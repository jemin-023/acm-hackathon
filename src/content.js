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
    return new Promise((resolve) => chrome.runtime.sendMessage(data, resolve));
  }

  async function loadAll() {
    const [kr, nr, rr] = await Promise.all([
      send({ type: 'GET_KEPT' }),
      send({ type: 'GET_NOTICED' }),
      send({ type: 'GET_RULES' }),
    ]);
    state.kept = kr?.kept || [];
    state.noticed = nr?.noticed || [];
    state.rules = rr?.rules || [];
    renderAll();
  }

  async function addKept(mem) {
    const r = await send({ type: 'ADD_KEPT', memory: mem });
    state.kept = r?.kept || [];
    renderAll();
    showToast('Memory saved ✓');
  }

  async function deleteKept(id) {
    const r = await send({ type: 'DELETE_KEPT', id });
    state.kept = r?.kept || [];
    renderAll();
    showToast('Memory deleted');
  }

  async function updateKept(id, text) {
    const r = await send({ type: 'UPDATE_KEPT', id, text });
    state.kept = r?.kept || [];
    renderAll();
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
     Dark glass aesthetic, purple accent palette
     ═══════════════════════════════════════════ */
  function getCSS() {
    return `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:host, * { box-sizing: border-box; margin: 0; padding: 0; }

.mn {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #f0f0f5;
  line-height: 1.5;
  pointer-events: auto;
}

/* ── FAB ── */
.mn-fab {
  position: fixed; bottom: 28px; right: 28px;
  width: 54px; height: 54px; border-radius: 16px;
  border: 1px solid rgba(139,92,246,.25);
  background: linear-gradient(145deg, rgba(18,18,32,.96), rgba(30,22,50,.96));
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  color: #a78bfa; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow:
    0 4px 20px rgba(139,92,246,.18),
    0 0 0 1px rgba(139,92,246,.06),
    inset 0 1px 0 rgba(255,255,255,.04);
  transition: all .3s cubic-bezier(.4,0,.2,1);
  z-index: 99999; outline: none;
}
.mn-fab:hover {
  transform: translateY(-2px) scale(1.04);
  box-shadow:
    0 8px 30px rgba(139,92,246,.3),
    0 0 0 1px rgba(139,92,246,.15),
    inset 0 1px 0 rgba(255,255,255,.06);
  border-color: rgba(139,92,246,.45);
}
.mn-fab:active { transform: translateY(0) scale(.97); }
.mn-fab svg { width: 24px; height: 24px; flex-shrink: 0; }

.mn-badge {
  position: absolute; top: -5px; right: -5px;
  min-width: 20px; height: 20px; border-radius: 10px;
  background: linear-gradient(135deg, #8b5cf6, #a855f7);
  color: #fff; font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  padding: 0 5px;
  box-shadow: 0 2px 8px rgba(139,92,246,.45);
  animation: mnPulse 2.5s ease-in-out infinite;
}
@keyframes mnPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }

/* ── Overlay ── */
.mn-ov {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.35);
  backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
  opacity: 0; pointer-events: none;
  transition: opacity .35s;
  z-index: 99997;
}
.mn-ov.open { opacity: 1; pointer-events: auto; }

/* ── Drawer ── */
.mn-dr {
  position: fixed; top: 0; right: 0;
  width: 400px; max-width: 92vw; height: 100vh; height: 100dvh;
  background: rgba(10,10,18,.97);
  backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
  border-left: 1px solid rgba(139,92,246,.1);
  transform: translateX(100%);
  transition: transform .38s cubic-bezier(.4,0,.2,1);
  display: flex; flex-direction: column;
  z-index: 99998;
  box-shadow: -10px 0 50px rgba(0,0,0,.5);
}
.mn-dr.open { transform: translateX(0); }

/* ── Drawer Header ── */
.mn-hdr {
  padding: 18px 20px;
  border-bottom: 1px solid rgba(139,92,246,.08);
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
.mn-title {
  font-size: 17px; font-weight: 700;
  background: linear-gradient(135deg, #a78bfa, #c084fc);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
  display: flex; align-items: center; gap: 10px;
}
.mn-title svg { width: 22px; height: 22px; stroke: #a78bfa; flex-shrink: 0; -webkit-text-fill-color: initial; }
.mn-hdr-r { display: flex; align-items: center; gap: 10px; }

/* Lock tag */
.mn-lock {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 9px; font-weight: 600; letter-spacing: .4px;
  text-transform: uppercase; color: #4e4e66;
  -webkit-text-fill-color: initial;
}

/* ── Toggle ── */
.mn-tgl {
  position: relative; width: 38px; height: 20px;
  appearance: none; -webkit-appearance: none;
  background: rgba(255,255,255,.06);
  border-radius: 10px; cursor: pointer;
  transition: background .3s;
  border: 1px solid rgba(255,255,255,.08);
  outline: none; flex-shrink: 0;
}
.mn-tgl:checked { background: rgba(139,92,246,.45); border-color: rgba(139,92,246,.5); }
.mn-tgl::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: #e0e0f0;
  transition: transform .25s cubic-bezier(.4,0,.2,1);
  box-shadow: 0 1px 3px rgba(0,0,0,.25);
}
.mn-tgl:checked::after { transform: translateX(18px); }

/* ── Close ── */
.mn-cls {
  width: 30px; height: 30px; border-radius: 8px;
  border: none; background: rgba(255,255,255,.04);
  color: #6e6e86; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all .2s; outline: none; flex-shrink: 0;
}
.mn-cls svg { width: 16px; height: 16px; }
.mn-cls:hover { background: rgba(248,113,113,.12); color: #f87171; }

/* ── Tabs ── */
.mn-tabs {
  display: flex; padding: 0 20px;
  border-bottom: 1px solid rgba(139,92,246,.06);
  flex-shrink: 0; position: relative;
}
.mn-tab {
  flex: 1; padding: 11px 0; text-align: center;
  font-size: 13px; font-weight: 500; color: #6e6e86;
  background: none; border: none; cursor: pointer;
  transition: color .2s; outline: none; font-family: inherit;
}
.mn-tab:hover { color: #9e9eb6; }
.mn-tab.active { color: #a78bfa; }
.mn-tab-bar {
  position: absolute; bottom: -1px;
  height: 2px; border-radius: 1px;
  background: linear-gradient(90deg, #8b5cf6, #a855f7);
  transition: left .32s cubic-bezier(.4,0,.2,1), width .32s;
}

/* ── Scrollable body ── */
.mn-body { flex: 1; overflow-y: auto; padding: 14px 18px; }
.mn-body::-webkit-scrollbar { width: 4px; }
.mn-body::-webkit-scrollbar-track { background: transparent; }
.mn-body::-webkit-scrollbar-thumb { background: rgba(139,92,246,.15); border-radius: 2px; }
.mn-pane { display: none; }
.mn-pane.active { display: block; }

/* ── Memory Card ── */
.mn-card {
  background: rgba(20,20,34,.65);
  border: 1px solid rgba(139,92,246,.08);
  border-radius: 10px; padding: 14px 15px;
  margin-bottom: 10px;
  transition: all .22s;
}
.mn-card:hover {
  border-color: rgba(139,92,246,.2);
  background: rgba(25,25,42,.75);
  box-shadow: 0 2px 16px rgba(139,92,246,.06);
  transform: translateY(-1px);
}
.mn-card-txt {
  font-size: 13px; color: #c8c8dc; line-height: 1.65;
  margin-bottom: 10px; word-break: break-word; white-space: pre-wrap;
}
.mn-card-meta {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11px; color: #5e5e76;
}
.mn-card-acts { display: flex; gap: 6px; }

/* Buttons */
.mn-btn {
  padding: 4px 11px; border-radius: 6px;
  border: none; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all .2s;
  outline: none; font-family: inherit;
  letter-spacing: .2px;
}
.mn-btn-k { background: rgba(52,211,153,.12); color: #34d399; }
.mn-btn-k:hover { background: rgba(52,211,153,.22); }
.mn-btn-d { background: rgba(248,113,113,.1); color: #f87171; }
.mn-btn-d:hover { background: rgba(248,113,113,.2); }

/* Role badge */
.mn-role {
  display: inline-block; padding: 1px 7px; border-radius: 4px;
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .5px; margin-right: 6px; vertical-align: middle;
}
.mn-role-a { background: rgba(139,92,246,.12); color: #a78bfa; }
.mn-role-u { background: rgba(52,211,153,.1); color: #34d399; }
.mn-role-s { background: rgba(251,191,36,.1); color: #fbbf24; }

/* ── Empty state ── */
.mn-empty { text-align: center; padding: 44px 20px; color: #4e4e66; }
.mn-empty svg { margin-bottom: 14px; opacity: .35; }
.mn-empty-t { font-size: 14px; font-weight: 600; margin-bottom: 6px; color: #7e7e96; }
.mn-empty-s { font-size: 12px; line-height: 1.6; }

/* ── Footer ── */
.mn-foot {
  padding: 14px 18px;
  border-top: 1px solid rgba(139,92,246,.06);
  flex-shrink: 0;
}
.mn-exp {
  width: 100%; padding: 10px; border-radius: 8px;
  border: 1px solid rgba(139,92,246,.15);
  background: linear-gradient(135deg, rgba(139,92,246,.08), rgba(168,85,247,.05));
  color: #a78bfa; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all .2s;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  outline: none; font-family: inherit;
}
.mn-exp svg { width: 16px; height: 16px; }
.mn-exp:hover {
  background: linear-gradient(135deg, rgba(139,92,246,.15), rgba(168,85,247,.1));
  border-color: rgba(139,92,246,.3);
}

/* ── Selection save popup ── */
.mn-sel {
  position: fixed;
  padding: 7px 14px; border-radius: 9px;
  border: 1px solid rgba(139,92,246,.28);
  background: rgba(16,16,28,.96);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  color: #a78bfa; font-size: 12px; font-weight: 600;
  cursor: pointer;
  display: none; align-items: center; gap: 6px;
  z-index: 99999;
  box-shadow: 0 6px 24px rgba(0,0,0,.45), 0 0 0 1px rgba(139,92,246,.08);
  transition: all .2s;
  animation: mnUp .22s ease-out;
  font-family: 'Inter', sans-serif;
}
.mn-sel svg { width: 14px; height: 14px; }
.mn-sel:hover {
  background: rgba(22,22,38,.96);
  border-color: rgba(139,92,246,.45);
  box-shadow: 0 6px 28px rgba(139,92,246,.18), 0 0 0 1px rgba(139,92,246,.12);
}
@keyframes mnUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }

/* ── Toast ── */
.mn-toast {
  position: fixed; bottom: 94px; right: 28px;
  padding: 10px 18px; border-radius: 9px;
  background: rgba(16,16,28,.96);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(52,211,153,.25);
  color: #34d399; font-size: 13px; font-weight: 500;
  opacity: 0; transform: translateY(8px);
  transition: all .3s;
  pointer-events: none; z-index: 99999;
}
.mn-toast.show { opacity: 1; transform: translateY(0); }

/* ── Responsive ── */
@media (max-width: 480px) {
  .mn-dr { width: 100vw; max-width: 100vw; }
}

/* ── Session Digest Card ── */
.mn-digest {
  position: fixed; top: 16px; right: 16px;
  width: 320px; max-width: calc(100vw - 32px);
  background: rgba(14,14,26,.97);
  backdrop-filter: blur(32px); -webkit-backdrop-filter: blur(32px);
  border: 1px solid rgba(139,92,246,.22);
  border-radius: 14px;
  padding: 16px 18px;
  z-index: 99999;
  box-shadow:
    0 8px 32px rgba(0,0,0,.55),
    0 0 0 1px rgba(139,92,246,.06);
  animation: mnSlideIn .32s cubic-bezier(.4,0,.2,1);
}
@keyframes mnSlideIn { from{opacity:0;transform:translateY(-12px)} to{opacity:1;transform:translateY(0)} }
.mn-digest-ttl {
  font-size: 13px; font-weight: 700; color: #a78bfa;
  display: flex; align-items: center; gap: 7px; margin-bottom: 8px;
}
.mn-digest-ttl svg { width: 15px; height: 15px; flex-shrink: 0; stroke: #a78bfa; }
.mn-digest-body { font-size: 12px; color: #9e9eb6; line-height: 1.6; margin-bottom: 12px; }
.mn-digest-body strong { color: #c8c8e8; font-weight: 600; }
.mn-digest-acts { display: flex; gap: 8px; }
.mn-digest-btn {
  flex: 1; padding: 7px 10px; border-radius: 8px;
  border: none; font-size: 12px; font-weight: 600;
  cursor: pointer; outline: none; font-family: inherit;
  transition: all .2s;
}
.mn-digest-review {
  background: linear-gradient(135deg, rgba(139,92,246,.18), rgba(168,85,247,.12));
  border: 1px solid rgba(139,92,246,.25);
  color: #a78bfa;
}
.mn-digest-review:hover { background: linear-gradient(135deg, rgba(139,92,246,.28), rgba(168,85,247,.2)); }
.mn-digest-dismiss {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.06);
  color: #5e5e76;
}
.mn-digest-dismiss:hover { color: #9e9eb6; background: rgba(255,255,255,.08); }

/* ── Rules Panel ── */
.mn-rules-toggle {
  width: 100%; padding: 8px 10px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,.06);
  background: rgba(255,255,255,.03);
  color: #7e7e96; font-size: 12px; font-weight: 500;
  cursor: pointer; transition: all .2s;
  display: flex; align-items: center; justify-content: space-between;
  outline: none; font-family: inherit; margin-top: 8px;
}
.mn-rules-toggle:hover { color: #a78bfa; border-color: rgba(139,92,246,.2); }
.mn-rules-toggle .mn-arrow { transition: transform .22s; font-size: 10px; }
.mn-rules-toggle.open .mn-arrow { transform: rotate(180deg); }
.mn-rules-panel {
  margin-top: 8px;
  border: 1px solid rgba(139,92,246,.1);
  border-radius: 8px;
  overflow: hidden;
  display: none;
}
.mn-rules-panel.open { display: block; }
.mn-rules-inp-row {
  display: flex; gap: 6px; padding: 10px;
  border-bottom: 1px solid rgba(139,92,246,.06);
}
.mn-rules-inp {
  flex: 1; padding: 6px 10px; border-radius: 6px;
  border: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.04);
  color: #e0e0f0; font-size: 12px; font-family: inherit;
  outline: none;
}
.mn-rules-inp::placeholder { color: #4e4e66; }
.mn-rules-inp:focus { border-color: rgba(139,92,246,.35); }
.mn-rules-add {
  padding: 6px 12px; border-radius: 6px;
  border: none;
  background: rgba(139,92,246,.2); color: #a78bfa;
  font-size: 12px; font-weight: 600; cursor: pointer;
  outline: none; font-family: inherit; white-space: nowrap;
  transition: background .2s;
}
.mn-rules-add:hover { background: rgba(139,92,246,.32); }
.mn-rules-list { padding: 4px 0; max-height: 120px; overflow-y: auto; }
.mn-rules-list::-webkit-scrollbar { width: 3px; }
.mn-rules-list::-webkit-scrollbar-thumb { background: rgba(139,92,246,.15); border-radius: 2px; }
.mn-rule-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; font-size: 11px;
  border-bottom: 1px solid rgba(255,255,255,.03);
}
.mn-rule-row:last-child { border-bottom: none; }
.mn-rule-kw { color: #c8c8dc; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mn-rule-del {
  width: 20px; height: 20px; border-radius: 5px;
  border: none; background: none; color: #5e5e76;
  cursor: pointer; font-size: 14px; line-height: 1;
  transition: all .15s; outline: none; flex-shrink: 0; margin-left: 6px;
}
.mn-rule-del:hover { color: #f87171; background: rgba(248,113,113,.1); }
.mn-rules-empty { padding: 10px; font-size: 11px; color: #4e4e66; text-align: center; }

/* ── Drag & Drop + Trash Zone (#4) ── */
.mn-card[draggable="true"] { cursor: grab; }
.mn-card[draggable="true"]:active { cursor: grabbing; }
.mn-card.mn-card-dragging { opacity: 0.35; border-style: dashed; border-color: rgba(139,92,246,0.6); }

.mn-fab.mn-fab-dragover {
  transform: scale(1.18) !important;
  border-color: rgba(52,211,153,0.8) !important;
  box-shadow: 0 0 25px rgba(52,211,153,0.4) !important;
}

.mn-trash-zone {
  margin-top: 10px;
  padding: 10px;
  border: 1px dashed rgba(248,113,113,0.35);
  border-radius: 8px;
  background: rgba(248,113,113,0.06);
  color: #f87171;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  display: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all .2s;
}
.mn-trash-zone.open { display: flex; animation: mnUp .2s ease-out; }
.mn-trash-zone.mn-trash-active {
  background: rgba(248,113,113,0.22);
  border-color: rgba(248,113,113,0.7);
  transform: scale(1.02);
}
.mn-trash-zone svg { width: 14px; height: 14px; }

/* ── Edit & Version History (#10) ── */
.mn-btn-e { background: rgba(139,92,246,.12); color: #a78bfa; }
.mn-btn-e:hover { background: rgba(139,92,246,.25); }
.mn-btn-h { background: rgba(255,255,255,.05); color: #8e8ea6; }
.mn-btn-h:hover { color: #c8c8dc; background: rgba(255,255,255,.1); }
.mn-btn-r { background: rgba(52,211,153,.12); color: #34d399; padding: 2px 7px; font-size: 10px; }
.mn-btn-r:hover { background: rgba(52,211,153,.25); }

.mn-edit-area { margin-top: 8px; }
.mn-edit-box {
  width: 100%; min-height: 60px; padding: 8px; border-radius: 6px;
  border: 1px solid rgba(139,92,246,.3); background: rgba(16,16,28,.9);
  color: #e0e0f0; font-size: 12px; font-family: inherit; outline: none;
  resize: vertical;
}
.mn-edit-acts { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }

.mn-hist-panel {
  margin-top: 10px; padding-top: 8px; border-top: 1px dashed rgba(139,92,246,.15);
}
.mn-hist-item {
  padding: 6px 8px; border-radius: 6px; background: rgba(255,255,255,.03);
  margin-bottom: 6px; font-size: 11px; line-height: 1.5;
}
.mn-hist-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; color: #6e6e86; font-size: 10px; }
.mn-diff-body { font-size: 11px; word-break: break-word; }
del.mn-diff-del { color: #f87171; text-decoration: line-through; background: rgba(248,113,113,.15); padding: 0 3px; border-radius: 3px; }
ins.mn-diff-ins { color: #34d399; text-decoration: none; background: rgba(52,211,153,.15); padding: 0 3px; border-radius: 3px; }
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
        <button class="mn-rules-toggle" title="Configure never-save keywords">
          <span>Never-Save Rules</span>
          <span class="mn-arrow">▾</span>
        </button>
        <div class="mn-rules-panel">
          <div class="mn-rules-inp-row">
            <input class="mn-rules-inp" type="text" placeholder="e.g. salary, health, password" maxlength="80" />
            <button class="mn-rules-add">Add</button>
          </div>
          <div class="mn-rules-list"></div>
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

    // Rules add — button click
    const inp = dr.querySelector('.mn-rules-inp');
    dr.querySelector('.mn-rules-add').addEventListener('click', () => {
      addRule(inp.value);
      inp.value = '';
    });
    // Rules add — Enter key
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { addRule(inp.value); inp.value = ''; }
    });

    ui.noticed = dr.querySelector('[data-pane="noticed"]');
    ui.kept = dr.querySelector('[data-pane="kept"]');
    ui.rulesList = dr.querySelector('.mn-rules-list');

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
    if (!state.rules.length) {
      list.innerHTML = '<div class="mn-rules-empty">No rules yet — memories matching your keywords will be silently ignored.</div>';
      return;
    }
    list.innerHTML = state.rules.map((r) =>
      '<div class="mn-rule-row" data-id="' + r.id + '">' +
      '<span class="mn-rule-kw">' + esc(r.pattern) + '</span>' +
      '<button class="mn-rule-del" data-rid="' + r.id + '" title="Remove rule">×</button>' +
      '</div>'
    ).join('');
    list.querySelectorAll('.mn-rule-del').forEach((b) =>
      b.addEventListener('click', () => deleteRule(b.dataset.rid))
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
  const activeEdits = new Set();

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
    p.innerHTML = state.kept
      .map((m) => {
        const roleClass = m.role === 'assistant' ? 'a' : m.role === 'user' ? 'u' : 's';
        const roleLabel = m.role || 'saved';
        const isEditing = activeEdits.has(m.id);
        const isHistOpen = openHistories.has(m.id);
        const historyCount = m.history ? m.history.length : 0;

        let contentHTML = isEditing
          ? '<div class="mn-edit-area">' +
            '<textarea class="mn-edit-box" data-id="' + m.id + '">' + esc(m.text) + '</textarea>' +
            '<div class="mn-edit-acts">' +
            '<button class="mn-btn mn-btn-k" data-act="save-edit" data-id="' + m.id + '">Save</button>' +
            '<button class="mn-btn mn-btn-d" data-act="cancel-edit" data-id="' + m.id + '">Cancel</button>' +
            '</div></div>'
          : '<div class="mn-card-txt"><span class="mn-role mn-role-' + roleClass + '">' + esc(roleLabel) + '</span>' + esc(truncate(m.text)) + '</div>';

        let histHTML = '';
        if (isHistOpen && m.history && m.history.length > 0) {
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

        return (
          '<div class="mn-card" data-id="' + m.id + '">' +
          contentHTML +
          '<div class="mn-card-meta">' +
          '<span>' + timeAgo(m.keptAt || m.timestamp) + (m.updatedAt ? ' (edited)' : '') + '</span>' +
          '<div class="mn-card-acts">' +
          (!isEditing ? '<button class="mn-btn mn-btn-e" data-act="edit" data-id="' + m.id + '">Edit</button>' : '') +
          (historyCount > 0 ? '<button class="mn-btn mn-btn-h" data-act="tog-hist" data-id="' + m.id + '">Diff (' + historyCount + ')</button>' : '') +
          '<button class="mn-btn mn-btn-d" data-act="del" data-id="' + m.id + '">Delete</button>' +
          '</div></div>' +
          histHTML +
          '</div>'
        );
      })
      .join('');

    // Actions
    p.querySelectorAll('[data-act="del"]').forEach((b) =>
      b.addEventListener('click', () => deleteKept(b.dataset.id))
    );
    p.querySelectorAll('[data-act="edit"]').forEach((b) =>
      b.addEventListener('click', () => { activeEdits.add(b.dataset.id); renderKept(); })
    );
    p.querySelectorAll('[data-act="cancel-edit"]').forEach((b) =>
      b.addEventListener('click', () => { activeEdits.delete(b.dataset.id); renderKept(); })
    );
    p.querySelectorAll('[data-act="save-edit"]').forEach((b) =>
      b.addEventListener('click', () => {
        const area = p.querySelector('textarea[data-id="' + b.dataset.id + '"]');
        if (area && area.value.trim()) {
          activeEdits.delete(b.dataset.id);
          updateKept(b.dataset.id, area.value.trim());
        }
      })
    );
    p.querySelectorAll('[data-act="tog-hist"]').forEach((b) =>
      b.addEventListener('click', () => {
        if (openHistories.has(b.dataset.id)) openHistories.delete(b.dataset.id);
        else openHistories.add(b.dataset.id);
        renderKept();
      })
    );
    p.querySelectorAll('[data-act="revert"]').forEach((b) =>
      b.addEventListener('click', () => {
        const item = state.kept.find((m) => m.id === b.dataset.id);
        const verIdx = parseInt(b.dataset.ver, 10);
        if (item && item.history && item.history[verIdx]) {
          openHistories.delete(b.dataset.id);
          updateKept(b.dataset.id, item.history[verIdx].text);
          showToast('Reverted to version v' + (item.history.length - verIdx) + ' ✓');
        }
      })
    );

    // Attach drag handlers (#4)
    p.querySelectorAll('.mn-card').forEach((card) => {
      const id = card.dataset.id;
      const mem = state.kept.find((m) => m.id === id);
      if (!mem) return;
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/json', JSON.stringify({ id, origin: 'kept', text: mem.text }));
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

  /* ═══════════════════════════════════════
     PER-MESSAGE STATUS INDICATOR (#2) & AMBIENT CAPTURE PULSE (#15)
     ═══════════════════════════════════════ */
  function injectHostCSS() {
    if (document.getElementById('mn-host-styles')) return;
    const style = document.createElement('style');
    style.id = 'mn-host-styles';
    style.textContent = `
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
      .mn-chip-fg { background: rgba(248,113,113,0.15) !important; color: #f87171 !important; }
      .mn-chip-fg:hover { background: rgba(248,113,113,0.3) !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  const dismissedChips = new Set();

  function updateMessageStatusIndicators() {
    injectHostCSS();

    const selectors = [
      '[data-is-streaming]',
      '.font-claude-message',
      '[class*="message"]',
      '[class*="Message"]',
      '[class*="assistant"]',
      '[class*="Agent"]',
      '.grid p',
      'main p'
    ];

    const elements = document.querySelectorAll(selectors.join(', '));
    elements.forEach((el) => {
      const text = el.textContent ? el.textContent.trim() : '';
      if (text.length < 30) return;

      const matchingKept = state.kept.find((k) => text.includes(k.text.slice(0, 30)));
      const matchingNoticed = !matchingKept && state.noticed.find((n) => text.includes(n.text.slice(0, 30)));

      let dot = el.querySelector('.mn-status-dot');
      let chip = el.querySelector('.mn-chip');

      if (!matchingKept && !matchingNoticed) {
        if (dot) dot.remove();
        if (chip) chip.remove();
        el.classList.remove('mn-pulse-candidate');

        // Check if text is a candidate (not saved/noticed yet and not dismissed)
        if (text.length >= 60 && !dismissedChips.has(text.slice(0, 30)) && state.collectionEnabled) {
          el.classList.add('mn-pulse-candidate');
          if (!chip) {
            chip = document.createElement('span');
            chip.className = 'mn-chip';
            chip.innerHTML =
              '<button class="mn-chip-btn mn-chip-rem" title="Save to Vault">Remember</button>' +
              '<button class="mn-chip-btn mn-chip-ses" title="Keep for Session">Session</button>' +
              '<button class="mn-chip-btn mn-chip-fg" title="Dismiss">Forget</button>';
            el.appendChild(chip);

            chip.querySelector('.mn-chip-rem').onclick = (e) => {
              e.stopPropagation();
              addKept({
                id: uid(),
                text: text.slice(0, 800),
                role: 'assistant',
                source: location.hostname,
                url: location.href,
                timestamp: Date.now(),
                keptAt: Date.now(),
              });
              el.classList.remove('mn-pulse-candidate');
              chip.remove();
            };
            chip.querySelector('.mn-chip-ses').onclick = (e) => {
              e.stopPropagation();
              addNoticed({
                id: uid(),
                text: text.slice(0, 800),
                role: 'assistant',
                source: location.hostname,
                url: location.href,
                timestamp: Date.now(),
              });
              el.classList.remove('mn-pulse-candidate');
              chip.remove();
            };
            chip.querySelector('.mn-chip-fg').onclick = (e) => {
              e.stopPropagation();
              dismissedChips.add(text.slice(0, 30));
              el.classList.remove('mn-pulse-candidate');
              chip.remove();
            };
          }
        }
        return;
      }

      // If matched, remove pulse glow & chip, show status dot
      el.classList.remove('mn-pulse-candidate');
      if (chip) chip.remove();

      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'mn-status-dot';
        el.appendChild(dot);
      }

      if (matchingKept) {
        dot.className = 'mn-status-dot mn-status-kept';
        dot.title = 'MemoNeg: Stored in Vault (Kept)';
        dot.onclick = (e) => {
          e.stopPropagation();
          state.activeTab = 'kept';
          if (!state.drawerOpen) toggleDrawer();
        };
      } else if (matchingNoticed) {
        dot.className = 'mn-status-dot mn-status-noticed';
        dot.title = 'MemoNeg: Session Candidate (Noticed)';
        dot.onclick = (e) => {
          e.stopPropagation();
          state.activeTab = 'noticed';
          if (!state.drawerOpen) toggleDrawer();
        };
      }
    });
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

        addNoticed({
          id: uid(),
          text: snippet.trim(),
          role: 'assistant',
          source: location.hostname,
          url: location.href,
          timestamp: Date.now(),
        });
      }, 3500);
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
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
