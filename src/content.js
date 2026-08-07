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

  // Suppress uncaught extension context invalidation errors when extension reloads
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason?.message?.includes('Extension context invalidated')) {
      event.preventDefault();
    }
  });

  /* ═══════════════════════════
     STATE
     ═══════════════════════════ */
  const state = {
    drawerOpen: false,
    activeTab: 'noticed', // 'noticed' | 'global-memory' | 'local-memory'
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

  async function updateKept(id, updates) {
    const payload = typeof updates === 'string' ? { id, text: updates } : { id, ...updates };
    const r = await send({ type: 'UPDATE_KEPT', ...payload });
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
     Premium Dark — Shield Dark + Connected Green
     Design System: UI/UX Pro Max
     ═══════════════════════════════════════════ */
  function getCSS() {
    return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:host, * { box-sizing: border-box; margin: 0; padding: 0; }

.mn {
  --mn-bg: rgba(20, 20, 25, 0.4);
  --mn-bg-card: rgba(255, 255, 255, 0.03);
  --mn-bg-elevated: rgba(255, 255, 255, 0.05);
  --mn-fg: #F8FAFC;
  --mn-fg-muted: #94A3B8;
  --mn-primary: rgba(148, 163, 184, 0.15);
  --mn-accent: #94A3B8;
  --mn-accent-hover: #CBD5E1;
  --mn-accent-purple: #8B5CF6;
  --mn-danger: #EF4444;
  --mn-danger-hover: #DC2626;
  --mn-warn: #F59E0B;
  --mn-border: rgba(255,255,255,0.08);
  --mn-border-focus: rgba(255,255,255,0.18);
  --mn-ring: rgba(148, 163, 184, 0.4);
  --mn-shadow: 0 4px 24px rgba(0,0,0,0.35);
  --mn-radius: 12px;
  --mn-radius-sm: 8px;
  --mn-radius-xs: 6px;
  --mn-transition: 180ms ease-out;

  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  color: var(--mn-fg);
  line-height: 1.5;
  pointer-events: auto;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ── FAB ── */
.mn-fab {
  position: fixed; bottom: 28px; right: 28px;
  width: 56px; height: 56px; border-radius: 28px;
  border: none;
  background: var(--mn-bg);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  color: var(--mn-fg); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.1);
  transition: all var(--mn-transition);
  z-index: 99999; outline: none;
}
.mn-fab:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 40px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.15);
  background: var(--mn-bg-elevated);
}
.mn-fab:active { transform: translateY(0); box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
.mn-fab svg { width: 26px; height: 26px; flex-shrink: 0; stroke: var(--mn-accent); stroke-width: 2; }

.mn-fab.mn-fab-hidden {
  opacity: 0 !important;
  pointer-events: none !important;
  transform: scale(0.3) translate(40px, 40px) !important;
}

.mn-badge {
  position: absolute; top: 0; right: 0;
  min-width: 22px; height: 22px; border-radius: 11px;
  background: var(--mn-fg); border: 1px solid rgba(0,0,0,0.1);
  color: #0F172A; font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  padding: 0 5px;
  animation: mnPulse 2.5s ease-in-out infinite;
  box-shadow: 0 2px 10px rgba(0,0,0,0.2);
}
@keyframes mnPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }

/* ── Overlay ── */
.mn-ov {
  position: fixed; inset: 0;
  background: rgba(2, 6, 23, 0.6);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  opacity: 0; pointer-events: none;
  transition: opacity .3s;
  z-index: 99997;
}
.mn-ov.open { opacity: 1; pointer-events: auto; }

/* ── Drawer ── */
.mn-dr {
  position: fixed !important; top: 16px !important; right: 16px !important;
  width: 480px; max-width: calc(100vw - 32px); height: calc(100vh - 32px); height: calc(100dvh - 32px);
  background: var(--mn-bg);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  border: none;
  border-radius: 24px;
  transform: translateX(calc(100% + 32px));
  transition: transform .32s cubic-bezier(.32,.72,0,1);
  display: flex; flex-direction: column;
  z-index: 99998;
  box-shadow: 0 20px 40px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255,255,255,0.1);
  overflow: hidden;
}
.mn-dr.open { transform: translateX(0) !important; }

/* ── Drawer Header ── */
.mn-hdr {
  position: relative; z-index: 2;
  padding: 18px 22px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid var(--mn-border);
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
.mn-title {
  position: relative; z-index: 2;
  font-size: 18px; font-weight: 700;
  color: var(--mn-fg);
  letter-spacing: -0.3px;
  display: flex; align-items: center; gap: 10px;
}
.mn-title svg { width: 24px; height: 24px; stroke: var(--mn-accent); stroke-width: 2; flex-shrink: 0; }
.mn-hdr-r { position: relative; z-index: 2; display: flex; align-items: center; gap: 10px; }

/* Lock tag */
.mn-lock {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 600; letter-spacing: .5px;
  text-transform: uppercase; color: var(--mn-fg);
  background: var(--mn-primary); border: 1px solid var(--mn-border);
  padding: 3px 8px; border-radius: var(--mn-radius-xs);
}

/* ── Toggle ── */
.mn-tgl {
  position: relative; width: 40px; height: 22px;
  appearance: none; -webkit-appearance: none;
  background: var(--mn-bg-card);
  border-radius: 11px; cursor: pointer;
  transition: background .2s;
  border: 1px solid var(--mn-border);
  outline: none; flex-shrink: 0;
}
.mn-tgl:checked { background: var(--mn-accent); border-color: var(--mn-accent); }
.mn-tgl::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--mn-fg);
  transition: transform .2s cubic-bezier(.4,0,.2,1);
}
.mn-tgl:checked::after { transform: translateX(18px); }

/* ── Close ── */
.mn-cls {
  position: relative; z-index: 100; pointer-events: auto;
  width: 32px; height: 32px; border-radius: var(--mn-radius-sm);
  border: 1px solid var(--mn-border); background: transparent;
  color: var(--mn-fg-muted); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all var(--mn-transition); outline: none; flex-shrink: 0;
}
.mn-cls svg { width: 18px; height: 18px; stroke-width: 2; stroke: var(--mn-fg-muted); pointer-events: none; }
.mn-cls:hover { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.3); }
.mn-cls:hover svg { stroke: var(--mn-danger); }

/* ── Tabs ── */
.mn-tabs {
  position: relative; z-index: 2;
  display: flex; padding: 0 22px;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--mn-border);
  flex-shrink: 0; gap: 2px;
}
.mn-tab {
  flex: 1; padding: 12px 0; text-align: center;
  font-size: 13px; font-weight: 600; color: var(--mn-fg-muted);
  background: transparent; border: none; border-bottom: 2px solid transparent;
  cursor: pointer; transition: all var(--mn-transition); outline: none;
}
.mn-tab:hover { color: var(--mn-fg); background: rgba(255,255,255,0.03); }
.mn-tab.active {
  color: var(--mn-accent);
  border-bottom: 2px solid var(--mn-accent);
  font-weight: 700;
}
.mn-tab-bar { display: none; }

/* ── 3-Tab layout adjustments ── */
.mn-tab { font-size: 12px; padding: 11px 4px; }

/* ── Memory Scope Badges ── */
.mn-mem-scope-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3px;
  margin-bottom: 10px;
}
.mn-mem-scope-global {
  background: rgba(139, 92, 246, 0.15);
  color: #A78BFA;
  border: 1px solid rgba(139, 92, 246, 0.3);
}
.mn-mem-scope-local {
  background: rgba(59, 130, 246, 0.15);
  color: #60A5FA;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

/* ── Scrollable body ── */
.mn-body {
  position: relative; z-index: 2;
  flex: 1; overflow-y: auto; padding: 18px 20px;
}
.mn-body::-webkit-scrollbar { width: 6px; }
.mn-body::-webkit-scrollbar-track { background: transparent; }
.mn-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
.mn-body::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }
.mn-pane { display: none; }
.mn-pane.active { display: block; }

/* ── Memory Card ── */
.mn-card {
  background: var(--mn-bg-card);
  border: none;
  border-radius: var(--mn-radius); padding: 16px 18px;
  margin-bottom: 12px;
  transition: all var(--mn-transition);
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(12px) saturate(120%);
  -webkit-backdrop-filter: blur(12px) saturate(120%);
}
.mn-card:hover {
  background: var(--mn-bg-elevated);
  box-shadow: 0 8px 24px rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.15);
}
.mn-card-title-row {
  display: flex; align-items: flex-start; gap: 10px;
  margin-bottom: 8px;
}
.mn-card-main-title {
  font-size: 14px; font-weight: 600; color: var(--mn-fg);
  line-height: 1.5; flex: 1; word-break: break-word;
}
.mn-card-meta-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-top: 4px;
}
.mn-card-time {
  font-size: 11px; font-weight: 500; color: var(--mn-fg-muted);
  display: flex; align-items: center; gap: 6px;
}
.mn-card-acts { display: flex; align-items: center; gap: 6px; }

/* Expanded Details View */
.mn-card-details-panel {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--mn-border);
  animation: mnSlideIn .2s ease-out;
}
.mn-details-sec { margin-bottom: 12px; }
.mn-details-lbl {
  display: block;
  font-size: 11px; font-weight: 600;
  color: var(--mn-fg-muted); text-transform: uppercase;
  letter-spacing: 0.5px; margin-bottom: 4px;
}
.mn-details-txt {
  font-size: 13px; font-weight: 400;
  color: var(--mn-fg); line-height: 1.55;
  background: rgba(255,255,255,0.04); padding: 10px 12px;
  border-radius: var(--mn-radius-sm); border: 1px solid var(--mn-border);
  white-space: pre-wrap; word-break: break-word;
}
.mn-chat-link {
  display: inline-block;
  color: #60A5FA; font-weight: 500;
  font-size: 12px; word-break: break-all;
  text-decoration: none;
  transition: color var(--mn-transition);
}
.mn-chat-link:hover { color: #93BBFC; text-decoration: underline; }
.mn-details-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px; margin-bottom: 12px;
  background: rgba(255,255,255,0.03); padding: 10px 12px;
  border-radius: var(--mn-radius-sm); border: 1px solid var(--mn-border);
  font-size: 12px; font-weight: 500; color: var(--mn-fg);
}
.mn-details-item { display: flex; flex-direction: column; gap: 2px; }
.mn-details-sublbl {
  color: var(--mn-fg-muted); font-size: 10px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.3px;
}

/* Buttons */
.mn-btn {
  padding: 5px 12px; border-radius: var(--mn-radius-xs);
  border: none; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all var(--mn-transition);
  outline: none; font-family: 'Inter', sans-serif;
  background: rgba(255, 255, 255, 0.03); color: var(--mn-fg-muted);
  box-shadow: 0 2px 8px rgba(0,0,0,0.15), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.mn-btn:hover {
  background: rgba(255, 255, 255, 0.08); color: var(--mn-fg);
  box-shadow: 0 4px 12px rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.15);
}
.mn-btn:active {
  background: rgba(255, 255, 255, 0.02);
  box-shadow: 0 1px 4px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.05);
}

