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
    activeTab: 'global-memory', // 'global-memory' | 'local-memory' | 'canvas' | 'settings' | 'export'
    mainViewTab: 'vault',       // 'vault' | 'spatial'
    collectionEnabled: true,
    spatialProtocolEnabled: true,
    liveSyncEnabled: true,
    lastDrawnClaudeMessage: '',
    canvasSubTab: 'mindmap',    // 'mindmap' | 'canvas' | 'timeline' | 'code'
    whiteboardTool: 'select',
    whiteboardPenColor: '#1A1A2E',
    noticed: [],
    kept: [],
    rules: [],          // never-save keyword rules
    rulesOpen: false,   // rules panel expanded in footer
    snapsOpen: false,
    snapshots: [],
    // PenEcho Spatial Canvas Protocol State
    penechoState: {
      timeline: [],
      mindmap: { nodes: [], links: [] },
      canvas: { elements: [] },
      drawings: [],
      stickies: []
    },
    penechoDraft: null,
    penechoHistory: [],
    selectedMindMapNode: null,
    canvasZoom: 1.0,
    canvasPan: { x: 0, y: 0 },
  };

  var shadow = null;
  const ui = {};
  let digestDismissed = false;
  let toastTimer = null;

  /* ═══════════════════════════════════════════════════════════════
     PENECHO + MEMONEG SPATIAL CANVAS PROTOCOL SPECIFICATION
     ═══════════════════════════════════════════════════════════════ */
  const PENECHO_PROTOCOL_DIRECTIVE = `[PenEcho Spatial Canvas Protocol Active]
For every response in this conversation:
1. Always output your complete, high-quality, human-readable markdown response first.
2. DO NOT make a hidden output. Whenever visualizing architecture, derivations, workflows, formulas, concepts, or mind maps, generate a dedicated code file / artifact named "penecho-canvas.json" (or a single code block tagged \`\`\`json:penecho-canvas\`\`\`) containing the exact structured canvas drawing JSON code.
3. The spatial canvas code file will be rendered directly onto our PenEcho shared whiteboard canvas.
4. Adhere strictly to the standardized 5-color memory taxonomy:
- 🟢 Green "#22C55E" (safe_memory): Long-term memory / verified architecture decisions / safe facts.
- 🟡 Yellow "#EAB308" (consideration): Trade-offs / provisional assumptions / revisit if time permits.
- 🔴 Red "#EF4444" (reconsider): High-risk failure modes / security risks / must reconsider / sensitive data.
- 🔵 Blue "#3B82F6" (active_focus): Current active task / step currently being computed.
- ⚪ Slate "#64748B" (neutral_structure): Structural concepts / groupings / neutral connectors.
5. Schema specification:
\`\`\`json:penecho-canvas
{
  "version": "1.0",
  "timeline": {
    "step_id": "step_unique_id",
    "step_number": 1,
    "title": "Short Milestone Title",
    "status": "completed | in_progress | planned",
    "summary": "Brief 1-line progress summary of what was accomplished or decided in this turn."
  },
  "mindmap": {
    "action": "merge",
    "nodes": [
      {
        "id": "node_unique_id",
        "label": "Concept or Decision Label",
        "category": "safe_memory | consideration | reconsider | active_focus | neutral_structure",
        "color": "#22C55E | #EAB308 | #EF4444 | #3B82F6 | #64748B",
        "description": "Short explanation of why this node is categorized this way.",
        "parent": "parent_node_id"
      }
    ],
    "links": [
      {
        "source": "source_node_id",
        "target": "target_node_id",
        "label": "relationship description",
        "style": "solid | dashed | arrow"
      }
    ]
  },
  "canvas": {
    "elements": [
      {
        "type": "render_formula",
        "id": "elem_id",
        "x": 380,
        "y": 100,
        "latex": "T_{\\\\text{expiry}} = \\\\mu_{\\\\text{session}} + 2\\\\sigma",
        "caption": "Adaptive Session Expiry Window"
      },
      {
        "type": "draw_box",
        "id": "box_id",
        "x": 80,
        "y": 180,
        "w": 140,
        "h": 80,
        "color": "#3B82F6",
        "title": "Browser Client",
        "style": "solid"
      },
      {
        "type": "draw_arrow",
        "from": [220, 220],
        "to": [320, 220],
        "label": "Bearer Token",
        "color": "#22C55E"
      },
      {
        "type": "draw_text",
        "x": 80,
        "y": 300,
        "text": "Note: Token rotation required every 15 mins",
        "color": "#EAB308"
      }
    ]
  }
}
\`\`\``;

  const PENECHO_EXAMPLE_PAYLOAD = {
    version: "1.0",
    timeline: {
      step_id: "step_2_auth_design",
      step_number: 2,
      title: "Session Architecture Finalized",
      status: "completed",
      summary: "Selected stateless JWT with optional Redis blocklist."
    },
    mindmap: {
      action: "merge",
      nodes: [
        {
          id: "auth_root",
          label: "Session Management",
          category: "neutral_structure",
          color: "#64748B",
          description: "Core authentication subtree"
        },
        {
          id: "jwt_tokens",
          label: "Stateless Ed25519 JWT",
          category: "safe_memory",
          color: "#22C55E",
          description: "Committed to permanent memory. Safe and verified.",
          parent: "auth_root"
        },
        {
          id: "redis_cache",
          label: "Redis Blocklist",
          category: "consideration",
          color: "#EAB308",
          description: "Moderate priority. Implement if infrastructure budget permits.",
          parent: "auth_root"
        },
        {
          id: "local_storage_secrets",
          label: "Secrets in LocalStorage",
          category: "reconsider",
          color: "#EF4444",
          description: "High vulnerability risk! Must be completely removed.",
          parent: "auth_root"
        }
      ],
      links: [
        {
          source: "auth_root",
          target: "jwt_tokens",
          label: "primary mechanism",
          style: "solid"
        },
        {
          source: "auth_root",
          target: "redis_cache",
          label: "optional revoke layer",
          style: "dashed"
        },
        {
          source: "auth_root",
          target: "local_storage_secrets",
          label: "prohibited pattern",
          style: "dashed"
        }
      ]
    },
    canvas: {
      elements: [
        {
          type: "render_formula",
          id: "f_expiry",
          x: 380,
          y: 100,
          latex: "T_{\\text{expiry}} = \\mu_{\\text{session}} + 2\\sigma",
          caption: "Adaptive Session Expiry Window"
        },
        {
          type: "draw_box",
          id: "b_client",
          x: 80,
          y: 180,
          w: 140,
          h: 80,
          color: "#3B82F6",
          title: "Browser Client",
          style: "solid"
        },
        {
          type: "draw_box",
          id: "b_auth",
          x: 320,
          y: 180,
          w: 160,
          h: 80,
          color: "#22C55E",
          title: "JWT Auth Guard",
          style: "solid"
        },
        {
          type: "draw_arrow",
          from: [220, 220],
          to: [320, 220],
          label: "Bearer Token",
          color: "#22C55E"
        },
        {
          type: "draw_text",
          x: 80,
          y: 300,
          text: "Note: Token rotation required every 15 mins",
          color: "#EAB308"
        }
      ]
    }
  };

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
    } catch (_) { }
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

  function getDomainFromUrl(url) {
    if (!url) return '';
    try {
      return new URL(url).hostname;
    } catch (_) {
      return 'source link';
    }
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
      const [kr, nr, rr, cr] = await Promise.all([
        send({ type: 'GET_KEPT' }),
        send({ type: 'GET_NOTICED' }),
        send({ type: 'GET_RULES' }),
        send({ type: 'GET_CANVAS_STATE' }),
      ]);
      state.kept = kr?.kept || state.kept || [];
      state.noticed = nr?.noticed || state.noticed || [];
      state.rules = rr?.rules || state.rules || [];
      if (cr?.canvasState) state.penechoState = cr.canvasState;
      renderAll();
    } catch (_) {
      renderAll();
    }
  }

  function injectSpatialPromptToClaude() {
    try {
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
        const directiveText = `${PENECHO_PROTOCOL_DIRECTIVE}\n\nPlease proceed with the next explanation/architecture and generate the penecho-canvas.json code file: `;

        if (inputEl.isContentEditable) {
          const p = document.createElement('p');
          p.textContent = directiveText;
          inputEl.appendChild(p);
          inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText' }));
        } else {
          const currentVal = inputEl.value;
          inputEl.value = currentVal ? `${currentVal}\n\n${directiveText}` : directiveText;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        showToast('⚡ PenEcho Spatial Canvas Prompt Injected to Claude ✓');
      } else {
        showToast('⚠️ Claude input box not found on page');
      }
    } catch (err) {
      console.warn('[MemoNeg] Error injecting prompt to Claude:', err);
      showToast('⚠️ Could not inject prompt to Claude');
    }
  }

  function renderClaudeMessageToCanvas(claudeAnswerText, force = false) {
    if (!claudeAnswerText || typeof claudeAnswerText !== 'string' || claudeAnswerText.length < 5) return;
    const textHash = hashStr(claudeAnswerText);
    if (!force && state.lastDrawnClaudeMessage === textHash) return;

    state.lastDrawnClaudeMessage = textHash;
    const parsedJson = parsePenechoJson(claudeAnswerText);
    if (parsedJson) {
      applyPenechoCanvasPayload(parsedJson, false);
      playMemoryTone('scope');
      showToast('✨ PenEcho Canvas Rendered from Claude code file ✓');
      return;
    }

    const fallbackPayload = parseMarkdownToPenechoCanvas(claudeAnswerText);
    if (fallbackPayload) {
      applyPenechoCanvasPayload(fallbackPayload, false);
      playMemoryTone('scope');
      showToast('✨ PenEcho Canvas Rendered from Claude conversation ✓');
    }
  }

  async function addKept(mem) {
    const memoryToSave = { scope: 'global', ...mem };
    const r = await send({ type: 'ADD_KEPT', memory: memoryToSave });
    state.kept = r?.kept || [];
    renderAll();
    syncMemoryToClaude(mem.text);
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
    brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a5 5 0 0 1 5 5c0 1.2-.4 2.3-1.1 3.2l.1.8a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5l.1-.8A4.98 4.98 0 0 1 4 7a5 5 0 0 1 5-5z"/><circle cx="12" cy="7" r="1.5" stroke-width="1.5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/><circle cx="18" cy="6" r="1.2" stroke-width="1.5"/><circle cx="6" cy="18" r="1.2" stroke-width="1.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><circle cx="12" cy="15" r="1.2" stroke-width="1.5"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><circle cx="12" cy="15" r="1.2" stroke-width="1.5"/></svg>',
    vault: '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1.5" stroke-width="1.5"/></svg>',
    lock: '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="8" height="6" rx="1"/><path d="M4 5V3.5a2 2 0 0 1 4 0V5"/><circle cx="6" cy="8" r="1" stroke-width="1.5"/></svg>',
    wipSign: '<svg viewBox="0 0 100 100" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;display:inline-block;"><path d="M50 18 L25 45 M50 18 L75 45" stroke="#1A1A2E" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="16" r="6" fill="#3B82F6" stroke="#1A1A2E" stroke-width="4"/><rect x="15" y="40" width="70" height="48" rx="8" fill="#FFD100" stroke="#1A1A2E" stroke-width="5"/><circle cx="30" cy="48" r="3" fill="#FFFFFF" stroke="#1A1A2E" stroke-width="2"/><circle cx="70" cy="48" r="3" fill="#FFFFFF" stroke="#1A1A2E" stroke-width="2"/><text x="50" y="62" font-family="sans-serif" font-weight="900" font-size="10" fill="#1A1A2E" text-anchor="middle">WORK IN</text><text x="50" y="76" font-family="sans-serif" font-weight="900" font-size="10" fill="#1A1A2E" text-anchor="middle">PROGRESS</text></svg>',
    personAvatar: '<svg viewBox="0 0 100 100" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;display:inline-block;"><path d="M15 95 C15 68 32 64 50 64 C68 64 85 68 85 95 Z" fill="#2C1D1D"/><path d="M42 60 C42 60 50 68 58 60 L58 72 C58 72 50 80 42 72 Z" fill="#FFA099"/><circle cx="50" cy="42" r="22" fill="#FFA099"/><path d="M20 34 C20 18 36 14 50 14 C66 14 78 24 78 38 C74 32 66 28 58 35 C58 35 50 20 32 28 C25 32 21 34 20 34 Z" fill="#2C1D1D"/><ellipse cx="39" cy="42" rx="2.5" ry="3.5" fill="#2C1D1D"/><ellipse cx="57" cy="42" rx="2.5" ry="3.5" fill="#2C1D1D"/><path d="M42 53 Q50 57 58 53" stroke="#E63946" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg>',
    cppLogo: '<svg viewBox="0 0 100 100" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;display:inline-block;"><polygon points="50,5 92,28 92,72 50,95 8,72 8,28" fill="#00599C"/><polygon points="50,5 92,28 92,72 50,95" fill="#004482" opacity="0.3"/><path d="M46 35 A 16 16 0 1 0 46 65 L 54 65 A 24 24 0 1 1 54 35 Z" fill="#FFFFFF"/><rect x="60" y="47" width="9" height="3" fill="#FFFFFF"/><rect x="63" y="44" width="3" height="9" fill="#FFFFFF"/><rect x="73" y="47" width="9" height="3" fill="#FFFFFF"/><rect x="76" y="44" width="3" height="9" fill="#FFFFFF"/></svg>',
    healthCross: '<svg viewBox="0 0 100 100" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;display:inline-block;"><rect x="10" y="10" width="80" height="80" rx="20" fill="#EF4444" stroke="#1A1A2E" stroke-width="4"/><path d="M50 25 V75 M25 50 H75" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round"/><path d="M32 50 Q41 38 50 50 T68 50" stroke="#1A1A2E" stroke-width="4" fill="none" stroke-linecap="round"/></svg>',
    familyHeart: '<svg viewBox="0 0 100 100" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;display:inline-block;"><path d="M50 85 C20 60 10 40 25 22 C38 6 50 25 50 25 C50 25 62 6 75 22 C90 40 80 60 50 85 Z" fill="#EC4899" stroke="#1A1A2E" stroke-width="4"/><path d="M35 45 A 8 8 0 1 1 45 35 M55 35 A 8 8 0 1 1 65 45" stroke="#FFFFFF" stroke-width="4" fill="none"/></svg>',
    researchAtom: '<svg viewBox="0 0 100 100" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;display:inline-block;"><ellipse cx="50" cy="50" rx="40" ry="14" stroke="#06B6D4" stroke-width="5" transform="rotate(30 50 50)"/><ellipse cx="50" cy="50" rx="40" ry="14" stroke="#3B82F6" stroke-width="5" transform="rotate(-30 50 50)"/><ellipse cx="50" cy="50" rx="40" ry="14" stroke="#8B5CF6" stroke-width="5" transform="rotate(90 50 50)"/><circle cx="50" cy="50" r="10" fill="#F59E0B" stroke="#1A1A2E" stroke-width="3"/></svg>',
    safeVault: '<svg viewBox="0 0 100 100" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;display:inline-block;"><rect x="12" y="12" width="76" height="76" rx="16" fill="#F59E0B" stroke="#1A1A2E" stroke-width="5"/><circle cx="50" cy="50" r="20" fill="#FFFFFF" stroke="#1A1A2E" stroke-width="5"/><circle cx="50" cy="50" r="6" fill="#1A1A2E"/><path d="M50 30 V36 M50 64 V70 M30 50 H36 M64 50 H70" stroke="#1A1A2E" stroke-width="4" stroke-linecap="round"/></svg>',
    railGlobal: '<svg viewBox="0 0 100 100" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;"><circle cx="50" cy="50" r="40" fill="#9333EA" stroke="#1A1A2E" stroke-width="5"/><ellipse cx="50" cy="50" rx="40" ry="16" stroke="#FFFFFF" stroke-width="4"/><ellipse cx="50" cy="50" rx="16" ry="40" stroke="#FFFFFF" stroke-width="4"/><line x1="10" y1="50" x2="90" y2="50" stroke="#FFFFFF" stroke-width="4"/></svg>',
    railSession: '<svg viewBox="0 0 100 100" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;"><path d="M15 22 H85 V65 H50 L30 80 V65 H15 Z" fill="#06B6D4" stroke="#1A1A2E" stroke-width="5" stroke-linejoin="round"/><circle cx="35" cy="43" r="5" fill="#FFFFFF"/><circle cx="50" cy="43" r="5" fill="#FFFFFF"/><circle cx="65" cy="43" r="5" fill="#FFFFFF"/></svg>',
    railCanvas: '<svg viewBox="0 0 100 100" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;"><path d="M15 20 H85 V80 H15 Z" fill="#EC4899" stroke="#1A1A2E" stroke-width="5" rx="10"/><circle cx="35" cy="40" r="8" fill="#F59E0B"/><circle cx="65" cy="40" r="8" fill="#3B82F6"/><path d="M30 65 L45 50 L60 65 L75 55" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    railExport: '<svg viewBox="0 0 100 100" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;"><rect x="15" y="45" width="70" height="42" rx="10" fill="#10B981" stroke="#1A1A2E" stroke-width="5"/><path d="M50 12 V55 M30 38 L50 58 L70 38" stroke="#1A1A2E" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    railSettings: '<svg viewBox="0 0 100 100" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;"><path d="M50 15 L57 25 H70 L73 38 L85 43 L80 56 L88 67 L76 73 L70 85 L57 80 L50 88 L43 80 L30 85 L24 73 L12 67 L20 56 L15 43 L27 38 L30 25 H43 Z" fill="#F59E0B" stroke="#1A1A2E" stroke-width="4"/><circle cx="50" cy="50" r="16" fill="#FFFFFF" stroke="#1A1A2E" stroke-width="4"/></svg>',
  };

  /* ═══════════════════════════════════════════
     CSS — Injected into closed Shadow DOM
     Design System: Retro Y2K Browser Pop
     ═══════════════════════════════════════════ */
  function getCSS() {
    return `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

:host, * { box-sizing: border-box; margin: 0; padding: 0; }

.mn {
  --mn-bg: #FFFFFF;
  --mn-bg-card: #F0F8FF;
  --mn-bg-elevated: #E8F4FD;
  --mn-fg: #1A1A2E;
  --mn-fg-muted: #6B7280;
  --mn-primary: #FF85C8;
  --mn-accent: #FF69B4;
  --mn-accent-hover: #FF4DA6;
  --mn-accent-purple: #9B72FF;
  --mn-danger: #EF4444;
  --mn-danger-hover: #DC2626;
  --mn-warn: #F59E0B;
  --mn-border: #1A1A2E;
  --mn-border-focus: #FF69B4;
  --mn-ring: rgba(255, 105, 180, 0.4);
  --mn-shadow: 4px 4px 0px #1A1A2E;
  --mn-radius: 14px;
  --mn-radius-sm: 10px;
  --mn-radius-xs: 6px;
  --mn-transition: 180ms cubic-bezier(0.16, 1, 0.3, 1);
  --mn-blue: #A8E6F0;
  --mn-grid-blue: #5B8DEF;
  --mn-pink: #FF85C8;
  --mn-gold: #F0A030;

  font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13.5px;
  color: var(--mn-fg);
  line-height: 1.5;
  pointer-events: auto;
  -webkit-font-smoothing: antialiased;
}

/* ── FAB ── */
.mn-fab {
  position: fixed; bottom: 28px; right: 28px;
  width: 56px; height: 56px; border-radius: 14px;
  border: 3px solid #1A1A2E;
  background: var(--mn-pink);
  color: #1A1A2E; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 4px 4px 0px #1A1A2E;
  transition: all var(--mn-transition);
  z-index: 99999; outline: none;
}
.mn-fab:hover {
  transform: translate(-2px, -2px);
  box-shadow: 6px 6px 0px #1A1A2E;
  background: #FF9DD5;
}
.mn-fab:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0px #1A1A2E; }
.mn-fab svg { width: 26px; height: 26px; flex-shrink: 0; stroke: #1A1A2E; stroke-width: 2.5; }

.mn-fab.mn-fab-hidden { opacity: 0 !important; pointer-events: none !important; }

/* ── Pull Tab ── */
.mn-pull-tab {
  position: fixed; top: 50%; right: 0; transform: translateY(-50%);
  z-index: 99997; background: var(--mn-blue);
  border: 3px solid #1A1A2E; border-right: none;
  border-radius: 14px 0 0 14px; padding: 12px 6px;
  cursor: pointer; display: flex; flex-direction: column;
  align-items: center; gap: 8px;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: -3px 3px 0px #1A1A2E;
}
.mn-pull-tab:hover { background: #C2F0F8; padding-left: 10px; }
.mn-pull-tab.sidebar-open { right: 440px; }
.mn-pull-tab-text { writing-mode: vertical-rl; text-orientation: mixed; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #1A1A2E; }
.mn-pull-tab-arrow { font-size: 12px; color: #1A1A2E; line-height: 1; transition: transform .2s ease; }
.mn-pull-tab.sidebar-open .mn-pull-tab-arrow { transform: rotate(180deg); }

.mn-ov { display: none !important; }

/* ── Sidebar ── */
.mn-dr {
  position: fixed !important; top: 50% !important; right: 0 !important;
  width: 440px; max-width: 88vw; height: 80vh; max-height: 750px;
  background-color: #FFFFFF !important;
  background: #FFFFFF !important;
  background-image: linear-gradient(rgba(91,141,239,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(91,141,239,0.08) 1px, transparent 1px) !important;
  background-size: 20px 20px !important;
  border: 3px solid #1A1A2E !important;
  border-right: none !important;
  border-radius: 16px 0 0 16px !important;
  transform: translateY(-50%) translateX(100%);
  transition: transform .28s cubic-bezier(.32,.72,0,1);
  display: flex; flex-direction: column;
  z-index: 99998;
  box-shadow: -6px 4px 0px #1A1A2E !important;
  overflow: hidden;
  font-family: 'Space Grotesk', sans-serif !important;
  color: #1A1A2E !important;
}
.mn-dr.open { transform: translateY(-50%) translateX(0) !important; }

/* ── Header ── */
.mn-hdr {
  position: relative; z-index: 2; padding: 14px 18px;
  background: var(--mn-blue) !important;
  border-bottom: 3px solid #1A1A2E !important;
  display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
}
.mn-title {
  position: relative; z-index: 2;
  font-family: 'Space Grotesk', sans-serif !important;
  font-size: 18px; font-weight: 700; color: #1A1A2E !important;
  letter-spacing: -0.3px; display: flex; align-items: center; gap: 10px;
}
.mn-title svg { width: 22px; height: 22px; stroke: #1A1A2E !important; stroke-width: 2.5; flex-shrink: 0; }
.mn-hdr-r { position: relative; z-index: 2; display: flex; align-items: center; gap: 10px; }

.mn-lock {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10px; font-weight: 700; letter-spacing: .5px;
  text-transform: uppercase; color: #FFFFFF;
  background: var(--mn-pink); border: 2px solid #1A1A2E;
  padding: 3px 8px; border-radius: 8px; box-shadow: 2px 2px 0px #1A1A2E;
}

/* ── Toggle ── */
.mn-tgl {
  position: relative; width: 40px; height: 22px;
  appearance: none; -webkit-appearance: none;
  background: #E5E7EB; border-radius: 11px; cursor: pointer;
  transition: background .2s; border: 2px solid #1A1A2E; outline: none; flex-shrink: 0;
}
.mn-tgl:checked { background: var(--mn-pink); border-color: #1A1A2E; }
.mn-tgl::after {
  content: ''; position: absolute; top: 1px; left: 1px;
  width: 16px; height: 16px; border-radius: 50%;
  background: #FFFFFF; border: 2px solid #1A1A2E;
  transition: transform .2s cubic-bezier(.4,0,.2,1);
}
.mn-tgl:checked::after { transform: translateX(18px); }

/* ── Close ── */
.mn-cls {
  position: relative; z-index: 100; pointer-events: auto;
  width: 28px; height: 28px; border-radius: 50%;
  border: 2px solid #1A1A2E; background: #EF4444;
  color: #FFFFFF; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all var(--mn-transition); outline: none; flex-shrink: 0;
  box-shadow: 2px 2px 0px #1A1A2E;
}
.mn-cls svg { width: 14px; height: 14px; stroke-width: 2.5; stroke: #FFFFFF; pointer-events: none; }
.mn-cls:hover { transform: translate(-1px, -1px); box-shadow: 3px 3px 0px #1A1A2E; background: #DC2626; }

/* ── Tabs ── */
.mn-tabs {
  position: relative; z-index: 2; display: flex; padding: 0;
  background: var(--mn-pink) !important;
  border-bottom: 3px solid #1A1A2E !important; flex-shrink: 0; gap: 0;
}
.mn-tab {
  flex: 1; padding: 11px 0; text-align: center;
  font-size: 13px; font-weight: 700; color: #1A1A2E;
  background: transparent; border: none; border-bottom: 3px solid transparent;
  cursor: pointer; transition: all 0.15s ease; outline: none;
  font-family: 'Space Grotesk', sans-serif; text-transform: uppercase; letter-spacing: 0.5px;
}
.mn-tab:hover { background: rgba(255,255,255,0.3); }
.mn-tab.active { color: #1A1A2E !important; background: #FFFFFF !important; border-bottom: 3px solid #1A1A2E !important; font-weight: 700; }
.mn-tab-bar { display: none; }

.mn-sidebar-subhdr {
  position: relative; z-index: 2; padding: 8px 18px;
  background: var(--mn-blue) !important; border-bottom: 2px solid #1A1A2E !important;
  font-size: 11px; font-weight: 700; color: #1A1A2E; text-align: center; text-transform: uppercase; letter-spacing: 0.5px;
}

.mn-memory-section {
  position: relative; border: 3px solid #1A1A2E; border-radius: 14px;
  padding: 14px; background: #FFFFFF;
  display: flex; flex-direction: column; min-height: 420px; height: 100%;
  transition: all 0.25s ease; box-shadow: 4px 4px 0px #1A1A2E;
}
.mn-memory-section.mn-drop-target-active {
  border-color: var(--mn-pink) !important; background: rgba(255,133,200,0.08) !important;
  box-shadow: 0 0 0 4px rgba(255,105,180,0.3), 4px 4px 0px #1A1A2E !important;
}

.mn-section-hdr {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 13px; font-weight: 700; color: #1A1A2E;
  margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #1A1A2E;
}
.mn-section-sub { font-size: 10px; font-weight: 600; color: var(--mn-fg-muted); letter-spacing: 0.3px; }

/* ── Body ── */
.mn-body { position: relative; z-index: 2; flex: 1; overflow-y: auto; padding: 16px 18px; display: block; }
.mn-body::-webkit-scrollbar { width: 8px; }
.mn-body::-webkit-scrollbar-track { background: transparent; }
.mn-body::-webkit-scrollbar-thumb { background: var(--mn-pink); border-radius: 4px; border: 2px solid #FFFFFF; }
.mn-body::-webkit-scrollbar-thumb:hover { background: #FF69B4; }
.mn-pane { display: none; }
.mn-pane.active { display: block; }

/* ── Card ── */
.mn-card {
  background: #FFFFFF; border: 2px solid #1A1A2E;
  border-radius: 12px; padding: 14px 16px; margin-bottom: 12px;
  transition: all var(--mn-transition); cursor: pointer;
  box-shadow: 3px 3px 0px #1A1A2E;
}
.mn-card:hover {
  border-color: var(--mn-pink); background: #FFF5FA;
  box-shadow: 5px 5px 0px var(--mn-pink); transform: translate(-2px, -2px);
}
.mn-card-title-row { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px; }
.mn-card-main-title { font-size: 14px; font-weight: 600; color: #1A1A2E; line-height: 1.5; flex: 1; word-break: break-word; }
.mn-card-meta-bar { display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 12px !important; margin-top: 10px !important; padding-top: 8px !important; border-top: 1px solid #E5E7EB !important; }
.mn-card-time { font-size: 11px; font-weight: 500; color: var(--mn-fg-muted); display: flex; align-items: center; gap: 6px; font-family: 'DM Mono', monospace; }
.mn-card-acts { display: flex; align-items: center; gap: 6px; }

.mn-card-details-panel { margin-top: 14px; padding-top: 14px; border-top: 2px dashed #D1D5DB; animation: mnSlideIn .2s ease-out; }
.mn-details-sec { margin-bottom: 12px; }
.mn-details-lbl { display: block; font-size: 11px; font-weight: 700; color: var(--mn-fg-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.mn-details-txt { font-size: 13px; font-weight: 400; color: #1A1A2E; line-height: 1.55; background: var(--mn-bg-card); padding: 10px 12px; border-radius: 10px; border: 2px solid #E5E7EB; white-space: pre-wrap; word-break: break-word; }
.mn-chat-link { display: inline-block; color: var(--mn-grid-blue); font-weight: 600; font-size: 12px; word-break: break-all; text-decoration: none; transition: color var(--mn-transition); }
.mn-chat-link:hover { color: var(--mn-accent); text-decoration: underline; }
.mn-details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; background: var(--mn-bg-card); padding: 10px 12px; border-radius: 10px; border: 2px solid #E5E7EB; font-size: 12px; font-weight: 500; color: #1A1A2E; }
.mn-details-item { display: flex; flex-direction: column; gap: 2px; }
.mn-details-sublbl { color: var(--mn-fg-muted); font-size: 10px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.3px; }

/* ── Buttons ── */
.mn-btn {
  padding: 5px 14px; border-radius: 8px !important;
  border: 2px solid #1A1A2E !important; font-size: 11px; font-weight: 700;
  cursor: pointer; transition: all 0.15s ease !important; outline: none;
  font-family: 'Space Grotesk', sans-serif !important;
  background: #FFFFFF !important; color: #1A1A2E !important;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  box-shadow: 2px 2px 0px #1A1A2E; text-transform: uppercase; letter-spacing: 0.3px;
}
.mn-btn:hover { transform: translate(-1px, -1px); box-shadow: 3px 3px 0px #1A1A2E; background: var(--mn-bg-card) !important; }
.mn-btn:active { transform: translate(1px, 1px); box-shadow: 1px 1px 0px #1A1A2E; }

.mn-btn-k { background: #D1FAE5 !important; color: #065F46 !important; border-color: #065F46 !important; }
.mn-btn-k:hover { background: #A7F3D0 !important; }
.mn-btn-d { background: #FEE2E2 !important; color: #991B1B !important; border-color: #991B1B !important; }
.mn-btn-d:hover { background: #FECACA !important; }
.mn-btn-e { background: var(--mn-blue) !important; color: #1A1A2E !important; border-color: #1A1A2E !important; }
.mn-btn-e:hover { background: #C2F0F8 !important; }
.mn-btn-h { background: #FEF3C7 !important; color: #92400E !important; border-color: #92400E !important; }
.mn-btn-h:hover { background: #FDE68A !important; }
.mn-btn-r { background: #D1FAE5 !important; color: #065F46 !important; padding: 2px 10px; font-size: 10px; border-color: #065F46 !important; }
.mn-btn-p {
  background: var(--mn-pink) !important; color: #FFFFFF !important;
  border-color: #1A1A2E !important; box-shadow: 3px 3px 0px #1A1A2E !important;
}
.mn-btn-p:hover { background: #FF69B4 !important; transform: translate(-2px, -2px); box-shadow: 5px 5px 0px #1A1A2E !important; }
.mn-btn-sim { background: #FEF3C7 !important; color: #92400E !important; border-color: #92400E !important; }

.mn-role { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; margin-right: 6px; vertical-align: middle; border: 2px solid #1A1A2E; box-shadow: 1px 1px 0px #1A1A2E; }
.mn-role-a { background: #EDE9FE; color: #5B21B6; }
.mn-role-u { background: #D1FAE5; color: #065F46; }
.mn-role-s { background: #FEF3C7; color: #92400E; }

.mn-empty { text-align: center; padding: 40px 20px; color: var(--mn-fg-muted); background: #FFFFFF; border: 3px dashed #D1D5DB; border-radius: 14px; }
.mn-empty svg { margin-bottom: 12px; stroke-width: 2; stroke: var(--mn-fg-muted); opacity: 0.5; }
.mn-empty-t { font-size: 15px; font-weight: 700; margin-bottom: 6px; color: #1A1A2E; }
.mn-empty-s { font-size: 12px; line-height: 1.6; color: var(--mn-fg-muted); font-weight: 400; }

/* ── Footer ── */
.mn-foot {
  position: relative; z-index: 2; padding: 14px 18px;
  background: var(--mn-blue) !important; border-top: 3px solid #1A1A2E !important; flex-shrink: 0;
}
.mn-exp {
  width: 100%; padding: 10px 16px; border-radius: 10px !important;
  border: 2px solid #1A1A2E !important; background: #FFFFFF !important;
  color: #1A1A2E !important; font-size: 12.5px; font-weight: 700;
  cursor: pointer; transition: all 0.15s ease !important;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  outline: none; font-family: 'Space Grotesk', sans-serif !important;
  box-shadow: 3px 3px 0px #1A1A2E; text-transform: uppercase; letter-spacing: 0.3px;
}
.mn-exp svg { width: 16px; height: 16px; stroke-width: 2.5; stroke: #1A1A2E; }
.mn-exp:hover { transform: translate(-2px, -2px); box-shadow: 5px 5px 0px #1A1A2E; background: var(--mn-bg-card) !important; }
.mn-exp:hover svg { stroke: #1A1A2E; }

.mn-sel {
  position: fixed; padding: 8px 16px; border-radius: 10px;
  border: 2px solid #1A1A2E; background: var(--mn-pink);
  color: #FFFFFF; font-size: 12px; font-weight: 700; cursor: pointer;
  display: none; align-items: center; gap: 6px; z-index: 99999;
  box-shadow: 3px 3px 0px #1A1A2E; transition: all var(--mn-transition);
  animation: mnUp .2s ease-out; font-family: 'Space Grotesk', sans-serif; text-transform: uppercase;
}
.mn-sel svg { width: 16px; height: 16px; stroke-width: 2.5; stroke: #FFFFFF; }
.mn-sel:hover { background: #FF69B4; transform: translate(-1px, -1px); box-shadow: 4px 4px 0px #1A1A2E; }
.mn-sel:hover svg { stroke: #FFFFFF; }
@keyframes mnUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }

.mn-toast {
  position: fixed; bottom: 94px; right: 28px;
  padding: 10px 18px; border-radius: 10px;
  background: var(--mn-pink); border: 2px solid #1A1A2E;
  color: #FFFFFF; font-size: 13px; font-weight: 700;
  box-shadow: 3px 3px 0px #1A1A2E;
  opacity: 0; transform: translateY(8px); transition: all .25s;
  pointer-events: none; z-index: 99999; font-family: 'Space Grotesk', sans-serif;
}
.mn-toast.show { opacity: 1; transform: translateY(0); }

@media (max-width: 480px) { .mn-dr { width: 100vw; max-width: 100vw; } }

.mn-digest {
  position: fixed; top: 16px; right: 16px; width: 330px; max-width: calc(100vw - 32px);
  background: #FFFFFF; border: 3px solid #1A1A2E; border-radius: 14px;
  padding: 16px; z-index: 99999; box-shadow: 5px 5px 0px #1A1A2E;
  animation: mnSlideIn .32s cubic-bezier(.4,0,.2,1);
}
@keyframes mnSlideIn { from{opacity:0;transform:translateY(-12px)} to{opacity:1;transform:translateY(0)} }
.mn-digest-ttl { font-size: 14px; font-weight: 700; color: #1A1A2E; display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
.mn-digest-ttl svg { width: 18px; height: 18px; flex-shrink: 0; stroke: var(--mn-pink); stroke-width: 2.5; }
.mn-digest-body { font-size: 12px; color: var(--mn-fg-muted); font-weight: 400; line-height: 1.6; margin-bottom: 12px; }
.mn-digest-body strong { color: #1A1A2E; font-weight: 700; }
.mn-digest-acts { display: flex; gap: 8px; }
.mn-digest-btn { flex: 1; padding: 8px 10px; border-radius: 8px; border: 2px solid #1A1A2E; font-size: 12px; font-weight: 700; cursor: pointer; outline: none; font-family: 'Space Grotesk', sans-serif; transition: all var(--mn-transition); box-shadow: 2px 2px 0px #1A1A2E; text-transform: uppercase; }
.mn-digest-review { background: #EDE9FE; color: #5B21B6; }
.mn-digest-review:hover { background: #DDD6FE; transform: translate(-1px, -1px); box-shadow: 3px 3px 0px #1A1A2E; }
.mn-digest-dismiss { background: #F3F4F6; color: var(--mn-fg-muted); }
.mn-digest-dismiss:hover { background: #E5E7EB; }

/* ── Rules ── */
.mn-rules-toggle {
  width: 100%; padding: 8px 14px; border-radius: 10px !important;
  border: 2px solid #1A1A2E !important; background: var(--mn-blue) !important;
  color: #1A1A2E !important; font-size: 12px; font-weight: 700;
  cursor: pointer; transition: all 0.15s ease !important;
  display: flex; align-items: center; justify-content: space-between;
  outline: none; font-family: 'Space Grotesk', sans-serif !important; margin-top: 8px;
  box-shadow: 2px 2px 0px #1A1A2E; text-transform: uppercase; letter-spacing: 0.3px;
}
.mn-rules-toggle:hover { transform: translate(-1px, -1px); box-shadow: 3px 3px 0px #1A1A2E; background: #C2F0F8 !important; }
.mn-rules-toggle .mn-arrow { transition: transform .2s; font-size: 11px; }
.mn-rules-toggle.open .mn-arrow { transform: rotate(180deg); }
.mn-rules-panel { margin-top: 8px; border: 2px solid #1A1A2E; border-radius: 10px; background: #FFFFFF; overflow: hidden; display: none; box-shadow: 2px 2px 0px #1A1A2E; }
.mn-rules-panel.open { display: block; }
.mn-rules-inp-row { display: flex; gap: 6px; padding: 10px; border-bottom: 2px solid #E5E7EB; }
.mn-rules-inp { flex: 1; padding: 6px 10px; border-radius: 8px; border: 2px solid #D1D5DB; background: #FFFFFF; color: #1A1A2E; font-size: 12px; font-weight: 500; outline: none; font-family: 'Space Grotesk', sans-serif; }
.mn-rules-inp::placeholder { color: #9CA3AF; }
.mn-rules-inp:focus { border-color: var(--mn-pink); background: #FFF5FA; }
.mn-rules-add { padding: 6px 12px; border-radius: 8px; border: 2px solid #065F46; background: #D1FAE5; color: #065F46; font-size: 12px; font-weight: 700; cursor: pointer; outline: none; font-family: 'Space Grotesk', sans-serif; white-space: nowrap; transition: all var(--mn-transition); box-shadow: 2px 2px 0px #065F46; text-transform: uppercase; }
.mn-rules-add:hover { background: #A7F3D0; transform: translate(-1px, -1px); box-shadow: 3px 3px 0px #065F46; }
.mn-rules-list { padding: 4px 0; max-height: 120px; overflow-y: auto; }
.mn-rules-list::-webkit-scrollbar { width: 6px; }
.mn-rules-list::-webkit-scrollbar-thumb { background: var(--mn-pink); border-radius: 3px; }
.mn-rule-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; font-size: 11px; border-bottom: 1px solid #E5E7EB; }
.mn-rule-row:last-child { border-bottom: none; }
.mn-rule-kw { color: #1A1A2E; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.mn-rule-del { width: 22px; height: 22px; border-radius: 6px; border: 2px solid #991B1B; background: #FEE2E2; color: #991B1B; cursor: pointer; font-size: 14px; line-height: 1; font-weight: 700; transition: all var(--mn-transition); outline: none; flex-shrink: 0; margin-left: 6px; display: flex; align-items: center; justify-content: center; }
.mn-rule-del:hover { background: #FECACA; }
.mn-rules-empty { padding: 10px; font-size: 11px; color: var(--mn-fg-muted); text-align: center; font-weight: 400; }

.mn-card[draggable="true"] { cursor: grab; }
.mn-card[draggable="true"]:active { cursor: grabbing; }
.mn-card.mn-card-dragging { opacity: 0.4; border-style: dashed; }
.mn-fab.mn-fab-dragover { transform: scale(1.1) !important; background: #D1FAE5 !important; box-shadow: 0 0 0 3px #065F46 !important; }

.mn-trash-zone { margin-top: 8px; padding: 10px; border: 2px dashed #991B1B; border-radius: 10px; background: #FEE2E2; color: #991B1B; font-size: 12px; font-weight: 700; text-align: center; display: none; align-items: center; justify-content: center; gap: 6px; transition: all var(--mn-transition); text-transform: uppercase; }
.mn-trash-zone.open { display: flex; animation: mnUp .2s ease-out; }
.mn-trash-zone.mn-trash-active { background: #FECACA; border-color: #DC2626; color: #DC2626; }
.mn-trash-zone svg { width: 16px; height: 16px; stroke-width: 2.5; }

.mn-edit-area { margin-top: 8px; }
.mn-edit-box { width: 100%; min-height: 60px; padding: 8px; border-radius: 10px; border: 2px solid #D1D5DB; background: #FFFFFF; color: #1A1A2E; font-size: 12px; font-weight: 400; font-family: 'DM Mono', monospace; outline: none; resize: vertical; }
.mn-edit-box:focus { border-color: var(--mn-pink); }
.mn-edit-acts { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }

.mn-hist-panel { margin-top: 10px; padding-top: 8px; border-top: 2px dashed #D1D5DB; }
.mn-hist-item { padding: 6px 8px; border-radius: 8px; background: var(--mn-bg-card); border: 2px solid #E5E7EB; margin-bottom: 6px; font-size: 11px; line-height: 1.5; color: #1A1A2E; }
.mn-hist-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; color: var(--mn-fg-muted); font-size: 10px; font-weight: 600; }
.mn-diff-body { font-size: 11px; word-break: break-word; font-weight: 400; }
del.mn-diff-del { color: #991B1B; text-decoration: line-through; background: #FEE2E2; padding: 0 3px; border-radius: 3px; }
ins.mn-diff-ins { color: #065F46; text-decoration: none; background: #D1FAE5; padding: 0 3px; border-radius: 3px; }

.mn-prov-panel { margin-top: 10px; padding: 10px; border-radius: 10px; background: var(--mn-bg-card); border: 2px solid #E5E7EB; font-size: 11px; line-height: 1.6; color: #1A1A2E; font-weight: 400; }
.mn-prov-ttl { font-weight: 700; color: #1A1A2E; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; }
.mn-prov-row { display: flex; justify-content: space-between; margin-bottom: 4px; border-bottom: 1px solid #E5E7EB; padding-bottom: 3px; }
.mn-prov-lbl { color: var(--mn-fg-muted); font-weight: 600; }
.mn-prov-val { color: #1A1A2E; word-break: break-all; font-weight: 600; }

.mn-sens-badge { display: inline-block; padding: 2px 6px; border-radius: 6px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; margin-left: 6px; vertical-align: middle; border: 2px solid currentColor; }
.mn-sens-low { background: #D1FAE5; color: #065F46; }
.mn-sens-medium { background: #FEF3C7; color: #92400E; }
.mn-sens-high { background: #FEE2E2; color: #991B1B; }

.mn-rules-warn { padding: 6px 10px; font-size: 11px; color: #92400E; font-weight: 600; background: #FEF3C7; border-radius: 8px; margin: 6px 10px; border: 2px solid #92400E; }

.mn-snaps-toggle {
  width: 100%; padding: 8px 14px; border-radius: 10px !important;
  border: 2px solid #1A1A2E !important; background: var(--mn-blue) !important;
  color: #1A1A2E !important; font-size: 12px; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between;
  outline: none; font-family: 'Space Grotesk', sans-serif !important; margin-top: 6px;
  transition: all 0.15s ease !important; box-shadow: 2px 2px 0px #1A1A2E;
  text-transform: uppercase; letter-spacing: 0.3px;
}
.mn-snaps-toggle:hover { transform: translate(-1px, -1px); box-shadow: 3px 3px 0px #1A1A2E; background: #C2F0F8 !important; }
.mn-snaps-toggle .mn-arrow { transition: transform .2s; font-size: 11px; }
.mn-snaps-toggle.open .mn-arrow { transform: rotate(180deg); }
.mn-snaps-panel { margin-top: 6px; border: 2px solid #1A1A2E; border-radius: 10px; background: #FFFFFF; overflow: hidden; display: none; box-shadow: 2px 2px 0px #1A1A2E; }
.mn-snaps-panel.open { display: block; }
.mn-snaps-inp-row { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 2px solid #E5E7EB; }
.mn-snaps-list { max-height: 110px; overflow-y: auto; padding: 4px 0; }
.mn-snap-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; font-size: 11px; border-bottom: 1px solid #E5E7EB; font-weight: 600; color: #1A1A2E; }

.mn-dag-hdr { font-size: 11px; font-weight: 700; color: var(--mn-fg-muted); padding: 6px 10px 4px 10px; text-transform: uppercase; letter-spacing: .5px; }
.mn-dag-canvas { padding: 8px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.mn-dag-node { width: 100%; border: 2px solid #1A1A2E; border-radius: 10px; background: #FFFFFF; padding: 8px; font-size: 11px; transition: all var(--mn-transition); box-shadow: 2px 2px 0px #1A1A2E; }
.mn-dag-node.active { background: #EDE9FE; border-color: #7C3AED; }
.mn-dag-node-hdr { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.mn-dag-title { display: flex; align-items: center; gap: 6px; color: #1A1A2E; font-weight: 700; }
.mn-dag-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mn-pink); border: 2px solid #1A1A2E; }
.mn-dag-delta { color: var(--mn-fg-muted); font-size: 10px; font-weight: 700; }
.mn-dag-acts { display: flex; gap: 4px; }
.mn-dag-meta { font-size: 9px; color: var(--mn-fg-muted); margin-top: 4px; font-weight: 400; font-family: 'DM Mono', monospace; }
.mn-dag-connector { font-size: 10px; color: var(--mn-fg-muted); text-align: center; line-height: 1; font-weight: 700; }
.mn-dag-diff-box { margin-top: 8px; padding: 6px; border-radius: 8px; background: var(--mn-bg-card); border: 2px solid #E5E7EB; }

.mn-decay-wrap { margin-top: 6px; display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--mn-fg-muted); font-weight: 600; }
.mn-decay-bar-outer { flex: 1; height: 6px; border-radius: 3px; background: #E5E7EB; overflow: hidden; border: 1px solid #D1D5DB; }
.mn-decay-bar-inner { height: 100%; border-radius: 3px; transition: width .3s ease; background: var(--mn-pink); }
.mn-decay-select { background: #FFFFFF; border: 2px solid #1A1A2E; color: #1A1A2E; font-size: 10px; font-weight: 600; border-radius: 6px; padding: 2px 6px; outline: none; font-family: 'Space Grotesk', sans-serif; }
.mn-thermo-badge { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 6px; background: #FEF3C7; border: 2px solid #92400E; color: #92400E; white-space: nowrap; }

.mn-grav-wrap { margin-bottom: 12px; padding: 10px; border-radius: 14px; background: #FFFFFF; border: 2px solid #1A1A2E; text-align: center; box-shadow: 2px 2px 0px #1A1A2E; }
.mn-grav-hdr-title { font-size: 12px; font-weight: 700; color: #1A1A2E; margin-bottom: 6px; }
.mn-grav-svg { overflow: visible; display: block; margin: 0 auto; }
.mn-grav-legend { font-size: 10px; margin-top: 6px; display: flex; gap: 10px; justify-content: center; font-weight: 600; color: var(--mn-fg-muted); }

.mn-filter-bar { display: flex; gap: 6px; margin-bottom: 12px; overflow-x: auto; padding-bottom: 4px; }
.mn-filter-pill { padding: 4px 10px; border-radius: 8px; border: 2px solid #1A1A2E; background: #FFFFFF; color: #1A1A2E; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all var(--mn-transition); box-shadow: 2px 2px 0px #1A1A2E; }
.mn-filter-pill.active { background: var(--mn-pink); color: #FFFFFF; }
.mn-time-hdr { font-size: 11px; font-weight: 700; color: var(--mn-fg-muted); margin: 12px 0 6px 0; text-transform: uppercase; letter-spacing: .5px; }

.mn-sim-panel { margin-top: 10px; padding: 10px; border-radius: 10px; background: #FFFFFF; border: 2px solid #1A1A2E; font-size: 11px; box-shadow: 2px 2px 0px #1A1A2E; }
.mn-sim-title { font-weight: 700; color: #1A1A2E; margin-bottom: 6px; }
.mn-sim-row { margin-bottom: 6px; }
.mn-sim-lbl { color: var(--mn-fg-muted); font-weight: 600; display: block; margin-bottom: 2px; }
.mn-sim-box { padding: 6px; border-radius: 8px; background: var(--mn-bg-card); border: 2px solid #E5E7EB; color: #1A1A2E; font-weight: 400; }
.mn-sim-meta { font-size: 10px; color: var(--mn-fg-muted); margin-top: 4px; font-weight: 500; font-style: italic; }

.mn-emotional-card {
  margin: 10px 18px; padding: 10px 12px; border-radius: 12px;
  background: var(--mn-blue); border: 2px solid #1A1A2E;
  color: #1A1A2E; font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  box-shadow: 2px 2px 0px #1A1A2E;
}

/* ── Categories ── */
.mn-category-list-container { display: flex; flex-direction: column; gap: 8px; padding: 6px 0 16px 0; }

.mn-category-list-item {
  border-radius: 12px; border: 2px solid #1A1A2E !important;
  background: #FFFFFF !important; overflow: hidden;
  transition: all 0.15s ease; box-shadow: 3px 3px 0px #1A1A2E !important;
}
.mn-category-list-item:hover { border-color: var(--mn-pink) !important; transform: translate(-1px, -1px); box-shadow: 4px 4px 0px var(--mn-pink) !important; }
.mn-category-list-item.open { border-color: var(--mn-pink) !important; background: #FFF5FA !important; box-shadow: 4px 4px 0px var(--mn-pink) !important; }

.mn-cat-row-hdr { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; cursor: pointer; user-select: none; }
.mn-cat-row-title { font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 700; color: #1A1A2E !important; letter-spacing: -0.2px; text-transform: uppercase; }
.mn-cat-row-count { font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 8px; background: var(--mn-pink) !important; color: #FFFFFF !important; border: 2px solid #1A1A2E !important; box-shadow: 1px 1px 0px #1A1A2E; }
.mn-cat-row-cards { display: flex !important; flex-direction: column !important; gap: 12px !important; padding: 12px 14px 14px 14px !important; border-top: 2px dashed #E5E7EB !important; animation: mnSlideIn 0.2s ease-out !important; }

.mn-sq-icon { font-size: 36px; margin-bottom: 8px; line-height: 1; }
.mn-sq-title { font-size: 14px; font-weight: 700; color: #1A1A2E; margin-bottom: 4px; }
.mn-sq-count { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 8px; background: var(--mn-pink); color: #FFFFFF; border: 2px solid #1A1A2E; }

.mn-sq-back-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 10px; border: 2px solid #1A1A2E;
  background: var(--mn-blue); color: #1A1A2E; font-size: 12px; font-weight: 700;
  cursor: pointer; transition: all .15s ease; margin-bottom: 12px;
  box-shadow: 2px 2px 0px #1A1A2E; text-transform: uppercase;
}
.mn-sq-back-btn:hover { background: #C2F0F8; transform: translate(-1px, -1px); box-shadow: 3px 3px 0px #1A1A2E; }

.mn-scrapbook-container { display: flex; flex-direction: column; gap: 16px; padding: 4px 0 20px 0; }

.mn-bucket-card { border-radius: 14px; border: 3px solid #1A1A2E; background: #FFFFFF; padding: 16px; transition: all 0.2s ease; position: relative; box-shadow: 4px 4px 0px #1A1A2E; }
.mn-bucket-card.mn-bucket-coding { border-color: #0891B2; background: #ECFEFF; box-shadow: 4px 4px 0px #0891B2; }
.mn-bucket-card.mn-bucket-coding:hover { transform: translate(-2px, -2px); box-shadow: 6px 6px 0px #0891B2; }
.mn-bucket-card.mn-bucket-personal { border-color: #DB2777; background: #FDF2F8; box-shadow: 4px 4px 0px #DB2777; }
.mn-bucket-card.mn-bucket-personal:hover { transform: translate(-2px, -2px); box-shadow: 6px 6px 0px #DB2777; }
.mn-bucket-card.mn-bucket-research { border-color: #D97706; background: #FFFBEB; box-shadow: 4px 4px 0px #D97706; }
.mn-bucket-card.mn-bucket-research:hover { transform: translate(-2px, -2px); box-shadow: 6px 6px 0px #D97706; }
.mn-bucket-card.mn-bucket-general { border-color: #4F46E5; background: #EEF2FF; box-shadow: 4px 4px 0px #4F46E5; }
.mn-bucket-card.mn-bucket-general:hover { transform: translate(-2px, -2px); box-shadow: 6px 6px 0px #4F46E5; }

.mn-bucket-hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 2px solid #1A1A2E; }
.mn-bucket-title { font-size: 14px; font-weight: 700; color: #1A1A2E; display: flex; align-items: center; gap: 8px; text-transform: uppercase; }
.mn-bucket-count-badge { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 8px; background: var(--mn-pink); color: #FFFFFF; border: 2px solid #1A1A2E; }

.mn-scrapbook-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; align-items: start; }

.mn-scrapbook-card {
  position: relative; border-radius: 12px; border: 2px solid #1A1A2E !important;
  background: #FFFFFF !important; padding: 14px 16px !important;
  transition: all 0.15s ease; display: flex; flex-direction: column;
  justify-content: space-between; height: auto !important; min-height: auto !important;
  box-sizing: border-box; overflow: visible !important; cursor: pointer;
  color: #1A1A2E !important; box-shadow: 3px 3px 0px #1A1A2E !important;
}
.mn-scrapbook-card.open { height: auto !important; min-height: auto !important; }
.mn-scrapbook-card:hover { transform: translate(-2px, -2px); border-color: var(--mn-pink) !important; background: #FFFFFF !important; box-shadow: 4px 4px 0px #1A1A2E !important; z-index: 2; }

.mn-scrapbook-card.mn-cat-coding { font-family: 'Space Grotesk', -apple-system, sans-serif !important; border-color: #1A1A2E !important; box-shadow: 3px 3px 0px #1A1A2E !important; background: #FFFFFF !important; }
.mn-scrapbook-card.mn-cat-coding:hover { box-shadow: 4px 4px 0px #1A1A2E !important; background: #FFFFFF !important; }
.mn-scrapbook-card.mn-cat-personal { border-radius: 12px; border-color: #1A1A2E !important; background: #FFFFFF !important; box-shadow: 3px 3px 0px #1A1A2E !important; }
.mn-scrapbook-card.mn-cat-personal:hover { box-shadow: 4px 4px 0px #1A1A2E !important; }
.mn-scrapbook-card.mn-cat-research { border-color: #1A1A2E !important; background: #FFFFFF !important; box-shadow: 3px 3px 0px #1A1A2E !important; }
.mn-scrapbook-card.mn-cat-research:hover { box-shadow: 4px 4px 0px #1A1A2E !important; }
.mn-scrapbook-card.mn-cat-general { border-color: #1A1A2E !important; background: #FFFFFF !important; box-shadow: 3px 3px 0px #1A1A2E !important; }
.mn-scrapbook-card.mn-cat-general:hover { box-shadow: 4px 4px 0px #1A1A2E !important; }

.mn-card-hdr-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.mn-card-cb-wrap { display: flex; align-items: center; gap: 6px; }
.mn-card-select-cb { width: 15px; height: 15px; accent-color: var(--mn-pink); cursor: pointer; }

.mn-cat-badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.4px; border: 2px solid currentColor; }
.mn-cat-badge-work { background: #DBEAFE; color: #1E40AF; }
.mn-cat-badge-coding { background: #ECFEFF; color: #0E7490; }
.mn-cat-badge-personal { background: #FDF2F8; color: #BE185D; }
.mn-cat-badge-health { background: #D1FAE5; color: #065F46; }
.mn-cat-badge-relationships { background: #FFF1F2; color: #BE123C; }
.mn-cat-badge-research { background: #FFFBEB; color: #92400E; }
.mn-cat-badge-general { background: #EEF2FF; color: #4338CA; }

.mn-copy-snippet-btn { padding: 3px 8px; border-radius: 6px; font-size: 10px; font-weight: 700; background: #ECFEFF; color: #0E7490; border: 2px solid #0E7490; cursor: pointer; transition: all .15s ease; box-shadow: 1px 1px 0px #0E7490; }
.mn-copy-snippet-btn:hover { background: #CFFAFE; transform: translate(-1px, -1px); box-shadow: 2px 2px 0px #0E7490; }

.mn-citation-tag { font-size: 10px; font-weight: 700; color: #92400E; background: #FEF3C7; padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px; word-break: break-all; border: 1px solid #D97706; }
.mn-card-snippet-text { font-family: 'Space Grotesk', -apple-system, sans-serif !important; font-size: 13px !important; line-height: 1.55 !important; color: #1F2937 !important; word-break: break-word !important; margin: 10px 0 !important; white-space: pre-wrap !important; }

.mn-synthesize-bar {
  position: sticky; bottom: 0; left: 0; right: 0;
  margin-top: 14px; padding: 10px 14px; border-radius: 12px;
  background: #FFFFFF; border: 3px solid #1A1A2E;
  box-shadow: 4px 4px 0px #1A1A2E;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  z-index: 10; animation: mnUp 0.25s ease-out;
}
.mn-synth-btn {
  padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 700;
  cursor: pointer; border: 2px solid #1A1A2E;
  background: var(--mn-pink); color: #FFFFFF;
  box-shadow: 2px 2px 0px #1A1A2E; transition: all .15s ease; text-transform: uppercase;
}
.mn-synth-btn:hover { transform: translate(-1px, -1px); box-shadow: 3px 3px 0px #1A1A2E; background: #FF69B4; }

/* ── Side Rail Options Panel ── */
.mn-side-rail {
  position: fixed !important;
  top: 40% !important;
  right: 0 !important;
  transform: translateY(-50%) !important;
  z-index: 2147483646 !important;
  pointer-events: auto !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  background: #FFFFFF !important;
  border: 3px solid #1A1A2E !important;
  border-right: none !important;
  border-radius: 14px 0 0 14px !important;
  padding: 8px 6px !important;
  box-shadow: -4px 4px 0px #1A1A2E !important;
  transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s ease, right 0.28s cubic-bezier(.32,.72,0,1) !important;
  width: 52px !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
}

.mn-side-rail.panel-open {
  right: 440px !important;
}

.mn-side-rail:hover {
  width: 210px !important;
  background: #FFFDF0 !important;
}

.mn-rail-item {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  padding: 8px 10px !important;
  border-radius: 8px !important;
  background: transparent !important;
  border: 2px solid transparent !important;
  cursor: pointer !important;
  transition: all 0.15s ease !important;
  white-space: nowrap !important;
  color: #1A1A2E !important;
  font-family: 'Space Grotesk', sans-serif !important;
  font-size: 12px !important;
  font-weight: 700 !important;
  user-select: none !important;
  outline: none !important;
  text-transform: uppercase !important;
  letter-spacing: 0.3px !important;
}

.mn-rail-item:hover {
  background: var(--mn-pink) !important;
  border-color: #1A1A2E !important;
  box-shadow: 2px 2px 0px #1A1A2E !important;
  transform: translate(-1px, -1px) !important;
}

.mn-rail-item.active {
  background: var(--mn-yellow) !important;
  border-color: #1A1A2E !important;
  box-shadow: 2px 2px 0px #1A1A2E !important;
}

.mn-rail-icon {
  font-size: 18px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  flex-shrink: 0 !important;
  width: 22px !important;
  height: 22px !important;
}

.mn-rail-label {
  display: inline-block !important;
  opacity: 0 !important;
  max-width: 0 !important;
  overflow: hidden !important;
  white-space: nowrap !important;
  vertical-align: middle !important;
  transition: opacity 0.2s ease, max-width 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

.mn-side-rail:hover .mn-rail-label,
.mn-rail-item:hover .mn-rail-label {
  opacity: 1 !important;
  max-width: 170px !important;
}

/* ── PenEcho Spatial Canvas & Multi-Stream UI ── */
.mn-nav-tabs {
  position: relative; z-index: 3;
  display: flex; padding: 0 16px;
  background: #FFFFFF !important;
  border-bottom: 2px solid #1A1A2E;
  gap: 6px; flex-shrink: 0;
}
.mn-nav-tab {
  flex: 1; padding: 10px 12px; font-size: 12px; font-weight: 700;
  color: #64748B; background: transparent; border: none;
  border-bottom: 2px solid transparent; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  transition: all var(--mn-transition); outline: none;
  font-family: 'Space Grotesk', sans-serif;
}
.mn-nav-tab:hover { color: #1A1A2E; background: rgba(0,0,0,0.03); }
.mn-nav-tab.active {
  color: #1A1A2E !important; border-bottom: 2px solid #1A1A2E !important; font-weight: 700;
}
.mn-nav-tab-badge {
  font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 10px;
  background: var(--mn-blue); color: #1A1A2E; border: 1px solid #1A1A2E;
}

.mn-spatial-view {
  display: flex; flex-direction: column; height: 100%; flex: 1;
  overflow-y: auto; padding: 14px 16px; gap: 14px;
}
.mn-spatial-view::-webkit-scrollbar { width: 6px; }
.mn-spatial-view::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 3px; }

.mn-spatial-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-radius: var(--mn-radius-sm);
  background: #FFFFFF; border: 2px solid #1A1A2E;
  box-shadow: 2px 2px 0px #1A1A2E;
  flex-wrap: wrap; gap: 8px;
}
.mn-spatial-status {
  display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: #1A1A2E;
}
.mn-spatial-pulse-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #22C55E;
  box-shadow: 0 0 8px #22C55E; animation: mnPulse 2s infinite;
}
.mn-spatial-pulse-dot.drafting {
  background: #EAB308; box-shadow: 0 0 8px #EAB308;
}

.mn-spatial-actions {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.mn-spatial-btn {
  padding: 5px 10px; border-radius: var(--mn-radius-xs); border: 2px solid #1A1A2E;
  background: #FFFFFF; color: #1A1A2E; font-size: 11px;
  font-weight: 700; cursor: pointer; transition: all var(--mn-transition); outline: none;
  font-family: inherit; display: inline-flex; align-items: center; gap: 4px;
  box-shadow: 2px 2px 0px #1A1A2E;
}
.mn-spatial-btn:hover { background: #F0F8FF; color: #1A1A2E; transform: translate(-1px, -1px); box-shadow: 3px 3px 0px #1A1A2E; }
.mn-spatial-btn-primary {
  background: var(--mn-blue) !important;
  color: #1A1A2E !important; border-color: #1A1A2E !important;
}
.mn-spatial-btn-primary:hover {
  background: #C2F0F8 !important;
  color: #1A1A2E !important;
}
.mn-spatial-btn-danger {
  background: #FEE2E2 !important; color: #991B1B !important; border-color: #991B1B !important;
}
.mn-spatial-btn-danger:hover { background: #FECACA !important; color: #7F1D1D !important; }

/* ── Draft Layer Banner ── */
.mn-draft-banner {
  padding: 12px 14px; border-radius: var(--mn-radius-sm);
  background: #FFFBEB;
  border: 2px dashed #D97706;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  box-shadow: 2px 2px 0px #D97706; animation: mnUp 0.2s ease-out;
}
.mn-draft-info { display: flex; flex-direction: column; gap: 2px; }
.mn-draft-title { font-size: 12px; font-weight: 700; color: #92400E; display: flex; align-items: center; gap: 6px; }
.mn-draft-subtitle { font-size: 11px; color: #78350F; }
.mn-draft-acts { display: flex; align-items: center; gap: 6px; }

/* ── Stream 1: Running Timeline ── */
.mn-stream-card {
  border-radius: var(--mn-radius);
  border: 2px solid #1A1A2E;
  background: #FFFFFF;
  padding: 14px;
  box-shadow: 3px 3px 0px #1A1A2E;
}
.mn-stream-hdr {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid #E5E7EB;
}
.mn-stream-title {
  font-size: 13px; font-weight: 700; color: #1A1A2E; display: flex; align-items: center; gap: 8px;
}
.mn-timeline-steps {
  display: flex; flex-direction: column; gap: 10px; position: relative;
}
.mn-timeline-step-item {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 10px 12px; border-radius: var(--mn-radius-sm);
  background: var(--mn-bg-card); border: 2px solid #E5E7EB;
  transition: all var(--mn-transition);
}
.mn-timeline-step-item:hover {
  background: #FFFFFF; border-color: var(--mn-pink); box-shadow: 2px 2px 0px #1A1A2E;
}
.mn-timeline-step-num {
  width: 24px; height: 24px; border-radius: 50%;
  background: #E0F2FE; border: 2px solid #0284C7;
  color: #0369A1; font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.mn-timeline-step-content { flex: 1; min-width: 0; }
.mn-timeline-step-top {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;
}
.mn-timeline-step-ttl { font-size: 12px; font-weight: 700; color: #1A1A2E; }
.mn-timeline-status-pill {
  font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; text-transform: uppercase;
}
.mn-timeline-status-completed { background: #D1FAE5; color: #065F46; border: 1px solid #059669; }
.mn-timeline-status-in_progress { background: #DBEAFE; color: #1D4ED8; border: 1px solid #2563EB; animation: mnPulse 2s infinite; }
.mn-timeline-status-planned { background: #F1F5F9; color: #475569; border: 1px solid #94A3B8; }
.mn-timeline-step-sum { font-size: 11px; color: #4B5563; line-height: 1.4; }

/* ── Stream 2: Dynamic Force-Directed Mind Map ── */
.mn-mindmap-wrap {
  position: relative; width: 100%; height: 320px;
  background: #F8FAFC;
  background-image: radial-gradient(rgba(148, 163, 184, 0.25) 1px, transparent 1px);
  background-size: 16px 16px;
  border-radius: var(--mn-radius-sm);
  border: 2px solid #1A1A2E; overflow: hidden;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.05);
}
.mn-mindmap-svg {
  width: 100%; height: 100%; cursor: grab;
}
.mn-mindmap-svg:active { cursor: grabbing; }

.mn-mindmap-legend {
  display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; font-size: 10px; font-weight: 700;
}
.mn-legend-tag {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
  border-radius: 6px; background: #FFFFFF; border: 1.5px solid #CBD5E1;
  color: #334155; box-shadow: 1px 1px 0px rgba(0,0,0,0.05);
}
.mn-legend-dot { width: 8px; height: 8px; border-radius: 50%; }

.mn-node-inspector {
  margin-top: 10px; padding: 10px 12px; border-radius: var(--mn-radius-sm);
  background: #FFFFFF; border: 2px solid #1A1A2E; box-shadow: 3px 3px 0px #1A1A2E;
  animation: mnUp 0.18s ease-out;
}
.mn-inspector-hdr {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;
}
.mn-inspector-label { font-size: 13px; font-weight: 700; color: #1A1A2E; display: flex; align-items: center; gap: 6px; }
.mn-inspector-desc { font-size: 11px; color: #4B5563; line-height: 1.45; margin-bottom: 8px; }
.mn-inspector-acts { display: flex; gap: 6px; }

/* ── Stream 3: 2D Vector & LaTeX Formula Canvas ── */
.mn-canvas-elements-grid {
  display: flex; flex-direction: column; gap: 10px;
}
.mn-formula-card {
  padding: 12px 14px; border-radius: var(--mn-radius-sm);
  background: #F0F9FF;
  border: 2px solid #0284C7;
  box-shadow: 2px 2px 0px #0284C7;
}
.mn-formula-caption {
  font-size: 11px; font-weight: 700; color: #0369A1; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.4px;
}
.mn-formula-math {
  font-family: 'Cambria Math', 'Latin Modern Math', 'STIX Two Math', 'Times New Roman', serif;
  font-size: 16px; font-style: italic; color: #0F172A; padding: 8px 12px;
  background: #FFFFFF; border-radius: 6px; border: 1.5px solid #BAE6FD;
  display: flex; align-items: center; justify-content: center; overflow-x: auto;
}

.mn-vector-boxes-row {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px;
}
.mn-vector-box-item {
  padding: 10px 12px; border-radius: var(--mn-radius-xs);
  background: #FFFFFF; border: 2px solid #1A1A2E;
  box-shadow: 2px 2px 0px #1A1A2E;
}
.mn-vector-box-ttl { font-size: 12px; font-weight: 700; margin-bottom: 4px; }
.mn-vector-arrow-card {
  padding: 8px 12px; border-radius: var(--mn-radius-xs);
  background: #ECFDF5; border: 2px solid #059669;
  font-size: 11px; font-weight: 600; color: #065F46; display: flex; align-items: center; gap: 6px;
}

/* ── Chat Stream Interceptor Badge ── */
.mn-penecho-chat-pill {
  margin: 10px 0 !important; padding: 10px 14px !important;
  border-radius: 12px !important;
  background: #FFFFFF !important;
  border: 2px solid #1A1A2E !important;
  box-shadow: 3px 3px 0px #1A1A2E !important;
  display: flex !important; align-items: center !important; justify-content: space-between !important;
  gap: 12px !important; font-family: 'Space Grotesk', 'Inter', sans-serif !important; color: #1A1A2E !important;
  animation: mnSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.mn-penecho-pill-left { display: flex !important; align-items: center !important; gap: 10px !important; }
.mn-penecho-pill-icon { font-size: 20px !important; line-height: 1 !important; }
.mn-penecho-pill-info { display: flex !important; flex-direction: column !important; gap: 2px !important; }
.mn-penecho-pill-info strong { font-size: 12px !important; font-weight: 700 !important; color: #0284C7 !important; }
.mn-penecho-pill-info span { font-size: 11px !important; color: #64748B !important; }
.mn-penecho-pill-btn {
  padding: 6px 12px !important; border-radius: 8px !important;
  background: var(--mn-blue) !important; border: 2px solid #1A1A2E !important;
  color: #1A1A2E !important; font-size: 11px !important; font-weight: 700 !important;
  cursor: pointer !important; transition: all 0.15s !important; outline: none !important;
  box-shadow: 2px 2px 0px #1A1A2E !important;
}
/* ── PenEcho Spatial Whiteboard & Canvas UI ── */
.mn-spatial-copilot-card {
  border: 3px solid #1A1A2E !important;
  border-radius: 14px !important;
  padding: 16px !important;
  background: #FFFFFF !important;
  box-shadow: 4px 4px 0px #1A1A2E !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 12px !important;
  position: relative !important;
  overflow: hidden !important;
}
.mn-spatial-hdr-row {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 10px !important;
}
.mn-spatial-title {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  font-size: 15px !important;
  font-weight: 700 !important;
  color: #1A1A2E !important;
}
.mn-spatial-badge {
  display: inline-flex !important;
  align-items: center !important;
  gap: 5px !important;
  padding: 3px 8px !important;
  border-radius: 8px !important;
  border: 2px solid #1A1A2E !important;
  font-size: 10.5px !important;
  font-weight: 700 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.4px !important;
  box-shadow: 2px 2px 0px #1A1A2E !important;
}
.mn-spatial-badge.active {
  background: #D1FAE5 !important;
  color: #065F46 !important;
}
.mn-spatial-badge.inactive {
  background: #F3F4F6 !important;
  color: #6B7280 !important;
}
.mn-spatial-desc {
  font-size: 12px !important;
  color: #4B5563 !important;
  line-height: 1.5 !important;
}
.mn-spatial-toggle-bar {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  padding: 10px 12px !important;
  background: #F0F9FF !important;
  border: 2px solid #1A1A2E !important;
  border-radius: 10px !important;
}
.mn-spatial-toggle-label {
  font-size: 12.5px !important;
  font-weight: 700 !important;
  color: #1A1A2E !important;
}
.mn-spatial-actions-row {
  display: flex !important;
  gap: 8px !important;
  flex-wrap: wrap !important;
}
.mn-prompt-spatial-draw {
  background: #E0F2FE !important;
  color: #0369A1 !important;
  border-color: #0369A1 !important;
}
.mn-prompt-spatial-draw:hover {
  background: #BAE6FD !important;
}
.mn-spatial-pulse-dot {
  width: 8px !important;
  height: 8px !important;
  border-radius: 50% !important;
  background: #22C55E !important;
  box-shadow: 0 0 8px #22C55E !important;
  display: inline-block !important;
}
.mn-spatial-subtab-btn {
  padding: 4px 10px !important;
  border: 2px solid #1A1A2E !important;
  border-radius: 8px !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  cursor: pointer !important;
  background: #FFFFFF !important;
  color: #1A1A2E !important;
  transition: all 0.15s !important;
}
.mn-spatial-subtab-btn.active {
  background: var(--mn-pink) !important;
  color: #FFFFFF !important;
  box-shadow: 2px 2px 0px #1A1A2E !important;
}
.mn-canvas-code-box {
  background: #1A1A2E !important;
  color: #E2E8F0 !important;
  border: 2px solid #1A1A2E !important;
  border-radius: 10px !important;
  padding: 12px !important;
  font-family: 'DM Mono', monospace !important;
  font-size: 11.5px !important;
  max-height: 480px !important;
  overflow-y: auto !important;
  white-space: pre-wrap !important;
  word-break: break-all !important;
}

/* ── Interactive Infinite Whiteboard Engine ── */
.mn-whiteboard-container {
  display: flex !important;
  flex-direction: column !important;
  gap: 8px !important;
  margin-top: 4px !important;
}
.mn-whiteboard-toolbar {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 6px !important;
  padding: 8px 10px !important;
  background: #FFFFFF !important;
  border: 2px solid #1A1A2E !important;
  border-radius: 12px !important;
  box-shadow: 2px 2px 0px #1A1A2E !important;
  flex-wrap: wrap !important;
}
.mn-wb-tool-group {
  display: flex !important;
  align-items: center !important;
  gap: 4px !important;
  flex-wrap: wrap !important;
}
.mn-wb-btn {
  padding: 5px 9px !important;
  border-radius: 8px !important;
  border: 1.5px solid #1A1A2E !important;
  background: #F8FAFC !important;
  color: #1A1A2E !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  cursor: pointer !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  transition: all 0.12s ease !important;
  outline: none !important;
}
.mn-wb-btn:hover {
  background: #E2E8F0 !important;
  transform: translate(-1px, -1px) !important;
  box-shadow: 1.5px 1.5px 0px #1A1A2E !important;
}
.mn-wb-btn.active {
  background: var(--mn-pink) !important;
  color: #FFFFFF !important;
  border-color: #1A1A2E !important;
  box-shadow: 2px 2px 0px #1A1A2E !important;
}
.mn-wb-color-picker {
  display: flex !important;
  align-items: center !important;
  gap: 3px !important;
  padding: 2px 6px !important;
  border: 1.5px solid #CBD5E1 !important;
  border-radius: 8px !important;
  background: #FFFFFF !important;
}
.mn-wb-color-dot {
  width: 14px !important;
  height: 14px !important;
  border-radius: 50% !important;
  cursor: pointer !important;
  border: 1.5px solid transparent !important;
  transition: transform 0.1s !important;
}
.mn-wb-color-dot:hover {
  transform: scale(1.25) !important;
}
.mn-wb-color-dot.active {
  border-color: #1A1A2E !important;
  box-shadow: 0 0 0 1.5px #FFFFFF, 0 0 0 3px #1A1A2E !important;
  transform: scale(1.2) !important;
}
.mn-whiteboard-viewport {
  position: relative !important;
  width: 100% !important;
  height: 480px !important;
  background-color: #FAFAFA !important;
  background-image: radial-gradient(#CBD5E1 1.2px, transparent 1.2px) !important;
  background-size: 20px 20px !important;
  border: 2px solid #1A1A2E !important;
  border-radius: 14px !important;
  box-shadow: 3px 3px 0px #1A1A2E !important;
  overflow: hidden !important;
  user-select: none !important;
  cursor: grab !important;
}
.mn-whiteboard-viewport.panning {
  cursor: grabbing !important;
}
.mn-whiteboard-viewport.drawing {
  cursor: crosshair !important;
}
.mn-whiteboard-surface {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 100% !important;
  height: 100% !important;
  transform-origin: 0 0 !important;
  pointer-events: auto !important;
}
.mn-whiteboard-svg {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 3200px !important;
  height: 3200px !important;
  pointer-events: auto !important;
}
.mn-sticky-note-card {
  position: absolute !important;
  width: 160px !important;
  min-height: 95px !important;
  border: 2px solid #1A1A2E !important;
  border-radius: 10px !important;
  padding: 8px 10px !important;
  box-shadow: 3px 3px 0px rgba(0,0,0,0.2) !important;
  cursor: move !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 4px !important;
  z-index: 10 !important;
  transition: box-shadow 0.15s !important;
  backdrop-filter: blur(4px) !important;
}
.mn-sticky-note-card:hover {
  box-shadow: 5px 5px 0px rgba(0,0,0,0.28) !important;
}
.mn-sticky-hdr {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  font-size: 10px !important;
  font-weight: 700 !important;
  opacity: 0.8 !important;
}
.mn-sticky-body {
  flex: 1 !important;
  font-size: 11.5px !important;
  line-height: 1.35 !important;
  color: #1A1A2E !important;
  font-family: 'Space Grotesk', -apple-system, sans-serif !important;
  outline: none !important;
  cursor: text !important;
  word-break: break-word !important;
  min-height: 48px !important;
}
.mn-floating-formula-card {
  position: absolute !important;
  border: 2px solid #0284C7 !important;
  border-radius: 10px !important;
  background: #F0F9FF !important;
  box-shadow: 3px 3px 0px #0284C7 !important;
  padding: 10px 12px !important;
  cursor: move !important;
  z-index: 9 !important;
  max-width: 240px !important;
}
.mn-wb-zoom-bar {
  position: absolute !important;
  bottom: 12px !important;
  right: 12px !important;
  display: flex !important;
  align-items: center !important;
  gap: 4px !important;
  padding: 4px 8px !important;
  background: rgba(255, 255, 255, 0.94) !important;
  backdrop-filter: blur(8px) !important;
  border: 2px solid #1A1A2E !important;
  border-radius: 10px !important;
  box-shadow: 2px 2px 0px #1A1A2E !important;
  z-index: 20 !important;
}
.mn-wb-badge-info {
  font-size: 10.5px !important;
  font-weight: 700 !important;
  color: #1A1A2E !important;
  padding: 0 4px !important;
}

    `;
  }


  /* ═══════════════════════════════════════
     SHADOW DOM + UI CREATION
     ═══════════════════════════════════════ */
  function init() {
    try {
      const existing = document.getElementById('memoneg-root');
      if (existing) existing.remove();

      const host = document.createElement('div');
      host.id = 'memoneg-root';
      host.style.cssText =
        'all:initial!important;position:fixed!important;top:0!important;left:0!important;' +
        'width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;';
      document.documentElement.appendChild(host);
      shadow = host.attachShadow({ mode: 'open' });

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
      toggleDrawer(true); // Persistent sidebar alongside chat

      // Text selection → "Save to Memory" button
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('selectionchange', () => {
        const s = window.getSelection();
        if (!s || s.isCollapsed) hideSelPopup();
      });

      // Auto-notice for assistant responses
      setupAutoNotice();

      console.log('[MemoNeg] Extension loaded on', location.hostname);
    } catch (err) {
      console.error('[MemoNeg Initialization Error]:', err);
    }
  }



  /* ═══════════════════════════
     FAB
     ═══════════════════════════ */
  const TAB_TITLES = {
    'global-memory': 'Global Memory',
    'current-session': 'Current Session',
    'canvas': '🎨 Spatial Canvas & Mind Map',
    'export': 'Export Vault',
    'settings': 'Settings',
  };

  function openTab(tabName) {
    if (tabName === 'export') {
      doExport();
      return;
    }
    toggleDrawer(true);
    if (!ui.dr) return;

    // Set panel header title to the opened option
    const titleEl = ui.dr.querySelector('.mn-drawer-title-text');
    if (titleEl && TAB_TITLES[tabName]) {
      titleEl.textContent = TAB_TITLES[tabName];
    }

    // Activate only the selected option panel
    ui.dr.querySelectorAll('.mn-pane').forEach((p) => {
      p.classList.toggle('active', p.dataset.pane === tabName);
    });

    if (tabName === 'canvas') {
      renderPenechoSpatialView();
    }

    if (ui.fab) {
      ui.fab.querySelectorAll('.mn-rail-item').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
      });
    }
    state.activeTab = tabName;
  }

  function buildFAB(root) {
    const rail = document.createElement('div');
    rail.className = 'mn-side-rail';
    rail.innerHTML =
      '<button class="mn-rail-item active" data-tab="global-memory" title="Global Memory">' +
      '<span class="mn-rail-icon">' + IC.railGlobal + '</span>' +
      '<span class="mn-rail-label">Global Memory</span>' +
      '</button>' +
      '<button class="mn-rail-item" data-tab="current-session" title="Current Session">' +
      '<span class="mn-rail-icon">' + IC.railSession + '</span>' +
      '<span class="mn-rail-label">Current Session</span>' +
      '<span class="mn-rail-badge" style="display:none"></span>' +
      '</button>' +
      '<button class="mn-rail-item" data-tab="canvas" title="Spatial Canvas">' +
      '<span class="mn-rail-icon">' + IC.railCanvas + '</span>' +
      '<span class="mn-rail-label">Spatial Canvas</span>' +
      '</button>' +
      '<button class="mn-rail-item" data-tab="export" title="Export">' +
      '<span class="mn-rail-icon">' + IC.railExport + '</span>' +
      '<span class="mn-rail-label">Export</span>' +
      '</button>' +
      '<button class="mn-rail-item" data-tab="settings" title="Settings">' +
      '<span class="mn-rail-icon">' + IC.railSettings + '</span>' +
      '<span class="mn-rail-label">Settings</span>' +
      '</button>';

    rail.querySelectorAll('.mn-rail-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tabName = btn.dataset.tab;
        if (tabName === 'export') {
          doExport();
          return;
        }
        openTab(tabName);
      });
    });

    root.appendChild(rail);
    ui.fab = rail;
    ui.badge = rail.querySelector('.mn-rail-badge');
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
    } catch (_) { }
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
        try { canvas.remove(); } catch (_) { }
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
          <span class="mn-drawer-title-text">Global Memory</span>
        </div>
        <div class="mn-hdr-r">
          <button class="mn-cls" title="Close drawer">${IC.close}</button>
        </div>
      </div>
      <div class="mn-body">
        <div class="mn-pane active" data-pane="global-memory"></div>
        <div class="mn-pane" data-pane="current-session"></div>
        <div class="mn-pane" data-pane="canvas" style="padding: 12px; overflow-y: auto;"></div>
        <div class="mn-pane" data-pane="export">
          <div class="mn-export-pane-wrap" style="padding: 16px;">
            <div style="font-size: 15px; font-weight: 700; color: #1A1A2E; margin-bottom: 8px;">📥 Export Memory Vault</div>
            <div style="font-size: 12.5px; color: #4B5563; margin-bottom: 16px; line-height: 1.5;">
              Download a complete JSON export of all your saved memories across all sessions.
            </div>
            <button class="mn-exp-btn-tab" style="width: 100%; padding: 12px; font-size: 13.5px; font-weight: 700; background: var(--mn-yellow); border: 3px solid #1A1A2E; border-radius: 10px; box-shadow: 3px 3px 0px #1A1A2E; cursor: pointer; text-transform: uppercase;">
              ${IC.download} Export All (JSON)
            </button>
          </div>
        </div>
        <div class="mn-pane" data-pane="settings">
          <div class="mn-settings-pane-wrap" style="padding: 16px; display: flex; flex-direction: column; gap: 16px;">
            <!-- Setting 1: Never-Save Rules -->
            <div style="border: 3px solid #1A1A2E; border-radius: 12px; padding: 14px; background: #FFFFFF; box-shadow: 3px 3px 0px #1A1A2E;">
              <div style="font-weight: 700; font-size: 14px; color: #1A1A2E; margin-bottom: 4px;">🛑 1. Never-Save Rules</div>
              <div style="font-size: 12px; color: #4B5563; margin-bottom: 10px;">Keywords or natural rules for topics Claude must never remember.</div>
              <div class="mn-rules-inp-row" style="display: flex; gap: 6px; margin-bottom: 10px;">
                <input class="mn-rules-inp" type="text" placeholder="e.g. Never remember salary details" maxlength="80" style="flex: 1; padding: 8px; border: 2px solid #1A1A2E; border-radius: 8px; font-size: 12px;" />
                <button class="mn-rules-add" style="padding: 8px 14px; border: 2px solid #1A1A2E; background: var(--mn-pink); border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 12px;">Add</button>
              </div>
              <div class="mn-rules-list"></div>
            </div>

            <!-- Setting 2: Memory Freeze & Snapshots -->
            <div style="border: 3px solid #1A1A2E; border-radius: 12px; padding: 14px; background: #FFFFFF; box-shadow: 3px 3px 0px #1A1A2E;">
              <div style="font-weight: 700; font-size: 14px; color: #1A1A2E; margin-bottom: 4px;">❄️ 2. Memory Freeze & Snapshots</div>
              <div style="font-size: 12px; color: #4B5563; margin-bottom: 10px;">Freeze current memory state or restore previous memory snapshots.</div>
              <div class="mn-snaps-inp-row" style="display: flex; gap: 6px; margin-bottom: 10px;">
                <input class="mn-rules-inp mn-snaps-inp" type="text" placeholder="Snapshot label" maxlength="40" style="flex: 1; padding: 8px; border: 2px solid #1A1A2E; border-radius: 8px; font-size: 12px;" />
                <button class="mn-rules-add mn-snaps-add" style="padding: 8px 14px; border: 2px solid #1A1A2E; background: var(--mn-blue); border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 12px;">Freeze</button>
              </div>
              <div class="mn-snaps-list"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="mn-foot">
        <div class="mn-trash-zone">${IC.close} Drag memory here to purge</div>
      </div>

      <!-- VIEW 2: PenEcho Spatial Canvas -->
      <div class="mn-spatial-view" style="display:${state.mainViewTab === 'spatial' ? 'flex' : 'none'};"></div>
    `;
    root.appendChild(dr);
    ui.dr = dr;
    ui.spatialView = dr.querySelector('[data-pane="canvas"]');

    // Tab switching handlers
    dr.querySelectorAll('.mn-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetPane = tab.dataset.tab;
        dr.querySelectorAll('.mn-tab').forEach((t) => t.classList.remove('active'));
        dr.querySelectorAll('.mn-pane').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        const pane = dr.querySelector('.mn-pane[data-pane="' + targetPane + '"]');
        if (pane) pane.classList.add('active');
        if (ui.fab) {
          ui.fab.querySelectorAll('.mn-rail-item').forEach((b) => {
            b.classList.toggle('active', b.dataset.tab === targetPane);
          });
        }
        state.activeTab = targetPane;
      });
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

    // Setup Section Drop Zones for Drag & Drop between Global Memory & Current Session
    const setupSectionDropZone = (secEl, targetScope) => {
      if (!secEl) return;
      secEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        secEl.classList.add('mn-drop-target-active');
      });
      secEl.addEventListener('dragleave', () => {
        secEl.classList.remove('mn-drop-target-active');
      });
      secEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        secEl.classList.remove('mn-drop-target-active');
        const jsonRaw = e.dataTransfer.getData('application/json');
        if (!jsonRaw) return;
        try {
          const payload = JSON.parse(jsonRaw);
          if (payload.id) {
            if (targetScope === 'local') {
              await updateKept(payload.id, { scope: 'local', source: location.hostname });
              showToast('📍 Moved memory to Current Session (' + location.hostname + ')');
            } else {
              await updateKept(payload.id, { scope: 'global', source: '' });
              showToast('🌐 Moved memory to Global Memory (Everywhere)');
            }
          }
        } catch (_) { }
      });
    };

    setupSectionDropZone(dr.querySelector('.mn-section-global'), 'global');
    setupSectionDropZone(dr.querySelector('.mn-section-local'), 'local');

    // Export
    const expBtn = dr.querySelector('.mn-exp-btn-tab');
    if (expBtn) expBtn.addEventListener('click', doExport);

    // Rules toggle (if element exists)
    const rulesToggle = dr.querySelector('.mn-rules-toggle');
    const rulesPanel = dr.querySelector('.mn-rules-panel');
    if (rulesToggle && rulesPanel) {
      rulesToggle.addEventListener('click', () => {
        state.rulesOpen = !state.rulesOpen;
        rulesToggle.classList.toggle('open', state.rulesOpen);
        rulesPanel.classList.toggle('open', state.rulesOpen);
      });
    }

    // Rules add — button click (#21)
    const inp = dr.querySelector('.mn-rules-inp');
    const rulesAddBtn = dr.querySelector('.mn-rules-add');
    if (rulesAddBtn && inp) {
      rulesAddBtn.addEventListener('click', () => {
        addRule(inp.value);
        inp.value = '';
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { addRule(inp.value); inp.value = ''; }
      });
    }

    // Snapshots toggle & add (#24)
    const snapsToggle = dr.querySelector('.mn-snaps-toggle');
    const snapsPanel = dr.querySelector('.mn-snaps-panel');
    if (snapsToggle && snapsPanel) {
      snapsToggle.addEventListener('click', () => {
        state.snapsOpen = !state.snapsOpen;
        snapsToggle.classList.toggle('open', state.snapsOpen);
        snapsPanel.classList.toggle('open', state.snapsOpen);
        if (state.snapsOpen) loadSnapshots();
      });
    }
    const snapInp = dr.querySelector('.mn-snaps-inp');
    const snapsAddBtn = dr.querySelector('.mn-snaps-add');
    if (snapsAddBtn && snapInp) {
      snapsAddBtn.addEventListener('click', () => {
        createSnapshot(snapInp.value);
        snapInp.value = '';
      });
    }

    ui.globalMemory = dr.querySelector('[data-pane="global-memory"]');
    ui.currentSession = dr.querySelector('[data-pane="current-session"]');
    ui.localMemory = ui.currentSession;
    ui.kept = ui.globalMemory;
    ui.rulesList = dr.querySelector('.mn-rules-list');
    ui.snapsList = dr.querySelector('.mn-snaps-list');

    // ── Drag & Drop Trash Zone (#4) ──
    const tz = dr.querySelector('.mn-trash-zone');
    if (tz) {
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
        } catch (_) { }
      });
    }
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
  const SIDEBAR_WIDTH = '440px';
  const PAGE_PUSH_MARGIN = '444px'; // sidebar width + border

  function toggleDrawer(forceState) {
    if (typeof forceState === 'boolean') {
      state.drawerOpen = forceState;
    } else {
      state.drawerOpen = !state.drawerOpen;
    }
    if (ui.dr) ui.dr.classList.toggle('open', state.drawerOpen);

    // Toggle panel-open class so right: 440px !important takes effect when open
    if (ui.fab) {
      ui.fab.classList.toggle('panel-open', state.drawerOpen);
    }

    try {
      document.body.style.transition = 'margin-right .28s cubic-bezier(.32,.72,0,1)';
      document.body.style.marginRight = state.drawerOpen ? PAGE_PUSH_MARGIN : '';
    } catch (_) { }
    if (state.drawerOpen) loadAll();
  }

  function updateBadge() {
    if (!ui.badge) return;
    const c = state.noticed ? state.noticed.length : 0;
    if (c > 0) {
      ui.badge.textContent = c > 99 ? '99+' : c;
      ui.badge.style.display = 'inline-flex';
    } else {
      ui.badge.style.display = 'none';
    }
  }

  function showToast(text) {
    if (!ui.toast) return;
    ui.toast.textContent = text;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (ui.toast) ui.toast.classList.remove('show');
    }, 2200);
  }

  /* ═══════════════════════════════════════════════════════════════
     PENECHO SPATIAL CANVAS PROTOCOL ENGINE & METHODS
     ═══════════════════════════════════════════════════════════════ */
  async function loadCanvasState() {
    try {
      const r = await send({ type: 'GET_CANVAS_STATE' });
      if (r && r.canvasState) {
        state.penechoState = r.canvasState;
        renderPenechoSpatialView();
      }
    } catch (_) { }
  }

  async function saveCanvasState() {
    try {
      await send({ type: 'SAVE_CANVAS_STATE', canvasState: state.penechoState });
    } catch (_) { }
  }

  function parsePenechoJson(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const blockRegex = /```(?:json:)?(?:penecho-canvas|memoneg-canvas|penecho)([\s\S]*?)(?:```|$)/i;
    const match = rawText.match(blockRegex);
    let jsonStr = match ? match[1].trim() : null;

    if (!jsonStr) {
      const jsonStartIdx = rawText.indexOf('{"version":');
      if (jsonStartIdx !== -1) {
        jsonStr = rawText.slice(jsonStartIdx);
        const endFence = jsonStr.indexOf('```');
        if (endFence !== -1) jsonStr = jsonStr.slice(0, endFence);
      }
    }
    if (!jsonStr) return null;

    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && (parsed.timeline || parsed.mindmap || parsed.canvas)) {
        return parsed;
      }
    } catch (_) { }
    return null;
  }

  function parseMarkdownToPenechoCanvas(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.replace(/```[\s\S]*?```/g, '').trim();
    const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return null;

    // 1. Extract Milestones for Timeline
    const firstHeading = lines.find(l => l.startsWith('#') || l.length < 60) || 'Milestone Assessment';
    const title = firstHeading.replace(/^[#*\-•\d.]+\s*/, '').slice(0, 50);
    const summary = lines.slice(1, 4).join(' ').slice(0, 140) || 'Derived structured spatial architecture and milestones.';

    // 2. Extract Concept Nodes for Mind Map
    const nodes = [];
    const links = [];
    const bulletLines = lines.filter(l => /^[*\-•\d.]+\s+[A-Z0-9]/.test(l) || l.includes(':'));
    const candidateTopics = bulletLines.length >= 3 ? bulletLines.slice(0, 7) : lines.slice(0, 6);

    const categories = ['safe_memory', 'active_focus', 'consideration', 'reconsider', 'neutral_structure'];
    const colors = ['#22C55E', '#3B82F6', '#EAB308', '#EF4444', '#64748B'];

    // Root node
    nodes.push({
      id: 'node_root',
      label: title.slice(0, 24) || 'Core Context',
      category: 'active_focus',
      color: '#3B82F6',
      description: summary.slice(0, 90),
      x: 200,
      y: 130
    });

    candidateTopics.forEach((topic, idx) => {
      const rawLabel = topic.replace(/^[#*\-•\d.]+\s*/, '').split(/[:—–-]/)[0].trim().slice(0, 26);
      if (!rawLabel || rawLabel.toLowerCase() === title.toLowerCase()) return;
      const catIdx = idx % categories.length;
      const nid = `node_${idx + 1}`;
      const desc = topic.length > rawLabel.length ? topic.slice(rawLabel.length + 1).trim().slice(0, 80) : `Decision factor for ${rawLabel}`;

      const angle = (idx / candidateTopics.length) * 2 * Math.PI;
      const dist = 110 + (idx % 2) * 30;

      nodes.push({
        id: nid,
        label: rawLabel,
        category: categories[catIdx],
        color: colors[catIdx],
        description: desc || 'Architectural decision point.',
        x: Math.round(200 + Math.cos(angle) * dist),
        y: Math.round(150 + Math.sin(angle) * dist)
      });

      links.push({
        source: 'node_root',
        target: nid,
        label: catIdx === 0 ? 'persists' : catIdx === 2 ? 'evaluates' : catIdx === 3 ? 'warns' : 'connects',
        style: catIdx === 2 || catIdx === 3 ? 'dashed' : 'solid'
      });
    });

    // 3. Extract Formulas or Vector Boxes
    const elements = [];
    const mathMatches = text.match(/\$\$([\s\S]+?)\$\$|\$([^$]+)\$/g) || [];
    if (mathMatches.length > 0) {
      mathMatches.slice(0, 2).forEach((m, idx) => {
        const cleanMath = m.replace(/^\$\$?|\$\$?$/g, '').trim();
        elements.push({
          type: 'render_formula',
          id: `f_${idx + 1}`,
          x: 60 + idx * 160,
          y: 40,
          latex: cleanMath,
          caption: `Mathematical Formulation #${idx + 1}`
        });
      });
    } else {
      elements.push({
        type: 'render_formula',
        id: 'f_std',
        x: 70,
        y: 40,
        latex: '\\mathcal{S}_{t+1} = f(\\mathcal{S}_t, \\mathcal{A}_t) \\quad \\text{where } \\mathcal{L} \\le \\epsilon',
        caption: 'State Transition & Convergence'
      });
    }

    elements.push({
      type: 'draw_box',
      id: 'box_core',
      x: 40,
      y: 180,
      w: 160,
      h: 80,
      color: '#3B82F6',
      title: 'Execution Pipeline',
      style: 'solid'
    });

    elements.push({
      type: 'draw_arrow',
      from: [200, 220],
      to: [280, 220],
      label: 'State Flow',
      color: '#22C55E'
    });

    return {
      version: '1.0',
      timeline: {
        step_id: `step_${Date.now()}`,
        step_number: 1,
        title: title,
        status: 'completed',
        summary: summary
      },
      mindmap: {
        action: 'merge',
        nodes: nodes,
        links: links
      },
      canvas: {
        elements: elements
      }
    };
  }

  function applyPenechoCanvasPayload(payload, isDraft = false) {
    if (!payload) return;
    if (isDraft) {
      state.penechoDraft = { payload, timestamp: Date.now() };
      renderPenechoSpatialView();
      return;
    }

    const cur = state.penechoState || { timeline: [], mindmap: { nodes: [], links: [] }, canvas: { elements: [] }, drawings: [], stickies: [] };
    if (!cur.drawings) cur.drawings = [];
    if (!cur.stickies) cur.stickies = [];

    // Stream 1: Timeline merge
    if (payload.timeline) {
      if (!cur.timeline) cur.timeline = [];
      const exists = cur.timeline.some((t) => t.step_id === payload.timeline.step_id);
      if (!exists) {
        cur.timeline.unshift(payload.timeline);
        if (cur.timeline.length > 20) cur.timeline.pop();
      }
    }

    // Stream 2: Mind map merge
    if (payload.mindmap && Array.isArray(payload.mindmap.nodes)) {
      if (!cur.mindmap) cur.mindmap = { nodes: [], links: [] };
      const nodeMap = new Map();
      (cur.mindmap.nodes || []).forEach((n) => nodeMap.set(n.id, n));

      payload.mindmap.nodes.forEach((n, idx) => {
        const existing = nodeMap.get(n.id);
        const angle = (idx / payload.mindmap.nodes.length) * 2 * Math.PI;
        const dist = 120 + (idx % 2) * 35;
        const initX = existing ? existing.x : Math.round(200 + Math.cos(angle) * dist);
        const initY = existing ? existing.y : Math.round(150 + Math.sin(angle) * dist);

        nodeMap.set(n.id, {
          ...n,
          x: initX,
          y: initY,
          vx: 0,
          vy: 0
        });
      });
      cur.mindmap.nodes = Array.from(nodeMap.values());

      if (Array.isArray(payload.mindmap.links)) {
        const linkKeys = new Set((cur.mindmap.links || []).map((l) => `${l.source}->${l.target}`));
        payload.mindmap.links.forEach((l) => {
          const key = `${l.source}->${l.target}`;
          if (!linkKeys.has(key)) {
            cur.mindmap.links.push(l);
            linkKeys.add(key);
          }
        });
      }
    }

    // Stream 3: Canvas elements merge
    if (payload.canvas && Array.isArray(payload.canvas.elements)) {
      if (!cur.canvas) cur.canvas = { elements: [] };
      const elMap = new Map();
      (cur.canvas.elements || []).forEach((e) => elMap.set(e.id || JSON.stringify(e), e));
      payload.canvas.elements.forEach((e) => {
        elMap.set(e.id || JSON.stringify(e), e);
      });
      cur.canvas.elements = Array.from(elMap.values());
    }

    state.penechoState = cur;
    state.penechoDraft = null;
    saveCanvasState();
    renderPenechoSpatialView();
    startMindMapPhysics();
  }

  function acceptPenechoDraft() {
    if (!state.penechoDraft || !state.penechoDraft.payload) return;
    applyPenechoCanvasPayload(state.penechoDraft.payload, false);
    showToast('Spatial Canvas Draft Committed to Whiteboard ✓');
  }

  function discardPenechoDraft() {
    state.penechoDraft = null;
    renderPenechoSpatialView();
    showToast('Draft discarded');
  }

  function clearPenechoCanvas() {
    state.penechoState = {
      timeline: [],
      mindmap: { nodes: [], links: [] },
      canvas: { elements: [] },
      drawings: [],
      stickies: []
    };
    state.penechoDraft = null;
    state.selectedMindMapNode = null;
    state.canvasPan = { x: 0, y: 0 };
    state.canvasZoom = 1.0;
    saveCanvasState();
    renderPenechoSpatialView();
    showToast('Whiteboard Cleared ✓');
  }

  function loadPenechoDemo() {
    applyPenechoCanvasPayload(PENECHO_EXAMPLE_PAYLOAD, false);
    if (!state.penechoState.stickies) state.penechoState.stickies = [];
    state.penechoState.stickies.push({
      id: 'sticky_' + Date.now(),
      x: 60,
      y: 80,
      text: '📌 Architectural Goal:\nAchieve sub-50ms token inference with local-first vault security.',
      color: '#FEF08A'
    });
    saveCanvasState();
    renderPenechoSpatialView();
    showToast('Loaded Interactive Whiteboard Demo ✓');
  }

  /* ── Mind Map Force-Directed Physics ── */
  function startMindMapPhysics() {
    if (state.physicsRaf) cancelAnimationFrame(state.physicsRaf);
    let iterations = 0;
    const maxIterations = 140;

    function physicsStep() {
      const nodes = state.penechoState?.mindmap?.nodes || [];
      const links = state.penechoState?.mindmap?.links || [];
      if (!nodes.length) return;

      const cx = 200;
      const cy = 150;
      const kRepel = 2800;
      const kSpring = 0.04;
      const restLen = 90;
      const damping = 0.85;

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i];
          const n2 = nodes[j];
          let dx = (n1.x || cx) - (n2.x || cx);
          let dy = (n1.y || cy) - (n2.y || cy);
          let distSq = dx * dx + dy * dy + 100;
          let dist = Math.sqrt(distSq);
          let force = kRepel / distSq;
          let fx = (dx / dist) * force;
          let fy = (dy / dist) * force;
          n1.vx = (n1.vx || 0) + fx;
          n1.vy = (n1.vy || 0) + fy;
          n2.vx = (n2.vx || 0) - fx;
          n2.vy = (n2.vy || 0) - fy;
        }
      }

      for (const link of links) {
        const source = nodes.find((n) => n.id === link.source);
        const target = nodes.find((n) => n.id === link.target);
        if (source && target) {
          let dx = target.x - source.x;
          let dy = target.y - source.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          let delta = dist - restLen;
          let fx = (dx / dist) * delta * kSpring;
          let fy = (dy / dist) * delta * kSpring;
          source.vx = (source.vx || 0) + fx;
          source.vy = (source.vy || 0) + fy;
          target.vx = (target.vx || 0) - fx;
          target.vy = (target.vy || 0) - fy;
        }
      }

      for (const node of nodes) {
        if (state.draggedElement && state.draggedElement.id === node.id) continue;
        node.vx = ((node.vx || 0) + (cx - node.x) * 0.012) * damping;
        node.vy = ((node.vy || 0) + (cy - node.y) * 0.012) * damping;
        node.x = Math.max(30, Math.min(370, node.x + node.vx));
        node.y = Math.max(30, Math.min(270, node.y + node.vy));
      }

      updateWhiteboardSVG();
      iterations++;
      if (iterations < maxIterations) {
        state.physicsRaf = requestAnimationFrame(physicsStep);
      }
    }
    state.physicsRaf = requestAnimationFrame(physicsStep);
  }

  function formatLatexFormula(latex) {
    if (!latex) return '';
    return String(latex)
      .split('\\nabla').join('∇')
      .split('\\times').join(' × ')
      .split('\\partial').join('∂')
      .split('\\mu').join('μ')
      .split('\\sigma').join('σ')
      .split('\\sum').join('∑')
      .split('\\int').join('∫')
      .replace(/\\mathbf\{([^}]+)\}/g, '<b>$1</b>')
      .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1 / $2)')
      .replace(/_\{([^}]+)\}/g, '<sub>$1</sub>')
      .replace(/\^\{([^}]+)\}/g, '<sup>$1</sup>');
  }

  /* ── PenEcho SVG Rendering Engine (Mind Map, Vector Shapes, Freehand Drawing) ── */
  function updateWhiteboardSVG() {
    const svg = ui.spatialView?.querySelector('.mn-whiteboard-svg');
    if (!svg) return;

    const data = state.penechoState || { timeline: [], mindmap: { nodes: [], links: [] }, canvas: { elements: [] }, drawings: [], stickies: [] };
    const nodes = data.mindmap?.nodes || [];
    const links = data.mindmap?.links || [];
    const canvasElements = data.canvas?.elements || [];
    const drawings = data.drawings || [];

    const NS = 'http://www.w3.org/2000/svg';
    svg.innerHTML = `
      <defs>
        <marker id="arrow-green" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#22C55E"/>
        </marker>
        <marker id="arrow-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#3B82F6"/>
        </marker>
        <marker id="arrow-yellow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#EAB308"/>
        </marker>
        <marker id="arrow-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#EF4444"/>
        </marker>
        <marker id="arrow-slate" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748B"/>
        </marker>
        <filter id="mn-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#1A1A2E" flood-opacity="0.12"/>
        </filter>
      </defs>
    `;

    // 1. Render Mind Map Links
    const linkGroup = document.createElementNS(NS, 'g');
    linkGroup.setAttribute('class', 'mn-svg-links');

    links.forEach((l) => {
      const source = nodes.find((n) => n.id === l.source);
      const target = nodes.find((n) => n.id === l.target);
      if (source && target) {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', source.x || 200);
        line.setAttribute('y1', source.y || 150);
        line.setAttribute('x2', target.x || 200);
        line.setAttribute('y2', target.y || 150);
        line.setAttribute('stroke', '#94A3B8');
        line.setAttribute('stroke-width', '2');
        if (l.style === 'dashed') {
          line.setAttribute('stroke-dasharray', '5,5');
        }
        line.setAttribute('marker-end', 'url(#arrow-slate)');
        linkGroup.appendChild(line);

        if (l.label) {
          const midX = ((source.x || 200) + (target.x || 200)) / 2;
          const midY = ((source.y || 150) + (target.y || 150)) / 2;
          const txt = document.createElementNS(NS, 'text');
          txt.setAttribute('x', midX);
          txt.setAttribute('y', midY - 4);
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('font-size', '9.5');
          txt.setAttribute('font-family', 'Space Grotesk, sans-serif');
          txt.setAttribute('font-weight', '700');
          txt.setAttribute('fill', '#475569');
          txt.textContent = l.label;
          linkGroup.appendChild(txt);
        }
      }
    });
    svg.appendChild(linkGroup);

    // 2. Render Canvas Vector Elements (Box, Arrow, Text)
    const elemGroup = document.createElementNS(NS, 'g');
    elemGroup.setAttribute('class', 'mn-svg-canvas-elements');

    canvasElements.forEach((el) => {
      if (el.type === 'draw_box') {
        const rect = document.createElementNS(NS, 'rect');
        rect.setAttribute('x', el.x || 50);
        rect.setAttribute('y', el.y || 50);
        rect.setAttribute('width', el.w || 140);
        rect.setAttribute('height', el.h || 70);
        rect.setAttribute('rx', '10');
        rect.setAttribute('fill', '#FFFFFF');
        rect.setAttribute('stroke', el.color || '#3B82F6');
        rect.setAttribute('stroke-width', '2.5');
        rect.setAttribute('filter', 'url(#mn-glow)');
        elemGroup.appendChild(rect);

        if (el.title) {
          const txt = document.createElementNS(NS, 'text');
          txt.setAttribute('x', (el.x || 50) + (el.w || 140) / 2);
          txt.setAttribute('y', (el.y || 50) + 24);
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('font-size', '11');
          txt.setAttribute('font-weight', '700');
          txt.setAttribute('font-family', 'Space Grotesk, sans-serif');
          txt.setAttribute('fill', '#1A1A2E');
          txt.textContent = el.title;
          elemGroup.appendChild(txt);
        }
      } else if (el.type === 'draw_arrow' && Array.isArray(el.from) && Array.isArray(el.to)) {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', el.from[0]);
        line.setAttribute('y1', el.from[1]);
        line.setAttribute('x2', el.to[0]);
        line.setAttribute('y2', el.to[1]);
        line.setAttribute('stroke', el.color || '#22C55E');
        line.setAttribute('stroke-width', '2.5');
        line.setAttribute('marker-end', el.color === '#EF4444' ? 'url(#arrow-red)' : el.color === '#EAB308' ? 'url(#arrow-yellow)' : 'url(#arrow-green)');
        elemGroup.appendChild(line);

        if (el.label) {
          const midX = (el.from[0] + el.to[0]) / 2;
          const midY = (el.from[1] + el.to[1]) / 2;
          const txt = document.createElementNS(NS, 'text');
          txt.setAttribute('x', midX);
          txt.setAttribute('y', midY - 6);
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('font-size', '10');
          txt.setAttribute('font-weight', '700');
          txt.setAttribute('fill', el.color || '#22C55E');
          txt.textContent = el.label;
          elemGroup.appendChild(txt);
        }
      } else if (el.type === 'draw_text') {
        const txt = document.createElementNS(NS, 'text');
        txt.setAttribute('x', el.x || 60);
        txt.setAttribute('y', el.y || 60);
        txt.setAttribute('font-size', '11.5');
        txt.setAttribute('font-weight', '600');
        txt.setAttribute('font-family', 'Space Grotesk, sans-serif');
        txt.setAttribute('fill', el.color || '#1A1A2E');
        txt.textContent = el.text || '';
        elemGroup.appendChild(txt);
      }
    });
    svg.appendChild(elemGroup);

    // 3. Render Freehand Pen Drawings
    const drawGroup = document.createElementNS(NS, 'g');
    drawGroup.setAttribute('class', 'mn-svg-pen-drawings');

    drawings.forEach((d) => {
      if (d.points && d.points.length > 1) {
        const path = document.createElementNS(NS, 'path');
        const dStr = d.points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        path.setAttribute('d', dStr);
        path.setAttribute('stroke', d.color || '#1A1A2E');
        path.setAttribute('stroke-width', d.width || '3');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        drawGroup.appendChild(path);
      }
    });
    svg.appendChild(drawGroup);

    // 4. Render Interactive Mind Map Nodes
    const nodeGroup = document.createElementNS(NS, 'g');
    nodeGroup.setAttribute('class', 'mn-svg-nodes');

    nodes.forEach((n) => {
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'mn-wb-node');
      g.setAttribute('transform', `translate(${n.x || 200}, ${n.y || 150})`);
      g.style.cursor = 'pointer';

      const isSelected = state.selectedMindMapNode?.id === n.id;
      const color = n.color || '#3B82F6';

      // Outer Selection Ring
      if (isSelected) {
        const ring = document.createElementNS(NS, 'circle');
        ring.setAttribute('r', '26');
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#EC4899');
        ring.setAttribute('stroke-width', '3');
        ring.setAttribute('stroke-dasharray', '4,3');
        g.appendChild(ring);
      }

      // Node Circle
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('r', '18');
      circle.setAttribute('fill', '#FFFFFF');
      circle.setAttribute('stroke', color);
      circle.setAttribute('stroke-width', '3');
      circle.setAttribute('filter', 'url(#mn-glow)');
      g.appendChild(circle);

      // Inner Category Dot
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '7');
      dot.setAttribute('fill', color);
      g.appendChild(dot);

      // Label Pill Background & Text
      const labelText = n.label || 'Concept';
      const txt = document.createElementNS(NS, 'text');
      txt.setAttribute('x', '0');
      txt.setAttribute('y', '32');
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', '10.5');
      txt.setAttribute('font-weight', '700');
      txt.setAttribute('font-family', 'Space Grotesk, sans-serif');
      txt.setAttribute('fill', '#1A1A2E');
      txt.textContent = labelText.length > 20 ? labelText.slice(0, 18) + '...' : labelText;
      g.appendChild(txt);

      // Node Click Event
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedMindMapNode = n;
        renderNodeInspector();
        updateWhiteboardSVG();
      });

      nodeGroup.appendChild(g);
    });
    svg.appendChild(nodeGroup);
  }

  function updateMindMapSVG() {
    updateWhiteboardSVG();
  }

  function renderNodeInspector() {
    const inspectorEl = ui.spatialView?.querySelector('.mn-node-inspector');
    if (!inspectorEl) return;
    const node = state.selectedMindMapNode;
    if (!node) {
      inspectorEl.style.display = 'none';
      return;
    }
    inspectorEl.style.display = 'block';
    const color = node.color || '#64748B';
    const catLabel =
      node.category === 'safe_memory' ? '🟢 Safe Long-Term Memory' :
        node.category === 'consideration' ? '🟡 Consideration / Revisit' :
          node.category === 'reconsider' ? '🔴 High Risk / Reconsider' :
            node.category === 'active_focus' ? '🔵 Active Focus' : '⚪ Structural Connector';

    const saveBtnHtml = (node.category === 'safe_memory' || color === '#22C55E')
      ? '<button class="mn-spatial-btn mn-spatial-btn-primary mn-node-save-btn">💾 Save Fact to Kept Vault</button>'
      : '';
    const ruleBtnHtml = (node.category === 'reconsider' || color === '#EF4444')
      ? '<button class="mn-spatial-btn mn-spatial-btn-danger mn-node-rule-btn">🛡️ Add to Never-Save Rules</button>'
      : '';

    inspectorEl.innerHTML = `
      <div class="mn-inspector-hdr">
        <div class="mn-inspector-label">
          <span style="color:${color};font-size:14px;">●</span>
          <strong>${esc(node.label)}</strong>
        </div>
        <span class="mn-sens-badge" style="background:${color}22;color:${color};border:1px solid ${color}44;">${catLabel}</span>
      </div>
      <div class="mn-inspector-desc">${esc(node.description || 'No description provided.')}</div>
      <div class="mn-inspector-acts">
        ${saveBtnHtml}
        ${ruleBtnHtml}
        <button class="mn-spatial-btn mn-node-close-btn">Close</button>
      </div>
    `;

    const saveBtn = inspectorEl.querySelector('.mn-node-save-btn');
    if (saveBtn) {
      saveBtn.onclick = () => {
        addKept({
          id: uid(),
          text: `[${node.label}] ${node.description}`,
          role: 'assistant',
          source: location.hostname,
          url: location.href,
          timestamp: Date.now(),
          keptAt: Date.now()
        });
        showToast('Node fact committed to Vault ✓');
      };
    }

    const ruleBtn = inspectorEl.querySelector('.mn-node-rule-btn');
    if (ruleBtn) {
      ruleBtn.onclick = () => {
        addRule(node.label);
        showToast(`Rule added: "${node.label}" will be blocked ✓`);
      };
    }

    const closeBtn = inspectorEl.querySelector('.mn-node-close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        state.selectedMindMapNode = null;
        renderNodeInspector();
      };
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     RENDER TRUE INTERACTIVE INFINITE WHITEBOARD
     ═══════════════════════════════════════════════════════════════ */
  function renderPenechoSpatialView() {
    const viewEl = ui.spatialView;
    if (!viewEl) return;

    const data = state.penechoState || { timeline: [], mindmap: { nodes: [], links: [] }, canvas: { elements: [] }, drawings: [], stickies: [] };
    const draft = state.penechoDraft?.payload;
    const isLiveOn = state.liveSyncEnabled;
    const activeTool = state.whiteboardTool || 'select';
    const subTab = state.canvasSubTab || 'mindmap';

    // 1. Draft Layer Banner
    let draftBannerHtml = '';
    if (draft) {
      const stepTtl = draft.timeline?.title || 'Incoming Turn Update';
      const nodeCnt = draft.mindmap?.nodes?.length || 0;
      const elemCnt = draft.canvas?.elements?.length || 0;
      draftBannerHtml = `
        <div class="mn-draft-banner" style="margin-bottom:8px;">
          <div class="mn-draft-info">
            <div class="mn-draft-title">✨ Draft Layer: ${esc(stepTtl)}</div>
            <div class="mn-draft-subtitle">${nodeCnt} Nodes • ${elemCnt} Visuals</div>
          </div>
          <div class="mn-draft-acts">
            <button class="mn-spatial-btn mn-spatial-btn-primary mn-btn-accept-draft">✅ Accept</button>
            <button class="mn-spatial-btn mn-spatial-btn-danger mn-btn-discard-draft">Discard</button>
          </div>
        </div>
      `;
    }

    // 2. Sleek Single-Row Top Bar
    const topBarHtml = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 10px;background:#F8FAFC;border:2px solid #1A1A2E;border-radius:10px;margin-bottom:8px;box-shadow:2px 2px 0px #1A1A2E;flex-wrap:wrap;">
        <div style="display:flex;gap:4px;align-items:center;">
          <button class="mn-spatial-subtab-btn ${subTab === 'mindmap' ? 'active' : ''}" data-subtab="mindmap">🗺️ Mind Map</button>
          <button class="mn-spatial-subtab-btn ${subTab === 'canvas' ? 'active' : ''}" data-subtab="canvas">📐 Whiteboard</button>
          <button class="mn-spatial-subtab-btn ${subTab === 'timeline' ? 'active' : ''}" data-subtab="timeline">⏳ Timeline (${data.timeline?.length || 0})</button>
          <button class="mn-spatial-subtab-btn ${subTab === 'code' ? 'active' : ''}" data-subtab="code">📜 Code</button>
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          <button class="mn-spatial-btn mn-btn-inject-prompt" style="background:#E0F2FE;color:#0369A1;border:1.5px solid #0369A1;font-size:10px;font-weight:700;padding:3px 7px;" title="Inject PenEcho Canvas protocol prompt into Claude">⚡ Prompt</button>
          <button class="mn-spatial-btn mn-btn-render-chat" style="background:var(--mn-pink);color:#FFFFFF;border:1.5px solid #1A1A2E;font-size:10px;font-weight:700;padding:3px 7px;" title="Render current chat conversation to canvas">🎨 Sync Chat</button>
          <button class="mn-spatial-btn mn-btn-clear-canvas" style="background:#F1F5F9;color:#475569;border:1.5px solid #1A1A2E;font-size:10px;font-weight:700;padding:3px 7px;" title="Clear whiteboard">🧹</button>
          <label style="display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:700;cursor:pointer;" title="Auto live-sync with chat">
            <span>Sync:</span>
            <input type="checkbox" class="mn-tgl mn-live-sync-tgl" ${isLiveOn ? 'checked' : ''} style="width:26px;height:14px;" />
          </label>
        </div>
      </div>
    `;

    // 3. Sub-tab Content Generation
    let mainSubTabContentHtml = '';

    if (subTab === 'code') {
      const codeJsonStr = JSON.stringify(data, null, 2);
      mainSubTabContentHtml = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="font-size:12px;font-weight:700;color:#1A1A2E;">📄 penecho-canvas.json (Live Code File)</div>
            <div style="display:flex;gap:6px;">
              <button class="mn-spatial-btn mn-btn-copy-code" style="background:var(--mn-blue);padding:4px 8px;font-size:11px;font-weight:700;">📋 Copy JSON</button>
              <button class="mn-spatial-btn mn-btn-load-demo" style="padding:4px 8px;font-size:11px;font-weight:700;">✨ Demo</button>
            </div>
          </div>
          <pre class="mn-canvas-code-box"><code>${esc(codeJsonStr)}</code></pre>
        </div>
      `;
    } else if (subTab === 'timeline') {
      const steps = data.timeline || [];
      mainSubTabContentHtml = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          <div style="font-size:12px;font-weight:700;color:#1A1A2E;margin-bottom:4px;">⏳ Running Chronological Milestones</div>
          ${steps.length === 0 ? '<div style="font-size:12px;color:#6B7280;padding:12px;text-align:center;">No milestones in timeline yet. Ask Claude a question or click "Sync Chat".</div>' : ''}
          ${steps.map((st, i) => `
            <div style="border:2px solid #1A1A2E;border-radius:10px;padding:10px;background:#FFFFFF;box-shadow:2px 2px 0px #1A1A2E;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                <strong style="font-size:13px;color:#1A1A2E;">#${st.step_number || (i + 1)}: ${esc(st.title || 'Milestone')}</strong>
                <span style="font-size:10px;padding:2px 6px;border-radius:6px;border:1px solid #1A1A2E;background:${st.status === 'completed' ? '#D1FAE5' : '#FEF3C7'};font-weight:700;">${esc(st.status || 'completed')}</span>
              </div>
              <div style="font-size:12px;color:#4B5563;">${esc(st.summary || '')}</div>
            </div>
          `).join('')}
        </div>
      `;
    } else if (subTab === 'canvas') {
      // Whiteboard View (Tools, LaTeX cards, Stickies, Drawings)
      const toolButtons = [
        { id: 'select', label: '👆 Select', title: 'Drag elements or pan' },
        { id: 'pen', label: '✏️ Pen', title: 'Freehand sketch' },
        { id: 'sticky', label: '📝 Note', title: 'Add sticky note' },
        { id: 'box', label: '⬜ Box', title: 'Add concept box' },
        { id: 'eraser', label: '🧹 Eraser', title: 'Erase items' },
      ];
      const penColors = ['#1A1A2E', '#2563EB', '#EC4899', '#16A34A', '#D97706', '#DC2626'];
      const activeColor = state.whiteboardPenColor || '#1A1A2E';

      const stickies = data.stickies || [];
      let stickiesHtml = '';
      stickies.forEach((s) => {
        stickiesHtml += `
          <div class="mn-sticky-note-card mn-draggable" data-sticky-id="${esc(s.id)}" style="left:${s.x || 40}px;top:${s.y || 40}px;background:${s.color || '#FEF08A'};">
            <div class="mn-sticky-hdr">
              <span>📌 Note</span>
              <span class="mn-sticky-del" data-del-sticky="${esc(s.id)}" style="cursor:pointer;padding:0 2px;" title="Delete note">×</span>
            </div>
            <div class="mn-sticky-body" contenteditable="true" data-edit-sticky="${esc(s.id)}">${esc(s.text || 'Type notes here...')}</div>
          </div>
        `;
      });

      const canvasElements = (data.canvas?.elements?.length ? data.canvas.elements : (draft?.canvas?.elements || []));
      let formulasOverlayHtml = '';
      canvasElements.forEach((el, idx) => {
        if (el.type === 'render_formula') {
          // Layout formula cards in a clean non-overlapping row/grid
          const col = idx % 2;
          const row = Math.floor(idx / 2);
          const posX = el.x !== undefined ? el.x : (20 + col * 200);
          const posY = el.y !== undefined ? el.y : (20 + row * 130);
          formulasOverlayHtml += `
            <div class="mn-floating-formula-card mn-draggable" data-formula-id="${esc(el.id || 'f_' + idx)}" style="left:${posX}px;top:${posY}px;">
              ${el.caption ? `<div class="mn-formula-caption">📐 ${esc(el.caption)}</div>` : ''}
              <div class="mn-formula-math">${formatLatexFormula(el.latex)}</div>
            </div>
          `;
        }
      });

      mainSubTabContentHtml = `
        <div class="mn-whiteboard-container">
          <div class="mn-whiteboard-toolbar">
            <div class="mn-wb-tool-group">
              ${toolButtons.map(t => `
                <button class="mn-wb-btn ${activeTool === t.id ? 'active' : ''}" data-tool="${t.id}" title="${t.title}">${t.label}</button>
              `).join('')}
            </div>
            <div class="mn-wb-tool-group">
              <div class="mn-wb-color-picker" title="Pen Stroke Color">
                ${penColors.map(c => `
                  <div class="mn-wb-color-dot ${activeColor === c ? 'active' : ''}" data-color="${c}" style="background:${c};"></div>
                `).join('')}
              </div>
              <button class="mn-wb-btn mn-wb-btn-export" title="Export Whiteboard to SVG">${IC.download} SVG</button>
            </div>
          </div>

          <div class="mn-whiteboard-viewport ${activeTool === 'pen' ? 'drawing' : ''}">
            <div class="mn-whiteboard-surface" style="transform: translate(${state.canvasPan.x}px, ${state.canvasPan.y}px) scale(${state.canvasZoom});">
              <svg class="mn-whiteboard-svg" viewBox="0 0 3200 3200"></svg>
              <div class="mn-whiteboard-overlay">
                ${stickiesHtml}
                ${formulasOverlayHtml}
              </div>
            </div>

            <!-- Zoom Controls -->
            <div class="mn-wb-zoom-bar">
              <button class="mn-wb-btn mn-wb-zoom-out" style="padding:2px 6px;" title="Zoom Out">➖</button>
              <span class="mn-wb-badge-info">${Math.round((state.canvasZoom || 1.0) * 100)}%</span>
              <button class="mn-wb-btn mn-wb-zoom-in" style="padding:2px 6px;" title="Zoom In">➕</button>
              <button class="mn-wb-btn mn-wb-zoom-reset" style="padding:2px 6px;" title="Reset View">🎯 100%</button>
            </div>
          </div>
        </div>
      `;
    } else {
      // Default: Mind Map View (Clean, unobstructed Knowledge Graph with physics and legend)
      mainSubTabContentHtml = `
        <div class="mn-whiteboard-container">
          <div class="mn-whiteboard-viewport">
            <div class="mn-whiteboard-surface" style="transform: translate(${state.canvasPan.x}px, ${state.canvasPan.y}px) scale(${state.canvasZoom});">
              <svg class="mn-whiteboard-svg" viewBox="0 0 3200 3200"></svg>
            </div>

            <!-- Zoom Controls -->
            <div class="mn-wb-zoom-bar">
              <button class="mn-wb-btn mn-wb-zoom-out" style="padding:2px 6px;" title="Zoom Out">➖</button>
              <span class="mn-wb-badge-info">${Math.round((state.canvasZoom || 1.0) * 100)}%</span>
              <button class="mn-wb-btn mn-wb-zoom-in" style="padding:2px 6px;" title="Zoom In">➕</button>
              <button class="mn-wb-btn mn-wb-zoom-reset" style="padding:2px 6px;" title="Reset View">🎯 100%</button>
            </div>
          </div>

          <div class="mn-mindmap-legend" style="margin-top:4px;">
            <span class="mn-legend-tag"><span class="mn-legend-dot" style="background:#22C55E;"></span> 🟢 Safe Memory</span>
            <span class="mn-legend-tag"><span class="mn-legend-dot" style="background:#EAB308;"></span> 🟡 Consideration</span>
            <span class="mn-legend-tag"><span class="mn-legend-dot" style="background:#EF4444;"></span> 🔴 Reconsider</span>
            <span class="mn-legend-tag"><span class="mn-legend-dot" style="background:#3B82F6;"></span> 🔵 Active Focus</span>
            <span class="mn-legend-tag"><span class="mn-legend-dot" style="background:#64748B;"></span> ⚪ Structure</span>
          </div>

          <div class="mn-node-inspector" style="display:none;"></div>
        </div>
      `;
    }

    // 4. Assemble View Structure
    viewEl.innerHTML = `
      ${draftBannerHtml}
      ${topBarHtml}
      ${mainSubTabContentHtml}
    `;

    // Event listeners
    const liveTgl = viewEl.querySelector('.mn-live-sync-tgl');
    if (liveTgl) {
      liveTgl.onchange = () => {
        state.liveSyncEnabled = liveTgl.checked;
        showToast(liveTgl.checked ? '⚡ Live Sync Enabled ✓' : 'Live Sync Paused');
      };
    }

    const injectBtn = viewEl.querySelector('.mn-btn-inject-prompt');
    if (injectBtn) injectBtn.onclick = injectSpatialPromptToClaude;

    const renderChatBtn = viewEl.querySelector('.mn-btn-render-chat');
    if (renderChatBtn) {
      renderChatBtn.onclick = () => {
        const assistantEls = document.querySelectorAll(
          '.font-claude-message, [data-message-author-role="assistant"], .font-user-message ~ div .prose, div.standard-markdown, .prose'
        );
        let text = '';
        if (assistantEls.length > 0) {
          text = (assistantEls[assistantEls.length - 1].innerText || assistantEls[assistantEls.length - 1].textContent || '').trim();
        }
        if (text) {
          renderClaudeMessageToCanvas(text, true);
        } else {
          showToast('⚠️ No assistant message found in chat. Loading demo...');
          loadPenechoDemo();
        }
      };
    }

    // Subtab switching
    viewEl.querySelectorAll('.mn-spatial-subtab-btn').forEach((btn) => {
      btn.onclick = () => {
        state.canvasSubTab = btn.dataset.subtab;
        renderPenechoSpatialView();
      };
    });

    // Tool switching
    viewEl.querySelectorAll('.mn-wb-btn[data-tool]').forEach((btn) => {
      btn.onclick = () => {
        state.whiteboardTool = btn.dataset.tool;
        renderPenechoSpatialView();
      };
    });

    // Color picker
    viewEl.querySelectorAll('.mn-wb-color-dot[data-color]').forEach((dot) => {
      dot.onclick = () => {
        state.whiteboardPenColor = dot.dataset.color;
        renderPenechoSpatialView();
      };
    });

    // Zoom controls
    const zoomInBtn = viewEl.querySelector('.mn-wb-zoom-in');
    if (zoomInBtn) {
      zoomInBtn.onclick = () => {
        state.canvasZoom = Math.min(2.5, (state.canvasZoom || 1.0) + 0.15);
        renderPenechoSpatialView();
      };
    }

    const zoomOutBtn = viewEl.querySelector('.mn-wb-zoom-out');
    if (zoomOutBtn) {
      zoomOutBtn.onclick = () => {
        state.canvasZoom = Math.max(0.4, (state.canvasZoom || 1.0) - 0.15);
        renderPenechoSpatialView();
      };
    }

    const zoomResetBtn = viewEl.querySelector('.mn-wb-zoom-reset');
    if (zoomResetBtn) {
      zoomResetBtn.onclick = () => {
        state.canvasZoom = 1.0;
        state.canvasPan = { x: 0, y: 0 };
        renderPenechoSpatialView();
      };
    }

    // SVG Export
    const exportSvgBtn = viewEl.querySelector('.mn-wb-btn-export');
    if (exportSvgBtn) {
      exportSvgBtn.onclick = () => {
        const svgEl = viewEl.querySelector('.mn-whiteboard-svg');
        if (svgEl) {
          const svgData = new XMLSerializer().serializeToString(svgEl);
          const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `penecho-canvas-${Date.now()}.svg`;
          a.click();
          URL.revokeObjectURL(url);
          showToast('Canvas exported to SVG ✓');
        }
      };
    }

    // Sticky Note Deletion & Editing
    viewEl.querySelectorAll('.mn-sticky-del').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.delSticky;
        state.penechoState.stickies = (state.penechoState.stickies || []).filter((s) => s.id !== id);
        saveCanvasState();
        renderPenechoSpatialView();
      };
    });

    viewEl.querySelectorAll('.mn-sticky-body').forEach((body) => {
      body.onblur = () => {
        const id = body.dataset.editSticky;
        const s = (state.penechoState.stickies || []).find((x) => x.id === id);
        if (s) {
          s.text = body.textContent;
          saveCanvasState();
        }
      };
    });

    // Draggable Formula and Sticky Cards
    viewEl.querySelectorAll('.mn-draggable').forEach((card) => {
      let isDragging = false;
      let startX = 0, startY = 0;
      let initLeft = 0, initTop = 0;

      card.onmousedown = (e) => {
        if (e.target.closest('[contenteditable="true"]') || e.target.closest('.mn-sticky-del')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initLeft = parseInt(card.style.left, 10) || card.offsetLeft;
        initTop = parseInt(card.style.top, 10) || card.offsetTop;
        card.style.zIndex = '100';

        const onMove = (ev) => {
          if (!isDragging) return;
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          card.style.left = `${initLeft + dx}px`;
          card.style.top = `${initTop + dy}px`;
        };

        const onUp = () => {
          if (isDragging) {
            isDragging = false;
            card.style.zIndex = '10';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);

            const stickyId = card.dataset.stickyId;
            const formulaId = card.dataset.formulaId;
            if (stickyId && state.penechoState?.stickies) {
              const s = state.penechoState.stickies.find(x => x.id === stickyId);
              if (s) { s.x = parseInt(card.style.left, 10); s.y = parseInt(card.style.top, 10); }
            }
            if (formulaId && state.penechoState?.canvas?.elements) {
              const el = state.penechoState.canvas.elements.find(x => (x.id || 'f_' + x) === formulaId);
              if (el) { el.x = parseInt(card.style.left, 10); el.y = parseInt(card.style.top, 10); }
            }
            saveCanvasState();
          }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      };
    });

    // Whiteboard Freehand Pen Drawing
    const viewport = viewEl.querySelector('.mn-whiteboard-viewport');
    if (viewport && subTab === 'canvas') {
      let isDrawing = false;
      let currentStroke = null;

      viewport.onmousedown = (e) => {
        if (state.whiteboardTool === 'pen') {
          isDrawing = true;
          const rect = viewport.getBoundingClientRect();
          const zoom = state.canvasZoom || 1.0;
          const pan = state.canvasPan || { x: 0, y: 0 };
          const pt = {
            x: Math.round((e.clientX - rect.left - pan.x) / zoom),
            y: Math.round((e.clientY - rect.top - pan.y) / zoom)
          };
          currentStroke = {
            id: 'draw_' + Date.now(),
            color: state.whiteboardPenColor || '#1A1A2E',
            width: 3,
            points: [pt]
          };
          if (!state.penechoState.drawings) state.penechoState.drawings = [];
          state.penechoState.drawings.push(currentStroke);
        } else if (state.whiteboardTool === 'sticky') {
          const rect = viewport.getBoundingClientRect();
          const zoom = state.canvasZoom || 1.0;
          const pan = state.canvasPan || { x: 0, y: 0 };
          const posX = Math.round((e.clientX - rect.left - pan.x) / zoom);
          const posY = Math.round((e.clientY - rect.top - pan.y) / zoom);

          if (!state.penechoState.stickies) state.penechoState.stickies = [];
          state.penechoState.stickies.push({
            id: 'sticky_' + Date.now(),
            x: posX,
            y: posY,
            text: 'Type notes here...',
            color: '#FEF08A'
          });
          state.whiteboardTool = 'select';
          saveCanvasState();
          renderPenechoSpatialView();
        } else if (state.whiteboardTool === 'box') {
          const rect = viewport.getBoundingClientRect();
          const zoom = state.canvasZoom || 1.0;
          const pan = state.canvasPan || { x: 0, y: 0 };
          const posX = Math.round((e.clientX - rect.left - pan.x) / zoom);
          const posY = Math.round((e.clientY - rect.top - pan.y) / zoom);

          if (!state.penechoState.canvas) state.penechoState.canvas = { elements: [] };
          state.penechoState.canvas.elements.push({
            type: 'draw_box',
            id: 'box_' + Date.now(),
            x: posX,
            y: posY,
            w: 140,
            h: 70,
            color: '#3B82F6',
            title: 'Concept Box'
          });
          state.whiteboardTool = 'select';
          saveCanvasState();
          renderPenechoSpatialView();
        }
      };

      viewport.onmousemove = (e) => {
        if (isDrawing && currentStroke) {
          const rect = viewport.getBoundingClientRect();
          const zoom = state.canvasZoom || 1.0;
          const pan = state.canvasPan || { x: 0, y: 0 };
          const pt = {
            x: Math.round((e.clientX - rect.left - pan.x) / zoom),
            y: Math.round((e.clientY - rect.top - pan.y) / zoom)
          };
          currentStroke.points.push(pt);
          updateWhiteboardSVG();
        }
      };

      viewport.onmouseup = () => {
        if (isDrawing) {
          isDrawing = false;
          currentStroke = null;
          saveCanvasState();
        }
      };
    }

    const copyCodeBtn = viewEl.querySelector('.mn-btn-copy-code');
    if (copyCodeBtn) {
      copyCodeBtn.onclick = () => {
        const jsonStr = JSON.stringify(data, null, 2);
        navigator.clipboard.writeText(jsonStr).then(() => {
          showToast('📋 Canvas JSON copied to clipboard ✓');
        });
      };
    }

    const demoBtn = viewEl.querySelector('.mn-wb-btn-demo, .mn-btn-load-demo');
    if (demoBtn) demoBtn.onclick = loadPenechoDemo;

    const clearBtn = viewEl.querySelector('.mn-btn-clear-canvas, .mn-wb-btn-clear');
    if (clearBtn) clearBtn.onclick = clearPenechoCanvas;

    const acceptBtn = viewEl.querySelector('.mn-btn-accept-draft');
    if (acceptBtn) acceptBtn.onclick = acceptPenechoDraft;

    const discardBtn = viewEl.querySelector('.mn-btn-discard-draft');
    if (discardBtn) discardBtn.onclick = discardPenechoDraft;

    if (subTab !== 'code' && subTab !== 'timeline') {
      updateWhiteboardSVG();
      if (subTab === 'mindmap') {
        startMindMapPhysics();
      }
    }
  }

  /* ═══════════════════════════════════════
     RENDER SETTINGS PANEL
     ═══════════════════════════════════════ */
  function renderSettingsPanel() {
    const pane = ui.dr?.querySelector('[data-pane="settings"]');
    if (!pane) return;

    pane.innerHTML = `
      <div class="mn-settings-pane-wrap" style="padding:16px;display:flex;flex-direction:column;gap:16px;">
        <!-- Card 1: PenEcho Spatial Canvas Engine -->
        <div class="mn-spatial-copilot-card">
          <div class="mn-spatial-hdr-row">
            <div class="mn-spatial-title">
              <span style="font-size:18px;">🎨</span>
              <span>PenEcho Spatial Canvas</span>
            </div>
            <span class="mn-spatial-badge active">
              ● Native Engine Active
            </span>
          </div>

          <div class="mn-spatial-desc">
            Directly renders Claude's <strong>penecho-canvas.json</strong> code files, LaTeX mathematical formulas, dynamic 5-color mind maps, and running timelines with zero external API dependencies.
          </div>

          <!-- Toggle Row -->
          <div class="mn-spatial-toggle-bar">
            <div>
              <div class="mn-spatial-toggle-label">Auto Live-Sync from Chat</div>
              <div style="font-size:11px;color:#6B7280;">Instantly render canvas code files emitted by Claude</div>
            </div>
            <input type="checkbox" class="mn-tgl mn-settings-livesync-toggle" ${state.liveSyncEnabled ? 'checked' : ''} />
          </div>

          <!-- Actions Row -->
          <div class="mn-spatial-actions-row" style="margin-top:6px;">
            <button class="mn-btn mn-btn-p mn-settings-inject-prompt" style="flex:1;">⚡ Inject Canvas Prompt</button>
            <button class="mn-btn mn-btn-sim mn-settings-load-demo" style="flex:1;">✨ Load Sample Canvas</button>
          </div>
        </div>

        <!-- Card 2: Never-Save Rules -->
        <div style="border:3px solid #1A1A2E;border-radius:12px;padding:14px;background:#FFFFFF;box-shadow:3px 3px 0px #1A1A2E;">
          <div style="font-weight:700;font-size:14px;color:#1A1A2E;margin-bottom:4px;">🛑 Never-Save Rules</div>
          <div style="font-size:12px;color:#4B5563;margin-bottom:10px;">Keywords or natural rules for topics Claude must never remember.</div>
          <div class="mn-rules-inp-row" style="display:flex;gap:6px;margin-bottom:10px;">
            <input class="mn-rules-inp" type="text" placeholder="e.g. Never remember salary details" maxlength="80" style="flex:1;padding:8px;border:2px solid #1A1A2E;border-radius:8px;font-size:12px;" />
            <button class="mn-rules-add" style="padding:8px 14px;border:2px solid #1A1A2E;background:var(--mn-pink);border-radius:8px;font-weight:700;cursor:pointer;font-size:12px;">Add</button>
          </div>
          <div class="mn-rules-list"></div>
        </div>

        <!-- Card 3: Memory Freeze & Snapshots -->
        <div style="border:3px solid #1A1A2E;border-radius:12px;padding:14px;background:#FFFFFF;box-shadow:3px 3px 0px #1A1A2E;">
          <div style="font-weight:700;font-size:14px;color:#1A1A2E;margin-bottom:4px;">❄️ Memory Freeze &amp; Snapshots</div>
          <div style="font-size:12px;color:#4B5563;margin-bottom:10px;">Freeze current memory state or restore previous memory snapshots.</div>
          <div class="mn-snaps-inp-row" style="display:flex;gap:6px;margin-bottom:10px;">
            <input class="mn-rules-inp mn-snaps-inp" type="text" placeholder="Snapshot label" maxlength="40" style="flex:1;padding:8px;border:2px solid #1A1A2E;border-radius:8px;font-size:12px;" />
            <button class="mn-rules-add mn-snaps-add" style="padding:8px 14px;border:2px solid #1A1A2E;background:var(--mn-blue);border-radius:8px;font-weight:700;cursor:pointer;font-size:12px;">Freeze</button>
          </div>
          <div class="mn-snaps-list"></div>
        </div>
      </div>
    `;

    // Rebind rules and snapshots lists
    ui.rulesList = pane.querySelector('.mn-rules-list');
    ui.snapsList = pane.querySelector('.mn-snaps-list');
    renderRulesPanel();
    renderSnapshotsPanel();

    const livesyncTgl = pane.querySelector('.mn-settings-livesync-toggle');
    if (livesyncTgl) {
      livesyncTgl.onchange = () => {
        state.liveSyncEnabled = livesyncTgl.checked;
        showToast(livesyncTgl.checked ? '⚡ Auto Live-Sync Enabled ✓' : 'Auto Live-Sync Disabled');
      };
    }

    const injectBtn = pane.querySelector('.mn-settings-inject-prompt');
    if (injectBtn) injectBtn.onclick = injectSpatialPromptToClaude;

    const demoBtn = pane.querySelector('.mn-settings-load-demo');
    if (demoBtn) {
      demoBtn.onclick = () => {
        loadPenechoDemo();
        openTab('canvas');
      };
    }

    // Bind Rules Add
    const inp = pane.querySelector('.mn-rules-inp');
    const rulesAddBtn = pane.querySelector('.mn-rules-add');
    if (rulesAddBtn && inp) {
      rulesAddBtn.addEventListener('click', () => {
        addRule(inp.value);
        inp.value = '';
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { addRule(inp.value); inp.value = ''; }
      });
    }

    // Bind Snapshot Add
    const snapInp = pane.querySelector('.mn-snaps-inp');
    const snapsAddBtn = pane.querySelector('.mn-snaps-add');
    if (snapsAddBtn && snapInp) {
      snapsAddBtn.addEventListener('click', () => {
        createSnapshot(snapInp.value);
        snapInp.value = '';
      });
    }
  }

  /* ═══════════════════════════════════════
     RENDER ALL
     ═══════════════════════════════════════ */
  function renderAll() {
    renderGlobalMemory();
    renderLocalMemory();
    renderRulesPanel();
    renderSnapshotsPanel();
    renderSettingsPanel();
    renderPenechoSpatialView();
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

    // 💼 Work & Projects check
    if (
      /\b(?:work|job|company|project|client|task|sprint|deadline|meeting|salary|resume|career|office|team|manager|boss)\b/i.test(lower)
    ) {
      return 'work';
    }

    // 💻 Coding & Tech check
    if (
      text.includes('```') ||
      /\b(?:function|const|let|var|import|export|class|def|return|async|await|select-string|powershell|bash|npm|git|html|css|javascript|python|java|c\+\+|sql|json|api|endpoint|bug|fix|code)\b/i.test(text) ||
      /[{}<>;=]\s*[{}<>;=]/.test(text) ||
      /\b(?:if|else|for|while|try|catch)\s*\(/.test(text)
    ) {
      return 'coding';
    }

    // 🩺 Health & Wellbeing check
    if (
      /\b(?:health|medical|doctor|workout|gym|fitness|diet|sleep|exercise|medication|hospital|blood|weight|energy|mental|habit|routine)\b/i.test(lower)
    ) {
      return 'health';
    }

    // ❤️ Relationships & Family check
    if (
      /\b(?:family|friend|relationship|married|dating|parent|sister|brother|son|daughter|partner|anniversary|gift|love|wife|husband|mother|father)\b/i.test(lower)
    ) {
      return 'relationships';
    }

    // 📚 Research & Knowledge check
    if (
      /https?:\/\/\S+/i.test(text) ||
      /\b(?:http|www|github\.com|wikipedia|doi|paper|research|documentation|reference|source|study|citation|according to|article|book|link)\b/i.test(lower)
    ) {
      return 'research';
    }

    // 💬 Personal & Profile check
    if (
      /\b(?:my\s+(?:name|birthday|age|location|city|address|hobbies|hobby|favorite|pet|dog|cat|phone|email))\b/i.test(lower) ||
      /\b(?:i\s+(?:live|love|hate|prefer|enjoy|dislike|am\s+feeling|am\s+a|feel|want\s+to\s+shift))\b/i.test(lower) ||
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
        '<span class="mn-details-lbl">Full Memory Content:</span>' +
        '<div class="mn-details-txt">' + esc(m.text) + '</div>' +
        '</div>' +

        '<div class="mn-details-sec">' +
        '<span class="mn-details-lbl">Source Chat Link:</span>' +
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
      (cat === 'coding' ? '<button class="mn-copy-snippet-btn" data-id="' + m.id + '" data-act="copy-snippet" title="Copy code snippet">Copy Snippet</button>' : '') +
      '</div>' +
      contentHTML +
      (cat === 'research' && domainTag ? '<div class="mn-citation-tag">Citation: ' + esc(domainTag) + '</div>' : '') +
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

  // Separate state for Global and Current Session memory panels
  // Open states for category lists (Global vs Current Session)
  // Navigation State Objects for Global and Current Session panels
  const navStateGlobal = { activeCategory: null, activeMemoryId: null };
  const navStateLocal = { activeCategory: null, activeMemoryId: null };

  // Shared helper: render Memory panel (Global or Current Session) with full-page drill-down navigation
  function renderMemoryPanel(p, memories, panelType) {
    if (!p) return;

    const nav = panelType === 'global' ? navStateGlobal : navStateLocal;

    if (memories.length === 0) {
      p.innerHTML =
        '<div class="mn-empty">' +
        IC.vault +
        '<div class="mn-empty-t">No ' + (panelType === 'global' ? 'Global' : 'Current Session') + ' memories yet</div>' +
        '<div class="mn-empty-s">' +
        (panelType === 'global'
          ? 'Memories stored without a domain restriction appear here. They apply across all sites.'
          : 'Memories scoped to <strong>' + location.hostname + '</strong> for this session appear here.') +
        '</div></div>';
      return;
    }

    const categoriesMap = {
      work: { title: 'Work & Projects', icon: IC.wipSign, items: [] },
      coding: { title: 'Coding & Tech', icon: IC.cppLogo, items: [] },
      personal: { title: 'Personal & Profile', icon: IC.personAvatar, items: [] },
      health: { title: 'Health & Wellbeing', icon: IC.healthCross, items: [] },
      relationships: { title: 'Relationships & Family', icon: IC.familyHeart, items: [] },
      research: { title: 'Research & Knowledge', icon: IC.researchAtom, items: [] },
      general: { title: 'General Vault', icon: IC.safeVault, items: [] }
    };

    memories.forEach((m) => {
      const cat = getMemoryCategory(m.text);
      (categoriesMap[cat] || categoriesMap.general).items.push(m);
    });

    // ── LEVEL 3: SINGLE MEMORY FULL DETAILS VIEW ──
    if (nav.activeMemoryId !== null) {
      const m = memories.find((x) => x.id === nav.activeMemoryId);
      if (!m) {
        nav.activeMemoryId = null;
        renderMemoryPanel(p, memories, panelType);
        return;
      }

      const catKey = getMemoryCategory(m.text);
      const catObj = categoriesMap[catKey] || categoriesMap.general;
      const isEditing = activeEdits.has(m.id);

      let histHTML = '';
      if (m.history && m.history.length > 0) {
        histHTML =
          '<div class="mn-hist-panel">' +
          '<div style="font-weight:700;font-size:12px;margin-bottom:8px;">📜 Version History</div>' +
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

      let contentDisplay = '';
      if (isEditing) {
        contentDisplay =
          '<div style="margin-bottom:12px;">' +
          '<textarea class="mn-card-edit-area" data-id="' + m.id + '" style="width:100%;height:120px;padding:10px;border:2px solid #1A1A2E;border-radius:10px;font-family:inherit;font-size:13px;box-shadow:2px 2px 0px #1A1A2E;">' + esc(m.text) + '</textarea>' +
          '<div style="display:flex;gap:8px;margin-top:8px;">' +
          '<button class="mn-btn mn-btn-k" data-act="save-edit" data-id="' + m.id + '" style="flex:1;">Save</button>' +
          '<button class="mn-btn mn-btn-d" data-act="cancel-edit" data-id="' + m.id + '" style="flex:1;">Cancel</button>' +
          '</div></div>';
      } else {
        contentDisplay =
          '<div style="background:#FFFFFF;border:3px solid #1A1A2E;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:3px 3px 0px #1A1A2E;">' +
          '<div style="font-size:13.5px;line-height:1.6;color:#1F2937;white-space:pre-wrap;word-break:break-word;">' + esc(m.text) + '</div>' +
          '</div>';
      }

      p.innerHTML =
        '<div style="padding:14px;display:flex;flex-direction:column;gap:14px;">' +
        // Back Header
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
        '<button class="mn-sq-back-btn" data-act="back-to-cat" style="margin-bottom:0;">← Back</button>' +
        '<span class="mn-cat-badge mn-cat-badge-' + catKey + '">' + catKey + '</span>' +
        '</div>' +

        '<div style="font-size:16px;font-weight:700;color:#1A1A2E;">📌 Memory Details</div>' +

        contentDisplay +

        (m.url ? '<div style="font-size:11px;color:#6B7280;margin-bottom:8px;">Source: <a href="' + esc(m.url) + '" target="_blank" style="color:#2563EB;">' + esc(m.url) + '</a></div>' : '') +

        // Details Grid & Duration
        '<div class="mn-details-grid">' +
        '<div class="mn-details-item">' +
        '<span class="mn-details-sublbl">Captured At:</span>' +
        '<span>' + new Date(m.keptAt || m.timestamp).toLocaleString() + '</span>' +
        '</div>' +
        '<div class="mn-details-item">' +
        '<span class="mn-details-sublbl">Scope:</span>' +
        '<span>' + (panelType === 'global' ? '🌐 Global' : '💬 Current Session') + '</span>' +
        '</div>' +
        '<div class="mn-details-item" style="grid-column: span 2">' +
        '<span class="mn-details-sublbl">Memory Duration:</span>' +
        '<select class="mn-decay-select" data-id="' + m.id + '" style="padding:6px 10px;border-radius:8px;border:2px solid #1A1A2E;font-size:12px;font-weight:700;">' +
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

        // Action buttons
        '<div style="display:flex;gap:8px;margin-top:10px;">' +
        (!isEditing ? '<button class="mn-btn mn-btn-e" data-act="edit" data-id="' + m.id + '" style="flex:1;">Edit Memory</button>' : '') +
        '<button class="mn-btn mn-btn-d" data-act="del" data-id="' + m.id + '" style="flex:1;">Delete Memory</button>' +
        '</div>' +
        '</div>';

      // Event handlers for Level 3
      const backCatBtn = p.querySelector('[data-act="back-to-cat"]');
      if (backCatBtn) {
        backCatBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          nav.activeMemoryId = null;
          renderMemoryPanel(p, memories, panelType);
        });
      }

      const sel = p.querySelector('.mn-decay-select');
      if (sel) {
        sel.addEventListener('change', (e) => {
          updateKept(m.id, { decayTier: sel.value });
        });
      }

      const delBtn = p.querySelector('[data-act="del"]');
      if (delBtn) {
        delBtn.addEventListener('click', () => {
          deleteKept(m.id);
          nav.activeMemoryId = null;
          renderMemoryPanel(p, memories, panelType);
        });
      }

      const editBtn = p.querySelector('[data-act="edit"]');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          activeEdits.add(m.id);
          renderMemoryPanel(p, memories, panelType);
        });
      }

      const saveBtn = p.querySelector('[data-act="save-edit"]');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const area = p.querySelector('textarea[data-id="' + m.id + '"]');
          if (area && area.value.trim()) {
            activeEdits.delete(m.id);
            updateKept(m.id, area.value.trim());
            renderMemoryPanel(p, memories, panelType);
          }
        });
      }

      const cancelBtn = p.querySelector('[data-act="cancel-edit"]');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          activeEdits.delete(m.id);
          renderMemoryPanel(p, memories, panelType);
        });
      }

      p.querySelectorAll('[data-act="revert"]').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const verIdx = parseInt(b.dataset.ver, 10);
          if (m && m.history && m.history[verIdx]) {
            updateKept(m.id, m.history[verIdx].text);
            renderMemoryPanel(p, memories, panelType);
          }
        })
      );
      return;
    }

    // ── LEVEL 2: SELECTED CATEGORY PAGE ──
    if (nav.activeCategory !== null) {
      const catKey = nav.activeCategory;
      const catObj = categoriesMap[catKey] || categoriesMap.general;
      const catItems = catObj.items;

      let cardsHTML = '';
      if (catItems.length > 0) {
        cardsHTML = catItems.map((m) => {
          const domainTag = getDomainFromUrl(m.url);
          return (
            '<div class="mn-scrapbook-card mn-cat-' + catKey + '" data-id="' + m.id + '" data-act="open-memory-detail" style="margin-bottom:10px;cursor:pointer;">' +
            '<div class="mn-card-snippet-text">' + esc(truncate(m.text, 160)) + '</div>' +
            (catKey === 'research' && domainTag ? '<div class="mn-citation-tag">Citation: ' + esc(domainTag) + '</div>' : '') +
            '<div class="mn-card-meta-bar" style="margin-top:8px;padding-top:6px;border-top:1px solid #E5E7EB;">' +
            '<span class="mn-card-time">' + timeAgo(m.keptAt || m.timestamp) + '</span>' +
            '</div>' +
            '</div>'
          );
        }).join('');
      } else {
        cardsHTML = '<div class="mn-empty" style="padding:20px 0;"><div class="mn-empty-t" style="font-size:13px">No memories saved yet</div></div>';
      }

      p.innerHTML =
        '<div style="padding:14px;display:flex;flex-direction:column;gap:12px;">' +
        '<div style="display:flex;align-items:center;margin-bottom:4px;">' +
        '<button class="mn-sq-back-btn" data-act="back-to-all-cats" style="margin-bottom:0;">← Back</button>' +
        '</div>' +

        '<div class="mn-cat-items-list">' + cardsHTML + '</div>' +
        '</div>';

      // Event Handlers for Level 2
      const backAllBtn = p.querySelector('[data-act="back-to-all-cats"]');
      if (backAllBtn) {
        backAllBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          nav.activeCategory = null;
          nav.activeMemoryId = null;
          renderMemoryPanel(p, memories, panelType);
        });
      }

      p.querySelectorAll('[data-act="open-memory-detail"]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.dataset.id || btn.closest('.mn-scrapbook-card')?.dataset.id;
          if (id) {
            nav.activeMemoryId = id;
            renderMemoryPanel(p, memories, panelType);
          }
        });
      });

      p.querySelectorAll('.mn-card-select-cb').forEach((cb) => {
        cb.addEventListener('change', (e) => {
          e.stopPropagation();
          const id = cb.dataset.id;
          if (cb.checked) selectedKeptIds.add(id);
          else selectedKeptIds.delete(id);
          renderMemoryPanel(p, memories, panelType);
        });
      });

      p.querySelectorAll('[data-act="copy-snippet"]').forEach((b) => {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const mem = memories.find((m) => m.id === b.dataset.id);
          if (mem) {
            navigator.clipboard.writeText(mem.text);
            showToast('Code snippet copied to clipboard 📋');
          }
        });
      });

      const copyAllBtn = p.querySelector('[data-act="copy-all-coding"]');
      if (copyAllBtn) {
        copyAllBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const codingTexts = catItems.map((m) => m.text).join('\n\n// ─── Snippet ───\n');
          if (codingTexts) {
            navigator.clipboard.writeText(codingTexts);
            showToast('All coding snippets copied to clipboard 📋');
          }
        });
      }
      return;
    }

    // ── LEVEL 1: CATEGORY FOLDERS VIEW (DEFAULT) ──
    const folderCardsHTML = Object.keys(categoriesMap).map((catKey) => {
      const category = categoriesMap[catKey];
      const count = category.items.length;

      return (
        '<div class="mn-category-folder-card" data-cat="' + catKey + '" style="background:#FFFFFF;border:3px solid #1A1A2E;border-radius:14px;padding:14px 16px;cursor:pointer;transition:all 0.15s ease;box-shadow:3px 3px 0px #1A1A2E;display:flex;align-items:center;justify-content:space-between;">' +
        '<div style="display:flex;align-items:center;gap:12px;">' +
        '<span style="font-size:22px;">' + category.icon + '</span>' +
        '<div>' +
        '<div style="font-size:14px;font-weight:700;color:#1A1A2E;letter-spacing:-0.2px;">' + category.title + '</div>' +
        '<div style="font-size:11px;color:#6B7280;margin-top:2px;">' + count + ' memory item' + (count === 1 ? '' : 's') + '</div>' +
        '</div>' +
        '</div>' +
        '<span style="font-size:14px;font-weight:700;color:#1A1A2E;">→</span>' +
        '</div>'
      );
    }).join('');

    p.innerHTML =
      '<div style="padding:14px;display:flex;flex-direction:column;gap:12px;">' +
      '<div style="font-size:12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;">Select Classification</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' + folderCardsHTML + '</div>' +
      '</div>';

    p.querySelectorAll('.mn-category-folder-card').forEach((card) => {
      card.addEventListener('click', () => {
        const catKey = card.dataset.cat;
        nav.activeCategory = catKey;
        renderMemoryPanel(p, memories, panelType);
      });
    });

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

  // Global Memory = default panel for all kept memories unless explicitly set to 'local'
  function renderGlobalMemory() {
    const globalMems = state.kept.filter((m) => m.scope !== 'local');
    renderMemoryPanel(ui.globalMemory, globalMems, 'global');
  }

  // Current Session Memory = memories explicitly moved/scoped to 'local'
  function renderLocalMemory() {
    const localMems = state.kept.filter((m) => m.scope === 'local');
    renderMemoryPanel(ui.currentSession || ui.localMemory, localMems, 'local');
  }

  function renderCurrentSession() {
    renderLocalMemory();
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
      if (btn) {
        btn.style.display = 'flex';
        btn.style.top = Math.min(rect.bottom + 10, window.innerHeight - 50) + 'px';
        btn.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - 72, window.innerWidth - 160)) + 'px';
      }
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

    let role = 'user';
    try {
      const anchor = sel.anchorNode?.parentElement;
      if (anchor) {
        const el = anchor.closest
          ? anchor.closest('[class*="claude"], [class*="assistant"], [class*="response"], [data-is-streaming], .font-claude-message, [class*="Agent"], [class*="bot"]')
          : null;
        if (el) role = 'assistant';
      }
    } catch (_) { }

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
    try { window.getSelection()?.removeAllRanges(); } catch (_) { }
  }

  /* ═══════════════════════════════════════
     AUTO-NOTICE & CLAUDE MEMORY DETECTION
     ═══════════════════════════════════════ */

  function injectHostCSS() {
    if (document.getElementById('mn-host-styles')) return;
    const style = document.createElement('style');
    style.id = 'mn-host-styles';
    style.textContent = `
      .mn-purple-memory-border {
        border: 2px solid #8B5CF6 !important;
        border-radius: 12px !important;
        box-shadow: none !important;
        position: relative !important;
        padding: 8px 12px !important;
        transition: all 0.3s ease !important;
      }
      .mn-blue-memory-border {
        border: 2px solid #3B82F6 !important;
        border-radius: 12px !important;
        box-shadow: none !important;
        position: relative !important;
        padding: 8px 12px !important;
        transition: all 0.3s ease !important;
      }
      .mn-red-memory-border {
        border: 2px solid #EF4444 !important;
        border-radius: 12px !important;
        box-shadow: none !important;
        position: relative !important;
        padding: 8px 12px !important;
        transition: all 0.3s ease !important;
      }
      .mn-inline-memory-prompt {
        margin: 10px 0 !important;
        padding: 12px 14px !important;
        border-radius: 10px !important;
        background: #FFFFFF !important;
        border: 2px solid #1A1A2E !important;
        box-shadow: 3px 3px 0px #1A1A2E !important;
        font-family: 'Space Grotesk', -apple-system, sans-serif !important;
        font-size: 12.5px !important;
        color: #1A1A2E !important;
        z-index: 9999 !important;
        display: block !important;
      }
      .mn-prompt-hdr {
        font-weight: 700 !important;
        font-size: 13px !important;
        margin-bottom: 4px !important;
        color: #1A1A2E !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
      }
      .mn-prompt-body {
        font-size: 12px !important;
        color: #4B5563 !important;
        margin-bottom: 8px !important;
        line-height: 1.4 !important;
      }
      .mn-prompt-snippet-box {
        background: #F0F8FF !important;
        border: 2px solid #1A1A2E !important;
        border-radius: 8px !important;
        padding: 8px 10px !important;
        font-size: 12px !important;
        color: #1A1A2E !important;
        font-family: monospace !important;
        word-break: break-word !important;
        margin-bottom: 8px !important;
      }
      .mn-prompt-acts {
        display: flex !important;
        gap: 6px !important;
        flex-wrap: wrap !important;
      }
      .mn-prompt-btn {
        padding: 4px 10px !important;
        border-radius: 6px !important;
        border: 2px solid #1A1A2E !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        box-shadow: 2px 2px 0px #1A1A2E !important;
        background: #FFFFFF !important;
        color: #1A1A2E !important;
        font-family: 'Space Grotesk', sans-serif !important;
        text-transform: uppercase !important;
        transition: all 0.15s ease !important;
      }
      .mn-prompt-btn:hover {
        transform: translate(-1px, -1px) !important;
        box-shadow: 3px 3px 0px #1A1A2E !important;
      }
      .mn-prompt-accept {
        background: #FF85C8 !important;
        color: #FFFFFF !important;
      }
      .mn-prompt-accept:hover {
        background: #FF69B4 !important;
      }
      .mn-prompt-kept {
        background: #A8E6F0 !important;
      }
      .mn-prompt-reject {
        background: #FEE2E2 !important;
        color: #991B1B !important;
        border-color: #991B1B !important;
      }
      .mn-prompt-edit-wrap textarea {
        width: 100% !important;
        min-height: 60px !important;
        padding: 6px 8px !important;
        border-radius: 6px !important;
        border: 2px solid #1A1A2E !important;
        font-family: monospace !important;
        font-size: 12px !important;
        color: #1A1A2E !important;
        background: #FFFFFF !important;
        box-sizing: border-box !important;
        margin-bottom: 8px !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ── Tier 1: Claude Memory Saved detection ──
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

  // ── Tier 3: Private Information Leak detection ──
  const PRIVATE_INFO_PATTERNS = [
    /\b(?:\d{4}[\s-]?){3}\d{4}\b/,
    /\b\d{3}[\s-]?\d{2}[\s-]?\d{4}\b/,
    /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/i,
    /\b(?:api[_\s-]?key|secret[_\s-]?key|access[_\s-]?token|auth[_\s-]?token)\s*[:=]\s*\S+/i,
    /\b[A-Za-z]{2}\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{0,2}\b/,
    /\b(?:sk|pk|rk)[-_](?:live|test)[-_][a-zA-Z0-9]{20,}\b/,
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/,
    /\bAIza[0-9A-Za-z\-_]{35}\b/,
    /\b(?:bank\s*account|routing\s*number|account\s*number)\s*[:=]?\s*\d+/i,
    /\b(?:cvv|cvc|security\s+code)\s*[:=]?\s*\d{3,4}\b/i,
  ];

  function classifyMessage(text, role) {
    if (!text || text.length < 5) return { type: null };
    const lower = text.toLowerCase();

    // ── Case 1: Suspicious / Private Information Leak (RED BOUNDARY BOX) ──
    const suspiciousWords = [
      'password', 'secret key', 'api key', 'credit card', 'ssn',
      'social security', 'bank account', 'private key', 'auth token', 'suspicious'
    ];
    for (const w of suspiciousWords) {
      if (lower.includes(w)) {
        return {
          type: 'private_leak',
          label: '🚨 Suspicious Data Warning',
          description: 'Private/suspicious information was detected in this message.',
        };
      }
    }

    // ── Case 2: Claude Saved a Memory by Himself in Chat (RED BOUNDARY BOX) ──
    if (role === 'assistant') {
      const memoryWords = [
        'remember', 'noted', 'saved', 'memory', 'memories',
        'keep in mind', 'got it', 'profile', 'updating'
      ];
      for (const w of memoryWords) {
        if (lower.includes(w)) {
          return {
            type: 'claude_memory',
            label: '🧠 Claude Saved Memory',
            description: 'Claude has saved a memory from this conversation by himself.',
          };
        }
      }
    }

    // No box for normal messages
    return { type: null };
  }

  function scanAndPromptClaudeMemories() {
    if (!state.collectionEnabled) return;
    injectHostCSS();

    // ── Find ALL ASSISTANT message elements ──
    const assistantSelectors = [
      '[data-message-author-role="assistant"]',
      '.font-claude-response',
      '.font-claude-message',
      '[class*="assistant-message"]',
      '[class*="assistantMessage"]',
      '[class*="font-claude"]',
      '[data-is-streaming]',
      '[data-testid*="assistant"]',
      '[data-testid*="response"]',
      '.prose'
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

    // ── Find ALL USER message elements ──
    const userSelectors = [
      '[data-message-author-role="user"]',
      '[class*="user-message"]',
      '[class*="userMessage"]',
      '[class*="human-message"]',
      '[class*="humanMessage"]',
      '[class*="font-user"]',
      'div[class*="UserMessage"]',
      '[data-testid*="user"]'
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

    const topAssistantContainers = Array.from(assistantContainersSet).filter(c => {
      let p = c.parentElement;
      while (p) { if (assistantContainersSet.has(p)) return false; p = p.parentElement; }
      return true;
    });

    // Process assistant messages (check if Claude saved a memory by himself & trigger Spatial Canvas)
    topAssistantContainers.forEach((container) => {
      const text = container.textContent.trim();

      // If inline PenEcho protocol JSON or canvas code is emitted directly by Claude
      const directJson = parsePenechoJson(text);
      if (directJson) {
        applyPenechoCanvasPayload(directJson, false);
      } else if (state.liveSyncEnabled && !container.dataset.mnCanvasDrawn) {
        container.dataset.mnCanvasDrawn = 'true';
        renderClaudeMessageToCanvas(text);
      }

      if (container.dataset.mnPrompted === 'true' || container.querySelector('.mn-inline-memory-prompt')) {
        return;
      }

      const result = classifyMessage(text, 'assistant');
      if (!result.type) return;

      let snippet = text.slice(0, 400);
      const lastDot = snippet.lastIndexOf('. ');
      if (lastDot > 100) snippet = snippet.slice(0, lastDot + 1);

      container.dataset.mnPrompted = 'true';
      const cleanSnippet = snippet.trim();
      highlightAndPromptClaudeMemory(container, cleanSnippet, result);

      // Auto-add to state.noticed as candidate memory
      addNoticed({
        id: uid(),
        text: cleanSnippet,
        role: 'assistant',
        source: location.hostname,
        url: location.href,
        timestamp: Date.now(),
      });
    });

    const topUserContainers = Array.from(userContainersSet).filter(c => {
      let p = c.parentElement;
      while (p) { if (userContainersSet.has(p)) return false; p = p.parentElement; }
      return true;
    });

    // Process user messages
    topUserContainers.forEach((container) => {
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
      const cleanSnippet = snippet.trim();
      highlightAndPromptClaudeMemory(container, cleanSnippet, result);

      // Auto-add to state.noticed as candidate memory
      addNoticed({
        id: uid(),
        text: cleanSnippet,
        role: 'user',
      });
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

    const borderClass = classification.type === 'private_leak'
      ? 'mn-red-memory-border'
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
          '<button class="mn-prompt-btn mn-prompt-spatial-draw" title="Render to PenEcho Spatial Canvas">🎨 Render to Spatial Canvas</button>' +
          '<button class="mn-prompt-btn mn-prompt-kept" title="View stored details or change options">Options</button>' +
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

        const drawBtn = promptEl.querySelector('.mn-prompt-spatial-draw');
        if (drawBtn) {
          drawBtn.onclick = (e) => {
            e.stopPropagation();
            openTab('canvas');
            renderClaudeMessageToCanvas(currentSnippet, true);
          };
        }

        promptEl.querySelector('.mn-prompt-kept').onclick = (e) => {
          e.stopPropagation();
          renderBannerStep('options');
        };
        return;
      }

      if (step === 'options') {
        const msgTitle = currentSnippet.split('\n')[0].trim().slice(0, 70) + (currentSnippet.length > 70 ? '...' : '');

        promptEl.innerHTML =
          '<div class="mn-prompt-hdr"><span>' + classification.label + '</span></div>' +
          '<div class="mn-prompt-body" style="font-weight:600;color:#111827;margin:6px 0 8px 0;font-size:13px;">' +
          '📌 Title: ' + esc(msgTitle) +
          '</div>' +
          '<div class="mn-prompt-acts" style="margin-top:8px">' +
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
            try { port.disconnect(); } catch (_) { }
          } else if (msg.type === 'ERROR') {
            console.error('[MemoNeg LLM Error]:', msg.error);
            if (onError) onError(new Error(msg.error));
            try { port.disconnect(); } catch (_) { }
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
