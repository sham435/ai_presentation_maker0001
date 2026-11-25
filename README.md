# AI Presentation Maker — Desktop Stack

A complete desktop application stack for the **AI Presentation Maker** agent: a brief goes in, a styled multi-slide deck comes out, with streaming preview and conversational edits.

## Stack

- **Desktop shell:** Electron
- **Renderer:** React 18 + TypeScript + Vite
- **Main process:** Node.js agent orchestration, IPC, local storage
- **Contracts:** shared typed IPC + Zod/TS contracts
- **Generation:** Model Gateway adapter (HTTP OpenAI-compatible) with offline mock fallback
- **Storage:** local session/artifact store under Electron `userData`
- **Packaging:** electron-builder (mac/win/linux)

## Project layout

```text
.
├── architecture.md              # Agent architecture
├── blueprint.md                 # Product/engineering blueprint
├── integration.md               # Platform integration contract
├── milestone.md                 # Delivery milestones
├── todos.md                     # Task checklist
├── desktop.md                   # Desktop stack details
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json
└── src/
    ├── main/                    # Electron main process
    │   ├── agent/               # Parser, outline, generator, renderer, edit orchestrator
    │   ├── security/            # HTML sanitization
    │   ├── store/               # Session persistence
    │   ├── telemetry/           # Structured logging
    │   ├── ipc.ts               # IPC handlers
    │   └── index.ts             # App entry
    ├── preload/                 # Typed contextBridge API
    ├── renderer/                # React desktop UI
    └── shared/                  # Types, IPC channels, constants
```

## Quick start

```bash
# 1) Install dependencies
npm install

# 2) Optional: configure real model gateway
cp .env.example .env
# set MODEL_GATEWAY_URL, MODEL_GATEWAY_API_KEY, MODEL_NAME

# 3) Run desktop app in dev mode
npm run dev
```

If `MODEL_GATEWAY_URL` is not set, the app uses a deterministic **MockModelGateway** so the full flow still works offline.

## Desktop flow

1. User enters brief + options in the renderer.
2. Renderer calls `window.desktopApi.createDeck(...)` over IPC.
3. Main process runs agent pipeline: parse → outline → per-slide generation → render → deliver.
4. Main emits `plan/slide/completed/error` events back to renderer for live preview.
5. User can edit by instruction; edit orchestrator regenerates only targeted slides.
6. Artifact is saved as a self-contained HTML deck and can be opened/exported.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Electron + Vite dev |
| `npm run build` | Build main/preload/renderer |
| `npm run typecheck` | TypeScript checks |
| `npm run package:mac` | Build macOS package |
| `npm run package:win` | Build Windows package |
| `npm run package:linux` | Build Linux package |

## Security notes

- Renderer is isolated (`contextIsolation: true`, `nodeIntegration: false`).
- Only typed IPC methods are exposed via preload.
- Generated slide HTML is sanitized (no scripts/iframes/inline event handlers).
- Reference docs are treated as data, never instructions.
- Model credentials stay in main process / env.

## Next steps

- Replace mock/local artifact flow with real cloud model gateway + object storage.
- Add PPTX/PDF export renderer.
- Add tests (unit per stage + E2E Playwright/Electron).
- Add telemetry exporter and crash reporting.
