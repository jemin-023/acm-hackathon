# MemoNeg — AI Memory Negotiator Browser Extension

MemoNeg is a privacy-first, local-first browser extension for Chrome & Chromium-based browsers designed to give users fine-grained control and agency over AI assistant memory (specifically targeting Claude.ai).

## 🌟 Key Features

* **Memory Lens Header Icon & Badge:** Floating interactive trigger with unreviewed candidate counters and privacy lock glyph.
* **Per-Message Memory Status Indicator:** Visual inline dots indicating session-scoped candidates (light grey) and durable vault memories (accent color) directly on chat messages.
* **Message-to-Memory Save Button:** One-click hover button to instantly promote highlighted text to long-term memory.
* **Direct Drag-and-Drop Promotion & Purge:** Drag Noticed memory cards onto the Memory Lens icon to promote them to the Kept Vault, or drag cards into the slide-out Trash Zone to purge them instantly.
* **Per-Conversation Memory Toggle:** Quick switch to pause or resume memory collection for private/off-topic sessions.
* **Noticed Memories Tab:** Review session-scoped memory candidates auto-captured during active chat sessions.
* **Kept Memories Vault Tab:** Access and manage long-term memories retained across past and present conversations with origin metadata.
* **Session Digest Card:** Dismissible summary card appearing at the start of new sessions to review auto-captured candidates.
* **Never-Save Rules Engine:** Configurable keyword and regex rules to silently filter out sensitive topics (e.g., finances, passwords, health).
* **Client-Side Data Export:** 1-click JSON export ensuring complete user data ownership.
* **PenEcho Live Spatial Canvas & Mind Map Protocol:** Real-time multimodal canvas with a Running Timeline, force-directed Dynamic Mind Map with taxonomy color coding (#22C55E safe memory, #EAB308 consideration, #EF4444 reconsider, #3B82F6 active focus, #64748B structure), Canvas2D vector shapes, and LaTeX mathematical formula rendering.
* **Stream Interceptor & Draft Safety Layer:** Intercepts ```json:penecho-canvas``` blocks from Claude's live stream, collapses raw JSON from the chat, and provides an editable preview before committing to persistent board memory.
* **Local-First On-Device Architecture:** All user memories and spatial canvas states remain strictly stored inside your browser's local/session storage.

## 🚀 Installation & Setup

1. Clone or download this repository:
   ```bash
   git clone https://github.com/jemin-023/acm-hackathon.git
   ```
2. Open Chrome (or any Chromium browser like Brave or Edge) and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the repository root directory.
5. Open [Claude.ai](https://claude.ai) to begin negotiating AI memory!

## 📁 Repository Structure

```
├── manifest.json                        # Manifest V3 extension configuration
├── src/
│   ├── background.js                    # Background service worker & storage handlers
│   └── content.js                       # Shadow DOM UI, memory observer, drag-and-drop & status indicators
├── features.md                          # Comprehensive feature tracker & progress
└── Extension_Feature_Specification.md   # System design & architecture specification
```

## 📜 License

MIT License
