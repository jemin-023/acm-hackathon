/*  ═══════════════════════════════════════════════════════
    Memo.io — Background Service Worker
    Handles storage CRUD (chrome.storage.local / session),
    offscreen ONNX document lifecycle, and message routing.
    ═══════════════════════════════════════════════════════ */

let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('src/offscreen/offscreen.html');
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });

    if (existingContexts.length > 0) return;

    if (creatingOffscreen) {
      await creatingOffscreen;
    } else {
      creatingOffscreen = chrome.offscreen.createDocument({
        url: offscreenUrl,
        reasons: ['WORKERS'],
        justification: 'Run local INT4 ONNX LLM inference for memory negotiation',
      });
      await creatingOffscreen;
      creatingOffscreen = null;
    }
  } catch (err) {
    console.error('[Memo.io Background] Failed to create offscreen document:', err);
  }
}

// Auto-spawn offscreen document on SW start
ensureOffscreenDocument();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('memoio_kept', (r) => {
    if (!r.memoio_kept) chrome.storage.local.set({ memoio_kept: [] });
  });
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  chrome.storage.session.set({ memoio_noticed: [] });
  ensureOffscreenDocument();
});

// Also init session storage on service worker startup (survives restarts)
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  ensureOffscreenDocument();
});

chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name === 'memoio-inference') {
    await ensureOffscreenDocument();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg.type];
  if (handler) {
    handler(msg, sendResponse);
    return true; // keep channel open for async sendResponse
  }
});

const handlers = {
  /* ── Kept memories (persistent) ── */
  GET_KEPT(_msg, respond) {
    chrome.storage.local.get('memoio_kept', (r) => {
      respond({ kept: r.memoio_kept || [] });
    });
  },

  ADD_KEPT(msg, respond) {
    chrome.storage.local.get('memoio_kept', (r) => {
      const kept = r.memoio_kept || [];
      kept.unshift(msg.memory);
      chrome.storage.local.set({ memoio_kept: kept }, () => {
        respond({ success: true, kept });
      });
    });
  },

  DELETE_KEPT(msg, respond) {
    chrome.storage.local.get('memoio_kept', (r) => {
      const kept = (r.memoio_kept || []).filter((m) => m.id !== msg.id);
      chrome.storage.local.set({ memoio_kept: kept }, () => {
        respond({ success: true, kept });
      });
    });
  },

  UPDATE_KEPT(msg, respond) {
    chrome.storage.local.get('memoio_kept', (r) => {
      const kept = r.memoio_kept || [];
      const idx = kept.findIndex((m) => m.id === msg.id);
      if (idx !== -1) {
        const item = kept[idx];
        const history = item.history || [];
        // Only add to edit history if text actually changed
        if (msg.text !== undefined && msg.text !== item.text) {
          history.unshift({ text: item.text, timestamp: Date.now() });
        }
        kept[idx] = {
          ...item,
          text: msg.text !== undefined ? msg.text : item.text,
          decayTier: msg.decayTier !== undefined ? msg.decayTier : item.decayTier,
          history,
          updatedAt: Date.now()
        };
        chrome.storage.local.set({ memoio_kept: kept }, () => {
          respond({ success: true, kept });
        });
      } else {
        respond({ success: false, kept });
      }
    });
  },

  /* ── Noticed memories (session-scoped) ── */
  GET_NOTICED(_msg, respond) {
    chrome.storage.session.get('memoio_noticed', (r) => {
      respond({ noticed: r.memoio_noticed || [] });
    });
  },

  ADD_NOTICED(msg, respond) {
    chrome.storage.session.get('memoio_noticed', (r) => {
      const noticed = r.memoio_noticed || [];
      if (msg.memory?.text && noticed.some((n) => n.text === msg.memory.text)) {
        respond({ success: true, noticed });
        return;
      }
      noticed.unshift(msg.memory);
      chrome.storage.session.set({ memoio_noticed: noticed }, () => {
        respond({ success: true, noticed });
      });
    });
  },

  REMOVE_NOTICED(msg, respond) {
    chrome.storage.session.get('memoio_noticed', (r) => {
      const noticed = (r.memoio_noticed || []).filter((m) => m.id !== msg.id);
      chrome.storage.session.set({ memoio_noticed: noticed }, () => {
        respond({ success: true, noticed });
      });
    });
  },

  EXPORT_ALL(_msg, respond) {
    chrome.storage.local.get('memoio_kept', (r) => {
      respond({ kept: r.memoio_kept || [] });
    });
  },

  /* ── Never-Save Rules (sync-persisted) ── */
  GET_RULES(_msg, respond) {
    chrome.storage.sync.get('memoio_rules', (r) => {
      respond({ rules: r.memoio_rules || [] });
    });
  },

  SET_RULES(msg, respond) {
    chrome.storage.sync.set({ memoio_rules: msg.rules }, () => {
      respond({ success: true });
    });
  },

  /* ── Memory Freeze & Snapshots (#24) ── */
  GET_SNAPSHOTS(_msg, respond) {
    chrome.storage.local.get('memoio_snapshots', (r) => {
      respond({ snapshots: r.memoio_snapshots || [] });
    });
  },

  CREATE_SNAPSHOT(msg, respond) {
    chrome.storage.local.get(['memoio_kept', 'memoio_snapshots'], (r) => {
      const kept = r.memoio_kept || [];
      const snapshots = r.memoio_snapshots || [];
      const newSnapshot = {
        id: 'snap_' + Date.now().toString(36),
        name: msg.name || 'Memory Freeze ' + new Date().toLocaleDateString(),
        timestamp: Date.now(),
        keptCount: kept.length,
        kept: JSON.parse(JSON.stringify(kept)),
      };
      snapshots.unshift(newSnapshot);
      chrome.storage.local.set({ memoio_snapshots: snapshots }, () => {
        respond({ success: true, snapshots });
      });
    });
  },

  RESTORE_SNAPSHOT(msg, respond) {
    chrome.storage.local.get('memoio_snapshots', (r) => {
      const snapshots = r.memoio_snapshots || [];
      const target = snapshots.find((s) => s.id === msg.id);
      if (target) {
        chrome.storage.local.set({ memoio_kept: target.kept }, () => {
          respond({ success: true, kept: target.kept });
        });
      } else {
        respond({ success: false });
      }
    });
  },

  /* ── PenEcho Spatial Canvas State Persistence ── */
  GET_CANVAS_STATE(_msg, respond) {
    chrome.storage.local.get('memoio_canvas_state', (r) => {
      respond({ canvasState: r.memoio_canvas_state || null });
    });
  },

  SAVE_CANVAS_STATE(msg, respond) {
    chrome.storage.local.set({ memoio_canvas_state: msg.canvasState }, () => {
      respond({ success: true });
    });
  },
};