.mn-btn-k { color: #86efac; }
.mn-btn-k:hover { color: #4ade80; }
.mn-btn-d { color: #fca5a5; }
.mn-btn-d:hover { color: #f87171; }
.mn-btn-e { color: #d8b4fe; }
.mn-btn-e:hover { color: #c084fc; }
.mn-btn-h { color: #fde047; }
.mn-btn-h:hover { color: #facc15; }
.mn-btn-r { color: #86efac; padding: 2px 8px; font-size: 10px; }
.mn-btn-p { color: #93c5fd; }
.mn-btn-sim { color: #fde047; }

/* Role badge */
.mn-role {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .5px; margin-right: 6px; vertical-align: middle;
}
.mn-role-a { background: rgba(139,92,246,0.15); color: #A78BFA; }
.mn-role-u { background: rgba(34,197,94,0.15); color: #4ADE80; }
.mn-role-s { background: rgba(245,158,11,0.15); color: #FBBF24; }

/* ── Empty state ── */
.mn-empty {
  text-align: center; padding: 40px 20px; color: var(--mn-fg-muted);
  background: var(--mn-bg-card); border: 1px solid var(--mn-border); border-radius: var(--mn-radius);
}
.mn-empty svg { margin-bottom: 12px; stroke-width: 1.5; stroke: var(--mn-fg-muted); opacity: 0.5; }
.mn-empty-t { font-size: 15px; font-weight: 600; margin-bottom: 6px; color: var(--mn-fg); }
.mn-empty-s { font-size: 12px; line-height: 1.6; color: var(--mn-fg-muted); font-weight: 400; }

/* ── Footer ── */
.mn-foot {
  position: relative; z-index: 2;
  padding: 14px 18px;
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid var(--mn-border);
  flex-shrink: 0;
}
.mn-exp {
  width: 100%; padding: 10px; border-radius: var(--mn-radius-sm);
  border: 1px solid var(--mn-border);
  background: var(--mn-bg-card);
  color: var(--mn-fg-muted); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all var(--mn-transition);
  display: flex; align-items: center; justify-content: center; gap: 8px;
  outline: none; font-family: 'Inter', sans-serif;
}
.mn-exp svg { width: 16px; height: 16px; stroke-width: 2; stroke: var(--mn-fg-muted); }
.mn-exp:hover {
  background: var(--mn-primary);
  color: var(--mn-fg); border-color: var(--mn-border-focus);
}
.mn-exp:hover svg { stroke: var(--mn-fg); }

/* ── Selection save popup ── */
.mn-sel {
  position: fixed;
  padding: 8px 16px; border-radius: var(--mn-radius-sm);
  border: none;
  background: rgba(20, 20, 25, 0.6);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  color: var(--mn-accent); font-size: 12px; font-weight: 600;
  cursor: pointer;
  display: none; align-items: center; gap: 6px;
  z-index: 99999;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  transition: all var(--mn-transition);
  animation: mnUp .2s ease-out;
  font-family: 'Inter', sans-serif;
}
.mn-sel svg { width: 16px; height: 16px; stroke-width: 2; stroke: var(--mn-accent); }
.mn-sel:hover {
  background: var(--mn-accent);
  color: #0F172A;
}
.mn-sel:hover svg { stroke: #0F172A; }
@keyframes mnUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }

/* ── Toast ── */
.mn-toast {
  position: fixed; bottom: 94px; right: 28px;
  padding: 10px 18px; border-radius: var(--mn-radius-sm);
  background: rgba(20, 20, 25, 0.7);
  backdrop-filter: blur(16px) saturate(150%);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  border: none;
  color: var(--mn-accent); font-size: 13px; font-weight: 600;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  opacity: 0; transform: translateY(8px);
  transition: all .25s;
  pointer-events: none; z-index: 99999;
  font-family: 'Inter', sans-serif;
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
  background: var(--mn-bg);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  border: none;
  border-radius: 24px;
  padding: 16px;
  z-index: 99999;
  box-shadow: 0 20px 40px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  animation: mnSlideIn .32s cubic-bezier(.4,0,.2,1);
}
@keyframes mnSlideIn { from{opacity:0;transform:translateY(-12px)} to{opacity:1;transform:translateY(0)} }
.mn-digest-ttl {
  font-size: 14px; font-weight: 700; color: var(--mn-fg);
  display: flex; align-items: center; gap: 7px; margin-bottom: 8px;
}
.mn-digest-ttl svg { width: 18px; height: 18px; flex-shrink: 0; stroke: var(--mn-accent); stroke-width: 2; }
.mn-digest-body { font-size: 12px; color: var(--mn-fg-muted); font-weight: 400; line-height: 1.6; margin-bottom: 12px; }
.mn-digest-body strong { color: var(--mn-fg); font-weight: 600; }
.mn-digest-acts { display: flex; gap: 8px; }
.mn-digest-btn {
  flex: 1; padding: 8px 10px; border-radius: var(--mn-radius-sm);
  border: 1px solid var(--mn-border); font-size: 12px; font-weight: 600;
  cursor: pointer; outline: none; font-family: 'Inter', sans-serif;
  transition: all var(--mn-transition);
}
.mn-digest-review { background: rgba(139,92,246,0.12); color: #A78BFA; border-color: rgba(139,92,246,0.25); }
.mn-digest-review:hover { background: rgba(139,92,246,0.22); }
.mn-digest-dismiss { background: transparent; color: var(--mn-fg-muted); }
.mn-digest-dismiss:hover { background: rgba(255,255,255,0.05); color: var(--mn-fg); }

/* ── Rules Panel ── */
.mn-rules-toggle {
  width: 100%; padding: 8px 12px; border-radius: var(--mn-radius-sm);
  border: 1px solid var(--mn-border);
  background: var(--mn-bg-card);
  color: var(--mn-fg-muted); font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all var(--mn-transition);
  display: flex; align-items: center; justify-content: space-between;
  outline: none; font-family: 'Inter', sans-serif; margin-top: 8px;
}
.mn-rules-toggle:hover { background: var(--mn-bg-elevated); color: var(--mn-fg); border-color: var(--mn-border-focus); }
.mn-rules-toggle .mn-arrow { transition: transform .2s; font-size: 11px; }
.mn-rules-toggle.open .mn-arrow { transform: rotate(180deg); }
.mn-rules-panel {
  margin-top: 8px;
  border: none;
  border-radius: var(--mn-radius-sm);
  background: rgba(255, 255, 255, 0.02);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  overflow: hidden; display: none;
}
.mn-rules-panel.open { display: block; }
.mn-rules-inp-row {
  display: flex; gap: 6px; padding: 10px;
  border-bottom: 1px solid var(--mn-border);
}
.mn-rules-inp {
  flex: 1; padding: 6px 10px; border-radius: var(--mn-radius-xs);
  border: 1px solid var(--mn-border);
  background: var(--mn-bg);
  color: var(--mn-fg); font-size: 12px; font-weight: 500;
  outline: none; font-family: 'Inter', sans-serif;
}
.mn-rules-inp::placeholder { color: var(--mn-fg-muted); }
.mn-rules-inp:focus { border-color: var(--mn-accent); background: var(--mn-bg-elevated); }
.mn-rules-add {
  padding: 6px 12px; border-radius: var(--mn-radius-xs);
  border: 1px solid var(--mn-accent);
  background: rgba(34,197,94,0.1); color: var(--mn-accent);
  font-size: 12px; font-weight: 600; cursor: pointer;
  outline: none; font-family: 'Inter', sans-serif; white-space: nowrap;
  transition: all var(--mn-transition);
}
.mn-rules-add:hover { background: rgba(34,197,94,0.2); }
.mn-rules-list { padding: 4px 0; max-height: 120px; overflow-y: auto; }
.mn-rules-list::-webkit-scrollbar { width: 4px; }
.mn-rules-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
.mn-rule-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; font-size: 11px;
  border-bottom: 1px solid var(--mn-border);
}
.mn-rule-row:last-child { border-bottom: none; }
.mn-rule-kw { color: var(--mn-fg); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.mn-rule-del {
  width: 22px; height: 22px; border-radius: 5px;
  border: 1px solid rgba(239,68,68,0.2); background: rgba(239,68,68,0.1); color: #F87171;
  cursor: pointer; font-size: 14px; line-height: 1; font-weight: 600;
  transition: all var(--mn-transition); outline: none; flex-shrink: 0; margin-left: 6px;
  display: flex; align-items: center; justify-content: center;
}
.mn-rule-del:hover { background: rgba(239,68,68,0.2); }
.mn-rules-empty { padding: 10px; font-size: 11px; color: var(--mn-fg-muted); text-align: center; font-weight: 400; }

/* ── Drag & Drop + Trash Zone ── */
.mn-card[draggable="true"] { cursor: grab; }
.mn-card[draggable="true"]:active { cursor: grabbing; }
.mn-card.mn-card-dragging { opacity: 0.4; border-style: dashed; }

.mn-fab.mn-fab-dragover {
  transform: scale(1.1) !important;
  background: rgba(34,197,94,0.2) !important;
  box-shadow: 0 0 0 2px var(--mn-accent) !important;
}

.mn-trash-zone {
  margin-top: 8px; padding: 10px;
  border: 1px dashed rgba(239,68,68,0.3);
  border-radius: var(--mn-radius-sm);
  background: rgba(239,68,68,0.06); color: #F87171;
  font-size: 12px; font-weight: 600;
  text-align: center; display: none; align-items: center; justify-content: center;
  gap: 6px; transition: all var(--mn-transition);
}
.mn-trash-zone.open { display: flex; animation: mnUp .2s ease-out; }
.mn-trash-zone.mn-trash-active { background: rgba(239,68,68,0.15); border-color: var(--mn-danger); color: var(--mn-danger); }
.mn-trash-zone svg { width: 16px; height: 16px; stroke-width: 2; }

/* ── Edit & Version History (#10) ── */
.mn-edit-area { margin-top: 8px; }
.mn-edit-box {
  width: 100%; min-height: 60px; padding: 8px; border-radius: var(--mn-radius-sm);
  border: 1px solid var(--mn-border); background: var(--mn-bg);
  color: var(--mn-fg); font-size: 12px; font-weight: 400; font-family: inherit; outline: none;
  resize: vertical;
}
.mn-edit-box:focus { border-color: var(--mn-accent); }
.mn-edit-acts { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }

.mn-hist-panel { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--mn-border); }
.mn-hist-item {
  padding: 6px 8px; border-radius: var(--mn-radius-xs); background: rgba(255,255,255,0.03); border: 1px solid var(--mn-border);
  margin-bottom: 6px; font-size: 11px; line-height: 1.5; color: var(--mn-fg);
}
.mn-hist-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; color: var(--mn-fg-muted); font-size: 10px; font-weight: 500; }
.mn-diff-body { font-size: 11px; word-break: break-word; font-weight: 400; }
del.mn-diff-del { color: #FCA5A5; text-decoration: line-through; background: rgba(239,68,68,0.12); padding: 0 3px; border-radius: 3px; }
ins.mn-diff-ins { color: #86EFAC; text-decoration: none; background: rgba(34,197,94,0.12); padding: 0 3px; border-radius: 3px; }

/* ── Provenance & Lineage (#19) ── */
.mn-prov-panel {
  margin-top: 10px; padding: 10px; border-radius: var(--mn-radius-sm);
  background: var(--mn-bg-card); border: 1px solid var(--mn-border);
  font-size: 11px; line-height: 1.6; color: var(--mn-fg); font-weight: 400;
}
.mn-prov-ttl { font-weight: 700; color: var(--mn-fg); margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; }
.mn-prov-row { display: flex; justify-content: space-between; margin-bottom: 4px; border-bottom: 1px solid var(--mn-border); padding-bottom: 3px; }
.mn-prov-lbl { color: var(--mn-fg-muted); font-weight: 500; }
.mn-prov-val { color: var(--mn-fg); word-break: break-all; font-weight: 500; }

/* ── Sensitivity Tier Badges (#20) ── */
.mn-sens-badge {
  display: inline-block; padding: 2px 6px; border-radius: 4px;
  font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: .4px;
  margin-left: 6px; vertical-align: middle;
}
.mn-sens-low { background: rgba(34,197,94,0.12); color: #4ADE80; }
.mn-sens-medium { background: rgba(245,158,11,0.12); color: #FBBF24; }
.mn-sens-high { background: rgba(239,68,68,0.12); color: #F87171; }

/* ── Natural Language Rules & Snapshots (#21, #24) ── */
.mn-rules-warn { padding: 6px 10px; font-size: 11px; color: #FBBF24; font-weight: 500; background: rgba(245,158,11,0.08); border-radius: var(--mn-radius-xs); margin: 6px 10px; border: 1px solid rgba(245,158,11,0.2); }

.mn-snaps-toggle {
  width: 100%; padding: 8px 10px; border-radius: var(--mn-radius-sm);
  border: 1px solid var(--mn-border); background: var(--mn-bg-card);
  color: var(--mn-fg-muted); font-size: 12px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between;
  outline: none; font-family: 'Inter', sans-serif; margin-top: 6px; transition: all var(--mn-transition);
}
.mn-snaps-toggle:hover { background: var(--mn-bg-elevated); color: var(--mn-fg); }
.mn-snaps-toggle .mn-arrow { transition: transform .2s; font-size: 11px; }
.mn-snaps-toggle.open .mn-arrow { transform: rotate(180deg); }
.mn-snaps-panel { margin-top: 6px; border: 1px solid var(--mn-border); border-radius: var(--mn-radius-sm); background: var(--mn-bg-card); overflow: hidden; display: none; }
.mn-snaps-panel.open { display: block; }
.mn-snaps-inp-row { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--mn-border); }
.mn-snaps-list { max-height: 110px; overflow-y: auto; padding: 4px 0; }
.mn-snap-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; font-size: 11px; border-bottom: 1px solid var(--mn-border); font-weight: 500; color: var(--mn-fg); }

/* ── Multiverse Branching DAG (#31) ── */
.mn-dag-hdr { font-size: 11px; font-weight: 700; color: var(--mn-fg-muted); padding: 6px 10px 4px 10px; text-transform: uppercase; letter-spacing: .5px; }
.mn-dag-canvas { padding: 8px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.mn-dag-node { width: 100%; border: 1px solid var(--mn-border); border-radius: var(--mn-radius-sm); background: var(--mn-bg-card); padding: 8px; font-size: 11px; transition: all var(--mn-transition); }
.mn-dag-node.active { background: rgba(139,92,246,0.1); border-color: rgba(139,92,246,0.3); }
.mn-dag-node-hdr { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.mn-dag-title { display: flex; align-items: center; gap: 6px; color: var(--mn-fg); font-weight: 600; }
.mn-dag-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mn-accent-purple); }
.mn-dag-delta { color: var(--mn-fg-muted); font-size: 10px; font-weight: 600; }
.mn-dag-acts { display: flex; gap: 4px; }
.mn-dag-meta { font-size: 9px; color: var(--mn-fg-muted); margin-top: 4px; font-weight: 400; }
.mn-dag-connector { font-size: 10px; color: var(--mn-fg-muted); text-align: center; line-height: 1; font-weight: 600; }
.mn-dag-diff-box { margin-top: 8px; padding: 6px; border-radius: var(--mn-radius-xs); background: rgba(255,255,255,0.03); border: 1px solid var(--mn-border); }

/* ── Decay Engine (#18) ── */
.mn-decay-wrap { margin-top: 6px; display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--mn-fg-muted); font-weight: 500; }
.mn-decay-bar-outer { flex: 1; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.06); overflow: hidden; }
.mn-decay-bar-inner { height: 100%; border-radius: 2px; transition: width .3s ease; background: var(--mn-accent); }
.mn-decay-select { background: var(--mn-bg); border: 1px solid var(--mn-border); color: var(--mn-fg); font-size: 10px; font-weight: 500; border-radius: 4px; padding: 2px 6px; outline: none; font-family: 'Inter', sans-serif; }
.mn-thermo-badge { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2); color: #FBBF24; white-space: nowrap; }

/* ── Semantic Gravity Canvas (#28) ── */
.mn-grav-wrap { margin-bottom: 12px; padding: 10px; border-radius: var(--mn-radius); background: var(--mn-bg-card); border: 1px solid var(--mn-border); text-align: center; }
.mn-grav-hdr-title { font-size: 12px; font-weight: 700; color: var(--mn-fg); margin-bottom: 6px; }
.mn-grav-svg { overflow: visible; display: block; margin: 0 auto; }
.mn-grav-legend { font-size: 10px; margin-top: 6px; display: flex; gap: 10px; justify-content: center; font-weight: 500; color: var(--mn-fg-muted); }

/* ── Spatial Scoping & Chapters (#16, #22) ── */
.mn-filter-bar { display: flex; gap: 6px; margin-bottom: 12px; overflow-x: auto; padding-bottom: 4px; }
.mn-filter-pill { padding: 4px 10px; border-radius: 20px; border: 1px solid var(--mn-border); background: transparent; color: var(--mn-fg-muted); font-size: 11px; font-weight: 500; cursor: pointer; white-space: nowrap; transition: all var(--mn-transition); }
.mn-filter-pill.active { background: rgba(139,92,246,0.15); color: #A78BFA; border-color: rgba(139,92,246,0.3); }

.mn-time-hdr { font-size: 11px; font-weight: 600; color: var(--mn-fg-muted); margin: 12px 0 6px 0; text-transform: uppercase; letter-spacing: .5px; }

/* ── Counterfactual Simulator (#17) ── */
.mn-sim-panel { margin-top: 10px; padding: 10px; border-radius: var(--mn-radius-sm); background: var(--mn-bg-card); border: 1px solid var(--mn-border); font-size: 11px; }
.mn-sim-title { font-weight: 700; color: var(--mn-fg); margin-bottom: 6px; }
.mn-sim-row { margin-bottom: 6px; }
.mn-sim-lbl { color: var(--mn-fg-muted); font-weight: 500; display: block; margin-bottom: 2px; }
.mn-sim-box { padding: 6px; border-radius: var(--mn-radius-xs); background: rgba(255,255,255,0.03); border: 1px solid var(--mn-border); color: var(--mn-fg); font-weight: 400; }
.mn-sim-meta { font-size: 10px; color: var(--mn-fg-muted); margin-top: 4px; font-weight: 500; font-style: italic; }

/* ── Emotional Tone Calibration (#25) ── */
.mn-emotional-card {
  margin: 10px 18px; padding: 10px 12px; border-radius: var(--mn-radius);
  background: rgba(96,165,250,0.08); border: 1px solid rgba(96,165,250,0.2);
  color: #93C5FD; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; gap: 8px;
}

/* ── The Snippet Scrapbook (Magazine / Masonry Grid Layout) ── */
/* Square Category Cards Grid */
.mn-square-categories-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
  padding: 8px 0 16px 0;
}

.mn-category-square-card {
  aspect-ratio: 1 / 1;
  border-radius: 20px;
  border: 1px solid var(--mn-border);
  padding: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  overflow: hidden;
}

.mn-category-square-card:hover {
  transform: translateY(-4px) scale(1.02);
  z-index: 2;
}

.mn-category-square-card.mn-sq-coding {
  border-color: rgba(6, 182, 212, 0.4);
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(8, 47, 73, 0.7));
}
.mn-category-square-card.mn-sq-coding:hover {
  box-shadow: 0 14px 36px rgba(6, 182, 212, 0.3), inset 0 0 16px rgba(6, 182, 212, 0.15);
  border-color: #06B6D4 !important;
}

.mn-category-square-card.mn-sq-personal {
  border-color: rgba(236, 72, 153, 0.4);
  background: linear-gradient(135deg, rgba(30, 27, 75, 0.9), rgba(88, 28, 135, 0.6));
}
.mn-category-square-card.mn-sq-personal:hover {
  box-shadow: 0 14px 36px rgba(236, 72, 153, 0.3), inset 0 0 16px rgba(236, 72, 153, 0.15);
  border-color: #EC4899 !important;
}

.mn-category-square-card.mn-sq-research {
  border-color: rgba(245, 158, 11, 0.4);
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(69, 26, 3, 0.6));
}
.mn-category-square-card.mn-sq-research:hover {
  box-shadow: 0 14px 36px rgba(245, 158, 11, 0.3), inset 0 0 16px rgba(245, 158, 11, 0.15);
  border-color: #F59E0B !important;
}

.mn-category-square-card.mn-sq-general {
  border-color: rgba(99, 102, 241, 0.35);
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(49, 46, 129, 0.6));
}
.mn-category-square-card.mn-sq-general:hover {
  box-shadow: 0 14px 32px rgba(99, 102, 241, 0.3);
  border-color: #6366F1 !important;
}

.mn-sq-icon {
  font-size: 36px;
  margin-bottom: 8px;
  line-height: 1;
}

.mn-sq-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--mn-fg);
  margin-bottom: 4px;
}

.mn-sq-count {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.12);
  color: #F8FAFC;
}

.mn-sq-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid var(--mn-border);
  background: var(--mn-bg-card);
  color: #A78BFA;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all .18s ease;
  margin-bottom: 12px;
}
.mn-sq-back-btn:hover {
  background: var(--mn-bg-elevated);
  border-color: rgba(139, 92, 246, 0.4);
  transform: translateX(-2px);
}

.mn-scrapbook-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0 20px 0;
}

/* Category Bucket Cards */
.mn-bucket-card {
  border-radius: 16px;
  border: 1px solid var(--mn-border);
  background: var(--mn-bg-card);
  padding: 16px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
}

.mn-bucket-card.mn-bucket-coding {
  border-color: rgba(6, 182, 212, 0.4);
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(8, 47, 73, 0.5));
}
.mn-bucket-card.mn-bucket-coding:hover {
  box-shadow: 0 8px 32px rgba(6, 182, 212, 0.2);
}

.mn-bucket-card.mn-bucket-personal {
  border-color: rgba(236, 72, 153, 0.4);
  background: linear-gradient(135deg, rgba(30, 27, 75, 0.9), rgba(88, 28, 135, 0.4));
}
.mn-bucket-card.mn-bucket-personal:hover {
  box-shadow: 0 8px 32px rgba(236, 72, 153, 0.2);
}

.mn-bucket-card.mn-bucket-research {
  border-color: rgba(245, 158, 11, 0.4);
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(69, 26, 3, 0.4));
}
.mn-bucket-card.mn-bucket-research:hover {
  box-shadow: 0 8px 32px rgba(245, 158, 11, 0.2);
}

.mn-bucket-card.mn-bucket-general {
  border-color: rgba(99, 102, 241, 0.3);
  background: var(--mn-bg-card);
}
.mn-bucket-card.mn-bucket-general:hover {
  box-shadow: 0 8px 28px rgba(99, 102, 241, 0.18);
}

.mn-bucket-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--mn-border);
}

.mn-bucket-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--mn-fg);
  display: flex;
  align-items: center;
  gap: 8px;
}

.mn-bucket-count-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
  color: var(--mn-fg);
}

