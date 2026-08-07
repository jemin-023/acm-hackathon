/*  ═══════════════════════════════════════════════════════
    MemoNeg — Background Service Worker
    Handles storage CRUD (chrome.storage.local / session)
    and message routing for content scripts.
    ═══════════════════════════════════════════════════════ */

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('memoneg_kept', (r) => {
    if (!r.memoneg_kept) chrome.storage.local.set({ memoneg_kept: [] });
  });
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  chrome.storage.session.set({ memoneg_noticed: [] });
});

// Also init session storage on service worker startup (survives restarts)
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
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
    chrome.storage.local.get('memoneg_kept', (r) => {
      respond({ kept: r.memoneg_kept || [] });
    });
  },

  ADD_KEPT(msg, respond) {
    chrome.storage.local.get('memoneg_kept', (r) => {
      const kept = r.memoneg_kept || [];
      kept.unshift(msg.memory);
      chrome.storage.local.set({ memoneg_kept: kept }, () => {
        respond({ success: true, kept });
      });
    });
  },

  DELETE_KEPT(msg, respond) {
    chrome.storage.local.get('memoneg_kept', (r) => {
      const kept = (r.memoneg_kept || []).filter((m) => m.id !== msg.id);
      chrome.storage.local.set({ memoneg_kept: kept }, () => {
        respond({ success: true, kept });
      });
    });
  },

  UPDATE_KEPT(msg, respond) {
    chrome.storage.local.get('memoneg_kept', (r) => {
      const kept = r.memoneg_kept || [];
      const idx = kept.findIndex((m) => m.id === msg.id);
      if (idx !== -1) {
        const item = kept[idx];
        const history = item.history || [];
        // Save current state into history before updating
        history.unshift({ text: item.text, timestamp: Date.now() });
        kept[idx] = { ...item, text: msg.text, history, updatedAt: Date.now() };
        chrome.storage.local.set({ memoneg_kept: kept }, () => {
          respond({ success: true, kept });
        });
      } else {
        respond({ success: false, kept });
      }
    });
  },

  /* ── Noticed memories (session-scoped) ── */
  GET_NOTICED(_msg, respond) {
    chrome.storage.session.get('memoneg_noticed', (r) => {
      respond({ noticed: r.memoneg_noticed || [] });
    });
  },

  ADD_NOTICED(msg, respond) {
    chrome.storage.session.get('memoneg_noticed', (r) => {
      const noticed = r.memoneg_noticed || [];
      noticed.unshift(msg.memory);
      chrome.storage.session.set({ memoneg_noticed: noticed }, () => {
        respond({ success: true, noticed });
      });
    });
  },

  REMOVE_NOTICED(msg, respond) {
    chrome.storage.session.get('memoneg_noticed', (r) => {
      const noticed = (r.memoneg_noticed || []).filter((m) => m.id !== msg.id);
      chrome.storage.session.set({ memoneg_noticed: noticed }, () => {
        respond({ success: true, noticed });
      });
    });
  },

  EXPORT_ALL(_msg, respond) {
    chrome.storage.local.get('memoneg_kept', (r) => {
      respond({ kept: r.memoneg_kept || [] });
    });
  },

  /* ── Never-Save Rules (sync-persisted) ── */
  GET_RULES(_msg, respond) {
    chrome.storage.sync.get('memoneg_rules', (r) => {
      respond({ rules: r.memoneg_rules || [] });
    });
  },

  SET_RULES(msg, respond) {
    chrome.storage.sync.set({ memoneg_rules: msg.rules }, () => {
      respond({ success: true });
    });
  },

  /* ── Memory Freeze & Snapshots (#24) ── */
  GET_SNAPSHOTS(_msg, respond) {
    chrome.storage.local.get('memoneg_snapshots', (r) => {
      respond({ snapshots: r.memoneg_snapshots || [] });
    });
  },

  CREATE_SNAPSHOT(msg, respond) {
    chrome.storage.local.get(['memoneg_kept', 'memoneg_snapshots'], (r) => {
      const kept = r.memoneg_kept || [];
      const snapshots = r.memoneg_snapshots || [];
      const newSnapshot = {
        id: 'snap_' + Date.now().toString(36),
        name: msg.name || 'Memory Freeze ' + new Date().toLocaleDateString(),
        timestamp: Date.now(),
        keptCount: kept.length,
        kept: JSON.parse(JSON.stringify(kept)),
      };
      snapshots.unshift(newSnapshot);
      chrome.storage.local.set({ memoneg_snapshots: snapshots }, () => {
        respond({ success: true, snapshots });
      });
    });
  },

  RESTORE_SNAPSHOT(msg, respond) {
    chrome.storage.local.get('memoneg_snapshots', (r) => {
      const snapshots = r.memoneg_snapshots || [];
      const target = snapshots.find((s) => s.id === msg.id);
      if (target) {
        chrome.storage.local.set({ memoneg_kept: target.kept }, () => {
          respond({ success: true, kept: target.kept });
        });
      } else {
        respond({ success: false });
      }
    });
  },
};
