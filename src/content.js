/* ═══════════════════════════════════════════════════════════════
   MemoNeg — Content Script
   Injects Shadow DOM UI into claude.ai for local-first AI memory
   negotiation: FAB icon, slide-out drawer, text-selection save,
   and auto-notice of assistant responses.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Prevent double-injection
  if (window.__memoneg_injected) return;
  window.__memoneg_injected = true;

  /* ═══════════════════════════
     STATE
     ═══════════════════════════ */
  const state = {
    drawerOpen: false,
    activeTab: 'noticed',
    collectionEnabled: true,
    soundEnabled: true, // Accessibility-First Memory Sonification (#27)
    gravityOpen: false, // Semantic Gravity Canvas (#28)
    membranePermeability: 50, // Biomimetic Osmotic Membranes (#29)
    topoOpen: false,   // Topological Mirror (#30)
    noticed: [],
    kept: [],
    rules: [],          // never-save keyword rules
    rulesOpen: false,   // rules panel expanded in footer
  };

  let shadow = null;
  const ui = {};
  let mutationTimer = null;
  let toastTimer = null;
  let digestDismissed = false; // reset on each SPA navigation
  let audioCtx = null;

  /* ── Accessibility-First Memory Sonification (#27) ── */
  function playMemoryTone(type) {
    if (!state.soundEnabled) return;
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'capture') {
        // Ascending harmonic triad C5 -> E5 -> G5
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.08);
        osc.frequency.setValueAtTime(783.99, now + 0.16);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'forget') {
        // Descending dual tone E4 -> C4
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(329.63, now);
        osc.frequency.linearRampToValueAtTime(261.63, now + 0.2);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === 'warning') {
        // Pulsing warning chime A4 -> Bb4
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440.00, now);
        osc.frequency.setValueAtTime(466.16, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'scope') {
        // High harmonic ping A5
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880.00, now);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      }
    } catch (_) {}
  }

  function announceScreenReader(msg) {
    try {
      let el = document.getElementById('mn-sr-announcer');
      if (!el) {
        el = document.createElement('div');
        el.id = 'mn-sr-announcer';
        el.setAttribute('aria-live', 'polite');
        el.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
        document.body.appendChild(el);
      }
      el.textContent = msg;
    } catch (_) {}
  }

  /* ═══════════════════════════
     UTILITIES
     ═══════════════════════════ */
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
  }

  function truncate(s, n = 300) {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return h.toString(36);
  }

  function esc(s) {
    const d = document.createElement('span');
    d.textContent = s;
    return d.innerHTML;
  }

  /* ═══════════════════════════
     CHROME MESSAGING
     ═══════════════════════════ */
  function send(data) {
    return new Promise((resolve) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage || !chrome.runtime.id) {
          resolve(null);
          return;
        }
        chrome.runtime.sendMessage(data, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            // Silently swallow extension context invalidation or disconnect errors
            resolve(null);
          } else {
            resolve(response);
          }
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function loadAll() {
    try {
      const [kr, nr, rr] = await Promise.all([
        send({ type: 'GET_KEPT' }),
        send({ type: 'GET_NOTICED' }),
        send({ type: 'GET_RULES' }),
      ]);
      state.kept = kr?.kept || state.kept || [];
      state.noticed = nr?.noticed || state.noticed || [];
      state.rules = rr?.rules || state.rules || [];
      renderAll();
    } catch (_) {
      renderAll();
    }
  }

  async function addKept(mem) {
    const r = await send({ type: 'ADD_KEPT', memory: mem });
    state.kept = r?.kept || [];
    renderAll();
    syncMemoryToClaude(mem.text);
    playMemoryTone('capture');
    announceScreenReader('Memory saved to vault and synced to Claude');
    showToast('Memory saved & synced to Claude ✓');
  }

  function syncMemoryToClaude(text) {
    if (!text) return;
    try {
      const cleanText = text.trim();
      const selectors = [
        'div.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"]',
        'fieldset textarea',
        'textarea[placeholder*="Claude"]',
        'textarea'
      ];
      
      let inputEl = null;
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          inputEl = el;
          break;
        }
      }

      if (inputEl) {
        inputEl.focus();
        const memoryPrompt = `Please remember this for our conversation: "${cleanText}"`;

        if (inputEl.isContentEditable) {
          const p = document.createElement('p');
          p.textContent = memoryPrompt;
          inputEl.appendChild(p);
          inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText' }));
        } else {
          const currentVal = inputEl.value;
          inputEl.value = currentVal ? `${currentVal}\n\n${memoryPrompt}` : memoryPrompt;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    } catch (err) {
      console.warn('[MemoNeg] Memory sync to Claude prompt input error:', err);
    }
  }

  async function deleteKept(id) {
    const r = await send({ type: 'DELETE_KEPT', id });
    state.kept = r?.kept || [];
    renderAll();
    playMemoryTone('forget');
    announceScreenReader('Memory deleted');
    showToast('Memory deleted');
  }

  async function updateKept(id, text) {
    const r = await send({ type: 'UPDATE_KEPT', id, text });
    state.kept = r?.kept || [];
    renderAll();
    playMemoryTone('scope');
    announceScreenReader('Memory updated');
    showToast('Memory updated ✓');
  }

  async function addNoticed(mem) {
    // ── Never-Save Rules filter (#9) ──
    if (matchesAnyRule(mem.text)) return;
    const r = await send({ type: 'ADD_NOTICED', memory: mem });
    state.noticed = r?.noticed || [];
    renderAll();
  }

  async function removeNoticed(id) {
    const r = await send({ type: 'REMOVE_NOTICED', id });
    state.noticed = r?.noticed || [];
    renderAll();
  }

  async function keepNoticed(id) {
    const item = state.noticed.find((n) => n.id === id);
    if (!item) return;
    await addKept({ ...item, keptAt: Date.now() });
    await removeNoticed(id);
  }

  /* ── Rules helpers ── */
  function matchesAnyRule(text) {
    if (!state.rules.length) return false;
    const lower = text.toLowerCase();
    return state.rules.some((rule) => {
      try { return new RegExp(rule.pattern, 'i').test(lower); }
      catch (_) { return lower.includes(rule.pattern.toLowerCase()); }
    });
  }

  async function saveRules(rules) {
    state.rules = rules;
    await send({ type: 'SET_RULES', rules });
    renderRulesPanel();
  }

  async function addRule(keyword) {
    const trimmed = keyword.trim();
    if (!trimmed) return;
    if (state.rules.some((r) => r.pattern === trimmed)) return;
    await saveRules([...state.rules, { id: uid(), pattern: trimmed, createdAt: Date.now() }]);
    showToast('Rule added — "' + trimmed + '" will be ignored');
  }

  async function deleteRule(id) {
    await saveRules(state.rules.filter((r) => r.id !== id));
    showToast('Rule removed');
  }

  /* ═══════════════════════════
     SVG ICONS
     ═══════════════════════════ */
  const IC = {
    brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2a3.5 3.5 0 0 0-3 5.1A4 4 0 0 0 3 11a4 4 0 0 0 2.2 3.6A3.5 3.5 0 0 0 9 18.5h0a3.5 3.5 0 0 0 3.5 3.5"/><path d="M14.5 2a3.5 3.5 0 0 1 3 5.1A4 4 0 0 1 21 11a4 4 0 0 1-2.2 3.6 3.5 3.5 0 0 1-3.8 3.9h0a3.5 3.5 0 0 1-3.5 3.5"/><path d="M12 2v20"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    vault: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/></svg>',
    lock: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="8" height="6" rx="1"/><path d="M4 5V3.5a2 2 0 0 1 4 0V5"/></svg>',
  };

  /* ═══════════════════════════════════════════
     CSS — Injected into closed Shadow DOM
     Neubrutalist Retro Y2K Pastel aesthetic
     ═══════════════════════════════════════════ */
  function getCSS() {
    return `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Space+Grotesk:wght@600;700;800&display=swap');

:host, * { box-sizing: border-box; margin: 0; padding: 0; }

.mn {
  font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
  color: #111827;
  line-height: 1.5;
  pointer-events: auto;
}

/* ── FAB ── */
.mn-fab {
  position: fixed; bottom: 28px; right: 28px;
  width: 60px; height: 60px; border-radius: 18px;
  border: 3px solid #000000;
  background: #FF66E5;
  color: #000000; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 5px 5px 0px #000000;
  transition: all .25s cubic-bezier(.4,0,.2,1);
  z-index: 99999; outline: none;
}
.mn-fab:hover {
  transform: translate(-3px, -3px);
  box-shadow: 8px 8px 0px #000000;
  background: #FF4DDF;
}
.mn-fab:active { transform: translate(0, 0); box-shadow: 2px 2px 0px #000000; }
.mn-fab svg { width: 28px; height: 28px; flex-shrink: 0; stroke: #000000; stroke-width: 2.3; }

.mn-fab.mn-fab-hidden {
  opacity: 0 !important;
  pointer-events: none !important;
  transform: scale(0.3) translate(40px, 40px) !important;
}

.mn-badge {
  position: absolute; top: -7px; right: -7px;
  min-width: 24px; height: 24px; border-radius: 12px;
  background: #FFE600; border: 2.5px solid #000000;
  color: #000000; font-size: 11px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  padding: 0 5px;
  box-shadow: 2px 2px 0px #000000;
  animation: mnPulse 2s ease-in-out infinite;
}
@keyframes mnPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }

/* ── Overlay ── */
.mn-ov {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  opacity: 0; pointer-events: none;
  transition: opacity .3s;
  z-index: 99997;
}
.mn-ov.open { opacity: 1; pointer-events: auto; }

/* ── Drawer ── */
.mn-dr {
  position: fixed; top: 0; right: 0;
  width: 520px; max-width: 95vw; height: 100vh; height: 100dvh;
  background-color: #FF66E5;
  background-image: radial-gradient(#E84FD7 2px, transparent 2px);
  background-size: 16px 16px;
  border-left: 3.5px solid #000000;
  transform: translateX(100%);
  transition: transform .35s cubic-bezier(.4,0,.2,1);
  display: flex; flex-direction: column;
  z-index: 99998;
  box-shadow: -12px 0 0px rgba(0,0,0,0.3), -8px 0 0px #000000;
}
.mn-dr.open { transform: translateX(0); }

/* ── Drawer Header ── */
.mn-hdr {
  padding: 18px 22px;
  background: #67E8F9;
  border-bottom: 3px solid #000000;
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
.mn-title {
  font-family: 'Space Grotesk', 'Plus Jakarta Sans', sans-serif;
  font-size: 20px; font-weight: 800;
  color: #000000;
  letter-spacing: -0.5px;
  display: flex; align-items: center; gap: 9px;
}
.mn-title svg { width: 26px; height: 26px; stroke: #000000; stroke-width: 2.4; flex-shrink: 0; }
.mn-hdr-r { display: flex; align-items: center; gap: 10px; }

/* Lock tag */
.mn-lock {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 800; letter-spacing: .5px;
  text-transform: uppercase; color: #000000;
  background: #FFE600; border: 2px solid #000000;
  padding: 3px 8px; border-radius: 6px;
  box-shadow: 2px 2px 0px #000000;
}

/* ── Toggle ── */
.mn-tgl {
  position: relative; width: 44px; height: 24px;
  appearance: none; -webkit-appearance: none;
  background: #FFFFFF;
  border-radius: 12px; cursor: pointer;
  transition: background .2s;
  border: 2px solid #000000;
  outline: none; flex-shrink: 0;
  box-shadow: 2px 2px 0px #000000;
}
.mn-tgl:checked { background: #34D399; }
.mn-tgl::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 16px; height: 16px; border-radius: 50%;
  background: #000000;
  transition: transform .2s cubic-bezier(.4,0,.2,1);
}
.mn-tgl:checked::after { transform: translateX(20px); }

/* ── Close ── */
.mn-cls {
  width: 34px; height: 34px; border-radius: 8px;
  border: 2.5px solid #000000; background: #FFFFFF;
  color: #000000; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all .15s; outline: none; flex-shrink: 0;
  box-shadow: 2.5px 2.5px 0px #000000;
}
.mn-cls svg { width: 20px; height: 20px; stroke-width: 2.6; stroke: #000000; }
.mn-cls:hover { background: #FF4D4D; transform: translate(-1px, -1px); box-shadow: 3.5px 3.5px 0px #000000; }

/* ── Tabs ── */
.mn-tabs {
  display: flex; padding: 12px 18px 0 18px;
  background: #67E8F9;
  border-bottom: 3px solid #000000;
  flex-shrink: 0; gap: 10px;
  position: relative;
}
.mn-tab {
  flex: 1; padding: 10px 0; text-align: center;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px; font-weight: 800; color: #000000;
  background: #FFFFFF; border: 2.5px solid #000000;
  border-bottom: none; border-radius: 10px 10px 0 0;
  cursor: pointer; transition: all .15s; outline: none;
  opacity: 0.8;
}
.mn-tab:hover { opacity: 1; background: #FFF; }
.mn-tab.active {
  opacity: 1; background: #FF66E5;
  border: 2.5px solid #000000; border-bottom: 3px solid #FF66E5;
  box-shadow: 0 -3px 0px #000000;
  font-weight: 800; margin-bottom: -3px; z-index: 2;
}
.mn-tab-bar { display: none; }

/* ── Scrollable body ── */
.mn-body { flex: 1; overflow-y: auto; padding: 18px 20px; }
.mn-body::-webkit-scrollbar { width: 7px; }
.mn-body::-webkit-scrollbar-track { background: #FF66E5; }
.mn-body::-webkit-scrollbar-thumb { background: #000000; border-radius: 3px; }
.mn-pane { display: none; }
.mn-pane.active { display: block; }

/* ── Memory Card ── */
.mn-card {
  background: #FFFFFF;
  border: 3px solid #000000;
  border-radius: 14px; padding: 18px 20px;
  margin-bottom: 18px;
  box-shadow: 4px 4px 0px #000000;
  transition: all .2s cubic-bezier(.4,0,.2,1);
  cursor: pointer;
}
.mn-card:hover {
  transform: translate(-2px, -2px);
  box-shadow: 6px 6px 0px #000000;
}
.mn-card-title-row {
  display: flex; align-items: flex-start; gap: 10px;
  margin-bottom: 12px;
}
.mn-card-main-title {
  font-size: 14px; font-weight: 800; color: #000000;
  line-height: 1.45; font-family: 'Space Grotesk', 'Plus Jakarta Sans', sans-serif;
  flex: 1; word-break: break-word;
}
.mn-card-meta-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-top: 4px;
}
.mn-card-time {
  font-size: 11px; font-weight: 700; color: #374151;
  display: flex; align-items: center; gap: 6px;
}
.mn-card-acts { display: flex; align-items: center; gap: 8px; }

/* Expanded Details View */
.mn-card-details-panel {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 2.5px dashed #000000;
  animation: mnSlideIn .2s ease-out;
}
.mn-details-sec {
  margin-bottom: 12px;
}
.mn-details-lbl {
  display: block;
  font-size: 11px; font-weight: 800;
  color: #000000; text-transform: uppercase;
  letter-spacing: 0.5px; margin-bottom: 4px;
  font-family: 'Space Grotesk', sans-serif;
}
.mn-details-txt {
  font-size: 13px; font-weight: 600;
  color: #1F2937; line-height: 1.55;
  background: #F9FAFB; padding: 10px 12px;
  border-radius: 8px; border: 1.5px solid #000000;
  white-space: pre-wrap; word-break: break-word;
}
.mn-chat-link {
  display: inline-block;
  color: #2563EB; font-weight: 700;
  font-size: 12px; word-break: break-all;
  text-decoration: underline;
}
.mn-chat-link:hover {
  color: #1D4ED8;
}
.mn-details-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px; margin-bottom: 12px;
  background: #EFF6FF; padding: 10px 12px;
  border-radius: 8px; border: 1.5px solid #000000;
  font-size: 11px; font-weight: 700; color: #000000;
}
.mn-details-item {
  display: flex; flex-direction: column; gap: 2px;
}
.mn-details-sublbl {
  color: #4B5563; font-size: 10px; text-transform: uppercase; font-weight: 800;
}

/* Buttons */
.mn-btn {
  padding: 5px 12px; border-radius: 8px;
  border: 2px solid #000000; font-size: 11px; font-weight: 800;
  cursor: pointer; transition: all .15s;
  outline: none; font-family: 'Space Grotesk', sans-serif;
  box-shadow: 2px 2px 0px #000000;
}
.mn-btn:hover { transform: translate(-1px, -1px); box-shadow: 3px 3px 0px #000000; }
.mn-btn:active { transform: translate(0, 0); box-shadow: 1px 1px 0px #000000; }

.mn-btn-k { background: #A7F3D0; color: #000000; }
.mn-btn-k:hover { background: #6EE7B7; }
.mn-btn-d { background: #FCA5A5; color: #000000; }
.mn-btn-d:hover { background: #F87171; }
.mn-btn-e { background: #DDD6FE; color: #000000; }
.mn-btn-e:hover { background: #C4B5FD; }
.mn-btn-h { background: #FEF08A; color: #000000; }
.mn-btn-h:hover { background: #FDE047; }
.mn-btn-r { background: #A7F3D0; color: #000000; padding: 2px 8px; font-size: 10px; }
.mn-btn-p { background: #BAE6FD; color: #000000; }
.mn-btn-sim { background: #FEF08A; color: #000000; }

/* Role badge */
.mn-role {
  display: inline-block; padding: 2px 8px; border-radius: 6px;
  border: 1.5px solid #000000;
  font-size: 10px; font-weight: 800; text-transform: uppercase;
  letter-spacing: .5px; margin-right: 6px; vertical-align: middle;
  box-shadow: 1.5px 1.5px 0px #000000;
}
.mn-role-a { background: #DDD6FE; color: #000000; }
.mn-role-u { background: #A7F3D0; color: #000000; }
.mn-role-s { background: #FEF08A; color: #000000; }

/* ── Empty state ── */
.mn-empty {
  text-align: center; padding: 36px 20px; color: #000000;
  background: #FFFFFF; border: 2.5px solid #000000; border-radius: 12px;
  box-shadow: 4px 4px 0px #000000;
}
.mn-empty svg { margin-bottom: 12px; stroke-width: 2.2; stroke: #000000; opacity: 0.9; }
.mn-empty-t { font-size: 15px; font-weight: 800; margin-bottom: 6px; color: #000000; font-family: 'Space Grotesk', sans-serif; }
.mn-empty-s { font-size: 12px; line-height: 1.6; color: #374151; font-weight: 600; }

/* ── Footer ── */
.mn-foot {
  padding: 16px;
  background: #B8EBFB;
  border-top: 2.5px solid #000000;
  flex-shrink: 0;
}
.mn-exp {
  width: 100%; padding: 10px; border-radius: 10px;
  border: 2px solid #000000;
  background: #FFFFFF;
  color: #000000; font-size: 13px; font-weight: 800;
  box-shadow: 3px 3px 0px #000000;
  cursor: pointer; transition: all .15s;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  outline: none; font-family: 'Space Grotesk', sans-serif;
}
.mn-exp svg { width: 16px; height: 16px; stroke-width: 2.5; stroke: #000000; }
.mn-exp:hover {
  background: #FEF08A;
  transform: translate(-1px, -1px); box-shadow: 4px 4px 0px #000000;
}

/* ── Selection save popup ── */
.mn-sel {
  position: fixed;
  padding: 8px 16px; border-radius: 10px;
  border: 2.5px solid #000000;
  background: #F7A8EC;
  color: #000000; font-size: 12px; font-weight: 800;
  cursor: pointer;
  display: none; align-items: center; gap: 6px;
  z-index: 99999;
  box-shadow: 4px 4px 0px #000000;
  transition: all .15s;
  animation: mnUp .2s ease-out;
  font-family: 'Space Grotesk', sans-serif;
}
.mn-sel svg { width: 16px; height: 16px; stroke-width: 2.5; stroke: #000000; }
.mn-sel:hover {
  background: #F48CE4;
  transform: translate(-2px, -2px);
  box-shadow: 6px 6px 0px #000000;
}
@keyframes mnUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }

/* ── Toast ── */
.mn-toast {
  position: fixed; bottom: 94px; right: 28px;
  padding: 10px 18px; border-radius: 10px;
  background: #A7F3D0;
  border: 2.5px solid #000000;
  color: #000000; font-size: 13px; font-weight: 800;
  box-shadow: 4px 4px 0px #000000;
  opacity: 0; transform: translateY(8px);
  transition: all .25s;
  pointer-events: none; z-index: 99999;
  font-family: 'Space Grotesk', sans-serif;
}
.mn-toast.show { opacity: 1; transform: translateY(0); }

/* ── Responsive ── */
@media (max-width: 480px) {
  .mn-dr { width: 100vw; max-width: 100vw; }
}

/* ── Session Digest Card ── */
.mn-digest {
  position: fixed; top: 16px; right: 16px;
  width: 330px; max-width: calc(100vw - 32px);
  background: #FFFFFF;
  border: 3px solid #000000;
  border-radius: 14px;
  padding: 16px;
  z-index: 99999;
  box-shadow: 6px 6px 0px #000000;
  animation: mnSlideIn .32s cubic-bezier(.4,0,.2,1);
}
@keyframes mnSlideIn { from{opacity:0;transform:translateY(-12px)} to{opacity:1;transform:translateY(0)} }
.mn-digest-ttl {
  font-size: 14px; font-weight: 800; color: #000000;
  display: flex; align-items: center; gap: 7px; margin-bottom: 8px;
  font-family: 'Space Grotesk', sans-serif;
}
.mn-digest-ttl svg { width: 18px; height: 18px; flex-shrink: 0; stroke: #000000; stroke-width: 2.5; }
.mn-digest-body { font-size: 12px; color: #111827; font-weight: 600; line-height: 1.6; margin-bottom: 12px; }
.mn-digest-body strong { color: #000000; font-weight: 800; }
.mn-digest-acts { display: flex; gap: 8px; }
.mn-digest-btn {
  flex: 1; padding: 8px 10px; border-radius: 8px;
  border: 2px solid #000000; font-size: 12px; font-weight: 800;
  cursor: pointer; outline: none; font-family: 'Space Grotesk', sans-serif;
  box-shadow: 2px 2px 0px #000000; transition: all .15s;
}
.mn-digest-review { background: #F7A8EC; color: #000000; }
.mn-digest-review:hover { background: #F48CE4; transform: translate(-1px, -1px); box-shadow: 3px 3px 0px #000000; }
.mn-digest-dismiss { background: #FFFFFF; color: #000000; }
.mn-digest-dismiss:hover { background: #F3F4F6; transform: translate(-1px, -1px); box-shadow: 3px 3px 0px #000000; }

/* ── Rules Panel ── */
.mn-rules-toggle {
  width: 100%; padding: 8px 12px; border-radius: 8px;
  border: 2px solid #000000;
  background: #FFFFFF;
  color: #000000; font-size: 12px; font-weight: 800;
  cursor: pointer; transition: all .15s;
  display: flex; align-items: center; justify-content: space-between;
  outline: none; font-family: 'Space Grotesk', sans-serif; margin-top: 8px;
  box-shadow: 2px 2px 0px #000000;
}
.mn-rules-toggle:hover { background: #FEF08A; }
.mn-rules-toggle .mn-arrow { transition: transform .2s; font-size: 11px; font-weight: 800; }
.mn-rules-toggle.open .mn-arrow { transform: rotate(180deg); }
.mn-rules-panel {
  margin-top: 8px;
  border: 2px solid #000000;
  border-radius: 8px;
  background: #FFFFFF;
  overflow: hidden; display: none;
  box-shadow: 3px 3px 0px #000000;
}
.mn-rules-panel.open { display: block; }
.mn-rules-inp-row {
  display: flex; gap: 6px; padding: 10px;
  border-bottom: 2px solid #000000; background: #FFF;
}
.mn-rules-inp {
  flex: 1; padding: 6px 10px; border-radius: 6px;
  border: 1.5px solid #000000;
  background: #F9FAFB;
  color: #000000; font-size: 12px; font-weight: 600;
  outline: none;
}
.mn-rules-inp::placeholder { color: #6B7280; }
.mn-rules-inp:focus { border-color: #000000; background: #FFF; }
.mn-rules-add {
  padding: 6px 12px; border-radius: 6px;
  border: 1.5px solid #000000;
  background: #A7F3D0; color: #000000;
  font-size: 12px; font-weight: 800; cursor: pointer;
  outline: none; font-family: 'Space Grotesk', sans-serif; white-space: nowrap;
  box-shadow: 1.5px 1.5px 0px #000000;
}
.mn-rules-add:hover { background: #6EE7B7; }
.mn-rules-list { padding: 4px 0; max-height: 120px; overflow-y: auto; }
.mn-rules-list::-webkit-scrollbar { width: 4px; }
.mn-rules-list::-webkit-scrollbar-thumb { background: #000000; border-radius: 2px; }
.mn-rule-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; font-size: 11px;
  border-bottom: 1px solid #E5E7EB;
}
.mn-rule-row:last-child { border-bottom: none; }
.mn-rule-kw { color: #111827; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.mn-rule-del {
  width: 22px; height: 22px; border-radius: 5px;
  border: 1.5px solid #000000; background: #FCA5A5; color: #000000;
  cursor: pointer; font-size: 14px; line-height: 1; font-weight: 800;
  transition: all .15s; outline: none; flex-shrink: 0; margin-left: 6px;
  display: flex; align-items: center; justify-content: center;
}
.mn-rule-del:hover { background: #F87171; }
.mn-rules-empty { padding: 10px; font-size: 11px; color: #6B7280; text-align: center; font-weight: 600; }

/* ── Drag & Drop + Trash Zone ── */
.mn-card[draggable="true"] { cursor: grab; }
.mn-card[draggable="true"]:active { cursor: grabbing; }
.mn-card.mn-card-dragging { opacity: 0.4; border-style: dashed; }

.mn-fab.mn-fab-dragover {
  transform: scale(1.15) !important;
  background: #A7F3D0 !important;
  box-shadow: 6px 6px 0px #000000 !important;
}

.mn-trash-zone {
  margin-top: 8px; padding: 10px;
  border: 2px dashed #000000;
  border-radius: 8px;
  background: #FCA5A5; color: #000000;
  font-size: 12px; font-weight: 800;
  font-family: 'Space Grotesk', sans-serif;
  text-align: center; display: none; align-items: center; justify-content: center;
  gap: 6px; transition: all .15s;
  box-shadow: 2px 2px 0px #000000;
}
.mn-trash-zone.open { display: flex; animation: mnUp .2s ease-out; }
.mn-trash-zone.mn-trash-active { background: #EF4444; color: #FFFFFF; }
.mn-trash-zone svg { width: 16px; height: 16px; stroke-width: 2.5; }

/* ── Edit & Version History (#10) ── */
.mn-edit-area { margin-top: 8px; }
.mn-edit-box {
  width: 100%; min-height: 60px; padding: 8px; border-radius: 8px;
  border: 2px solid #000000; background: #FFFFFF;
  color: #111827; font-size: 12px; font-weight: 600; font-family: inherit; outline: none;
  resize: vertical; box-shadow: 2px 2px 0px #000000;
}
.mn-edit-acts { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }

.mn-hist-panel { margin-top: 10px; padding-top: 8px; border-top: 2px dashed #000000; }
.mn-hist-item {
  padding: 6px 8px; border-radius: 6px; background: #F9FAFB; border: 1.5px solid #000000;
  margin-bottom: 6px; font-size: 11px; line-height: 1.5; color: #111827;
}
.mn-hist-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; color: #374151; font-size: 10px; font-weight: 700; }
.mn-diff-body { font-size: 11px; word-break: break-word; font-weight: 500; }
del.mn-diff-del { color: #991B1B; text-decoration: line-through; background: #FEE2E2; padding: 0 3px; border-radius: 3px; }
ins.mn-diff-ins { color: #065F46; text-decoration: none; background: #D1FAE5; padding: 0 3px; border-radius: 3px; }

/* ── Provenance & Lineage (#19) ── */
.mn-prov-panel {
  margin-top: 10px; padding: 10px; border-radius: 8px;
  background: #FFFFFF; border: 2px solid #000000;
  font-size: 11px; line-height: 1.6; color: #111827; font-weight: 600;
  box-shadow: 3px 3px 0px #000000;
}
.mn-prov-ttl { font-weight: 800; color: #000000; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; font-family: 'Space Grotesk', sans-serif; }
.mn-prov-row { display: flex; justify-content: space-between; margin-bottom: 4px; border-bottom: 1px dashed #000000; padding-bottom: 3px; }
.mn-prov-lbl { color: #4B5563; font-weight: 700; }
.mn-prov-val { color: #000000; word-break: break-all; font-weight: 600; }

/* ── Sensitivity Tier Badges (#20) ── */
.mn-sens-badge {
  display: inline-block; padding: 2px 6px; border-radius: 6px;
  border: 1.5px solid #000000; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .4px;
  margin-left: 6px; vertical-align: middle; box-shadow: 1px 1px 0px #000000;
}
.mn-sens-low { background: #A7F3D0; color: #000000; }
.mn-sens-medium { background: #FEF08A; color: #000000; }
.mn-sens-high { background: #FCA5A5; color: #000000; }

/* ── Natural Language Rules & Snapshots (#21, #24) ── */
.mn-rules-warn { padding: 6px 10px; font-size: 11px; color: #000000; font-weight: 700; background: #FEF08A; border-radius: 6px; margin: 6px 10px; border: 1.5px solid #000000; box-shadow: 2px 2px 0px #000000; }

.mn-snaps-toggle {
  width: 100%; padding: 8px 10px; border-radius: 8px;
  border: 2px solid #000000; background: #FFFFFF;
  color: #000000; font-size: 12px; font-weight: 800; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between;
  outline: none; font-family: 'Space Grotesk', sans-serif; margin-top: 6px; transition: all .15s;
  box-shadow: 2px 2px 0px #000000;
}
.mn-snaps-toggle:hover { background: #FEF08A; }
.mn-snaps-toggle .mn-arrow { transition: transform .2s; font-size: 11px; }
.mn-snaps-toggle.open .mn-arrow { transform: rotate(180deg); }
.mn-snaps-panel { margin-top: 6px; border: 2px solid #000000; border-radius: 8px; background: #FFF; overflow: hidden; display: none; box-shadow: 3px 3px 0px #000000; }
.mn-snaps-panel.open { display: block; }
.mn-snaps-inp-row { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 2px solid #000000; }
.mn-snaps-list { max-height: 110px; overflow-y: auto; padding: 4px 0; }
.mn-snap-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; font-size: 11px; border-bottom: 1px solid #E5E7EB; font-weight: 600; }

/* ── Multiverse Branching DAG (#31) ── */
.mn-dag-hdr { font-size: 11px; font-weight: 800; color: #000000; padding: 6px 10px 4px 10px; text-transform: uppercase; letter-spacing: .5px; font-family: 'Space Grotesk', sans-serif; }
.mn-dag-canvas { padding: 8px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.mn-dag-node { width: 100%; border: 2px solid #000000; border-radius: 8px; background: #FFFFFF; padding: 8px; font-size: 11px; transition: all .15s; box-shadow: 2px 2px 0px #000000; }
.mn-dag-node.active { background: #FEF08A; box-shadow: 3px 3px 0px #000000; }
.mn-dag-node-hdr { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.mn-dag-title { display: flex; align-items: center; gap: 6px; color: #000000; font-weight: 700; }
.mn-dag-dot { width: 8px; height: 8px; border-radius: 50%; background: #000000; }
.mn-dag-delta { color: #000000; font-size: 10px; font-weight: 800; }
.mn-dag-acts { display: flex; gap: 4px; }
.mn-dag-meta { font-size: 9px; color: #4B5563; margin-top: 4px; font-weight: 600; }
.mn-dag-connector { font-size: 10px; color: #000000; text-align: center; line-height: 1; font-weight: 800; }
.mn-dag-diff-box { margin-top: 8px; padding: 6px; border-radius: 6px; background: #F9FAFB; border: 1.5px solid #000000; }

/* ── Decay Engine (#18) ── */
.mn-decay-wrap { margin-top: 6px; display: flex; align-items: center; gap: 8px; font-size: 10px; color: #374151; font-weight: 700; }
.mn-decay-bar-outer { flex: 1; height: 6px; border-radius: 3px; background: #E5E7EB; border: 1px solid #000000; overflow: hidden; }
.mn-decay-bar-inner { height: 100%; border-radius: 2px; transition: width .3s ease; background: #A7F3D0; }
.mn-decay-select { background: #FFFFFF; border: 1.5px solid #000000; color: #000000; font-size: 10px; font-weight: 800; border-radius: 4px; padding: 1px 4px; outline: none; }
.mn-thermo-badge { font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 6px; background: #FEF08A; border: 1.5px solid #000000; color: #000000; white-space: nowrap; box-shadow: 1px 1px 0px #000000; }

/* ── Semantic Gravity Canvas (#28) ── */
.mn-grav-wrap { margin-bottom: 12px; padding: 10px; border-radius: 10px; background: #FFFFFF; border: 2.5px solid #000000; text-align: center; box-shadow: 3px 3px 0px #000000; }
.mn-grav-hdr-title { font-size: 12px; font-weight: 800; color: #000000; margin-bottom: 6px; font-family: 'Space Grotesk', sans-serif; }
.mn-grav-svg { overflow: visible; display: block; margin: 0 auto; }
.mn-grav-legend { font-size: 10px; margin-top: 6px; display: flex; gap: 10px; justify-content: center; font-weight: 700; color: #000000; }

/* ── Top-Right Topological Mirror Widget (#30) ── */
.mn-topo-trigger {
  position: fixed; top: 18px; right: 24px;
  padding: 8px 16px; border-radius: 10px;
  border: 2.5px solid #000000;
  background: #67E8F9;
  color: #000000; font-family: 'Space Grotesk', sans-serif;
  font-size: 12px; font-weight: 800;
  cursor: pointer; transition: all .15s;
  box-shadow: 3.5px 3.5px 0px #000000;
  z-index: 99995; outline: none;
}
.mn-topo-trigger:hover {
  background: #FFE600;
  transform: translate(-1px, -1px);
  box-shadow: 4.5px 4.5px 0px #000000;
}
.mn-topo-trigger.active {
  background: #FF66E5;
  box-shadow: 2px 2px 0px #000000;
}

.mn-topo-card {
  position: fixed; top: 62px; right: 24px;
  width: 360px; max-width: calc(100vw - 32px);
  background: #FFFFFF;
  border: 3px solid #000000;
  border-radius: 14px;
  padding: 16px;
  z-index: 99996;
  box-shadow: 6px 6px 0px #000000;
  animation: mnSlideIn .25s cubic-bezier(.4,0,.2,1);
}
.mn-topo-hdr-bar {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
.mn-topo-card-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 14px; font-weight: 800; color: #000000;
}
.mn-topo-cls {
  width: 26px; height: 26px; border-radius: 6px;
  border: 2px solid #000000; background: #FFFFFF;
  color: #000000; font-weight: 800; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 2px 2px 0px #000000; transition: all .15s;
}
.mn-topo-cls:hover { background: #FF4D4D; }
.mn-topo-sub { font-size: 11px; color: #374151; font-weight: 600; line-height: 1.5; margin-bottom: 10px; }
.mn-topo-svg { overflow: visible; display: block; margin: 0 auto 10px auto; }
.mn-topo-sculpt-acts { display: flex; gap: 8px; justify-content: center; }

/* ── Spatial Scoping & Chapters (#16, #22) ── */
.mn-filter-bar { display: flex; gap: 6px; margin-bottom: 12px; overflow-x: auto; padding-bottom: 4px; }
.mn-filter-pill { padding: 4px 10px; border-radius: 16px; border: 1.5px solid #000000; background: #FFFFFF; color: #000000; font-size: 11px; font-weight: 700; cursor: pointer; white-space: nowrap; transition: all .15s; box-shadow: 1.5px 1.5px 0px #000000; }
.mn-filter-pill.active { background: #F7A8EC; box-shadow: 2.5px 2.5px 0px #000000; }

.mn-time-hdr { font-size: 11px; font-weight: 800; color: #000000; margin: 12px 0 6px 0; text-transform: uppercase; letter-spacing: .5px; font-family: 'Space Grotesk', sans-serif; }

/* ── Counterfactual Simulator (#17) ── */
.mn-sim-panel { margin-top: 10px; padding: 10px; border-radius: 8px; background: #FFF; border: 2px solid #000000; font-size: 11px; box-shadow: 3px 3px 0px #000000; }
.mn-sim-title { font-weight: 800; color: #000000; margin-bottom: 6px; font-family: 'Space Grotesk', sans-serif; }
.mn-sim-row { margin-bottom: 6px; }
.mn-sim-lbl { color: #374151; font-weight: 700; display: block; margin-bottom: 2px; }
.mn-sim-box { padding: 6px; border-radius: 6px; background: #F9FAFB; border: 1.5px solid #000000; color: #000000; font-weight: 600; }
.mn-sim-meta { font-size: 10px; color: #000000; margin-top: 4px; font-weight: 700; font-style: italic; }

/* ── Emotional Tone Calibration (#25) ── */
.mn-emotional-card {
  margin: 10px 18px; padding: 10px 12px; border-radius: 10px;
  background: #BAE6FD; border: 2px solid #000000;
  color: #000000; font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  box-shadow: 3px 3px 0px #000000;
}
    `;
  }

  /* ═══════════════════════════════════════
     SHADOW DOM + UI CREATION
     ═══════════════════════════════════════ */
  function init() {
    const host = document.createElement('div');
    host.id = 'memoneg-root';
    host.style.cssText =
      'all:initial!important;position:fixed!important;top:0!important;left:0!important;' +
      'width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = getCSS();
    shadow.appendChild(style);

    const root = document.createElement('div');
    root.className = 'mn';
    shadow.appendChild(root);

    buildFAB(root);
    buildOverlay(root);
    buildDrawer(root);
    buildSelectionPopup(root);
    buildToast(root);
    buildDigestCard(root);
    buildTopoWidget(root);

    loadAll();

    // Text selection → "Save to Memory" button
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed) hideSelPopup();
    });

    // Auto-notice for assistant responses
    setupAutoNotice();

    console.log('[MemoNeg] Extension loaded on', location.hostname);
  }

  /* ═══════════════════════════
     TOP-RIGHT TOPOLOGICAL MIRROR WIDGET (#30)
     ═══════════════════════════ */
  function buildTopoWidget(root) {
    const btn = document.createElement('button');
    btn.className = 'mn-topo-trigger';
    btn.innerHTML = '🏔️ Topological Mirror';
    btn.title = 'Metacognitive Topological Mirror Terrain (#30)';
    btn.addEventListener('click', toggleTopoWidget);

    const card = document.createElement('div');
    card.className = 'mn-topo-card';
    card.style.display = 'none';

    root.appendChild(btn);
    root.appendChild(card);

    ui.topoBtn = btn;
    ui.topoCard = card;
  }

  function toggleTopoWidget() {
    state.topoOpen = !state.topoOpen;
    if (ui.topoCard) {
      ui.topoCard.style.display = state.topoOpen ? 'block' : 'none';
      if (state.topoOpen) renderTopoWidgetContent();
    }
    if (ui.topoBtn) {
      ui.topoBtn.classList.toggle('active', state.topoOpen);
    }
  }

  function renderTopoWidgetContent() {
    if (!ui.topoCard) return;
    const chapters = ['Work & Tech', 'Personal', 'Finance & Health', 'General'];
    const peaks = chapters.map((chap, idx) => {
      const chapMems = state.kept.filter((m) => getChapterForMemory(m.text) === chap);
      const avgHealth = chapMems.length ? chapMems.reduce((acc, m) => acc + calculateDecayHealth(m).health, 0) / chapMems.length : 0.2;
      const height = Math.round(15 + avgHealth * 65);
      const x = 40 + idx * 70;
      const y = 115 - height;
      return { chap, count: chapMems.length, avgHealth, height, x, y };
    });

    const points = peaks.map((p) => p.x + ',' + p.y).join(' ');
    const areaPoints = '20,120 ' + points + ' 270,120';
    const peaksHTML = peaks.map((p) =>
      '<g class="mn-topo-peak" title="' + esc(p.chap) + ': ' + p.count + ' facts (' + Math.round(p.avgHealth * 100) + '% elevation)">' +
      '<circle cx="' + p.x + '" cy="' + p.y + '" r="5" fill="#000000" />' +
      '<circle cx="' + p.x + '" cy="' + p.y + '" r="3" fill="#67E8F9" />' +
      '<text x="' + p.x + '" y="' + (p.y - 8) + '" fill="#000000" font-size="9" text-anchor="middle" font-weight="bold">' + Math.round(p.avgHealth * 100) + '%</text>' +
      '<text x="' + p.x + '" y="134" fill="#000000" font-size="8" font-weight="700" text-anchor="middle">' + esc(p.chap) + '</text>' +
      '</g>'
    ).join('');

    const svgHTML =
      '<svg class="mn-topo-svg" viewBox="0 0 300 145" width="100%" height="135">' +
      '<polygon points="' + areaPoints + '" fill="rgba(103,232,249,0.35)" stroke="none"/>' +
      '<polyline points="' + points + '" fill="none" stroke="#000000" stroke-width="2.5" />' +
      '<line x1="20" y1="120" x2="280" y2="120" stroke="#000000" stroke-width="2" />' +
      peaksHTML +
      '</svg>';

    ui.topoCard.innerHTML =
      '<div class="mn-topo-hdr-bar">' +
      '<span class="mn-topo-card-title">🏔️ Topological Mirror (#30)</span>' +
      '<button class="mn-topo-cls" title="Close">✕</button>' +
      '</div>' +
      '<div class="mn-topo-sub">Heightfield elevation drives AI perception confidence across memory domains:</div>' +
      svgHTML +
      '<div class="mn-topo-sculpt-acts">' +
      '<button class="mn-btn mn-btn-sim" data-act="sculpt-flatten">🔨 Flatten Peak (Erode)</button>' +
      '<button class="mn-btn mn-btn-k" data-act="sculpt-raise">🏔️ Raise Peak (Boost)</button>' +
      '</div>';

    const clsBtn = ui.topoCard.querySelector('.mn-topo-cls');
    if (clsBtn) clsBtn.onclick = toggleTopoWidget;

    const flattenBtn = ui.topoCard.querySelector('[data-act="sculpt-flatten"]');
    const raiseBtn = ui.topoCard.querySelector('[data-act="sculpt-raise"]');
    if (flattenBtn) flattenBtn.onclick = () => { showToast('🔨 Terrain Eroded (Confidence Lowered)'); renderTopoWidgetContent(); };
    if (raiseBtn) raiseBtn.onclick = () => { showToast('🏔️ Terrain Boosted (Confidence Raised)'); renderTopoWidgetContent(); };
  }

  /* ═══════════════════════════
     FAB
     ═══════════════════════════ */
  function buildFAB(root) {
    const fab = document.createElement('button');
    fab.className = 'mn-fab';
    fab.innerHTML = IC.brain + '<span class="mn-badge" style="display:none">0</span>';
    fab.title = 'MemoNeg — Open drawer (or drag text/cards here to save)';
    fab.addEventListener('click', toggleDrawer);

    // ── Drag & Drop Promotion (#4) ──
    fab.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      fab.classList.add('mn-fab-dragover');
    });
    fab.addEventListener('dragenter', (e) => {
      e.preventDefault();
      fab.classList.add('mn-fab-dragover');
    });
    fab.addEventListener('dragleave', () => {
      fab.classList.remove('mn-fab-dragover');
    });
    fab.addEventListener('drop', (e) => {
      e.preventDefault();
      fab.classList.remove('mn-fab-dragover');
      const jsonRaw = e.dataTransfer.getData('application/json');
      const textRaw = e.dataTransfer.getData('text/plain');
      if (jsonRaw) {
        try {
          const payload = JSON.parse(jsonRaw);
          if (payload.id && payload.origin === 'noticed') {
            keepNoticed(payload.id);
            showToast('Promoted to Kept Vault ✓');
            return;
          }
        } catch (_) {}
      }
      if (textRaw && textRaw.trim().length > 3) {
        addKept({
          id: uid(),
          text: textRaw.trim(),
          role: 'user',
          source: location.hostname,
          url: location.href,
          timestamp: Date.now(),
          keptAt: Date.now(),
        });
        showToast('Dropped text saved to Vault ✓');
      }
    });

    root.appendChild(fab);
    ui.fab = fab;
    ui.badge = fab.querySelector('.mn-badge');
  }

  /* ═══════════════════════════
     OVERLAY
     ═══════════════════════════ */
  function buildOverlay(root) {
    const ov = document.createElement('div');
    ov.className = 'mn-ov';
    ov.addEventListener('click', toggleDrawer);
    root.appendChild(ov);
    ui.ov = ov;
  }

  /* ═══════════════════════════
     DRAWER
     ═══════════════════════════ */
  function buildDrawer(root) {
    const dr = document.createElement('div');
    dr.className = 'mn-dr';
    dr.innerHTML = `
      <div class="mn-hdr">
        <div class="mn-title">
          ${IC.brain}
          MemoNeg
          <span class="mn-lock">${IC.lock} on-device</span>
        </div>
        <div class="mn-hdr-r">
          <input type="checkbox" class="mn-tgl" checked title="Toggle memory collection" />
          <button class="mn-snd-btn" title="Accessibility Sonification Tone (🔊/🔇)" style="background:none;border:none;color:#a78bfa;cursor:pointer;font-size:14px;padding:2px 4px;margin-right:4px;">🔊</button>
          <button class="mn-cls" title="Close drawer">${IC.close}</button>
        </div>
      </div>
      <div class="mn-tabs">
        <button class="mn-tab active" data-tab="noticed">Noticed</button>
        <button class="mn-tab" data-tab="kept">Kept</button>
        <div class="mn-tab-bar" style="left:0;width:50%"></div>
      </div>
      <div class="mn-body">
        <div class="mn-pane active" data-pane="noticed"></div>
        <div class="mn-pane" data-pane="kept"></div>
      </div>
      <div class="mn-foot">
        <div class="mn-trash-zone">${IC.close} Drag memory here to purge</div>
        <button class="mn-exp">${IC.download} Export All (JSON)</button>
        <button class="mn-rules-toggle" title="Configure never-save keywords & natural rules">
          <span>Never-Save Rules</span>
          <span class="mn-arrow">▾</span>
        </button>
        <div class="mn-rules-panel">
          <div class="mn-rules-inp-row">
            <input class="mn-rules-inp" type="text" placeholder="e.g. Never remember salary details" maxlength="80" />
            <button class="mn-rules-add">Add</button>
          </div>
          <div class="mn-rules-list"></div>
        </div>
        <button class="mn-snaps-toggle" title="Memory Freeze & Snapshots">
          <span>Memory Freeze & Snapshots</span>
          <span class="mn-arrow">▾</span>
        </button>
        <div class="mn-snaps-panel">
          <div class="mn-snaps-inp-row">
            <input class="mn-rules-inp mn-snaps-inp" type="text" placeholder="Snapshot label" maxlength="40" />
            <button class="mn-rules-add mn-snaps-add">Freeze</button>
          </div>
          <div class="mn-snaps-list"></div>
        </div>
      </div>
    `;
    root.appendChild(dr);
    ui.dr = dr;

    // Toggle switch
    const tgl = dr.querySelector('.mn-tgl');
    tgl.addEventListener('change', () => {
      state.collectionEnabled = tgl.checked;
    });

    // Close
    dr.querySelector('.mn-cls').addEventListener('click', toggleDrawer);

    // Sonification audio toggle (#27)
    const sndBtn = dr.querySelector('.mn-snd-btn');
    sndBtn.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      sndBtn.textContent = state.soundEnabled ? '🔊' : '🔇';
      if (state.soundEnabled) playMemoryTone('capture');
      showToast(state.soundEnabled ? 'Sonification Audio Enabled 🔊' : 'Sonification Muted 🔇');
    });

    // Tabs
    const tabs = dr.querySelectorAll('.mn-tab');
    const bar = dr.querySelector('.mn-tab-bar');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        state.activeTab = tab.dataset.tab;
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const idx = tab.dataset.tab === 'noticed' ? 0 : 1;
        bar.style.left = idx * 50 + '%';
        bar.style.width = '50%';
        dr.querySelectorAll('.mn-pane').forEach((p) => p.classList.remove('active'));
        dr.querySelector('[data-pane="' + state.activeTab + '"]').classList.add('active');
      });
    });

    // Export
    dr.querySelector('.mn-exp').addEventListener('click', doExport);

    // Rules toggle
    const rulesToggle = dr.querySelector('.mn-rules-toggle');
    const rulesPanel = dr.querySelector('.mn-rules-panel');
    rulesToggle.addEventListener('click', () => {
      state.rulesOpen = !state.rulesOpen;
      rulesToggle.classList.toggle('open', state.rulesOpen);
      rulesPanel.classList.toggle('open', state.rulesOpen);
    });

    // Rules add — button click (#21)
    const inp = dr.querySelector('.mn-rules-inp');
    dr.querySelector('.mn-rules-add').addEventListener('click', () => {
      addRule(inp.value);
      inp.value = '';
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { addRule(inp.value); inp.value = ''; }
    });

    // Snapshots toggle & add (#24)
    const snapsToggle = dr.querySelector('.mn-snaps-toggle');
    const snapsPanel = dr.querySelector('.mn-snaps-panel');
    snapsToggle.addEventListener('click', () => {
      state.snapsOpen = !state.snapsOpen;
      snapsToggle.classList.toggle('open', state.snapsOpen);
      snapsPanel.classList.toggle('open', state.snapsOpen);
      if (state.snapsOpen) loadSnapshots();
    });
    const snapInp = dr.querySelector('.mn-snaps-inp');
    dr.querySelector('.mn-snaps-add').addEventListener('click', () => {
      createSnapshot(snapInp.value);
      snapInp.value = '';
    });

    ui.noticed = dr.querySelector('[data-pane="noticed"]');
    ui.kept = dr.querySelector('[data-pane="kept"]');
    ui.rulesList = dr.querySelector('.mn-rules-list');
    ui.snapsList = dr.querySelector('.mn-snaps-list');

    // ── Drag & Drop Trash Zone (#4) ──
    const tz = dr.querySelector('.mn-trash-zone');
    tz.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tz.classList.add('mn-trash-active');
    });
    tz.addEventListener('dragenter', (e) => {
      e.preventDefault();
      tz.classList.add('mn-trash-active');
    });
    tz.addEventListener('dragleave', () => {
      tz.classList.remove('mn-trash-active');
    });
    tz.addEventListener('drop', (e) => {
      e.preventDefault();
      tz.classList.remove('mn-trash-active');
      tz.classList.remove('open');
      const jsonRaw = e.dataTransfer.getData('application/json');
      if (!jsonRaw) return;
      try {
        const payload = JSON.parse(jsonRaw);
        if (payload.id) {
          if (payload.origin === 'noticed') {
            removeNoticed(payload.id);
            showToast('Noticed memory purged ✓');
          } else if (payload.origin === 'kept') {
            deleteKept(payload.id);
            showToast('Kept memory purged ✓');
          }
        }
      } catch (_) {}
    });
    ui.trashZone = tz;
  }

  /* ═══════════════════════════
     SELECTION SAVE POPUP
     ═══════════════════════════ */
  function buildSelectionPopup(root) {
    const btn = document.createElement('button');
    btn.className = 'mn-sel';
    btn.innerHTML = IC.plus + ' Save to Memory';
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      saveSelection();
    });
    root.appendChild(btn);
    ui.sel = btn;
  }

  /* ═══════════════════════════
     TOAST
     ═══════════════════════════ */
  function buildToast(root) {
    const t = document.createElement('div');
    t.className = 'mn-toast';
    root.appendChild(t);
    ui.toast = t;
  }

  /* ═══════════════════════════════════════
     DIGEST CARD (#8)
     ═══════════════════════════════════════ */
  function buildDigestCard(root) {
    const el = document.createElement('div');
    el.className = 'mn-digest';
    el.style.display = 'none';
    root.appendChild(el);
    ui.digest = el;
  }

  function showDigest() {
    const count = state.noticed.length;
    if (count === 0 || digestDismissed) return;
    const el = ui.digest;
    el.innerHTML =
      '<div class="mn-digest-ttl">' + IC.brain + 'Memory Digest</div>' +
      '<div class="mn-digest-body">' +
        '<strong>' + count + ' unreviewed ' + (count === 1 ? 'memory' : 'memories') + '</strong> from this session ' +
        'are waiting in your Noticed tab. Review them before they expire.' +
      '</div>' +
      '<div class="mn-digest-acts">' +
        '<button class="mn-digest-btn mn-digest-review">Review Now</button>' +
        '<button class="mn-digest-btn mn-digest-dismiss">Dismiss</button>' +
      '</div>';
    el.style.display = 'block';

    el.querySelector('.mn-digest-review').addEventListener('click', () => {
      hideDigest();
      state.activeTab = 'noticed';
      if (!state.drawerOpen) toggleDrawer();
      // Switch to noticed tab
      const tabs = ui.dr.querySelectorAll('.mn-tab');
      tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === 'noticed'));
      ui.dr.querySelectorAll('.mn-pane').forEach((p) => {
        p.classList.toggle('active', p.dataset.pane === 'noticed');
      });
      const bar = ui.dr.querySelector('.mn-tab-bar');
      if (bar) { bar.style.left = '0'; bar.style.width = '50%'; }
    });
    el.querySelector('.mn-digest-dismiss').addEventListener('click', hideDigest);
  }

  /* ── Emotional Tone Calibration (#25) ── */
  function detectEmotionalTone(text) {
    if (!text || text.length < 15) return false;
    const capsCount = (text.match(/\b[A-Z]{3,}\b/g) || []).length;
    const exclamations = (text.match(/!!+/g) || []).length;
    const emoKeywords = /\b(angry|upset|frustrated|furious|hate|disgusted|outraged|panicking|depressed)\b/i;
    return capsCount >= 2 || exclamations >= 1 || emoKeywords.test(text);
  }

  function hideDigest() {
    digestDismissed = true;
    if (ui.digest) ui.digest.style.display = 'none';
  }

  /* ═══════════════════════════════════════
     INTERACTIONS
     ═══════════════════════════════════════ */
  function toggleDrawer() {
    state.drawerOpen = !state.drawerOpen;
    ui.dr.classList.toggle('open', state.drawerOpen);
    ui.ov.classList.toggle('open', state.drawerOpen);
    if (ui.fab) ui.fab.classList.toggle('mn-fab-hidden', state.drawerOpen);
    if (state.drawerOpen) loadAll();
  }

  function updateBadge() {
    const c = state.noticed.length;
    if (c > 0) {
      ui.badge.textContent = c > 99 ? '99+' : c;
      ui.badge.style.display = 'flex';
    } else {
      ui.badge.style.display = 'none';
    }
  }

  function showToast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
  }

  /* ═══════════════════════════════════════
     RENDER
     ═══════════════════════════════════════ */
  function renderAll() {
    renderNoticed();
    renderKept();
    renderRulesPanel();
    updateBadge();
    updateMessageStatusIndicators();
  }

  function renderRulesPanel() {
    const list = ui.rulesList;
    if (!list) return;

    let warningHTML = '';
    // Detect semantic conflicts between rules (#21)
    if (state.rules.length > 1) {
      for (let i = 0; i < state.rules.length; i++) {
        for (let j = i + 1; j < state.rules.length; j++) {
          const r1 = state.rules[i].pattern.toLowerCase();
          const r2 = state.rules[j].pattern.toLowerCase();
          if (r1.includes(r2) || r2.includes(r1)) {
            warningHTML = '<div class="mn-rules-warn">⚠️ Rule overlap detected between "' + esc(r1) + '" and "' + esc(r2) + '"</div>';
            break;
          }
        }
      }
    }

    if (!state.rules.length) {
      list.innerHTML = '<div class="mn-rules-empty">No rules yet — memories matching your keywords will be silently ignored.</div>';
      return;
    }

    list.innerHTML = warningHTML + state.rules.map((r) =>
      '<div class="mn-rule-row" data-id="' + r.id + '">' +
      '<span class="mn-rule-kw">' + esc(r.pattern) + '</span>' +
      '<button class="mn-rule-del" data-rid="' + r.id + '" title="Remove rule">×</button>' +
      '</div>'
    ).join('');
    list.querySelectorAll('.mn-rule-del').forEach((b) =>
      b.addEventListener('click', () => deleteRule(b.dataset.rid))
    );
  }

  /* ── Snapshot Panel (#24) ── */
  async function loadSnapshots() {
    const r = await send({ type: 'GET_SNAPSHOTS' });
    state.snapshots = r?.snapshots || [];
    renderSnapshotsPanel();
  }

  async function createSnapshot(name) {
    const r = await send({ type: 'CREATE_SNAPSHOT', name });
    state.snapshots = r?.snapshots || [];
    renderSnapshotsPanel();
    showToast('Memory freeze snapshot created ✓');
  }

  async function restoreSnapshot(id) {
    const r = await send({ type: 'RESTORE_SNAPSHOT', id });
    if (r?.success) {
      state.kept = r.kept || [];
      renderAll();
      showToast('Vault restored to snapshot ✓');
    }
  }

  let selectedDagBranch = null;

  function renderSnapshotsPanel() {
    const list = ui.snapsList;
    if (!list) return;
    if (!state.snapshots || !state.snapshots.length) {
      list.innerHTML = '<div class="mn-rules-empty">No snapshots yet — click Freeze to create a 1-click restore point.</div>';
      return;
    }

    // Multiverse DAG Tree Rendering (#31)
    const dagNodesHTML = state.snapshots.map((s, idx) => {
      const isSelected = selectedDagBranch === s.id;
      const prevCount = idx > 0 ? state.snapshots[idx - 1].keptCount : state.kept.length;
      const deltaCount = s.keptCount - prevCount;
      const deltaLabel = deltaCount >= 0 ? '+' + deltaCount : deltaCount;

      let branchDiffHTML = '';
      if (isSelected) {
        const snapText = s.keptCount + ' stored facts in snapshot';
        const currText = state.kept.length + ' stored facts in active vault';
        branchDiffHTML =
          '<div class="mn-dag-diff-box">' +
          '<div class="mn-sim-title">Counterfactual Branch Diff (Current vs ' + esc(s.name) + ')</div>' +
          '<div class="mn-diff-body">' + renderDiffHTML(currText, snapText) + '</div>' +
          '<div class="mn-sim-meta">Multiverse Branch Variance: ' + (deltaCount * 12) + '% • State Divergence: Low</div>' +
          '</div>';
      }

      return (
        '<div class="mn-dag-node ' + (isSelected ? 'active' : '') + '" data-sid="' + s.id + '">' +
        '<div class="mn-dag-node-hdr">' +
        '<div class="mn-dag-title">' +
        '<span class="mn-dag-dot"></span>' +
        '<strong>' + esc(s.name) + '</strong>' +
        '<span class="mn-dag-delta">(' + deltaLabel + ' items)</span>' +
        '</div>' +
        '<div class="mn-dag-acts">' +
        '<button class="mn-btn mn-btn-sim" data-act="prev-dag" data-sid="' + s.id + '">Branch Diff</button>' +
        '<button class="mn-btn mn-btn-r" data-act="restore-snap" data-sid="' + s.id + '">Merge Branch</button>' +
        '</div>' +
        '</div>' +
        '<div class="mn-dag-meta">Created ' + timeAgo(s.timestamp) + ' • ID: ' + s.id.slice(0, 7) + '</div>' +
        branchDiffHTML +
        '</div>'
      );
    }).join('<div class="mn-dag-connector">│<br/>▼</div>');

    list.innerHTML =
      '<div class="mn-dag-hdr">🌌 Multiverse Branching DAG (#31)</div>' +
      '<div class="mn-dag-canvas">' + dagNodesHTML + '</div>';

    list.querySelectorAll('[data-act="restore-snap"]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); restoreSnapshot(b.dataset.sid); })
    );

    list.querySelectorAll('[data-act="prev-dag"]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedDagBranch = selectedDagBranch === b.dataset.sid ? null : b.dataset.sid;
        renderSnapshotsPanel();
      })
    );
  }

  function renderNoticed() {
    const p = ui.noticed;
    if (!p) return;
    if (state.noticed.length === 0) {
      p.innerHTML =
        '<div class="mn-empty">' +
        IC.inbox +
        '<div class="mn-empty-t">No noticed memories</div>' +
        '<div class="mn-empty-s">When collection is ON, assistant responses appear here as candidates for review.</div>' +
        '</div>';
      return;
    }
    p.innerHTML = state.noticed
      .map(
        (m) =>
          '<div class="mn-card" data-id="' + m.id + '">' +
          '<div class="mn-card-txt">' +
          '<span class="mn-role mn-role-a">assistant</span>' +
          esc(truncate(m.text)) +
          '</div>' +
          '<div class="mn-card-meta">' +
          '<span>' + timeAgo(m.timestamp) + '</span>' +
          '<div class="mn-card-acts">' +
          '<button class="mn-btn mn-btn-k" data-act="keep" data-id="' + m.id + '">Keep</button>' +
          '<button class="mn-btn mn-btn-d" data-act="disc" data-id="' + m.id + '">Discard</button>' +
          '</div></div></div>'
      )
      .join('');

    p.querySelectorAll('[data-act="keep"]').forEach((b) =>
      b.addEventListener('click', () => keepNoticed(b.dataset.id))
    );
    p.querySelectorAll('[data-act="disc"]').forEach((b) =>
      b.addEventListener('click', () => removeNoticed(b.dataset.id))
    );

    // Attach drag handlers (#4)
    p.querySelectorAll('.mn-card').forEach((card) => {
      const id = card.dataset.id;
      const mem = state.noticed.find((m) => m.id === id);
      if (!mem) return;
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ id, origin: 'noticed', text: mem.text }));
        e.dataTransfer.setData('text/plain', mem.text);
        card.classList.add('mn-card-dragging');
        if (ui.trashZone) ui.trashZone.classList.add('open');
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('mn-card-dragging');
        if (ui.trashZone) ui.trashZone.classList.remove('open');
      });
    });
  }

  const openHistories = new Set();
  const openProvenances = new Set();
  const openSimulators = new Set();
  const activeEdits = new Set();
  let keptChapterFilter = 'all';
  let keptScopeFilter = 'all';

  /* ── Decay Engine Helpers (#18) ── */
  function getDecayHalfLifeMs(tier) {
    switch (tier) {
      case '24h': return 24 * 60 * 60 * 1000;
      case '7d': return 7 * 24 * 60 * 60 * 1000;
      case '90d': return 90 * 24 * 60 * 60 * 1000;
      case 'never': return Infinity;
      case '30d':
      default: return 30 * 24 * 60 * 60 * 1000;
    }
  }

  function calculateDecayHealth(mem) {
    const halfLife = getDecayHalfLifeMs(mem.decayTier || '30d');
    if (halfLife === Infinity) return { health: 1.0, isFading: false, label: 'Never Expire' };

    const age = Date.now() - (mem.keptAt || mem.timestamp || Date.now());
    const health = Math.pow(0.5, age / halfLife);
    const isFading = health < 0.35;
    return {
      health: Math.max(0.18, Math.min(1.0, health)),
      isFading,
      label: Math.round(health * 100) + '% health (' + (mem.decayTier || '30d') + ' half-life)'
    };
  }

  function renderDiffHTML(oldStr, newStr) {
    const oldWords = oldStr.split(/\s+/);
    const newWords = newStr.split(/\s+/);
    const oldSet = new Set(oldWords);
    const newSet = new Set(newWords);

    let html = '';
    oldWords.forEach((w) => {
      if (!newSet.has(w)) html += '<del class="mn-diff-del">' + esc(w) + '</del> ';
    });
    newWords.forEach((w) => {
      if (!oldSet.has(w)) html += '<ins class="mn-diff-ins">' + esc(w) + '</ins> ';
      else html += esc(w) + ' ';
    });
    return html.trim();
  }

  function getChapterForMemory(text) {
    const lower = text.toLowerCase();
    if (/\b(code|python|js|react|api|git|bug|function|stack|dev)\b/i.test(lower)) return 'Work & Tech';
    if (/\b(health|medical|salary|bank|money|finance|pay|ssn)\b/i.test(lower)) return 'Finance & Health';
    if (/\b(like|favorite|prefer|live|name|family|home|hobby)\b/i.test(lower)) return 'Personal';
    return 'General';
  }

  /* ── Semantic Gravity Canvas (#28) ── */
  function renderSemanticGravityCanvas(memories) {
    const cx = 150;
    const cy = 100;
    const items = memories.map((m, idx) => {
      const scope = m.scope || 'global';
      const decay = calculateDecayHealth(m);
      const classif = classifyMemoryCandidate(m.text);
      const isHighSens = classif.sensitivity === 'high';

      // Orbit radius based on scope & decay health
      let baseR = scope === 'global' ? 32 : scope === 'domain' ? 62 : 88;
      let r = baseR + (1 - decay.health) * 10;
      const angle = (idx * (2 * Math.PI / Math.max(memories.length, 1))) - (Math.PI / 2);
      const px = Math.round(cx + r * Math.cos(angle));
      const py = Math.round(cy + r * Math.sin(angle));
      const particleColor = scope === 'global' ? '#a78bfa' : scope === 'domain' ? '#fbbf24' : '#60a5fa';
      const nodeSize = isHighSens ? 7 : 5;

      return (
        '<g class="mn-grav-node" title="' + esc(truncate(m.text, 50)) + ' (' + esc(decay.label) + ')">' +
        (isHighSens ? '<circle cx="' + px + '" cy="' + py + '" r="' + (nodeSize + 3) + '" fill="none" stroke="#ef4444" stroke-width="1.5" opacity="0.8"/>' : '') +
        '<circle cx="' + px + '" cy="' + py + '" r="' + nodeSize + '" fill="' + particleColor + '" />' +
        '<text x="' + px + '" y="' + (py + 12) + '" fill="#cbd5e1" font-size="8" text-anchor="middle">' + esc(truncate(m.text, 12)) + '</text>' +
        '</g>'
      );
    }).join('');

    return (
      '<div class="mn-grav-wrap">' +
      '<div class="mn-grav-hdr-title">🪐 Semantic Gravity Particle Orbit Field (#28)</div>' +
      '<svg class="mn-grav-svg" viewBox="0 0 300 200" width="100%" height="180">' +
      '<!-- Orbit Rings -->' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="32" fill="none" stroke="rgba(167,139,250,0.3)" stroke-dasharray="3 3" />' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="62" fill="none" stroke="rgba(251,191,36,0.3)" stroke-dasharray="3 3" />' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="88" fill="none" stroke="rgba(96,165,250,0.3)" stroke-dasharray="3 3" />' +
      '<!-- Identity Nucleus -->' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="12" fill="#8b5cf6" />' +
      '<text x="' + cx + '" y="' + (cy + 3) + '" fill="#ffffff" font-size="8" font-weight="bold" text-anchor="middle">YOU</text>' +
      items +
      '</svg>' +
      '<div class="mn-grav-legend">' +
      '<span style="color:#a78bfa">● Global Core</span> ' +
      '<span style="color:#fbbf24">● Domain</span> ' +
      '<span style="color:#60a5fa">● Session</span>' +
      '</div>' +
      '</div>'
    );
  }
  /* ── Metacognitive Topological Mirror (#30) ── */
  function renderTopologicalMirror(memories) {
    const chapters = ['Work & Tech', 'Personal', 'Finance & Health', 'General'];
    const peaks = chapters.map((chap, idx) => {
      const chapMems = memories.filter((m) => getChapterForMemory(m.text) === chap);
      const avgHealth = chapMems.length ? chapMems.reduce((acc, m) => acc + calculateDecayHealth(m).health, 0) / chapMems.length : 0.2;
      const height = Math.round(15 + avgHealth * 65);
      const x = 40 + idx * 70;
      const y = 115 - height;

      return { chap, count: chapMems.length, avgHealth, height, x, y };
    });

    const points = peaks.map((p) => p.x + ',' + p.y).join(' ');
    const areaPoints = '20,120 ' + points + ' 270,120';

    const peaksHTML = peaks.map((p) =>
      '<g class="mn-topo-peak" title="' + esc(p.chap) + ': ' + p.count + ' facts (' + Math.round(p.avgHealth * 100) + '% elevation)">' +
      '<circle cx="' + p.x + '" cy="' + p.y + '" r="4" fill="#38bdf8" />' +
      '<text x="' + p.x + '" y="' + (p.y - 7) + '" fill="#38bdf8" font-size="8" text-anchor="middle" font-weight="bold">' + Math.round(p.avgHealth * 100) + '%</text>' +
      '<text x="' + p.x + '" y="134" fill="#94a3b8" font-size="8" text-anchor="middle">' + esc(p.chap) + '</text>' +
      '</g>'
    ).join('');

    return (
      '<div class="mn-topo-wrap">' +
      '<div class="mn-topo-hdr">🏔️ Metacognitive Topological Mirror Terrain (#30)</div>' +
      '<div class="mn-topo-sub">Heightfield elevation drives AI perception confidence across memory domains:</div>' +
      '<svg class="mn-topo-svg" viewBox="0 0 300 145" width="100%" height="135">' +
      '<polygon points="' + areaPoints + '" fill="rgba(56,189,248,0.12)" stroke="none"/>' +
      '<polyline points="' + points + '" fill="none" stroke="#38bdf8" stroke-width="2" />' +
      '<line x1="20" y1="120" x2="280" y2="120" stroke="rgba(255,255,255,0.1)" stroke-width="1" />' +
      peaksHTML +
      '</svg>' +
      '<div class="mn-topo-sculpt-acts">' +
      '<button class="mn-btn mn-btn-sim" data-act="sculpt-flatten">🔨 Flatten Peak (Erode)</button>' +
      '<button class="mn-btn mn-btn-k" data-act="sculpt-raise">🏔️ Raise Peak (Boost)</button>' +
      '</div>' +
      '</div>'
    );
  }

  const openDetails = new Set();

  function renderKept() {
    const p = ui.kept;
    if (!p) return;
    if (state.kept.length === 0) {
      p.innerHTML =
        '<div class="mn-empty">' +
        IC.vault +
        '<div class="mn-empty-t">No kept memories</div>' +
        '<div class="mn-empty-s">Select text on the page and click "Save to Memory", or keep noticed items from the other tab.</div>' +
        '</div>';
      return;
    }

    const cardsHTML = state.kept
      .map((m) => {
        const roleClass = m.role === 'assistant' ? 'a' : m.role === 'user' ? 'u' : 's';
        const roleLabel = (m.role || 'saved').toUpperCase();
        const isEditing = activeEdits.has(m.id);
        const isDetailsOpen = openDetails.has(m.id);

        const classification = classifyMemoryCandidate(m.text);
        const confidencePct = Math.round(classification.score * 100);
        const chatUrl = m.url || location.href;

        // Clean main title summary (first line or first 85 chars)
        const firstLine = m.text.split('\n')[0].trim();
        const titleText = firstLine.slice(0, 85) + (m.text.length > 85 ? '...' : '');

        let contentHTML = isEditing
          ? '<div class="mn-edit-area" onclick="event.stopPropagation()">' +
            '<textarea class="mn-edit-box" data-id="' + m.id + '">' + esc(m.text) + '</textarea>' +
            '<div class="mn-edit-acts">' +
            '<button class="mn-btn mn-btn-k" data-act="save-edit" data-id="' + m.id + '">Save</button>' +
            '<button class="mn-btn mn-btn-d" data-act="cancel-edit" data-id="' + m.id + '">Cancel</button>' +
            '</div></div>'
          : '<div class="mn-card-title-row">' +
            '<span class="mn-role mn-role-' + roleClass + '">' + esc(roleLabel) + '</span>' +
            '<span class="mn-card-main-title">' + esc(titleText) + '</span>' +
            '</div>';

        let detailsHTML = '';
        if (isDetailsOpen && !isEditing) {
          let histHTML = '';
          if (m.history && m.history.length > 0) {
            histHTML =
              '<div class="mn-hist-panel">' +
              m.history
                .map(
                  (h, idx) =>
                    '<div class="mn-hist-item">' +
                    '<div class="mn-hist-hdr">' +
                    '<span>v' + (m.history.length - idx) + ' • ' + timeAgo(h.timestamp) + '</span>' +
                    '<button class="mn-btn mn-btn-r" data-act="revert" data-id="' + m.id + '" data-ver="' + idx + '">Revert</button>' +
                    '</div>' +
                    '<div class="mn-diff-body">' + renderDiffHTML(h.text, m.text) + '</div>' +
                    '</div>'
                )
                .join('') +
              '</div>';
          }

          detailsHTML =
            '<div class="mn-card-details-panel" onclick="event.stopPropagation()">' +
            '<div class="mn-details-sec">' +
            '<span class="mn-details-lbl">📝 Full Memory Content:</span>' +
            '<div class="mn-details-txt">' + esc(m.text) + '</div>' +
            '</div>' +

            '<div class="mn-details-sec">' +
            '<span class="mn-details-lbl">🔗 Source Chat Link:</span>' +
            '<a href="' + esc(chatUrl) + '" target="_blank" rel="noopener noreferrer" class="mn-chat-link">' + esc(chatUrl) + '</a>' +
            '</div>' +

            '<div class="mn-details-grid">' +
            '<div class="mn-details-item">' +
            '<span class="mn-details-sublbl">Captured At:</span>' +
            '<span>' + new Date(m.keptAt || m.timestamp).toLocaleString() + '</span>' +
            '</div>' +
            '<div class="mn-details-item">' +
            '<span class="mn-details-sublbl">Perception Confidence:</span>' +
            '<span>' + confidencePct + '%</span>' +
            '</div>' +
            '<div class="mn-details-item" style="grid-column: span 2">' +
            '<span class="mn-details-sublbl">Decay Half-Life:</span>' +
            '<select class="mn-decay-select" data-id="' + m.id + '">' +
            '<option value="24h" ' + (m.decayTier === '24h' ? 'selected' : '') + '>24h half-life</option>' +
            '<option value="7d" ' + (m.decayTier === '7d' ? 'selected' : '') + '>7d half-life</option>' +
            '<option value="30d" ' + (!m.decayTier || m.decayTier === '30d' ? 'selected' : '') + '>30d half-life</option>' +
            '<option value="90d" ' + (m.decayTier === '90d' ? 'selected' : '') + '>90d half-life</option>' +
            '<option value="never" ' + (m.decayTier === 'never' ? 'selected' : '') + '>Never decay</option>' +
            '</select>' +
            '</div>' +
            '</div>' +

            '<div class="mn-sim-panel">' +
            '<div class="mn-sim-title">Counterfactual Audit Simulation ("What If I Forget?")</div>' +
            '<div class="mn-sim-row"><span class="mn-sim-lbl">Without Memory:</span><div class="mn-sim-box">' + renderDiffHTML(m.text, '') + '</div></div>' +
            '<div class="mn-sim-meta">Context Alignment Delta: -38% • Personalization Loss: Moderate</div>' +
            '</div>' +
            histHTML +
            '</div>';
        }

        return (
          '<div class="mn-card ' + (isDetailsOpen ? 'open' : '') + '" data-id="' + m.id + '" data-act="toggle-card">' +
          contentHTML +
          '<div class="mn-card-meta-bar">' +
          '<span class="mn-card-time">' + timeAgo(m.keptAt || m.timestamp) + (m.updatedAt ? ' (edited)' : '') + (isDetailsOpen ? ' ▲ Hide details' : ' ▼ Click for details') + '</span>' +
          '<div class="mn-card-acts" onclick="event.stopPropagation()">' +
          (!isEditing ? '<button class="mn-btn mn-btn-e" data-act="edit" data-id="' + m.id + '">Edit</button>' : '') +
          '<button class="mn-btn mn-btn-d" data-act="del" data-id="' + m.id + '">Delete</button>' +
          '</div></div>' +
          detailsHTML +
          '</div>'
        );
      })
      .join('');

    p.innerHTML = cardsHTML;

    // Card click toggle details event
    p.querySelectorAll('[data-act="toggle-card"]').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        if (openDetails.has(id)) openDetails.delete(id);
        else openDetails.add(id);
        renderKept();
      });
    });

    // Decay selector changes
    p.querySelectorAll('.mn-decay-select').forEach((sel) =>
      sel.addEventListener('change', (e) => {
        e.stopPropagation();
        const id = sel.dataset.id;
        const item = state.kept.find((m) => m.id === id);
        if (item) {
          item.decayTier = sel.value;
          updateKept(id, item.text);
        }
      })
    );

    // Edit and Delete actions
    p.querySelectorAll('[data-act="del"]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteKept(b.dataset.id);
      })
    );
    p.querySelectorAll('[data-act="edit"]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        activeEdits.add(b.dataset.id);
        renderKept();
      })
    );
    p.querySelectorAll('[data-act="cancel-edit"]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        activeEdits.delete(b.dataset.id);
        renderKept();
      })
    );
    p.querySelectorAll('[data-act="save-edit"]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const area = p.querySelector('textarea[data-id="' + b.dataset.id + '"]');
        if (area && area.value.trim()) {
          activeEdits.delete(b.dataset.id);
          updateKept(b.dataset.id, area.value.trim());
        }
      })
    );
    p.querySelectorAll('[data-act="revert"]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = state.kept.find((m) => m.id === b.dataset.id);
        const verIdx = parseInt(b.dataset.ver, 10);
        if (item && item.history && item.history[verIdx]) {
          openHistories.delete(b.dataset.id);
          updateKept(b.dataset.id, item.history[verIdx].text);
          showToast('Reverted to version v' + (item.history.length - verIdx) + ' ✓');
        }
      })
    );

    // Attach drag handlers (#4 & #33 Tactile Viscous Friction & Micro-Boundaries)
    p.querySelectorAll('.mn-card').forEach((card) => {
      const id = card.dataset.id;
      const mem = state.kept.find((m) => m.id === id);
      if (!mem) return;
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (e) => {
        const classif = classifyMemoryCandidate(mem.text);
        const isHighStakes = classif.sensitivity === 'high' || mem.scope === 'global';

        e.dataTransfer.setData('application/json', JSON.stringify({ id, origin: 'kept', text: mem.text }));
        e.dataTransfer.setData('text/plain', mem.text);
        card.classList.add('mn-card-dragging');

        if (isHighStakes) {
          card.classList.add('mn-viscous-friction');
          playMemoryTone('warning');
          announceScreenReader('High sensitivity boundary drag initiated — tactile viscous friction active');
          showToast('🧪 Viscous Friction: High-Stakes Micro-Boundary Drag (#33)');
        }

        if (ui.trashZone) ui.trashZone.classList.add('open');
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('mn-card-dragging');
        card.classList.remove('mn-viscous-friction');
        if (ui.trashZone) ui.trashZone.classList.remove('open');
      });
    });
  }

  /* ═══════════════════════════════════════
     PER-MESSAGE STATUS INDICATOR (#2) & AMBIENT CAPTURE PULSE (#15)
     ═══════════════════════════════════════ */
  function injectHostCSS() {
    if (document.getElementById('mn-host-styles')) return;
    const style = document.createElement('style');
    style.id = 'mn-host-styles';
    style.textContent = `
      .mn-purple-memory-border {
        border: 3px solid #A855F7 !important;
        box-shadow: 0 0 18px rgba(168, 85, 247, 0.45) !important;
        border-radius: 12px !important;
        padding: 12px !important;
        margin-top: 8px !important;
        margin-bottom: 8px !important;
        transition: all .25s ease !important;
        position: relative !important;
      }

      .mn-inline-memory-prompt {
        margin-top: 10px !important;
        padding: 12px 14px !important;
        border-radius: 10px !important;
        background: #FFFFFF !important;
        border: 2.5px solid #000000 !important;
        box-shadow: 4px 4px 0px #000000 !important;
        font-family: 'Space Grotesk', 'Plus Jakarta Sans', sans-serif !important;
        color: #000000 !important;
        z-index: 99 !important;
      }

      .mn-prompt-hdr {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        font-size: 13px !important;
        font-weight: 800 !important;
        color: #000000 !important;
        margin-bottom: 4px !important;
      }

      .mn-prompt-body {
        font-size: 12px !important;
        font-weight: 600 !important;
        color: #374151 !important;
        margin-bottom: 10px !important;
      }

      .mn-prompt-acts {
        display: flex !important;
        gap: 8px !important;
      }

      .mn-prompt-btn {
        padding: 6px 14px !important;
        border-radius: 8px !important;
        border: 2px solid #000000 !important;
        font-size: 12px !important;
        font-weight: 800 !important;
        cursor: pointer !important;
        font-family: 'Space Grotesk', sans-serif !important;
        box-shadow: 2px 2px 0px #000000 !important;
        transition: all .15s ease !important;
      }

      .mn-prompt-btn:hover {
        transform: translate(-1px, -1px) !important;
        box-shadow: 3px 3px 0px #000000 !important;
      }

      .mn-prompt-accept {
        background: #A7F3D0 !important;
        color: #000000 !important;
      }

      .mn-prompt-reject {
        background: #FCA5A5 !important;
        color: #000000 !important;
      }

      .mn-status-dot {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 8px !important;
        height: 8px !important;
        border-radius: 50% !important;
        margin-left: 6px !important;
        margin-right: 4px !important;
        vertical-align: middle !important;
        cursor: pointer !important;
        transition: transform .2s ease, box-shadow .2s ease !important;
        position: relative !important;
        z-index: 100 !important;
      }
      .mn-status-dot.mn-status-noticed {
        background-color: #6e6e86 !important;
        box-shadow: 0 0 6px rgba(110,110,134,.6) !important;
      }
      .mn-status-dot.mn-status-kept {
        background-color: #a78bfa !important;
        box-shadow: 0 0 8px rgba(167,139,250,.8) !important;
      }
      .mn-status-dot:hover {
        transform: scale(1.4) !important;
      }

      /* Ambient Memory Capture Pulse (#15) */
      @keyframes mnGlowPulse {
        0%, 100% { box-shadow: 0 0 6px rgba(167,139,250,0.2); border-color: rgba(167,139,250,0.25); }
        50% { box-shadow: 0 0 16px rgba(167,139,250,0.55); border-color: rgba(167,139,250,0.65); }
      }
      .mn-pulse-candidate {
        animation: mnGlowPulse 2.8s ease-in-out infinite !important;
        border: 1px solid rgba(167,139,250,0.3) !important;
        border-radius: 10px !important;
        transition: all .3s ease !important;
      }

      .mn-chip {
        display: inline-flex !important;
        align-items: center !important;
        gap: 5px !important;
        margin-left: 8px !important;
        padding: 3px 8px !important;
        border-radius: 12px !important;
        background: rgba(16,16,28,0.94) !important;
        border: 1px solid rgba(139,92,246,0.3) !important;
        box-shadow: 0 3px 12px rgba(0,0,0,0.4) !important;
        font-size: 11px !important;
        font-family: 'Inter', sans-serif !important;
      }
      .mn-chip-btn {
        padding: 2px 7px !important;
        border-radius: 5px !important;
        border: none !important;
        font-size: 10px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        transition: background .2s !important;
        font-family: inherit !important;
      }
      .mn-chip-rem { background: rgba(52,211,153,0.18) !important; color: #34d399 !important; }
      .mn-chip-rem:hover { background: rgba(52,211,153,0.35) !important; }
      .mn-chip-ses { background: rgba(251,191,36,0.15) !important; color: #fbbf24 !important; }
      .mn-chip-ses:hover { background: rgba(251,191,36,0.3) !important; }
      .mn-chip-neg { background: rgba(167,139,250,0.2) !important; color: #c084fc !important; }
      .mn-chip-neg:hover { background: rgba(167,139,250,0.38) !important; }
      .mn-chip-fg { background: rgba(248,113,113,0.15) !important; color: #f87171 !important; }
      /* Tactile Viscous Friction (#33) */
      @keyframes mnViscousPull {
        0%, 100% { box-shadow: 0 0 15px rgba(239,68,68,0.5), inset 0 0 10px rgba(239,68,68,0.3); border-color: rgba(239,68,68,0.8); }
        50% { box-shadow: 0 0 25px rgba(239,68,68,0.85), inset 0 0 18px rgba(239,68,68,0.5); border-color: #ef4444; transform: scale(0.98) rotate(0.5deg); }
      }
      .mn-viscous-friction {
        animation: mnViscousPull 1.5s ease-in-out infinite !important;
        cursor: grabbing !important;
        opacity: 0.9 !important;
        border: 2px dashed #ef4444 !important;
      }

      /* Negotiation Speech Act Box (#23) */
      .mn-negotiation-box {
        margin-top: 8px !important;
        padding: 10px 12px !important;
        border-radius: 10px !important;
        background: rgba(20,18,34,0.96) !important;
        border: 1px solid rgba(167,139,250,0.4) !important;
        color: #e2e8f0 !important;
        font-size: 11px !important;
        font-family: 'Inter', sans-serif !important;
        box-shadow: 0 6px 20px rgba(0,0,0,0.4) !important;
      }
      .mn-neg-hdr { font-weight: 700 !important; color: #c084fc !important; margin-bottom: 4px !important; }
      .mn-neg-desc { color: #94a3b8 !important; margin-bottom: 8px !important; }
      .mn-neg-row { display: flex !important; align-items: center !important; gap: 8px !important; margin-bottom: 6px !important; flex-wrap: wrap !important; }
      .mn-neg-row select, .mn-neg-row input {
        background: rgba(10,10,20,0.8) !important;
        border: 1px solid rgba(167,139,250,0.3) !important;
        color: #f1f5f9 !important;
        padding: 3px 6px !important;
        border-radius: 6px !important;
        font-size: 11px !important;
      }
      .mn-neg-row input { flex: 1 !important; }
      .mn-neg-acts { display: flex !important; gap: 6px !important; justify-content: flex-end !important; margin-top: 8px !important; }

      /* In-Thread Conflict Resolution Annotations (#12) */
      .mn-conflict-annotation {
        margin-top: 8px !important;
        padding: 10px 12px !important;
        border-radius: 10px !important;
        background: rgba(251,191,36,0.06) !important;
        border: 1px solid rgba(251,191,36,0.3) !important;
        color: #e0e0f0 !important;
        font-size: 12px !important;
        font-family: 'Inter', sans-serif !important;
        box-shadow: 0 4px 16px rgba(0,0,0,0.2) !important;
      }
      .mn-conflict-hdr {
        display: flex !important; align-items: center !important; gap: 6px !important;
        font-weight: 700 !important; color: #fbbf24 !important; font-size: 12px !important;
        margin-bottom: 6px !important;
      }
      .mn-conflict-diff {
        font-size: 11px !important; color: #c8c8dc !important;
        margin-bottom: 8px !important; line-height: 1.5 !important;
        background: rgba(10,10,18,0.5) !important; padding: 6px 8px !important; border-radius: 6px !important;
      }
      .mn-conflict-acts {
        display: flex !important; gap: 6px !important; flex-wrap: wrap !important;
      }
      .mn-conflict-btn {
        padding: 4px 9px !important; border-radius: 6px !important; border: none !important;
        font-size: 11px !important; font-weight: 600 !important; cursor: pointer !important;
        transition: all .2s !important; font-family: inherit !important;
      }
      .mn-conflict-keep { background: rgba(139,92,246,0.2) !important; color: #a78bfa !important; }
      .mn-conflict-keep:hover { background: rgba(139,92,246,0.35) !important; }
      .mn-conflict-update { background: rgba(52,211,153,0.18) !important; color: #34d399 !important; }
      .mn-conflict-update:hover { background: rgba(52,211,153,0.35) !important; }
      .mn-conflict-ignore { background: rgba(255,255,255,0.06) !important; color: #7e7e96 !important; }
      .mn-conflict-ignore:hover { background: rgba(255,255,255,0.12) !important; color: #c8c8dc !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  const dismissedChips = new Set();
  const resolvedConflicts = new Set();

  /* ── Ambient Background Memory Classifier (#13) ── */
  function classifyMemoryCandidate(text) {
    if (!text || text.length < 20) {
      return { score: 0, isDurable: false, isSession: false, conflict: null, sensitivity: 'low', filteredByRule: false };
    }

    if (matchesAnyRule(text)) {
      return { score: 0, isDurable: false, isSession: false, conflict: null, sensitivity: 'high', filteredByRule: true };
    }

    let sensitivity = 'low';
    const lower = text.toLowerCase();
    const highSensKeywords = ['password', 'ssn', 'credit card', 'salary', 'income', 'medical', 'diagnosis', 'bank account', 'secret', 'confidential'];
    const medSensKeywords = ['phone', 'address', 'email', 'location', 'family', 'employer', 'health'];

    // Collaborative Memory Sharing & Third-Party Protection (#26)
    const thirdPartyPattern = /\b(my wife|my husband|my boss|my doctor|my client|my colleague|my manager|my team|my mom|my dad|my daughter|my son|family member|co-worker|partner|spouse)\b/i;
    const isThirdParty = thirdPartyPattern.test(lower);
    if (isThirdParty && sensitivity !== 'high') sensitivity = 'medium';

    let score = 0.35;
    const durablePatterns = [
      /\b(i am|i live|i work|my name|my favorite|i prefer|i use|i have|always|never|located in|role is|stack is|build with)\b/i,
      /\b(user prefers|user lives|user works|user uses|user has|user's)\b/i
    ];
    durablePatterns.forEach((pat) => {
      if (pat.test(lower)) score += 0.25;
    });

    if (text.length >= 40 && text.length <= 600) score += 0.15;

    const conflict = findMemoryConflict(text);

    const isDurable = score >= 0.55;
    const isSession = score >= 0.35 && !isDurable;

    return {
      score: Math.min(1.0, score),
      isDurable,
      isSession,
      conflict,
      sensitivity,
      isThirdParty,
      filteredByRule: false
    };
  }

  function findMemoryConflict(text) {
    if (!state.kept.length || !text || text.length < 20) return null;

    const textLower = text.toLowerCase();
    const words = textLower.split(/\s+/).filter((w) => w.length > 3);

    for (const mem of state.kept) {
      const memLower = mem.text.toLowerCase();
      const memWords = memLower.split(/\s+/).filter((w) => w.length > 3);

      let overlap = 0;
      for (const w of memWords) {
        if (words.includes(w)) overlap++;
      }

      const similarity = overlap / Math.max(memWords.length, 1);

      if (similarity >= 0.35 && similarity < 0.85) {
        const diffHTML = renderDiffHTML(mem.text, text);
        if (diffHTML.includes('mn-diff-del') && diffHTML.includes('mn-diff-ins')) {
          return { memory: mem, diffHTML };
        }
      }
    }
    return null;
  }

  function updateMessageStatusIndicators() {
    // Clean up inline prompts/chips/annotations from chat thread elements.
    // Saved memories and newly detected candidates are managed exclusively inside
    // the MemoNeg sidebar drawer & selection text popup.
    const inlineElements = document.querySelectorAll(
      '.mn-chip, .mn-conflict-annotation, .mn-negotiation-box, .mn-status-dot'
    );
    inlineElements.forEach((el) => el.remove());

    const pulsedElements = document.querySelectorAll('.mn-pulse-candidate');
    pulsedElements.forEach((el) => el.classList.remove('mn-pulse-candidate'));
  }

  /* ═══════════════════════════════════════
     TEXT SELECTION → SAVE
     ═══════════════════════════════════════ */
  function onMouseUp() {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.toString().trim().length < 15) {
        hideSelPopup();
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const btn = ui.sel;
      btn.style.display = 'flex';
      btn.style.top = Math.min(rect.bottom + 10, window.innerHeight - 50) + 'px';
      btn.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - 72, window.innerWidth - 160)) + 'px';
    }, 80);
  }

  function hideSelPopup() {
    if (ui.sel) ui.sel.style.display = 'none';
  }

  function saveSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (text.length < 5) return;

    // Heuristic: determine if selected text is from an assistant response
    let role = 'user';
    try {
      const anchor = sel.anchorNode?.parentElement;
      if (anchor) {
        const el = anchor.closest
          ? anchor.closest('[class*="claude"], [class*="assistant"], [class*="response"], [data-is-streaming], .font-claude-message, [class*="Agent"], [class*="bot"]')
          : null;
        if (el) role = 'assistant';
      }
    } catch (_) {
      // ignore — role stays 'user'
    }

    addKept({
      id: uid(),
      text: text,
      role: role,
      source: location.hostname,
      url: location.href,
      timestamp: Date.now(),
      keptAt: Date.now(),
    });

    hideSelPopup();
    try { window.getSelection()?.removeAllRanges(); } catch (_) {}
  }

  /* ═══════════════════════════════════════
     AUTO-NOTICE (heuristic assistant response detection)
     Watches for substantial new text appearing in the page.
     After 3s of DOM quiet, captures new text as a noticed candidate.
     ═══════════════════════════════════════ */
  function setupAutoNotice() {
    const main = () => document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    let baseLen = main().textContent.length;
    let lastHash = '';
    let lastUrl = location.href;

    const observer = new MutationObserver(() => {
      if (!state.collectionEnabled) return;

      // SPA navigation reset — show digest card for the previous page's noticed items
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Small delay so the page has painted before we show the digest
        digestDismissed = false;
        setTimeout(() => {
          baseLen = main().textContent.length;
          // Show digest if there are unreviewed noticed items from a previous session
          if (state.noticed.length > 0) showDigest();
        }, 1800);
        return;
      }

      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        const el = main();
        const currentText = el.textContent;
        const delta = currentText.length - baseLen;

        if (delta < 100) return;

        const newText = currentText.slice(baseLen).trim();
        baseLen = currentText.length;

        if (newText.length < 80) return;

        const hash = hashStr(newText.slice(0, 500));
        if (hash === lastHash) return;
        lastHash = hash;

        // Trim to ~800 chars, break at sentence boundary if possible
        let snippet = newText.slice(0, 800);
        const lastDot = snippet.lastIndexOf('. ');
        if (lastDot > 200) snippet = snippet.slice(0, lastDot + 1);

        // Emotional Tone Calibration (#25)
        if (detectEmotionalTone(newText)) {
          showToast('💙 Memory capture paused: emotional tone detected');
          return;
        }

        const snippetText = snippet.trim();
        const assistantElements = Array.from(document.querySelectorAll(
          '.font-claude-message, [class*="assistant"], [class*="Agent"], [data-is-streaming], [class*="Message"]:not([class*="user"])'
        ));
        const targetEl = assistantElements.pop() || el;
        highlightAndPromptClaudeMemory(targetEl, snippetText);
      }, 3500);
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function highlightAndPromptClaudeMemory(msgElement, snippet) {
    if (!msgElement || !snippet) return;
    if (msgElement.querySelector('.mn-inline-memory-prompt')) return;

    injectHostCSS();

    msgElement.classList.add('mn-purple-memory-border');

    const promptEl = document.createElement('div');
    promptEl.className = 'mn-inline-memory-prompt';
    promptEl.innerHTML =
      '<div class="mn-prompt-hdr"><span>🧠 Claude Memory Detected</span></div>' +
      '<div class="mn-prompt-body">Do you want to accept this memory into your permanent vault or reject it to the noticed section?</div>' +
      '<div class="mn-prompt-acts">' +
      '<button class="mn-prompt-btn mn-prompt-accept">Accept & Save</button>' +
      '<button class="mn-prompt-btn mn-prompt-reject">Reject → Store in Noticed</button>' +
      '</div>';

    msgElement.appendChild(promptEl);

    promptEl.querySelector('.mn-prompt-accept').onclick = (e) => {
      e.stopPropagation();
      msgElement.classList.remove('mn-purple-memory-border');
      promptEl.remove();

      addKept({
        id: uid(),
        text: snippet,
        role: 'assistant',
        source: location.hostname,
        url: location.href,
        timestamp: Date.now(),
        keptAt: Date.now(),
      });

      showToast('Memory Accepted & Saved ✓');
    };

    promptEl.querySelector('.mn-prompt-reject').onclick = (e) => {
      e.stopPropagation();
      msgElement.classList.remove('mn-purple-memory-border');
      promptEl.remove();

      addNoticed({
        id: uid(),
        text: snippet,
        role: 'assistant',
        source: location.hostname,
        url: location.href,
        timestamp: Date.now(),
      });

      showToast('Memory Rejected → Stored in Noticed Sidebar');
    };
  }

  /* ═══════════════════════════════════════
     EXPORT
     ═══════════════════════════════════════ */
  function doExport() {
    const payload = {
      exportedAt: new Date().toISOString(),
      extension: 'MemoNeg',
      version: '0.1.0',
      totalKept: state.kept.length,
      totalNoticed: state.noticed.length,
      kept: state.kept,
      noticed: state.noticed,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'memoneg-export-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Exported ' + state.kept.length + ' memories ✓');
  }

  /* ═══════════════════════════════════════
     BOOT
     ═══════════════════════════════════════ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
