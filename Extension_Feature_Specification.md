# MemoNeg — AI Memory Negotiator Extension: Feature & Technical Specification

> **Full Extension Specification** | **Scope:** Browser Extension (Manifest V3) / Interface Control Layer | **Strict Line Budget:** < 500 lines

---

## 1. Executive Summary & Extension Architecture

**MemoNeg** is a privacy-first, local-first browser extension (Manifest V3) that acts as an interface control layer over web-based AI chat services (ChatGPT, Claude, Gemini). It transforms opaque, post-hoc AI memory into **live, human-controlled negotiation and consent**. MemoNeg operates strictly at the browser DOM and prompt-context layer without requiring backend AI model changes.

### Core Technical Architecture
- **Isolated Shadow DOM UI:** Injects top-bar icons, status indicators, and side drawers into host web app DOMs via Web Components with closed `ShadowRoot` boundaries to eliminate CSS collisions.
- **Background Service Worker:** Orchestrates state persistence, background NLP classification via Web Workers / ONNX runtime, and cross-tab message passing using `chrome.runtime.sendMessage`.
- **Local-First Storage Engine:** 100% on-device `IndexedDB` (using `idb` wrapper) and `chrome.storage.local`. Zero central cloud servers.
- **Prompt Injection Interceptor:** Intercepts prompt submission DOM events, prepending only active, user-permitted *Kept* memories as structured context.

---

## 2. Core Extension UI Features (Part I)

### 1. Memory Lens Header Icon & Badge
Persistent top-bar header icon with an unreviewed *Noticed* badge counter and an "on this device" lock glyph.
> **Implementation Strategy:** Content script uses `MutationObserver` to locate host nav headers (`header`, `nav`), injecting a custom `<memoneg-lens-badge>` Shadow DOM element. Queries background worker via `chrome.runtime.sendMessage` for live unreviewed counts from `chrome.storage.session`.

### 2. Per-Message Memory Status Indicator
Inline toolbar dot showing message memory state (light grey = session *Noticed*; solid accent = durable *Kept*).
> **Implementation Strategy:** `MutationObserver` tracks rendered message elements (`[data-message-author-role]`). Appends a status dot container into host hover action bars. Click handlers trigger drawer focus for target item.

### 3. Message-to-Memory Save Button
Hover toolbar icon allowing instant manual promotion of any message snippet to permanent long-term memory.
> **Implementation Strategy:** Injected alongside standard copy/thumbs-up icons in message action bars. Clicking extracts raw message snippet text and metadata, writing directly to `IndexedDB.kept_memories` with tag assignment.

### 4. Direct Drag-and-Drop Promotion & Purge
Drag messages directly onto top Memory Lens icon to keep; drag stored cards out of drawer onto trash zone to delete.
> **Implementation Strategy:** Attaches HTML5 Drag-and-Drop API event listeners (`dragstart`, `dragover`, `drop`) to message selection handles. Custom drop target listeners on header icon and drawer trash overlay update item state in `IndexedDB`.

### 5. Per-Conversation Memory Toggle
Header switch allowing users to pause or enable memory collection for the active chat session.
> **Implementation Strategy:** Toggle switch injected into chat header area. Setting state updates `sessionStorage` key `memoneg_session_active`. When `false`, content script suspends text scraping and background classifier execution.

### 6. Noticed Memories Tab
Drawer view displaying session-scoped memory candidates auto-captured during active chat with `[Keep]` and `[Discard]` actions.
> **Implementation Strategy:** Rendered inside the main Shadow DOM slide-out drawer panel (`#noticed-tab`). Binds dynamically to `chrome.storage.session` candidate array with instant one-tap state mutation handlers.

### 7. Kept Memories Vault Tab
Categorized list of long-term memories retained across sessions with provenance links and multi-conversation inference counts.
> **Implementation Strategy:** Rendered in drawer using virtualized list rendering for 1000+ items. Queries `IndexedDB.kept_memories`. Clicking provenance links executes `element.scrollIntoView()` on original DOM message anchor.

### 8. Session Digest Card
Dismissible notification card appearing at new chat start summarizing recent memory activity and expiring candidates.
> **Implementation Strategy:** Injected into chat root DOM on URL navigation change. Reads unreviewed candidates from `chrome.storage.session` and renders a non-blocking toast card with 1-tap review actions.

### 9. Never-Save Rules Engine
Configurable category toggles and plain-language filters for sensitive topics (health, finances, passwords).
> **Implementation Strategy:** Rules stored in `chrome.storage.sync`. Background service worker compiles user rules into regex/keyword matchers, silently filtering extracted facts before entry into the `Noticed` pipeline.

### 10. Track-Changes Diff & Version History
Visual red-strikethrough and green-highlight editor showing memory evolution over time with 1-click revert.
> **Implementation Strategy:** Utilizes client-side `diff-match-patch` library inside drawer modal. Maintains an array `history: [{ timestamp, text, diff }]` per record in `IndexedDB`, allowing instantaneous 1-click snapshot restore.