.mn-scrapbook-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  align-items: start;
}

/* Category Base Card & Context Glow */
.mn-scrapbook-card {
  position: relative;
  border-radius: 12px;
  border: 1px solid var(--mn-border);
  background: var(--mn-bg-card);
  padding: 12px 14px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 120px;
  cursor: pointer;
}

.mn-scrapbook-card:hover {
  transform: translateY(-3px);
  z-index: 2;
}

/* 💻 Coding Card Styling */
.mn-scrapbook-card.mn-cat-coding {
  grid-column: span 2;
  border-color: rgba(6, 182, 212, 0.35);
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(8, 47, 73, 0.7));
  font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace !important;
}
.mn-scrapbook-card.mn-cat-coding:hover {
  box-shadow: 0 12px 32px rgba(6, 182, 212, 0.25), inset 0 0 12px rgba(6, 182, 212, 0.1);
  border-color: #06B6D4 !important;
}

/* 💬 Personal Card Styling */
.mn-scrapbook-card.mn-cat-personal {
  border-radius: 18px;
  border-color: rgba(236, 72, 153, 0.35);
  background: linear-gradient(135deg, rgba(30, 27, 75, 0.9), rgba(88, 28, 135, 0.5));
  font-style: italic;
}
.mn-scrapbook-card.mn-cat-personal:hover {
  box-shadow: 0 12px 32px rgba(236, 72, 153, 0.25), inset 0 0 12px rgba(236, 72, 153, 0.1);
  border-color: #EC4899 !important;
}

