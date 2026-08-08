/*  ═══════════════════════════════════════════════════════
    Memo.io — Offscreen Local LLM Inference Worker
    Runs INT4 ONNX inference (WebGPU preferred, WASM fallback).
    Session initialized ONCE and reused.
    ═══════════════════════════════════════════════════════ */

import * as ortModule from '../lib/ort.all.min.js';
import { AutoTokenizer, env } from '../lib/transformers.min.js';

const ort = ortModule.default || ortModule;

// Suppress uncaught extension context errors
self.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.message?.includes('Extension context invalidated')) {
    event.preventDefault();
  }
});

// Configure WASM path to local extension lib folder
if (typeof ort !== 'undefined' && ort.env && ort.env.wasm) {
  ort.env.wasm.wasmPaths = chrome.runtime.getURL('src/lib/');
}

if (typeof env !== 'undefined') {
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.useBrowserCache = false;
  env.useCustomCache = false;
  env.useFSCache = false;
}

let session = null;
let tokenizer = null;
let isInitializing = false;
let initPromise = null;
let modelStats = { loaded: false, ep: null, loadTimeMs: 0, error: null };

async function initModel() {
  if (session && tokenizer) return { session, tokenizer };
  if (isInitializing) return initPromise;

  isInitializing = true;
  initPromise = (async () => {
    const t0 = performance.now();
    try {
      const modelUrl = chrome.runtime.getURL('memoio-270m-int4.onnx');
      const tokenizerConfigUrl = chrome.runtime.getURL('memoio-270m-finetuned/tokenizer_config.json');

      // Pre-check if local ONNX binary is present
      const checkModel = await fetch(modelUrl, { method: 'HEAD' }).catch(() => null);
      if (!checkModel || !checkModel.ok) {
        const warningMsg = 'Local ONNX model ("memoio-270m-int4.onnx") is not present in bundle. Standby mode active.';
        modelStats = { loaded: false, ep: null, loadTimeMs: 0, error: warningMsg };
        return null;
      }

      // Pre-check if local tokenizer files are present before invoking AutoTokenizer
      const checkTok = await fetch(tokenizerConfigUrl, { method: 'HEAD' }).catch(() => null);
      if (!checkTok || !checkTok.ok) {
        const warningMsg = 'Local tokenizer ("memoio-270m-finetuned/") is not present in bundle. Standby mode active.';
        modelStats = { loaded: false, ep: null, loadTimeMs: 0, error: warningMsg };
        return null;
      }

      if (typeof AutoTokenizer === 'undefined') {
        throw new Error('Transformers AutoTokenizer failed to load.');
      }

      const tokenizerUrl = chrome.runtime.getURL('memoio-270m-finetuned/');
      tokenizer = await AutoTokenizer.from_pretrained(tokenizerUrl, {
        local_files_only: true
      });

      // Try WebGPU first, then WASM
      let epUsed = 'webgpu';
      try {
        session = await ort.InferenceSession.create(modelUrl, {
          executionProviders: ['webgpu', 'wasm'],
        });
      } catch (gpuErr) {
        console.warn('[Memo.io Offscreen] WebGPU fallback to WASM:', gpuErr);
        epUsed = 'wasm';
        session = await ort.InferenceSession.create(modelUrl, {
          executionProviders: ['wasm'],
        });
      }

      const t1 = performance.now();
      modelStats = {
        loaded: true,
        ep: epUsed,
        loadTimeMs: t1 - t0,
        error: null,
      };
      console.log(`[Memo.io Offscreen] Model ready (${epUsed}) in ${modelStats.loadTimeMs.toFixed(2)}ms.`);

      // Warmup run
      try {
        const dummyInput = tokenizer('Hello');
        const ids = new ort.Tensor('int64', BigInt64Array.from(dummyInput.input_ids.data.map(x => BigInt(x))), dummyInput.input_ids.dims);
        const mask = new ort.Tensor('int64', BigInt64Array.from(dummyInput.attention_mask.data.map(x => BigInt(x))), dummyInput.attention_mask.dims);
        await session.run({ input_ids: ids, attention_mask: mask });
        console.log('[Memo.io Offscreen] Model warmup completed.');
      } catch (wErr) {
        console.warn('[Memo.io Offscreen] Warmup note:', wErr);
      }

      return { session, tokenizer };
    } catch (err) {
      console.warn('[Memo.io Offscreen] Model init note:', err.message);
      modelStats = { loaded: false, ep: null, loadTimeMs: 0, error: err.message };
      session = null;
      tokenizer = null;
      return null;
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
}

// Pre-trigger model loading on offscreen startup silently
initModel().catch((e) => console.warn('[Memo.io Offscreen] Auto-init note:', e?.message || e));

// Handle long-lived port connections for streaming inference
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'memoio-inference') return;

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'PING') {
      port.postMessage({ type: 'PONG', stats: modelStats });
      return;
    }

    if (msg.type === 'GENERATE') {
      const prompt = msg.prompt || '';
      const maxNewTokens = msg.maxNewTokens || 64;

      try {
        const res = await initModel();
        if (!res || !res.session || !res.tokenizer) {
          port.postMessage({
            type: 'ERROR',
            error: modelStats.error || 'Local LLM model session unavailable.'
          });
          return;
        }

        const { session: sess, tokenizer: tok } = res;
        const tStartInference = performance.now();
        const inputs = tok(prompt);
        let currentIds = Array.from(inputs.input_ids.data).map(Number);
        const generatedTokenIds = [];
        let ttftMs = 0;

        for (let step = 0; step < maxNewTokens; step++) {
          const seqLen = currentIds.length;
          const inputIdsTensor = new ort.Tensor('int64', BigInt64Array.from(currentIds.map(BigInt)), [1, seqLen]);
          const maskTensor = new ort.Tensor('int64', BigInt64Array.from(new Array(seqLen).fill(1n)), [1, seqLen]);

          const results = await sess.run({
            input_ids: inputIdsTensor,
            attention_mask: maskTensor,
          });

          const tStepEnd = performance.now();
          if (step === 0) ttftMs = tStepEnd - tStartInference;

          const logitsData = results.logits.data;
          const vocabSize = results.logits.dims[2];
          const lastTokenOffset = (seqLen - 1) * vocabSize;

          let maxLogit = -Infinity;
          let nextId = 0;
          for (let v = 0; v < vocabSize; v++) {
            const val = logitsData[lastTokenOffset + v];
            if (val > maxLogit) {
              maxLogit = val;
              nextId = v;
            }
          }

          if (nextId === 1 || nextId === 107) break; // EOS

          generatedTokenIds.push(nextId);
          currentIds.push(nextId);

          const tokenStr = tok.decode([nextId], { skip_special_tokens: false });
          const textSoFar = tok.decode(generatedTokenIds, { skip_special_tokens: true });

          port.postMessage({
            type: 'TOKEN',
            token: tokenStr,
            textSoFar,
            step,
          });
        }

        const tEndInference = performance.now();
        const totalGenTimeMs = tEndInference - tStartInference;
        const numTokens = generatedTokenIds.length;
        const tokPerSec = numTokens > 0 ? (numTokens / (totalGenTimeMs / 1000)).toFixed(2) : '0';
        const fullText = tok.decode(generatedTokenIds, { skip_special_tokens: true });

        port.postMessage({
          type: 'COMPLETE',
          text: fullText,
          metrics: {
            loadTimeMs: modelStats.loadTimeMs,
            ttftMs,
            totalGenTimeMs,
            numTokens,
            tokPerSec: parseFloat(tokPerSec),
            ep: modelStats.ep,
          },
        });
      } catch (err) {
        console.error('[Memo.io Offscreen] Inference error:', err);
        port.postMessage({ type: 'ERROR', error: err.message || String(err) });
      }
    }
  });
});

// Also respond to standard runtime messages for non-port calls
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_MODEL_STATUS') {
    sendResponse(modelStats);
    return true;
  }
});
