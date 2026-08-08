# Memo.io — AI Memory Negotiator Browser Extension

Memo.io is an interactive, privacy-first, local-first browser extension designed to give users explicit, fine-grained control over their AI assistant's memory (specifically targeting Claude.ai). 

Standard AI memory systems operate as passive, server-side black boxes. Memo.io transforms memory retention into an active negotiation by placing inline decision controls directly inside the chat interface, ensuring no persistent memory is stored without your explicit consent.

## 🌟 Key Features

* **Shadow DOM UI:** A completely isolated, retro Y2K-styled interface injected directly into Claude.ai, accessed via a Floating Action Button (FAB) or a vertical Pull Tab.
* **Inline Memory Prompts:** A background `MutationObserver` detects memory candidates in real-time and injects prompt cards directly beneath chat bubbles, allowing you to instantly **Accept & Save**, **Edit**, or **Reject** a memory without leaving the conversation flow.
* **Two-Tier Storage:**
  * **Current Session:** Ephemeral candidate memories stored temporarily in `chrome.storage.session`.
  * **Global Memory:** Your durable, long-term memory vault stored in `chrome.storage.local`. Memories only enter this tier upon your explicit approval.
* **Claude Context Syncing:** Approving a memory dynamically injects a hidden directive into Claude's input box, forcing the model to immediately ingest the accepted fact into its active context.
* **Never-Save Rules Engine:** Define keyword and regex patterns that silently block sensitive topics (e.g., finances, passwords, health) from ever being surfaced as memory candidates.
* **Memory Freeze & Snapshots:** Take named snapshots of your entire Global Memory vault and restore them with a single click if Claude's memory state becomes polluted.
* **PenEcho Spatial Canvas Protocol:** A "Draft Safety Layer" that intercepts structural JSON outputs (`json:penecho-canvas`) from Claude and renders them in a visual Canvas tab (force-directed mind maps, timelines, and LaTeX formulas) for review before committing to memory.
* **Local-First On-Device AI:** Memory analysis is processed entirely client-side. The extension bundles a fine-tuned Gemma-3 270M model (quantized to INT4 ONNX) running in a hidden Chrome Offscreen Document via WebGPU (with WASM fallbacks). No chat data is sent to external APIs for classification.

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
│   ├── background.js                    # Background service worker & storage handlers (local/session/sync)
│   ├── content.js                       # Shadow DOM UI, MutationObserver, inline prompts, & Canvas renderer
│   ├── components/MoltenMetal.jsx       # WebGL Y2K dynamic aesthetic background shader
│   └── offscreen/
│       ├── offscreen.html               # Hidden document for WebGPU inference
│       └── offscreen.js                 # ONNX Runtime Web logic running Gemma-3 270M INT4
├── train.py                             # HuggingFace fine-tuning script for the Gemma-3 model
├── quantize.py                          # ONNX MatMulNBitsQuantizer script for INT4 export
├── features.md                          # Original hackathon feature brainstorm list
└── Extension_Feature_Specification.md   # System design & architecture specification
```

## 📜 License

MIT License