### 11. Client-Side Data Export
One-click export tool generating structured JSON or plain text files of all stored memories.
> **Implementation Strategy:** Triggered from drawer settings: queries all `IndexedDB` stores, builds a JSON `Blob` (`application/json`), and initiates download via `URL.createObjectURL()` and `chrome.downloads.download()`.

### 12. In-Thread Conflict Resolution Annotations
Quiet inline warning under assistant responses when generated using memory contradicted by new input.
> **Implementation Strategy:** Content script inspects assistant text output against active context memories using client-side similarity scoring. Injects an inline conflict banner (`<div class="memoneg-conflict">`) with side-by-side merge drawer modal.

### 13. Ambient Background Memory Classifier
Non-blocking evaluation algorithm identifying durable facts immediately after assistant responses finish.
> **Implementation Strategy:** Offloads text extraction to a Web Worker running lightweight ONNX/Transformers.js embeddings (`all-MiniLM-L6-v2`) triggered upon LLM response stream completion signal.

### 14. Local-First On-Device Storage Architecture
Client-side database keeping memories strictly local, injecting minimal relevant excerpts into prompt contexts.
> **Implementation Strategy:** Core database built on `IndexedDB`. Content script hooks prompt form submission (`keydown` Enter / submit click), prepending filtered memory excerpts into prompt payload prior to DOM dispatch.

---

## 3. Research-Grounded HCI Features (Part II)

### 15. Ambient Memory Capture Pulse
Visual glow around message text when potential memory detected; hover expands micro-negotiation chip.
> **Implementation Strategy:** Injects CSS `@keyframes` pulse class into target DOM text nodes. Mouseover event mounts an absolute-positioned Floating UI micro-popover chip (`[Remember] [Session] [Edit] [Forget]`).

### 16. Tri-Tier Spatial Scoping Canvas
Interactive concentric-zone canvas (Session Ephemeral, Context Domain, Global Core) for drag-and-drop privacy scoping.
> **Implementation Strategy:** HTML5 `<canvas>` / SVG interactive component rendered in drawer modal. Pointer Events handle real-time dragging across concentric zone paths, updating item `scope` properties in `IndexedDB`.

### 17. Counterfactual Memory Simulator ("What If I Forget?")
Side-by-side simulation tool showing how AI responses would change with versus without a selected memory.
> **Implementation Strategy:** Modal UI triggers a background shadow request (or offline simulator parser) omitting target memory. Renders side-by-side output with line-by-line diff highlighting (`diff-match-patch`).

### 18. Semantic Decay Engine & Visual Fading
Half-life decay timers (24h, 7d, 30d, 90d) with gradual visual fading, micro-sparkline decay curves, and proactive sunset digests.
> **Implementation Strategy:** Background cron timer (`chrome.alarms`) calculates node opacity `opacity = e^(-λt)` based on last access timestamp. Updates inline CSS opacity and draws inline SVG sparklines in drawer cards.

### 19. Bidirectional Provenance & Lineage Inspector
Complete audit trail linking AI responses back to source memories, and memories forward to influenced responses.
> **Implementation Strategy:** Maintains DAG edge table `IndexedDB.provenance` storing `(memory_id, chat_id, message_id, timestamp)`. Inspector button launches interactive D3/SVG node graph modal.

### 20. Sensitivity-Tiered Consent Handshakes
Automated classification into Low/Medium/High sensitivity tiers with mandatory inline consent dialogs for high-stakes data.
> **Implementation Strategy:** Rule-based regex + local NER model scores memory sensitivity (0.0–1.0). Scores > 0.8 block auto-save and inject an un-dismissible inline consent modal into host chat turn.

### 21. Natural Language Memory Rules & End-User Programming
Policy builder allowing users to declare memory rules in plain text ("Never remember salary details").
> **Implementation Strategy:** Text rules parsed via client-side rule generator into executable JavaScript predicates. Includes rule collision validator checking for logical overlap against existing rules.

### 22. Memory Narrative Timeline & Chapters
Temporal visualization of memory story with multi-level zoom (months, weeks, days) and semantic chapter grouping.
> **Implementation Strategy:** Custom SVG timeline container in drawer. Groups memories chronologically and clusters semantically related items (via vector distance) into collapsible chapter cards.

### 23. Negotiation Dialogue Patterns & Speech Acts
Collaborative conversational sequences where AI proposes extractions and users counter-propose in natural text.
> **Implementation Strategy:** Content script parses structured extraction phrases in assistant responses, rendering an interactive inline speech-act bar (`[Accept] [Scope to Work] [Modify] [Reject]`).

### 24. Memory Freeze & Snapshot Version Control
Crystallization tool allowing users to take named snapshots of memory state with 1-click rollback and snapshot diffing.
> **Implementation Strategy:** Serializes entire `IndexedDB` database state to JSON stored in `IndexedDB.snapshots`. One-click rollback wipes active DB tables and restores from target snapshot object.

### 25. Emotional Tone Memory Calibration
Affect-aware mode that automatically pauses memory extraction during emotionally elevated chats.
> **Implementation Strategy:** Web Worker runs lightweight sentiment model (VADER / MobileBERT) on user input. High sentiment variance sets `session_paused = true` and generates a post-chat review card.