/* 📚 Research Card Styling */
.mn-scrapbook-card.mn-cat-research {
  border-color: rgba(245, 158, 11, 0.35);
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(69, 26, 3, 0.4));
}
.mn-scrapbook-card.mn-cat-research:hover {
  box-shadow: 0 12px 32px rgba(245, 158, 11, 0.25), inset 0 0 12px rgba(245, 158, 11, 0.1);
  border-color: #F59E0B !important;
}

/* 📌 General Card Styling */
.mn-scrapbook-card.mn-cat-general {
  border-color: rgba(99, 102, 241, 0.25);
  background: var(--mn-bg-card);
}
.mn-scrapbook-card.mn-cat-general:hover {
  box-shadow: 0 12px 28px rgba(99, 102, 241, 0.2);
  border-color: #6366F1 !important;
}

/* Card Elements */
.mn-card-hdr-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.mn-card-cb-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mn-card-select-cb {
  width: 15px;
  height: 15px;
  accent-color: #8B5CF6;
  cursor: pointer;
}

.mn-cat-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.mn-cat-badge-coding { background: rgba(6, 182, 212, 0.15); color: #22D3EE; border: 1px solid rgba(6, 182, 212, 0.3); }
.mn-cat-badge-personal { background: rgba(236, 72, 153, 0.15); color: #F472B6; border: 1px solid rgba(236, 72, 153, 0.3); }
.mn-cat-badge-research { background: rgba(245, 158, 11, 0.15); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.3); }
.mn-cat-badge-general { background: rgba(99, 102, 241, 0.15); color: #818CF8; border: 1px solid rgba(99, 102, 241, 0.3); }

.mn-copy-snippet-btn {
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  background: rgba(6, 182, 212, 0.2);
  color: #22D3EE;
  border: 1px solid rgba(6, 182, 212, 0.4);
  cursor: pointer;
  transition: all .15s ease;
}
.mn-copy-snippet-btn:hover {
  background: rgba(6, 182, 212, 0.35);
  transform: scale(1.03);
}

.mn-citation-tag {
  font-size: 10px;
  font-weight: 600;
  color: #FBBF24;
  background: rgba(245, 158, 11, 0.12);
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-block;
  margin-top: 4px;
  word-break: break-all;
}

.mn-card-snippet-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--mn-fg);
  word-break: break-word;
  margin-bottom: 10px;
  white-space: pre-wrap;
}

/* Floating Synthesis Action Bar */
.mn-synthesize-bar {
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(139, 92, 246, 0.4);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 20px rgba(139, 92, 246, 0.25);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  backdrop-filter: blur(10px);
  z-index: 10;
  animation: mnUp 0.25s ease-out;
}

