---
name: penecho-canvas-protocol
description: Live Spatial Canvas, Dynamic Mind Map, and Running Timeline skill contract for Claude.ai and MemoNeg browser extension.
version: 1.0.0
author: MemoNeg + PenEcho
---

# PenEcho + MemoNeg Live Spatial Canvas Skill Protocol

When this skill protocol is active, you collaborate with the user through a synchronized **Live Spatial Canvas, Dynamic Force-Directed Mind Map, and Running Timeline** rendered directly in the user's browser extension drawer.

---

## 1. Operating Instructions

For **every turn** where complex problem-solving, architectural design, mathematical derivations, decision-making, or memory capture occurs:

1. **Uninterrupted Conversational Response:**  
   Always produce your standard, high-quality, human-readable markdown response first. Explain your thoughts, reasoning, and conclusions naturally.

2. **Terminal Structured JSON Block:**  
   At the very bottom of your response, output a single code block tagged ````json:penecho-canvas````.

3. **Three Synchronized Visual Streams:**  
   Every canvas block must maintain and advance three synchronized streams:
   - **Running Timeline:** Chronological progression tracking milestones, statuses, and 1-line turn summaries.
   - **Dynamic Mind Map:** Semantic concept graph tracking decisions, relationships, and memory statuses.
   - **General Canvas Visuals:** Mathematical formulas in LaTeX, vector component boxes, directional arrows, and spatial annotations.

4. **Draft Safety & Non-Destructive Layer:**  
   The extension will render your output into an editable draft preview before the user permanently commits it to long-term memory or the board.

---

## 2. Strict Color Taxonomy & Memory Directive

You **must** classify all mind map nodes and canvas elements using this standardized color matrix:

| Color | Hex Code | Category | Meaning & Behavioral Directive |
| :--- | :--- | :--- | :--- |
| **🟢 Green** | `#22C55E` | `safe_memory` | **Saved in Long-Term Memory / Verified Safe:** Proven facts, agreed architecture decisions, durable user preferences, verified formulas, and safe non-sensitive data. *(Clicking saves directly to user's Kept Vault)*. |
| **🟡 Yellow** | `#EAB308` | `consideration` | **Moderate / Revisit If Time Permits:** Provisional assumptions, secondary optimization ideas, trade-offs to review later, or items pending verification. |
| **🔴 Red** | `#EF4444` | `reconsider` | **Must Reconsider / High Risk / Sensitive:** High-risk failure modes, security vulnerabilities, contradictions with stored memories, or sensitive personal data (passwords, financial info). *(Clicking creates a Never-Save safety rule)*. |
| **🔵 Blue** | `#3B82F6` | `active_focus` | **Current Active Task:** The specific node, component, or derivation step currently being computed in this chat turn. |
| **⚪ Slate** | `#64748B` | `neutral_structure` | **Structural / Connectors:** Neutral concepts, category groupings, structural boundaries, and neutral connector links. |

---

## 3. Terminal JSON Schema (`json:penecho-canvas`)

Your terminal block must adhere strictly to this schema:

```json
{
  "version": "1.0",
  "timeline": {
    "step_id": "string (unique identifier for this milestone)",
    "step_number": 1,
    "title": "Short Milestone Title (3-6 words)",
    "status": "completed | in_progress | planned",
    "summary": "Brief 1-line progress summary of what was decided or calculated in this turn."
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
        "parent": "optional_parent_node_id"
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
        "id": "formula_id",
        "x": 380,
        "y": 100,
        "latex": "\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}",
        "caption": "Formula Caption Title"
      },
      {
        "type": "draw_box",
        "id": "box_id",
        "x": 80,
        "y": 180,
        "w": 160,
        "h": 80,
        "color": "#3B82F6",
        "title": "Component Title",
        "style": "solid | dashed"
      },
      {
        "type": "draw_arrow",
        "from": [220, 220],
        "to": [320, 220],
        "label": "Interaction or payload label",
        "color": "#22C55E"
      },
      {
        "type": "draw_text",
        "x": 80,
        "y": 300,
        "text": "Spatial note or callout annotation",
        "color": "#EAB308"
      }
    ]
  }
}
```

---

## 4. Full Example Turn

### Example Claude Response:

```markdown
To design the user session store, we will use a stateless JWT model signed with Ed25519 asymmetric keys, paired with a short-lived Redis cache for revoking leaked tokens.

### Key Architecture Decisions:
1. **JWT Auth (🟢 Safe Memory):** Tokens are signed using asymmetric Ed25519 keys and store zero sensitive personal information.
2. **Redis Invalidation Cache (🟡 Consideration):** A secondary Redis blocklist can revoke leaked tokens, but adds infrastructure cost.
3. **Storing Raw Passwords in Session (🔴 Must Reconsider):** We must never place plaintext credentials or reversible hashes in browser storage.

The adaptive session expiry window is calculated as:
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
```
```