### 26. Collaborative Memory Sharing & Third-Party Protection
Interpersonal privacy engine detecting third-party facts (family/colleague data) defaulting to session-only scope.
> **Implementation Strategy:** NER entity extractor checks for third-person pronouns + proper names (e.g. "my spouse's medical info"). Automatically assigns `scope: "session_only"` with a third-party warning tag.

### 27. Accessibility-First Memory Sonification
Non-speech auditory cue system conveying extraction, decay warnings, and scope states through sound and voice control.
> **Implementation Strategy:** Uses Web Audio API (`AudioContext`) to generate synthesized audio cues (chords, arpeggios, pulse tones) for memory events, paired with `aria-live` screen-reader announcements.

---

## 4. Radical Physics-Embodied & Metacognitive Paradigms (Part III)

### 28. Semantic Gravity & Particle Force Fields
Physics canvas rendering memories as charged particles orbiting an Identity Nucleus at radius-dependent velocities.
> **Implementation Strategy:** WebGL / HTML5 2D Canvas physics simulation using Verlet integration. Particle radius $r$ determines memory privacy tier; dragging a particle past escape velocity triggers a deletion particle burst.

### 29. Biomimetic Osmotic Membranes
Contextual privacy domains enclosed by semi-permeable lipid bilayer membranes with mathematical diffusion rules.
> **Implementation Strategy:** Canvas 2D liquid simulation rendering deformable particle contours. Pinch/drag gestures alter membrane surface tension $\gamma$, dynamically computing cross-domain memory diffusion probabilities.

### 30. Metacognitive Topological Mirror (Perception Sculpting)
2.5D heightfield surface visualizing AI internal perception landscape with interactive sculpting tools (Flatten, Raise, Erode).
> **Implementation Strategy:** Three.js / WebGL heightmap shader canvas. Cursor brush drag events modify heightfield vertex matrix array, updating underlying memory weight vectors in local DB.

### 31. Multiverse Branching DAG & Counterfactual Canvas
Directed Acyclic Graph rendering parallel decision timelines for memory state changes with temporal scrubber.
> **Implementation Strategy:** Rendered via SVG/Canvas hierarchy graph in drawer modal. Scrubbing timeline bar updates active snapshot pointer state and live-previews prompt context diffs.

### 32. Stigmergic Thermodynamic Decay & Crystallization
Temperature state model transitioning memory nodes through Plasma, Liquid, Solid, Glass, and Shattered phases.
> **Implementation Strategy:** State machine driven by node access frequency temperature $T$. WebGL thermal shader visualizes phase states; applying freeze ray sets $T=0$ (Solid Glass), locking node against decay.

### 33. Tactile Viscous Friction & Micro-Boundaries
Proportional friction physics creating honey-like drag resistance and 3–5s reflection hold-times for sensitive data.
> **Implementation Strategy:** Pointer Event drag listener calculates velocity damper $F_{\text{drag}} = -k \cdot v^2$ when dragging items toward Global Core zone, requiring a 3-second sustained hold to confirm promotion.

### 34. Conversational Speech Act Protocol & Acoustic Sonification
Formal speech act contracting framework (Propose, Accept, Counter, Confirm) with spatialized audio feedback.
> **Implementation Strategy:** Negotiation state machine logs speech acts directly into host chat UI. Web Audio API `PannerNode` renders 3D spatialized audio feedback panned to match UI element screen position.

---

## 5. Summary Interaction Matrix & Implementation Stack

| Layer / Feature | Trigger Location | Chrome Extension API / DOM Tech | Data Persistence Level |
| :--- | :--- | :--- | :--- |
| **Memory Lens Header** | Top Nav Bar | `MutationObserver` + Shadow DOM Web Component | `chrome.storage.session` |
| **Inline Status & Save** | Message Hover Bar | Event Delegation + Selection API | `IndexedDB.kept_memories` |
| **Drawer (Noticed/Kept)** | Slide-out Panel | Shadow DOM + Virtualized List Renderer | `IndexedDB` + `chrome.storage` |
| **Rules & Export** | Drawer Deep Layer | `chrome.storage.sync` + `chrome.downloads` | `chrome.storage.sync` / Local File |
| **Ambient Classifier** | Post-Message Stream | Web Worker + ONNX Runtime / Transformers.js | Transient Memory / `chrome.storage.session` |
| **Physics / Canvas UI** | Modal Overlay | HTML5 Canvas 2D / WebGL / Web Audio API | `IndexedDB` Snapshots |

---

## 6. Scope Boundaries & Anti-Features

- **No Model Weight Modification:** Operates 100% on host DOM & prompt text box context injection; zero backend API model tuning.
- **No Remote Cloud Servers:** All storage, NLP classification, and physics rendering execute entirely inside the client browser.
- **No Real-Time Typing Blocking:** Background classifiers evaluate responses asynchronously after generation stream completion.
- **No Invisible Data Collection:** Zero telemetry or background user tracking; 100% user-verifiable client local data ownership.
