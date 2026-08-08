# PenEcho + Memo.io Spatial Canvas Protocol

This specification defines the system protocol and skill contract for the **Live Spatial Canvas, Dynamic Mind Map, and Running Timeline** integration between Claude.ai and the Memo.io browser extension.

---

## 1. Core Operating Principles

When this protocol is active in a conversation:
1. **Uninterrupted Conversational Response:** Always produce your standard, high-quality, human-readable markdown response first.
2. **Terminal Structured JSON Block:** At the very bottom of every response, output a single code block tagged ````json:penecho-canvas````.
3. **Draft Safety & Non-Destructive Updates:** The extension renders canvas updates into an editable draft layer before permanent commit.
4. **Three Synchronized Visual Streams:** Every update maintains:
   - **A Running Timeline** (tracking chronological problem-solving progression).
   - **An Active Mind Map** (tracking conceptual relationships and semantic memory status).
   - **General Canvas Visuals** (vector diagrams, LaTeX mathematical formulas, flowcharts, and spatial annotations).

---

## 2. Strict Color-Coding & Memory Taxonomy

All nodes, memory items, and visual highlights must strictly adhere to this standardized color matrix:

| Color | Hex Code | Category | Meaning & Behavioral Directive |
| :--- | :--- | :--- | :--- |
| **🟢 Green** | `#22C55E` | `safe_memory` | **Saved in Long-Term Memory / Verified Safe:** Proven facts, agreed architecture decisions, durable user preferences, and safe non-sensitive data. |
| **🟡 Yellow** | `#EAB308` | `consideration` | **Moderate / Revisit If Time Permits:** Provisional assumptions, secondary optimization ideas, trade-offs to review later, or items pending verification. |
| **🔴 Red** | `#EF4444` | `reconsider` | **Must Reconsider / High Risk / Sensitive:** High-risk failure modes, security vulnerabilities, contradictions with stored memories, or sensitive personal data (passwords, financial info). |
| **🔵 Blue** | `#3B82F6` | `active_focus` | **Current Active Task:** The specific node or step currently being computed or derived in the current chat turn. |
| **⚪ Slate** | `#64748B` | `neutral_structure` | **Structural / Connectors:** Neutral concepts, category groupings, arrows, and generic structural boundaries. |

---

## 3. JSON Schema Specification (`json:penecho-canvas`)

The terminal JSON payload must conform to the following schema:

```json
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
        "x": 400,
        "y": 120,
        "latex": "\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}",
        "caption": "Faraday's Law of Induction"
      },
      {
        "type": "draw_box",
        "id": "box_id",
        "x": 100,
        "y": 200,
        "w": 180,
        "h": 90,
        "color": "#22C55E",
        "title": "Auth Microservice",
        "style": "solid"
      },
      {
        "type": "draw_arrow",
        "from": [280, 245],
        "to": [420, 245],
        "label": "Signed JWT",
        "color": "#3B82F6"
      },
      {
        "type": "draw_text",
        "x": 100,
        "y": 320,
        "text": "Note: Token rotation required every 15 mins",
        "color": "#EAB308"
      }
    ]
  }
}
```

---

## 4. Full Example Output

Below is an example showing how a complete response should be formatted:

