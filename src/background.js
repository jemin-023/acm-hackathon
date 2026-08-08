/*  ═══════════════════════════════════════════════════════
    MemoNeg — Background Service Worker
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
    console.error('[MemoNeg Background] Failed to create offscreen document:', err);
  }
}

// Auto-spawn offscreen document on SW start
ensureOffscreenDocument();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('memoneg_kept', (r) => {
    if (!r.memoneg_kept) chrome.storage.local.set({ memoneg_kept: [] });
  });
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  chrome.storage.session.set({ memoneg_noticed: [] });
  ensureOffscreenDocument();
});

// Also init session storage on service worker startup (survives restarts)
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  ensureOffscreenDocument();
});

chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name === 'memoneg-inference') {
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
      if (msg.memory?.text && noticed.some((n) => n.text === msg.memory.text)) {
        respond({ success: true, noticed });
        return;
      }
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

  /* ── PenEcho Spatial Canvas State Persistence ── */
  GET_CANVAS_STATE(_msg, respond) {
    chrome.storage.local.get('memoneg_canvas_state', (r) => {
      respond({ canvasState: r.memoneg_canvas_state || null });
    });
  },

  SAVE_CANVAS_STATE(msg, respond) {
    chrome.storage.local.set({ memoneg_canvas_state: msg.canvasState }, () => {
      respond({ success: true });
    });
  },

  /* ── Gemini Spatial Canvas Drawing API ── */
  DEFAULT_GEMINI_KEY: '',

  GET_GEMINI_CONFIG(_msg, respond) {
    const defaultKey = Handlers.DEFAULT_GEMINI_KEY;
    chrome.storage.sync.get(['gemini_api_key', 'gemini_drawing_enabled', 'gemini_model'], (rSync) => {
      if (rSync && (rSync.gemini_api_key || rSync.gemini_drawing_enabled !== undefined)) {
        respond({
          geminiApiKey: rSync.gemini_api_key || defaultKey,
          geminiDrawingEnabled: rSync.gemini_drawing_enabled !== undefined ? rSync.gemini_drawing_enabled : true,
          geminiModel: rSync.gemini_model || 'gemini-2.5-flash',
        });
      } else {
        chrome.storage.local.get(['gemini_api_key', 'gemini_drawing_enabled', 'gemini_model'], (rLocal) => {
          respond({
            geminiApiKey: rLocal.gemini_api_key || defaultKey,
            geminiDrawingEnabled: rLocal.gemini_drawing_enabled !== undefined ? rLocal.gemini_drawing_enabled : true,
            geminiModel: rLocal.gemini_model || 'gemini-2.5-flash',
          });
        });
      }
    });
  },

  SET_GEMINI_CONFIG(msg, respond) {
    const data = {};
    if (msg.geminiApiKey !== undefined) data.gemini_api_key = msg.geminiApiKey;
    if (msg.geminiDrawingEnabled !== undefined) data.gemini_drawing_enabled = msg.geminiDrawingEnabled;
    if (msg.geminiModel !== undefined) data.gemini_model = msg.geminiModel;

    chrome.storage.sync.set(data, () => {
      chrome.storage.local.set(data, () => {
        respond({ success: true, ...data });
      });
    });
  },

  async CALL_GEMINI_DRAWING(msg, respond) {
    try {
      const apiKey = (msg.apiKey || '').trim() || Handlers.DEFAULT_GEMINI_KEY;
      if (!apiKey) {
        respond({ success: false, error: 'No Gemini API key configured. Please provide your Gemini API key in settings.' });
        return;
      }

      const claudeAnswer = msg.claudeAnswer || '';
      if (!claudeAnswer || typeof claudeAnswer !== 'string' || !claudeAnswer.trim()) {
        respond({ success: false, error: 'Empty Claude answer text provided.' });
        return;
      }

      const requestedModel = msg.model || 'gemini-2.5-flash';
      const modelsToTry = [
        requestedModel,
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-1.5-flash',
        'gemini-1.5-pro'
      ].filter((v, i, a) => a.indexOf(v) === i);

      const systemDirective = `You are the PenEcho Spatial Canvas Engine. Your job is to convert the conversational answer given by Claude into a rich, structured, 3-stream live spatial thinking board.
Adhere strictly to the PenEcho Spatial Canvas Protocol:
1. Strict 5-Color Taxonomy:
- 🟢 Green "#22C55E" (safe_memory): Long-term memory / verified architecture decisions / safe facts.
- 🟡 Yellow "#EAB308" (consideration): Trade-offs / provisional assumptions / revisit if time permits.
- 🔴 Red "#EF4444" (reconsider): High-risk failure modes / security risks / must reconsider / sensitive data.
- 🔵 Blue "#3B82F6" (active_focus): Current active task / step currently being computed.
- ⚪ Slate "#64748B" (neutral_structure): Structural concepts / groupings / neutral connectors.

2. Output ONLY a valid, parseable JSON object matching this exact JSON schema:
{
  "version": "1.0",
  "timeline": {
    "step_id": "step_unique_id",
    "step_number": 1,
    "title": "Short Milestone Title",
    "status": "completed | in_progress | planned",
    "summary": "Brief 1-line progress summary of what was accomplished or decided."
  },
  "mindmap": {
    "action": "merge",
    "nodes": [
      {
        "id": "node_id",
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
        "style": "solid | dashed"
      }
    ]
  },
  "canvas": {
    "elements": [
      {
        "type": "render_formula",
        "id": "f_1",
        "x": 380,
        "y": 100,
        "latex": "Formula in LaTeX (e.g. \\\\nabla \\\\times \\\\mathbf{E} = -\\\\frac{\\\\partial \\\\mathbf{B}}{\\\\partial t} or E = mc^2 or runtime complexity)",
        "caption": "Formula caption"
      },
      {
        "type": "draw_box",
        "id": "box_1",
        "x": 80,
        "y": 180,
        "w": 140,
        "h": 80,
        "color": "#3B82F6",
        "title": "Component Title",
        "style": "solid | dashed"
      },
      {
        "type": "draw_arrow",
        "from": [220, 220],
        "to": [320, 220],
        "label": "Flow Description",
        "color": "#22C55E"
      },
      {
        "type": "draw_text",
        "x": 80,
        "y": 300,
        "text": "Annotation note or key constraint",
        "color": "#EAB308"
      }
    ]
  }
}
Do NOT wrap the output in explanations. Output only the pure JSON.`;

      let lastError = null;
      let parsedResult = null;
      let rawResponseText = '';

      for (const model of modelsToTry) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
        
        try {
          const bodyPayload = {
            contents: [
              {
                role: 'user',
                parts: [
                  { text: `${systemDirective}\n\n=== CLAUDE CONVERSATION ANSWER TO VISUALIZE ===\n${claudeAnswer.slice(0, 8000)}` }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.15,
              maxOutputTokens: 2048,
              responseMimeType: 'application/json'
            }
          };

          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
          });

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const errMsg = errBody?.error?.message || `HTTP ${res.status} ${res.statusText}`;
            lastError = errMsg;
            // If responseMimeType failed, retry without responseMimeType
            if (res.status === 400 && errMsg.includes('responseMimeType')) {
              delete bodyPayload.generationConfig.responseMimeType;
              const retryRes = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload)
              });
              if (retryRes.ok) {
                const data = await retryRes.json();
                rawResponseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              }
            } else {
              continue;
            }
          } else {
            const data = await res.json();
            rawResponseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          }

          if (rawResponseText) {
            // Clean up code block ticks if model wrapped in markdown
            let cleanJson = rawResponseText.trim();
            cleanJson = cleanJson.replace(/^```(?:json:penecho-canvas|json)?/i, '').replace(/```$/i, '').trim();
            const startIdx = cleanJson.indexOf('{');
            const endIdx = cleanJson.lastIndexOf('}');
            if (startIdx !== -1 && endIdx !== -1) {
              cleanJson = cleanJson.slice(startIdx, endIdx + 1);
            }
            try {
              parsedResult = JSON.parse(cleanJson);
              if (parsedResult && (parsedResult.timeline || parsedResult.mindmap || parsedResult.canvas)) {
                break;
              }
            } catch (eJson) {
              lastError = 'JSON parse error: ' + eJson.message;
            }
          }
        } catch (fetchErr) {
          lastError = fetchErr.message;
        }
      }

      if (parsedResult) {
        respond({
          success: true,
          payload: parsedResult,
          raw: rawResponseText,
        });
        return;
      }

      // If the API call failed (e.g. invalid key format or network issue), generate intelligent fallback from Claude's text
      const fallbackPayload = generateLocalPenechoFallback(claudeAnswer);
      respond({
        success: true,
        payload: fallbackPayload,
        note: lastError ? `Rendered via Local Spatial Parser (${lastError.slice(0, 60)})` : 'Rendered via Local Spatial Parser'
      });
    } catch (err) {
      // Even on unhandled exception, provide fallback canvas payload
      const fallbackPayload = generateLocalPenechoFallback(msg.claudeAnswer || '');
      respond({ success: true, payload: fallbackPayload, note: 'Rendered via Local Spatial Engine' });
    }
  }
};

function generateLocalPenechoFallback(text) {
  if (!text) text = 'Architecture and System Analysis';
  const clean = text.replace(/```[\s\S]*?```/g, '').trim();
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. Extract Milestones for Timeline
  const firstHeading = lines.find(l => l.startsWith('#') || l.length < 60) || 'Milestone Assessment';
  const title = firstHeading.replace(/^[#*\-•\d.]+\s*/, '').slice(0, 50);
  const summary = lines.slice(1, 4).join(' ').slice(0, 140) || 'Analyzed conversational requirements and structured spatial decisions.';

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
    const desc = topic.length > rawLabel.length ? topic.slice(rawLabel.length + 1).trim().slice(0, 80) : `Concept factor for ${rawLabel}`;

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