.mn-synth-btn {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  border: none;
  background: linear-gradient(135deg, #8B5CF6, #EC4899);
  color: #FFFFFF;
  box-shadow: 0 4px 14px rgba(139, 92, 246, 0.4);
  transition: all .18s ease;
}
.mn-synth-btn:hover {
  transform: translateY(-1px) scale(1.02);
  box-shadow: 0 6px 20px rgba(236, 72, 153, 0.5);
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

  /* ═══════════════════════════════════════
     MOLTEN METAL WEBGL SHADER (#ReactBits)
     ═══════════════════════════════════════ */
  function createMoltenMetalCanvas(container, options = {}) {
    if (!container) return null;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:' + (options.opacity || 0.45) + ';z-index:0;display:block;';
    container.insertBefore(canvas, container.firstChild);

    let gl;
    try {
      gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    } catch (_) {}
    if (!gl) return null;

    const vsSource = `#version 300 es
    in vec2 position;
    void main() {
      gl_Position = vec4(position, 0.0, 1.0);
    }`;

    const fsSource = `#version 300 es
    precision highp float;
    uniform vec2 iResolution;
    uniform float iTime;
    uniform float uSpeed;
    uniform float uScale;
    uniform float uDetail;
    uniform float uGlow;
    uniform float uCoreSize;
    uniform float uSwirl;
    uniform float uFold;
    uniform float uBlackPoint;
    uniform float uBrightness;
    uniform float uColorMode;
    uniform float uGrain;
    uniform float uGrainIntensity;
    uniform float uOpacity;
    uniform vec2 uMouse;
    uniform float uMouseStrength;
    uniform bool uEnableMouse;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform vec3 uColor3;
    out vec4 fragColor;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      float time = iTime * uSpeed;
      vec2 p = uScale * ((gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y) - 0.5;

      vec2 drift = vec2(0.0);
      if (uEnableMouse) {
        drift = (uMouse - 0.5) * uMouseStrength * 2.0;
      }
      p += drift;

      vec2 i = p;
      float c = 0.0;
      float r = length(p + vec2(sin(time), sin(time * 0.3 + 5.0)) * 0.5);
      float d = length(p);
      float rot = d + time + p.x * uSwirl;

      float cosRot = cos(rot);
      mat2 warp = mat2(cos(rot - sin(time / 5.0)), sin(rot), -sin(cosRot - time), cosRot) * uFold;
      float glowCore = uGlow * uCoreSize;

      for (float n = 0.0; n < 8.0; n++) {
        if (n >= uDetail) break;
        p *= warp;
        float t = r - time / (n + 3.0);
        i -= p + vec2(cos(t - i.x - r) + sin(t + i.y), sin(t - i.y) + cos(t + i.x) + r);
        c += glowCore / length(vec2(sin(i.x + t), cos(i.y + t)));
      }

      c /= 6.0;

      float intensity = max(c - uBlackPoint, 0.0) * uBrightness;

      float g = clamp(intensity, 0.0, 1.0);

      float mid = 0.5;
      if (uColorMode > 1.5) {
        mid = 0.65;
      } else if (uColorMode > 0.5) {
        mid = 0.35;
      }

      vec3 col = mix(uColor1, uColor2, smoothstep(0.0, mid, g));
      col = mix(col, uColor3, smoothstep(mid, 1.0, g));

      float a = g;
      if (uGrain > 0.5) {
        float gr = hash(gl_FragCoord.xy + iTime);
        a += (gr - 0.5) * uGrainIntensity;
      }
      a = clamp(a, 0.0, 1.0) * uOpacity;
      fragColor = vec4(col * a, a);
    }`;

    // Compile shaders & program
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // Full-screen triangle buffer
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    const uRes = gl.getUniformLocation(prog, 'iResolution');
    const uTime = gl.getUniformLocation(prog, 'iTime');
    const uSpeed = gl.getUniformLocation(prog, 'uSpeed');
    const uScale = gl.getUniformLocation(prog, 'uScale');
    const uDetail = gl.getUniformLocation(prog, 'uDetail');
    const uGlow = gl.getUniformLocation(prog, 'uGlow');
    const uCoreSize = gl.getUniformLocation(prog, 'uCoreSize');
    const uSwirl = gl.getUniformLocation(prog, 'uSwirl');
    const uFold = gl.getUniformLocation(prog, 'uFold');
    const uBlackPoint = gl.getUniformLocation(prog, 'uBlackPoint');
    const uBrightness = gl.getUniformLocation(prog, 'uBrightness');
    const uColorMode = gl.getUniformLocation(prog, 'uColorMode');
    const uGrain = gl.getUniformLocation(prog, 'uGrain');
    const uGrainIntensity = gl.getUniformLocation(prog, 'uGrainIntensity');
    const uOpacity = gl.getUniformLocation(prog, 'uOpacity');
    const uColor1 = gl.getUniformLocation(prog, 'uColor1');
    const uColor2 = gl.getUniformLocation(prog, 'uColor2');
    const uColor3 = gl.getUniformLocation(prog, 'uColor3');

    // Set uniform values
    gl.uniform1f(uSpeed, options.speed || 0.35);
    gl.uniform1f(uScale, options.scale || 4.0);
    gl.uniform1f(uDetail, options.detail || 3.0);
    gl.uniform1f(uGlow, options.glow || 1.6);
    gl.uniform1f(uCoreSize, options.coreSize || 0.1);
    gl.uniform1f(uSwirl, options.swirl || 1.0);
    gl.uniform1f(uFold, options.fold || -0.2);
    gl.uniform1f(uBlackPoint, options.blackPoint || 0.05);
    gl.uniform1f(uBrightness, options.brightness || 1.3);
    gl.uniform1f(uColorMode, 0.0);
    gl.uniform1f(uGrain, 1.0);
    gl.uniform1f(uGrainIntensity, 0.05);
    gl.uniform1f(uOpacity, 1.0);

    // Purple (#8B5CF6), Pink (#EC4899), Cyan (#06B6D4)
    gl.uniform3f(uColor1, 0.54, 0.36, 0.96);
    gl.uniform3f(uColor2, 0.92, 0.28, 0.60);
    gl.uniform3f(uColor3, 0.02, 0.71, 0.83);

    const resize = () => {
      const w = container.clientWidth || 300;
      const h = container.clientHeight || 80;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    };
    window.addEventListener('resize', resize);
    resize();

    let raf = 0;
    const startTime = performance.now();

    const renderLoop = (t) => {
      gl.uniform1f(uTime, (t - startTime) * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(renderLoop);
    };
    raf = requestAnimationFrame(renderLoop);

    return {
      canvas,
      destroy() {
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
        try { canvas.remove(); } catch (_) {}
      }
    };
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
        <button class="mn-tab active" data-tab="noticed">🔍 Noticed</button>
        <button class="mn-tab" data-tab="global-memory">🌐 Global</button>
        <button class="mn-tab" data-tab="local-memory">📍 Local</button>
        <div class="mn-tab-bar" style="left:0;width:33.33%"></div>
      </div>
      <div class="mn-body">
        <div class="mn-pane active" data-pane="noticed"></div>
        <div class="mn-pane" data-pane="global-memory"></div>
        <div class="mn-pane" data-pane="local-memory"></div>
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

    // Attach MoltenMetal WebGL Shader Backdrop to Cover ENTIRE Extension Drawer
    createMoltenMetalCanvas(dr, { opacity: 0.35, speed: 0.35, scale: 4.0 });

    // Toggle switch
    const tgl = dr.querySelector('.mn-tgl');
    tgl.addEventListener('change', () => {
      state.collectionEnabled = tgl.checked;
    });

    // Close button
    const closeBtn = dr.querySelector('.mn-cls');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleDrawer(false);
      });
    }

    // Sonification audio toggle (#27)
    const sndBtn = dr.querySelector('.mn-snd-btn');
    sndBtn.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      sndBtn.textContent = state.soundEnabled ? '🔊' : '🔇';
      if (state.soundEnabled) playMemoryTone('capture');
      showToast(state.soundEnabled ? 'Sonification Audio Enabled 🔊' : 'Sonification Muted 🔇');
    });

    // Tabs (3-panel: Noticed, Global Memory, Local Memory)
    const tabs = dr.querySelectorAll('.mn-tab');
    const bar = dr.querySelector('.mn-tab-bar');
    const tabOrder = ['noticed', 'global-memory', 'local-memory'];
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        state.activeTab = tab.dataset.tab;
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const idx = tabOrder.indexOf(tab.dataset.tab);
        bar.style.left = (idx * 33.33) + '%';
        bar.style.width = '33.33%';
        dr.querySelectorAll('.mn-pane').forEach((p) => p.classList.remove('active'));
        dr.querySelector('[data-pane="' + state.activeTab + '"]').classList.add('active');
        if (state.activeTab === 'global-memory') renderGlobalMemory();
        else if (state.activeTab === 'local-memory') renderLocalMemory();
        else renderNoticed();
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
    ui.kept = dr.querySelector('[data-pane="global-memory"]');  // kept pane is now global-memory
    ui.globalMemory = dr.querySelector('[data-pane="global-memory"]');
    ui.localMemory = dr.querySelector('[data-pane="local-memory"]');
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
  function toggleDrawer(forceState) {
    if (typeof forceState === 'boolean') {
      state.drawerOpen = forceState;
    } else {
      state.drawerOpen = !state.drawerOpen;
    }
    if (ui.dr) ui.dr.classList.toggle('open', state.drawerOpen);
    if (ui.ov) ui.ov.classList.toggle('open', state.drawerOpen);
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
    renderGlobalMemory();
    renderLocalMemory();
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


  const openDetails = new Set();

  let scrapbookCategoryFilter = 'all';
  const selectedKeptIds = new Set();

  function getMemoryCategory(text) {
    if (!text) return 'general';
    const lower = text.toLowerCase();

    // 💻 Coding check: code blocks, keywords, functions, programming syntax
    if (
      text.includes('```') ||
      /\b(?:function|const|let|var|import|export|class|def|return|async|await|select-string|powershell|bash|npm|git|html|css|javascript|python|java|c\+\+|sql|json|api|endpoint)\b/i.test(text) ||
      /[{}<>;=]\s*[{}<>;=]/.test(text) ||
      /\b(?:if|else|for|while|try|catch)\s*\(/.test(text)
    ) {
      return 'coding';
    }

    // 📚 Research check: URLs, citations, documentation, references
    if (
      /https?:\/\/\S+/i.test(text) ||
      /\b(?:http|www|github\.com|wikipedia|doi|paper|research|documentation|reference|source|study|citation|according to)\b/i.test(lower)
    ) {
      return 'research';
    }

    // 💬 Personal check: preferences, location, feelings, identity
    if (
      /\b(?:my\s+(?:name|birthday|age|location|city|address|job|hobbies|hobby|favorite|wife|husband|pet|dog|cat|phone|email)\b)/i.test(lower) ||
      /\b(?:i\s+(?:live|work|love|hate|prefer|enjoy|dislike|am\s+feeling|am\s+a|feel|want\s+to\s+shift))\b/i.test(lower) ||
      /\b[1-9][0-9]{5}\b/.test(text) ||
      /\b(?:bhopal|mumbai|delhi|bangalore|pune|indore)\b/i.test(lower)
    ) {
      return 'personal';
    }

    return 'general';
  }

  function renderSingleScrapbookCardHTML(m, cat) {
    const isEditing = activeEdits.has(m.id);
    const isDetailsOpen = openDetails.has(m.id);
    const isSelected = selectedKeptIds.has(m.id);
    const chatUrl = m.url || location.href;

    const classification = classifyMemoryCandidate(m.text);
    const confidencePct = Math.round(classification.score * 100);

    // Domain extraction for research citation tag
    let domainTag = '';
    if (cat === 'research') {
      try {
        const urlObj = new URL(chatUrl);
        domainTag = urlObj.hostname;
      } catch (_) {
        domainTag = 'source link';
      }
    }

    // Snippet text preview
    const firstLine = m.text.split('\n')[0].trim();
    const snippetPreview = firstLine.slice(0, 90) + (m.text.length > 90 ? '...' : '');

    let contentHTML = isEditing
      ? '<div class="mn-edit-area" onclick="event.stopPropagation()">' +
        '<textarea class="mn-edit-box" data-id="' + m.id + '">' + esc(m.text) + '</textarea>' +
        '<div class="mn-edit-acts">' +
        '<button class="mn-btn mn-btn-k" data-act="save-edit" data-id="' + m.id + '">Save</button>' +
        '<button class="mn-btn mn-btn-d" data-act="cancel-edit" data-id="' + m.id + '">Cancel</button>' +
        '</div></div>'
      : '<div class="mn-card-snippet-text">' + esc(snippetPreview) + '</div>';

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
        '<span class="mn-details-sublbl">Memory Duration:</span>' +
        '<select class="mn-decay-select" data-id="' + m.id + '" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">' +
        '<option value="24h" ' + (m.decayTier === '24h' ? 'selected' : '') + '>24 Hours</option>' +
        '<option value="7d" ' + (m.decayTier === '7d' ? 'selected' : '') + '>7 Days</option>' +
        '<option value="30d" ' + (!m.decayTier || m.decayTier === '30d' ? 'selected' : '') + '>30 Days</option>' +
        '<option value="90d" ' + (m.decayTier === '90d' ? 'selected' : '') + '>90 Days</option>' +
        '<option value="never" ' + (m.decayTier === 'never' ? 'selected' : '') + '>Keep Forever</option>' +
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
      '<div class="mn-scrapbook-card mn-cat-' + cat + ' ' + (isDetailsOpen ? 'open' : '') + '" data-id="' + m.id + '" data-act="toggle-card">' +
      '<div class="mn-card-hdr-row" onclick="event.stopPropagation()">' +
      '<div class="mn-card-cb-wrap">' +
      '<input type="checkbox" class="mn-card-select-cb" data-id="' + m.id + '" ' + (isSelected ? 'checked' : '') + ' title="Select for Merge &amp; Synthesize" />' +
      '<span class="mn-cat-badge mn-cat-badge-' + cat + '">' + cat + '</span>' +
      '</div>' +
      (cat === 'coding' ? '<button class="mn-copy-snippet-btn" data-id="' + m.id + '" data-act="copy-snippet" title="Copy code snippet">📋 Copy Snippet</button>' : '') +
      '</div>' +
      contentHTML +
      (cat === 'research' && domainTag ? '<div class="mn-citation-tag">🌐 Citation: ' + esc(domainTag) + '</div>' : '') +
      '<div class="mn-card-meta-bar" style="margin-top:8px">' +
      '<span class="mn-card-time">' + timeAgo(m.keptAt || m.timestamp) + (isDetailsOpen ? ' ▲ Hide' : ' ▼ Details') + '</span>' +
      '<div class="mn-card-acts" onclick="event.stopPropagation()">' +
      (!isEditing ? '<button class="mn-btn mn-btn-e" data-act="edit" data-id="' + m.id + '">Edit</button>' : '') +
      '<button class="mn-btn mn-btn-d" data-act="del" data-id="' + m.id + '">Delete</button>' +
      '</div></div>' +
      detailsHTML +
      '</div>'
    );
  }

  // Separate state for Global and Local memory panels
  let selectedGlobalCategoryCard = null;
  let selectedLocalCategoryCard = null;

  // Shared helper: render Memory panel (Global or Local)
  function renderMemoryPanel(p, memories, panelType) {
    if (!p) return;
    if (memories.length === 0) {
      p.innerHTML =
        '<div class="mn-empty">' +
        IC.vault +
        '<div class="mn-empty-t">No ' + (panelType === 'global' ? 'Global' : 'Local') + ' memories yet</div>' +
        '<div class="mn-empty-s">' +
        (panelType === 'global'
          ? 'Memories stored without a domain restriction appear here. They apply across all sites.'
          : 'Memories scoped to <strong>' + location.hostname + '</strong> appear here.') +
        '</div></div>';
      return;
    }

    const categoriesMap = {
      coding:   { title: 'Coding Snippets', icon: '💻', items: [], class: 'mn-sq-coding' },
      personal: { title: 'Personal Info',   icon: '💬', items: [], class: 'mn-sq-personal' },
      research: { title: 'Research & Links',icon: '📚', items: [], class: 'mn-sq-research' },
      general:  { title: 'General Vault',   icon: '📌', items: [], class: 'mn-sq-general' }
    };

    memories.forEach((m) => {
      const cat = getMemoryCategory(m.text);
      (categoriesMap[cat] || categoriesMap.general).items.push(m);
    });

    const selectedCard = panelType === 'global' ? selectedGlobalCategoryCard : selectedLocalCategoryCard;
    const setSelectedCard = (v) => {
      if (panelType === 'global') selectedGlobalCategoryCard = v;
      else selectedLocalCategoryCard = v;
    };

    // ── VIEW 1: Square Category Cards Grid ──
    if (!selectedCard) {
      const squareCardsHTML = Object.keys(categoriesMap).map((catKey) => {
        const bucket = categoriesMap[catKey];
        const count = bucket.items.length;
        return (
          '<div class="mn-category-square-card ' + bucket.class + '" data-cat="' + catKey + '">' +
          '<div class="mn-sq-icon">' + bucket.icon + '</div>' +
          '<div class="mn-sq-title">' + bucket.title + '</div>' +
          '<div class="mn-sq-count">' + count + ' item' + (count === 1 ? '' : 's') + '</div>' +
          '</div>'
        );
      }).join('');

      p.innerHTML =
        '<div class="mn-scrapbook-container">' +
        '<div class="mn-mem-scope-badge mn-mem-scope-' + panelType + '">' +
        (panelType === 'global' ? '🌐 Global Memory — Applies everywhere' : '📍 Local Memory — <strong>' + location.hostname + '</strong> only') +
        '</div>' +
        '<div class="mn-square-categories-grid">' + squareCardsHTML + '</div>' +
        '</div>';

      p.querySelectorAll('.mn-category-square-card').forEach((sqCard) => {
        sqCard.addEventListener('click', () => {
          setSelectedCard(sqCard.dataset.cat);
          renderMemoryPanel(p, memories, panelType);
        });
      });
      return;
    }

    // ── VIEW 2: Drill-down into selected category ──
    const activeCategory = categoriesMap[selectedCard] || categoriesMap.general;
    const activeItems = activeCategory.items;
    const count = activeItems.length;
    const cardsInBucket = activeItems.map((m) => renderSingleScrapbookCardHTML(m, selectedCard)).join('');

    let synthBarHTML = '';
    if (selectedKeptIds.size >= 2) {
      synthBarHTML =
        '<div class="mn-synthesize-bar">' +
        '<div style="font-size:12px;font-weight:600;color:#F8FAFC">✨ ' + selectedKeptIds.size + ' memories selected</div>' +
        '<div style="display:flex;gap:6px">' +
        '<button class="mn-synth-btn" data-act="merge-synthesize">Merge & Synthesize ✨</button>' +
        '<button class="mn-btn mn-btn-d" data-act="clear-selected">Clear</button>' +
        '</div></div>';
    }

    p.innerHTML =
      '<div class="mn-scrapbook-container">' +
      '<div class="mn-mem-scope-badge mn-mem-scope-' + panelType + '" style="margin-bottom:8px">' +
      (panelType === 'global' ? '🌐 Global Memory' : '📍 Local — ' + location.hostname) +
      '</div>' +
      '<button class="mn-sq-back-btn" data-act="back-to-categories">← Back to Categories</button>' +
      '<div class="mn-bucket-hdr">' +
      '<div class="mn-bucket-title">' +
      '<span>' + activeCategory.icon + ' ' + activeCategory.title + '</span>' +
      '<span class="mn-bucket-count-badge">' + count + ' item' + (count === 1 ? '' : 's') + '</span>' +
      '</div>' +
      (selectedCard === 'coding' && count > 0 ? '<button class="mn-copy-snippet-btn" data-act="copy-all-coding">📋 Copy All Code</button>' : '') +
      '</div>' +
      (count === 0
        ? '<div class="mn-empty" style="padding:30px 0"><div class="mn-empty-t">No memories in this category yet</div></div>'
        : '<div class="mn-scrapbook-grid">' + cardsInBucket + '</div>') +
      synthBarHTML +
      '</div>';

    // Back button
    const backBtn = p.querySelector('[data-act="back-to-categories"]');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        setSelectedCard(null);
        renderMemoryPanel(p, memories, panelType);
      });
    }

    // Copy all coding snippets
    const copyAllBtn = p.querySelector('[data-act="copy-all-coding"]');
    if (copyAllBtn) {
      copyAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const codingTexts = activeCategory.items.map((m) => m.text).join('\n\n// ─── Snippet ───\n');
        if (codingTexts) {
          navigator.clipboard.writeText(codingTexts);
          showToast('All coding snippets copied to clipboard 📋');
          playMemoryTone('capture');
        }
      });
    }

    // Multi-select checkboxes
    p.querySelectorAll('.mn-card-select-cb').forEach((cb) => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const id = cb.dataset.id;
        if (cb.checked) selectedKeptIds.add(id);
        else selectedKeptIds.delete(id);
        renderMemoryPanel(p, memories, panelType);
      });
    });

    // Copy snippet button
    p.querySelectorAll('[data-act="copy-snippet"]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const mem = state.kept.find((m) => m.id === b.dataset.id);
        if (mem) {
          navigator.clipboard.writeText(mem.text);
          showToast('Code snippet copied to clipboard 📋');
          playMemoryTone('capture');
        }
      });
    });

    // Merge & Synthesize
    const synthBtn = p.querySelector('[data-act="merge-synthesize"]');
    if (synthBtn) {
      synthBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const selectedMems = state.kept.filter((m) => selectedKeptIds.has(m.id));
        if (selectedMems.length < 2) return;
        const synthText = 'Synthesized Context:\n' +
          selectedMems.map((m, idx) => '[Item ' + (idx + 1) + ' - ' + getMemoryCategory(m.text).toUpperCase() + ']: ' + m.text.trim()).join('\n\n');
        await addKept({ id: uid(), text: synthText, role: 'assistant', source: location.hostname, url: location.href, timestamp: Date.now(), keptAt: Date.now() });
        syncMemoryToClaude(synthText);
        selectedKeptIds.clear();
        showToast('✨ Memories Merged & Synthesized!');
        announceScreenReader('Memories merged and synthesized successfully');
        renderAll();
      });
    }

    // Clear selection
    const clearBtn = p.querySelector('[data-act="clear-selected"]');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedKeptIds.clear();
        renderMemoryPanel(p, memories, panelType);
      });
    }

    // Card click toggle details
    p.querySelectorAll('[data-act="toggle-card"]').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        if (openDetails.has(id)) openDetails.delete(id);
        else openDetails.add(id);
        renderMemoryPanel(p, memories, panelType);
      });
    });

    // Decay selector
    p.querySelectorAll('.mn-decay-select').forEach((sel) => {
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('mousedown', (e) => e.stopPropagation());
      sel.addEventListener('change', (e) => {
        e.stopPropagation();
        const id = sel.dataset.id;
        const item = state.kept.find((m) => m.id === id);
        if (item) { item.decayTier = sel.value; updateKept(id, { decayTier: sel.value }); }
      });
    });

    // Edit / Delete / Save / Cancel / Revert actions
    p.querySelectorAll('[data-act="del"]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); selectedKeptIds.delete(b.dataset.id); deleteKept(b.dataset.id); })
    );
    p.querySelectorAll('[data-act="edit"]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); activeEdits.add(b.dataset.id); renderMemoryPanel(p, memories, panelType); })
    );
    p.querySelectorAll('[data-act="cancel-edit"]').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); activeEdits.delete(b.dataset.id); renderMemoryPanel(p, memories, panelType); })
    );
    p.querySelectorAll('[data-act="save-edit"]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const area = p.querySelector('textarea[data-id="' + b.dataset.id + '"]');
        if (area && area.value.trim()) { activeEdits.delete(b.dataset.id); updateKept(b.dataset.id, area.value.trim()); }
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

    // Drag handlers
    p.querySelectorAll('.mn-scrapbook-card').forEach((card) => {
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
          showToast('🧪 Viscous Friction: High-Stakes Drag Active');
        }
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('mn-card-dragging', 'mn-viscous-friction');
      });
    });
  }

  // Global Memory = memories with no domain scope OR explicitly global
  function renderGlobalMemory() {
    const currentDomain = location.hostname;
    const globalMems = state.kept.filter((m) => {
      if (m.scope === 'local') return false;
      if (m.scope === 'global') return true;
      // No explicit scope: treat as global if source doesn't match current domain
      // OR if no source domain stored
      return !m.source || m.source === '' || m.source !== currentDomain;
    });
    renderMemoryPanel(ui.globalMemory, globalMems, 'global');
  }

  // Local Memory = memories scoped to the current domain
  function renderLocalMemory() {
    const currentDomain = location.hostname;
    const localMems = state.kept.filter((m) => {
      if (m.scope === 'global') return false;
      if (m.scope === 'local') return true;
      // No explicit scope: show if source matches current domain
      return m.source && m.source === currentDomain;
    });
    renderMemoryPanel(ui.localMemory, localMems, 'local');
  }

  // Keep renderKept as an alias for backward compatibility
  function renderKept() {
    renderGlobalMemory();
    renderLocalMemory();
  }

  let selectedCategoryCard = null; // legacy — not used in new 3-panel layout


  /* ═══════════════════════════════════════
     PER-MESSAGE STATUS INDICATOR (#2) & AMBIENT CAPTURE PULSE (#15)
     ═══════════════════════════════════════ */
  function injectHostCSS() {
    if (document.getElementById('mn-host-styles')) return;
    const style = document.createElement('style');
    style.id = 'mn-host-styles';
    style.textContent = `
      .mn-purple-memory-border {
        border: 2px solid #8B5CF6 !important;
        box-shadow: 0 0 20px rgba(139, 92, 246, 0.35), inset 0 0 12px rgba(139, 92, 246, 0.1) !important;
        border-radius: 12px !important;
        padding: 12px !important;
        margin-top: 8px !important;
        margin-bottom: 8px !important;
        transition: all .25s ease !important;
        position: relative !important;
      }

      .mn-blue-memory-border {
        border: 2px solid #3B82F6 !important;
        box-shadow: 0 0 20px rgba(59, 130, 246, 0.35), inset 0 0 12px rgba(59, 130, 246, 0.1) !important;
        border-radius: 12px !important;
        padding: 12px !important;
        margin-top: 8px !important;
        margin-bottom: 8px !important;
        transition: all .25s ease !important;
        position: relative !important;
      }

      .mn-red-memory-border {
        border: 2px solid #EF4444 !important;
        box-shadow: 0 0 20px rgba(239, 68, 68, 0.35), inset 0 0 12px rgba(239, 68, 68, 0.1) !important;
        border-radius: 12px !important;
        padding: 12px !important;
        margin-top: 8px !important;
        margin-bottom: 8px !important;
        transition: all .25s ease !important;
        position: relative !important;
      }

      .mn-inline-memory-prompt {
        margin-top: 10px !important;
        padding: 14px 16px !important;
        border-radius: 12px !important;
        background: #1E293B !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4) !important;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;
        color: #F8FAFC !important;
        z-index: 99 !important;
      }

      .mn-prompt-hdr {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        color: #F8FAFC !important;
        margin-bottom: 4px !important;
      }

      .mn-prompt-body {
        font-size: 12px !important;
        font-weight: 400 !important;
        color: #94A3B8 !important;
        margin-bottom: 10px !important;
      }

      .mn-prompt-acts {
        display: flex !important;
        gap: 8px !important;
      }

      .mn-prompt-btn {
        padding: 6px 14px !important;
        border-radius: 6px !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        font-family: 'Inter', sans-serif !important;
        transition: all .18s ease !important;
        outline: none !important;
      }

      .mn-prompt-btn:hover {
        transform: translateY(-1px) !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25) !important;
      }

      .mn-prompt-accept {
        background: rgba(34, 197, 94, 0.15) !important;
        color: #4ADE80 !important;
        border-color: rgba(34, 197, 94, 0.3) !important;
      }
      .mn-prompt-accept:hover {
        background: rgba(34, 197, 94, 0.25) !important;
        color: #22C55E !important;
      }

      .mn-prompt-kept {
        background: rgba(96, 165, 250, 0.15) !important;
        color: #60A5FA !important;
        border-color: rgba(96, 165, 250, 0.3) !important;
      }
      .mn-prompt-kept:hover {
        background: rgba(96, 165, 250, 0.25) !important;
      }

      .mn-prompt-edit {
        background: rgba(139, 92, 246, 0.15) !important;
        color: #A78BFA !important;
        border-color: rgba(139, 92, 246, 0.3) !important;
      }
      .mn-prompt-edit:hover {
        background: rgba(139, 92, 246, 0.25) !important;
      }

      .mn-prompt-reject {
        background: rgba(239, 68, 68, 0.15) !important;
        color: #F87171 !important;
        border-color: rgba(239, 68, 68, 0.3) !important;
      }
      .mn-prompt-reject:hover {
        background: rgba(239, 68, 68, 0.25) !important;
      }

      .mn-cancel-edited {
        background: rgba(255, 255, 255, 0.05) !important;
        color: #94A3B8 !important;
      }
      .mn-cancel-edited:hover {
        background: rgba(255, 255, 255, 0.1) !important;
        color: #F8FAFC !important;
      }

      .mn-prompt-edit-wrap {
        margin: 8px 0 10px 0 !important;
      }

      .mn-prompt-snippet-box {
        font-size: 12px !important;
        font-weight: 400 !important;
        color: #F8FAFC !important;
        background: rgba(15, 23, 42, 0.6) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        border-radius: 6px !important;
        padding: 8px 10px !important;
        line-height: 1.5 !important;
        white-space: pre-wrap !important;
        word-break: break-word !important;
      }

      .mn-prompt-textarea {
        width: 100% !important;
        min-height: 60px !important;
        padding: 8px 10px !important;
        border-radius: 6px !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        font-family: inherit !important;
        font-size: 12px !important;
        font-weight: 400 !important;
        color: #F8FAFC !important;
        background: #0F172A !important;
        box-sizing: border-box !important;
        outline: none !important;
      }
      .mn-prompt-textarea:focus {
        border-color: #8B5CF6 !important;
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
        background-color: #64748B !important;
        box-shadow: 0 0 6px rgba(100, 116, 139, 0.6) !important;
      }
      .mn-status-dot.mn-status-kept {
        background-color: #22C55E !important;
        box-shadow: 0 0 8px rgba(34, 197, 94, 0.8) !important;
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
     AUTO-NOTICE & CLAUDE MEMORY DETECTION
     3-tier content classifier:
       1. Claude Memory Saved — detects when Claude explicitly saves/updates a memory
       2. Emotional / Personal Tone — detects personal details, preferences, emotional sharing
       3. Private Info Leak — detects credit cards, SSN, passwords, API keys in USER messages
     Only matching messages get the purple boundary box + prompt banner.
     ═══════════════════════════════════════ */

  // ── Tier 1: Claude Memory Saved detection ──
  // These patterns match when Claude explicitly tells the user it has remembered/saved something
  const CLAUDE_MEMORY_PATTERNS = [
    /i(?:'ve|'ll| have| will)?\s+(?:remember(?:ed)?|noted?|saved?|stored?|recorded?|added?\s+(?:that|this)\s+to)\b/i,
    /(?:memory|memories)\s+(?:updated?|saved?|stored?|added?|created?)/i,
    /(?:added?|saved?|stored?|noted?|updated?)\s+(?:to|in)\s+(?:my\s+)?(?:memory|memories|notes?)/i,
    /i(?:'ll)?\s+keep\s+(?:that|this)\s+in\s+mind/i,
    /(?:thanks?\s+for\s+(?:sharing|telling|letting\s+me\s+know))/i,
    /(?:got\s+it|noted|understood)[,.]?\s+(?:i(?:'ll| will)\s+remember|your\s+(?:name|preference|location|birthday|job|work|hobby))/i,
    /(?:updating|updated)\s+(?:my\s+)?(?:understanding|knowledge|memory|profile)/i,
    /(?:i\s+now\s+know|i\s+know\s+(?:that\s+)?you(?:r|\s+are|\s+like|\s+prefer|\s+work|\s+live))/i,
    /\bpersonal\s+(?:memory|preference|detail)\s+(?:saved|stored|updated|recorded)\b/i,
  ];

  // ── Tier 2: Emotional / Personal Tone & Location detection ──
  // Detects sharing of personal details, locations, emotional content, life events
  const PERSONAL_TONE_PATTERNS = [
    /(?:my\s+(?:name|birthday|age|address|email|phone|job|occupation|hobby|hobbies|wife|husband|partner|daughter|son|child(?:ren)?|family|pet|dog|cat)\s+is\b)/i,
    /(?:i\s+(?:am|was|have\s+been|'m)\s+(?:feeling|diagnosed|suffering|struggling|dealing\s+with|going\s+through|recovering|grieving|depressed|anxious|stressed|lonely|scared|worried|excited|pregnant|engaged|married|divorced|retired))/i,
    /(?:i\s+(?:love|hate|prefer|enjoy|dislike|am\s+afraid\s+of|am\s+allergic\s+to|am\s+passionate\s+about|believe\s+in))\b/i,
    /(?:i\s+(?:live|work|study|grew\s+up|was\s+born|moved|relocated|reside|stay)\s+(?:in|at|to|near|from)\b)/i,
    /(?:i(?:'m| am)\s+(?:a|an)\s+(?:student|teacher|doctor|engineer|developer|designer|artist|musician|nurse|lawyer|therapist|manager|ceo|founder|parent|veteran))\b/i,
    /(?:i\s+recently\s+(?:lost|found|bought|sold|started|quit|joined|left|broke|got))\b/i,
    /(?:my\s+(?:salary|income|budget|savings|debt|rent|mortgage|medical|health|condition|diagnosis|medication|therapy|religion|faith|political)\b)/i,
    /(?:since|as|because)?\s*i\s+(?:live|work|study|reside|stay)\s+(?:in|at|near|around)\b/i,
    /(?:my\s+(?:location|pincode|zipcode|city|address|area)\s+(?:is|in)\b)/i,
    /(?:want|planning|looking|aiming)\s+to\s+(?:shift|move|relocate)\s+to\b/i,
    /\b[1-9][0-9]{5}\b/, // Indian 6-digit PIN codes (e.g. 462023)
    /(?:bhopal|mumbai|delhi|bangalore|bengaluru|hyderabad|chennai|kolkata|pune|ahmedabad|jaipur|indore|surat)\b/i,
    /(?:shifting|moving|relocating)\s+(?:from|to)\b/i,
    /(?:since|as|because)?\s*you\s+(?:live|work|study|are|prefer|enjoy|like|shared|mentioned|said|want)\s+(?:in|at|a|an|that|to)?/i,
    /(?:your\s+(?:location|city|hometown|job|profession|occupation|preference|hobby|family|address))/i,
  ];

  // ── Tier 3: Private Information Leak detection (for USER messages) ──
  // Credit cards, SSN, passwords, API keys, bank accounts
  const PRIVATE_INFO_PATTERNS = [
    /\b(?:\d{4}[\s-]?){3}\d{4}\b/,                                     // Credit card number
    /\b\d{3}[\s-]?\d{2}[\s-]?\d{4}\b/,                                // SSN
    /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/i,                        // Password sharing
    /\b(?:api[_\s-]?key|secret[_\s-]?key|access[_\s-]?token|auth[_\s-]?token)\s*[:=]\s*\S+/i, // API keys
    /\b[A-Za-z]{2}\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{0,2}\b/, // IBAN
    /\b(?:sk|pk|rk)[-_](?:live|test)[-_][a-zA-Z0-9]{20,}\b/,          // Stripe-like keys
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/,                   // GitHub tokens
    /\bAIza[0-9A-Za-z\-_]{35}\b/,                                      // Google API keys
    /\b(?:bank\s*account|routing\s*number|account\s*number)\s*[:=]?\s*\d+/i, // Bank details
    /\b(?:cvv|cvc|security\s+code)\s*[:=]?\s*\d{3,4}\b/i,              // CVV
  ];

  /**
   * Classify a message's text content.
   * @param {string} text - The text content to analyze
   * @param {string} role - 'assistant' or 'user'
   * @returns {{ type: string|null, label: string, description: string }}
   */
  function classifyMessage(text, role) {
    if (!text || text.length < 10) return { type: null };

    // ── Tier 3: Private Information Leak (HIGHEST PRIORITY FOR ALL MESSAGES) ──
    // Any credit card, SSN, password, API key, bank info MUST show RED alert box
    for (const pat of PRIVATE_INFO_PATTERNS) {
      if (pat.test(text)) {
        return {
          type: 'private_leak',
          label: '🔒 Sensitive Data Warning',
          description: 'Private information (credit card, SSN, password, API key, etc.) was detected in this message.',
        };
      }
    }

    // ── Tier 1: Claude Memory Saved (for ASSISTANT messages) ──
    if (role === 'assistant') {
      for (const pat of CLAUDE_MEMORY_PATTERNS) {
        if (pat.test(text)) {
          return {
            type: 'claude_memory',
            label: '🧠 Claude Memory Detected',
            description: 'Claude has saved personal information from this conversation as a memory.',
          };
        }
      }
    }

    // ── Tier 2: Personal Tone & Location Details ──
    for (const pat of PERSONAL_TONE_PATTERNS) {
      if (pat.test(text)) {
        return {
          type: 'personal_tone',
          label: role === 'user' ? '💬 Personal Info Shared' : '💬 Personal Info Detected',
          description: role === 'user'
            ? 'You shared personal/location details. Claude may remember this.'
            : 'This response references personal details, location, or preferences from this conversation.',
        };
      }
    }

    return { type: null };
  }

  function scanAndPromptClaudeMemories() {
    if (!state.collectionEnabled) return;
    injectHostCSS();

    // ── Find ALL ASSISTANT message elements in claude.ai DOM ──
    const assistantSelectors = [
      '[data-message-author-role="assistant"]',
      '.font-claude-response',
      '.font-claude-message',
      '[class*="assistant-message"]',
      '[class*="assistantMessage"]',
      '[class*="font-claude"]',
      '[data-is-streaming]'
    ];

    const assistantContainersSet = new Set();
    for (const sel of assistantSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const container = el.closest('[data-message-author-role="assistant"]') ||
                          el.closest('[class*="Message"]') ||
                          el.closest('article') ||
                          el;
        if (container) assistantContainersSet.add(container);
      });
    }

    // ── Find ALL USER message elements in claude.ai DOM ──
    const userSelectors = [
      '[data-message-author-role="user"]',
      '[class*="user-message"]',
      '[class*="userMessage"]',
      '[class*="human-message"]',
      '[class*="humanMessage"]',
      '[class*="font-user"]',
      'div[class*="UserMessage"]'
    ];

    const userContainersSet = new Set();
    for (const sel of userSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const container = el.closest('[data-message-author-role="user"]') ||
                          el.closest('[class*="Message"]') ||
                          el.closest('article') ||
                          el;
        if (container) userContainersSet.add(container);
      });
    }

    // Process assistant messages
    assistantContainersSet.forEach((container) => {
      if (container.dataset.mnPrompted === 'true' || container.querySelector('.mn-inline-memory-prompt')) {
        return;
      }

      const text = container.textContent.trim();
      const result = classifyMessage(text, 'assistant');
      if (!result.type) return;

      let snippet = text.slice(0, 400);
      const lastDot = snippet.lastIndexOf('. ');
      if (lastDot > 100) snippet = snippet.slice(0, lastDot + 1);

      container.dataset.mnPrompted = 'true';
      highlightAndPromptClaudeMemory(container, snippet.trim(), result);
    });

    // Process user messages
    userContainersSet.forEach((container) => {
      if (container.dataset.mnPrompted === 'true' || container.querySelector('.mn-inline-memory-prompt')) {
        return;
      }

      const text = container.textContent.trim();
      const result = classifyMessage(text, 'user');
      if (!result.type) return;

      let snippet = text.slice(0, 400);
      const lastDot = snippet.lastIndexOf('. ');
      if (lastDot > 100) snippet = snippet.slice(0, lastDot + 1);

      container.dataset.mnPrompted = 'true';
      highlightAndPromptClaudeMemory(container, snippet.trim(), result);
    });
  }

  function setupAutoNotice() {
    scanAndPromptClaudeMemories();
    setInterval(scanAndPromptClaudeMemories, 1500);

    let scanTimer = null;
    let lastUrl = location.href;

    const observer = new MutationObserver(() => {
      if (!state.collectionEnabled) return;

      if (location.href !== lastUrl) {
        lastUrl = location.href;
        digestDismissed = false;
        setTimeout(() => {
          if (state.noticed.length > 0) showDigest();
        }, 1800);
      }

      clearTimeout(scanTimer);
      scanTimer = setTimeout(scanAndPromptClaudeMemories, 300);
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function highlightAndPromptClaudeMemory(msgElement, snippet, classification) {
    if (!msgElement || !snippet) return;
    if (msgElement.querySelector('.mn-inline-memory-prompt')) return;

    injectHostCSS();

    // Apply type-specific border class
    const borderClass = classification.type === 'private_leak'
      ? 'mn-red-memory-border'
      : classification.type === 'personal_tone'
        ? 'mn-blue-memory-border'
        : 'mn-purple-memory-border';
    msgElement.classList.add(borderClass);

    let currentSnippet = snippet;

    const promptEl = document.createElement('div');
    promptEl.className = 'mn-inline-memory-prompt';

    function removeBorder() {
      msgElement.classList.remove('mn-purple-memory-border', 'mn-blue-memory-border', 'mn-red-memory-border');
    }

    function renderBannerStep(step = 'initial') {
      if (step === 'initial') {
        promptEl.innerHTML =
          '<div class="mn-prompt-hdr"><span>' + classification.label + '</span></div>' +
          '<div class="mn-prompt-body">' + esc(classification.description) + '</div>' +
          '<div class="mn-prompt-acts">' +
          '<button class="mn-prompt-btn mn-prompt-accept" title="Accept memory &amp; save">Accept & Save</button>' +
          '<button class="mn-prompt-btn mn-prompt-kept" title="View stored details or change options">Change Something / Options</button>' +
          '</div>';

        promptEl.querySelector('.mn-prompt-accept').onclick = (e) => {
          e.stopPropagation();
          removeBorder();
          promptEl.remove();

          addKept({
            id: uid(),
            text: currentSnippet,
            role: 'assistant',
            source: location.hostname,
            url: location.href,
            timestamp: Date.now(),
            keptAt: Date.now(),
          });

          showToast('Memory Accepted & Saved ✓');
        };

        promptEl.querySelector('.mn-prompt-kept').onclick = (e) => {
          e.stopPropagation();
          renderBannerStep('options');
        };
        return;
      }

      if (step === 'options') {
        promptEl.innerHTML =
          '<div class="mn-prompt-hdr"><span>📋 Stored Personal Info & Preferences</span></div>' +
          '<div class="mn-prompt-body" style="font-weight:700;color:#1F2937;margin-bottom:6px">Detected Memory Detail:</div>' +
          '<div class="mn-prompt-snippet-box">' + esc(currentSnippet) + '</div>' +
          '<div class="mn-prompt-acts" style="margin-top:10px">' +
          '<button class="mn-prompt-btn mn-prompt-accept" title="Accept memory">Accept</button>' +
          '<button class="mn-prompt-btn mn-prompt-kept" title="Store in Kept Vault">Store in Kept</button>' +
          '<button class="mn-prompt-btn mn-prompt-edit" title="Edit memory text">Edit</button>' +
          '<button class="mn-prompt-btn mn-prompt-reject" title="Reject memory to Noticed section">Reject</button>' +
          '<button class="mn-prompt-btn mn-cancel-edited" title="Back to main prompt">Back</button>' +
          '</div>';

        promptEl.querySelector('.mn-prompt-accept').onclick = (e) => {
          e.stopPropagation();
          removeBorder();
          promptEl.remove();

          addKept({
            id: uid(),
            text: currentSnippet,
            role: 'assistant',
            source: location.hostname,
            url: location.href,
            timestamp: Date.now(),
            keptAt: Date.now(),
          });

          showToast('Memory Accepted & Saved ✓');
        };

        promptEl.querySelector('.mn-prompt-kept').onclick = (e) => {
          e.stopPropagation();
          removeBorder();
          promptEl.remove();

          addKept({
            id: uid(),
            text: currentSnippet,
            role: 'assistant',
            source: location.hostname,
            url: location.href,
            timestamp: Date.now(),
            keptAt: Date.now(),
          });

          showToast('Stored in Kept Vault ✓');
        };

        promptEl.querySelector('.mn-prompt-edit').onclick = (e) => {
          e.stopPropagation();
          renderBannerStep('edit');
        };

        promptEl.querySelector('.mn-prompt-reject').onclick = (e) => {
          e.stopPropagation();
          removeBorder();
          promptEl.remove();

          addNoticed({
            id: uid(),
            text: currentSnippet,
            role: 'assistant',
            source: location.hostname,
            url: location.href,
            timestamp: Date.now(),
          });

          showToast('Memory Rejected → Stored in Noticed Sidebar');
        };

        promptEl.querySelector('.mn-cancel-edited').onclick = (e) => {
          e.stopPropagation();
          renderBannerStep('initial');
        };
        return;
      }

      if (step === 'edit') {
        promptEl.innerHTML =
          '<div class="mn-prompt-hdr"><span>✏️ Edit Memory Before Saving</span></div>' +
          '<div class="mn-prompt-edit-wrap">' +
          '<textarea class="mn-prompt-textarea">' + esc(currentSnippet) + '</textarea>' +
          '</div>' +
          '<div class="mn-prompt-acts">' +
          '<button class="mn-prompt-btn mn-prompt-accept mn-save-edited">Save Edited Memory</button>' +
          '<button class="mn-prompt-btn mn-cancel-edited">Cancel</button>' +
          '</div>';

        promptEl.querySelector('.mn-save-edited').onclick = (e) => {
          e.stopPropagation();
          const txt = promptEl.querySelector('.mn-prompt-textarea').value.trim();
          if (txt) {
            currentSnippet = txt;
            removeBorder();
            promptEl.remove();

            addKept({
              id: uid(),
              text: currentSnippet,
              role: 'assistant',
              source: location.hostname,
              url: location.href,
              timestamp: Date.now(),
              keptAt: Date.now(),
            });

            showToast('Edited Memory Accepted & Saved ✓');
          }
        };

        promptEl.querySelector('.mn-cancel-edited').onclick = (e) => {
          e.stopPropagation();
          renderBannerStep('options');
        };
        return;
      }
    }

    renderBannerStep('initial');
    msgElement.appendChild(promptEl);
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
     LOCAL LLM INFERENCE STREAMING API
     ═══════════════════════════════════════ */
  window.MemoNegInference = {
    streamCompletion(prompt, options = {}) {
      const { onToken, onComplete, onError, maxNewTokens = 64 } = options;
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.connect) {
          throw new Error('Chrome extension runtime port context unavailable.');
        }

        const port = chrome.runtime.connect({ name: 'memoneg-inference' });

        port.onMessage.addListener((msg) => {
          if (msg.type === 'TOKEN') {
            if (onToken) onToken(msg.token, msg.textSoFar);
          } else if (msg.type === 'COMPLETE') {
            if (onComplete) onComplete(msg.text, msg.metrics);
            try { port.disconnect(); } catch (_) {}
          } else if (msg.type === 'ERROR') {
            console.error('[MemoNeg LLM Error]:', msg.error);
            if (onError) onError(new Error(msg.error));
            try { port.disconnect(); } catch (_) {}
          }
        });

        port.onDisconnect.addListener(() => {
          const err = chrome.runtime.lastError;
          if (err) {
            console.warn('[MemoNeg LLM Port Disconnected]:', err.message);
          }
        });

        port.postMessage({
          type: 'GENERATE',
          prompt,
          maxNewTokens,
        });

        return port;
      } catch (err) {
        console.error('[MemoNeg LLM Stream Error]:', err);
        if (onError) onError(err);
      }
    },

    getStatus(callback) {
      send({ type: 'GET_MODEL_STATUS' }).then(callback);
    }
  };

  /* ═══════════════════════════════════════
     BOOT
     ═══════════════════════════════════════ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