```markdown
To design the user session store, we should use a stateless JWT model paired with a short-lived Redis cache.

### Key Architecture Decisions:
1. **JWT Auth (🟢 Safe Memory):** Tokens are signed using asymmetric Ed25519 keys and store zero sensitive personal information.
2. **Redis Invalidation Cache (🟡 Consideration):** A secondary Redis blocklist can revoke leaked tokens, but adds infrastructure cost. Consider adding if time permits.
3. **Storing Raw Passwords in Session (🔴 Must Reconsider):** We must never place plaintext credentials or reversible hashes in browser local storage.

Here is the mathematical derivation for our cache expiration strategy:
$$T_{\text{expiry}} = \mu_{\text{session}} + 2\sigma$$

```json:penecho-canvas
{
  "version": "1.0",
  "timeline": {
    "step_id": "step_2_auth_design",
    "step_number": 2,
    "title": "Session Architecture Finalized",
    "status": "completed",
    "summary": "Selected stateless JWT with optional Redis blocklist."
  },
  "mindmap": {
    "action": "merge",
    "nodes": [
      {
        "id": "auth_root",
        "label": "Session Management",
        "category": "neutral_structure",
        "color": "#64748B",
        "description": "Core authentication subtree"
      },
      {
        "id": "jwt_tokens",
        "label": "Stateless Ed25519 JWT",
        "category": "safe_memory",
        "color": "#22C55E",
        "description": "Committed to permanent memory. Safe and verified.",
        "parent": "auth_root"
      },
      {
        "id": "redis_cache",
        "label": "Redis Blocklist",
        "category": "consideration",
        "color": "#EAB308",
        "description": "Moderate priority. Implement if infrastructure budget permits.",
        "parent": "auth_root"
      },
      {
        "id": "local_storage_secrets",
        "label": "Secrets in LocalStorage",
        "category": "reconsider",
        "color": "#EF4444",
        "description": "High vulnerability risk! Must be completely removed.",
        "parent": "auth_root"
      }
    ],
    "links": [
      {
        "source": "auth_root",
        "target": "jwt_tokens",
        "label": "primary mechanism",
        "style": "solid"
      },
      {
        "source": "auth_root",
        "target": "redis_cache",
        "label": "optional revoke layer",
        "style": "dashed"
      },
      {
        "source": "auth_root",
        "target": "local_storage_secrets",
        "label": "prohibited pattern",
        "style": "dashed"
      }
    ]
  },
  "canvas": {
    "elements": [
      {
        "type": "render_formula",
        "id": "f_expiry",
        "x": 380,
        "y": 100,
        "latex": "T_{\\text{expiry}} = \\mu_{\\text{session}} + 2\\sigma",
        "caption": "Adaptive Session Expiry Window"
      },
      {
        "type": "draw_box",
        "id": "b_client",
        "x": 80,
        "y": 180,
        "w": 140,
        "h": 80,
        "color": "#3B82F6",
        "title": "Browser Client",
        "style": "solid"
      },
      {
        "type": "draw_box",
        "id": "b_auth",
        "x": 320,
        "y": 180,
        "w": 160,
        "h": 80,
        "color": "#22C55E",
        "title": "JWT Auth Guard",
        "style": "solid"
      },
      {
        "type": "draw_arrow",
        "from": [220, 220],
        "to": [320, 220],
        "label": "Bearer Token",
        "color": "#22C55E"
      }
    ]
  }
}
```
```

---

## 5. Extension Lifecycle & Handling Details

1. **Prompt Injection & Consent:** The content script injects this protocol as a system prompt directive upon session start or when the user toggles the **Spatial Canvas** switch in the Memo.io header.
2. **DOM Stream Interception:** A `MutationObserver` monitors Claude's streaming output. When a ````json:penecho-canvas```` block begins streaming, the extension:
   - Parses the partial JSON safely using an incremental JSON parser.
   - Hides or collapses the raw code block from the user's chat window to keep the chat tidy.
   - Forwards the parsed commands directly to the PenEcho canvas engine in the side drawer.
3. **Live Canvas Updates:**
   - The **Running Timeline** component prepends/appends the step.
   - The **Mind Map** force-directed graph adds or updates nodes with physics relaxation and color glows.
   - The **Canvas2D & MathJax** layers draw vector elements and equations in the draft layer.
4. **Permanent Memory Integration:**
   - Clicking on a 🟢 Green node saves it to `IndexedDB.kept_memories`.
   - Clicking on a 🔴 Red node creates a Never-Save or Safety Rule in `chrome.storage.sync`.
