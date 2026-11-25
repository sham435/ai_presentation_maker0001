# Ultimate macOS Desktop Release — Design Specification

**Date:** 2026-11-26  
**Project:** AI Presentation Maker (`ai_presentation_maker`)  
**Status:** Draft — dependency verification recorded in §2.1; pending implementation-plan approval  
**Scope:** macOS production v1 — all P0/P1 desktop items, with selected P1 quality safeguards. Defer P2/server/cloud items.

## 1. Summary

This spec defines the next production release of the AI Presentation Maker desktop app. The app remains a local-first Electron application that turns a short brief into a styled, editable, exportable presentation deck. This release completes the remaining P0/P1 desktop work: real model connectivity with macOS Keychain-backed credential storage, SQLite persistence with transactional integrity, local opt-in telemetry, PDF and PPTX export, broader automated testing, and polished macOS packaging.

The release is explicitly macOS-first. Server-side scaling, template marketplaces, multi-user editing, cloud object storage, and other P2/cloud roadmap items are out of scope.

## 2. Locked Decisions

| Decision | Choice |
| --- | --- |
| Release scope | macOS production v1; all P0/P1 desktop items plus selected test hardening |
| Delivery approach | Dependency-ordered, verified slices |
| Build tooling | `electron-vite`: separate Electron main, preload, and React renderer builds |
| Model path | OpenAI-compatible HTTP endpoint with model/key settings; macOS Keychain-backed credential encryption via Electron `safeStorage` |
| Credential boundary | Credentials and crypto operations stay in the main process; renderer receives only status flags |
| Database | SQLite via `better-sqlite3`, main process only, transactional writes |
| Telemetry | Local-only, opt-in JSONL under `userData`; view/delete in app; no network |
| Export formats | Canonical self-contained HTML, PDF via `BrowserWindow.printToPDF`, editable PPTX via `pptxgenjs` |
| Packaging | Polished unsigned DMG/zip with signing and notarization config ready for later Apple Developer credentials |
| Offline behavior | Explicit **Offline Preview** badge when using `MockModelGateway` |
| Testing | Vitest unit + integration, Playwright/Electron E2E, golden prompt suite, visual regression, split test commands, load/cancellation tests |

### 2.1 Repository verification (2026-11-26)

The spec remains **Draft** until the implementation plan is approved. Versions below were verified from `package.json`, `package-lock.json`, and `electron.vite.config.ts` in this repository:

| Package | Verified version | Notes |
| --- | --- | --- |
| Electron | 30.5.1 | `safeStorage` Keychain-backed credential encryption is available |
| React / React DOM | 18.3.1 | Renderer UI |
| TypeScript | 5.9.3 | Locked version; package.json range is compatible |
| Vite | 5.4.21 | Renderer bundler |
| electron-vite | 2.3.0 | Already configures separate main, preload, and renderer builds with `@shared`/`@renderer` aliases |
| electron-builder | 25.1.8 | Packaging |
| better-sqlite3 | 11.10.0 | Already installed; SQLite access stays in main |
| DOMPurify | 3.5.0 | Already installed with JSDOM sanitizer |
| JSDOM | 26.1.0 | Sanitizer support |
| Zod | 3.25.76 | IPC validation |
| Zustand | 5.1.0 | Available for renderer state if needed |
| Vitest | 2.1.9 | Unit and integration tests |

New dependencies are intentionally not yet installed. During Slice 3/4 they will be pinned exactly in `package.json` and `package-lock.json`: `@playwright/test` 1.65.1 and `pptxgenjs` 4.0.1. No `keytar` dependency is planned; Electron `safeStorage` provides macOS Keychain-backed encryption without an extra native credential module.

## 3. Goals and Non-Goals

### 3.1 Goals

- Generate a coherent deck from a one-line brief using a real OpenAI-compatible endpoint when configured.
- Make offline mock generation honest and clearly labeled.
- Persist sessions, slides, and artifact versions reliably in SQLite.
- Export the exact deck version as HTML, PDF, and editable PPTX.
- Give the user cancel/retry controls with correlation IDs and no stale-result overwrites.
- Provide local, opt-in telemetry without leaking secrets, prompts, or full slide text.
- Ship a polished unsigned macOS DMG that is ready for signing/notarization when credentials are supplied.
- Keep the generated-markup security boundary strict.

### 3.2 Non-Goals

- Multi-user or real-time co-editing.
- Cloud storage, horizontal workers, rate limiting as a service, or template marketplace.
- Arbitrary PPTX import fidelity.
- Live data binding or automatic chart generation from raw datasets.
- Dark/light theme variants, RTL, and other P2 items in `todos.md`.

## 4. Architecture

### 4.1 Stack

| Layer | Technology |
| --- | --- |
| Desktop runtime | Electron 30+ |
| Renderer UI | React 18 + TypeScript |
| Build tooling | `electron-vite`, Vite 5 |
| Main process | Node.js + TypeScript |
| IPC | Typed `contextBridge` preload APIs |
| Validation | Zod schemas at every IPC boundary |
| Database | SQLite via `better-sqlite3` |
| Credentials | Electron `safeStorage` with Keychain-backed encryption on macOS |
| PDF export | `BrowserWindow.printToPDF` |
| PPTX export | `pptxgenjs` |
| Unit/integration tests | Vitest |
| E2E tests | Playwright + Electron |
| Packaging | `electron-builder` |

### 4.2 Source Layout

```text
src/
├── main/
│   ├── index.ts
│   ├── ipc/
│   ├── agent/
│   │   ├── orchestrator.ts
│   │   ├── parser.ts
│   │   ├── outlineEngine.ts
│   │   ├── pageGenerator.ts
│   │   ├── renderer.ts
│   │   └── editOrchestrator.ts
│   ├── credentials/
│   │   └── keychain.ts
│   ├── gateway/
│   │   └── modelGateway.ts
│   ├── store/
│   │   └── sessionStore.ts
│   ├── telemetry/
│   │   └── logger.ts
│   ├── export/
│   │   ├── pdf.ts
│   │   └── pptx.ts
│   └── security/
│       └── sanitize.ts
├── preload/
│   └── index.ts
├── renderer/
│   ├── index.html
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── services/
│       ├── hooks/
│       └── types/
└── shared/
    ├── constants.ts
    ├── ipc.ts
    ├── schema.ts
    ├── templateCatalog.ts
    └── types.ts
```

### 4.3 Component Boundaries

#### Renderer

The React renderer owns user interaction only. It renders the brief form, template gallery, streaming slide previews, session list, settings screen, export actions, telemetry controls, and error/retry UI. It never reads credentials, performs encryption, opens SQLite directly, or constructs unrestricted IPC messages.

#### Preload

The preload exposes a finite typed API through `contextBridge`. Each method maps to a validated main-process channel. No wildcard, raw `ipcRenderer.send`, or generic invoke channel is exposed.

#### Main Process

The main process owns all privileged work:

- IPC validation and routing.
- Agent orchestration and streaming events.
- `ModelGateway` calls, retries, cancellation, and status diagnostics.
- Keychain-backed credential encryption/decryption.
- SQLite persistence and migration.
- Local telemetry writes.
- Artifact rendering and export.
- macOS packaging hooks and diagnostics.

#### Shared Contracts

Shared TypeScript types and Zod schemas are the only data contract between renderer, preload, and main. Unknown template ids, malformed payloads, and unsafe file paths are rejected at the boundary.

## 5. Data Flow

### 5.1 Startup

1. Main initializes settings and SQLite.
2. If `sessions.json` exists and the database has no imported sessions, main performs a transactional migration and retains the JSON as a backup.
3. Main checks credential availability through `safeStorage` and loads non-secret settings: endpoint, model name, telemetry opt-in.
4. Renderer receives only `{ endpoint, model, hasKey, telemetryOptIn, mode }`, where `mode` is `live` or `offline-preview`.
5. If no endpoint/key is configured, the renderer shows a persistent **Offline Preview** badge and uses `MockModelGateway`.

### 5.2 Create Flow

1. User submits brief and options.
2. IPC payload passes Zod validation.
3. Parser produces `PresentationSpec`.
4. Outline engine requests a JSON outline and validates it against the five canonical roles: `cover`, `catalog`, `chapter`, `content`, `end`.
5. Page generator streams one sanitized `Slide` at a time.
6. Renderer displays each slide immediately.
7. Deck renderer writes a versioned HTML artifact.
8. Session, slides, artifact metadata, and event summary commit in one SQLite transaction.
9. A single terminal `completed` event enables export/open actions.

### 5.3 Edit Flow

1. Renderer sends an edit instruction and optional target slides.
2. Main loads the session snapshot from SQLite.
3. Edit orchestrator detects target slides.
4. Only target slides regenerate through `ModelGateway`; untouched slides keep their stored content and HTML.
5. A new artifact version and session snapshot are written transactionally.
6. Renderer receives the updated session and new artifact metadata.

### 5.4 Export Flow

- **HTML:** canonical artifact, already sanitized and self-contained.
- **PDF:** main loads the exact artifact version in a hidden, sandboxed `BrowserWindow` and calls `printToPDF`. Exported content must match the artifact version shown in the session.
- **PPTX:** main builds a presentation from structured `Slide[]` content and theme tokens with `pptxgenjs`, so slides remain editable. Text is escaped; no generated HTML or scripts are copied into the PPTX.
- All exports use a native save dialog and reject paths outside the user-selected target.

### 5.5 Telemetry Flow

- Telemetry is off until the user opts in.
- Enabled telemetry appends JSONL records under `userData/data/telemetry.jsonl`.
- Records contain correlation id, stage name, start/end timestamps, duration, status, and sanitized error category/message.
- Records never contain credentials, prompts, full brief text, full slide text, reference-document text, or file contents.
- Renderer can view a redacted list and clear the log through IPC.

### 5.6 Failure Flow

- Provider failures are categorized as transient (`429`, `5xx`, network timeout) or terminal (`401`, `403`, invalid request/schema).
- Transient failures retry up to two times with exponential backoff and abort support.
- Terminal failures surface immediately with a user-readable message and correlation id.
- Cancel aborts in-flight model requests through `AbortSignal` and prevents late results from writing to a newer session version.
- Artifacts are marked complete only after successful sanitization and file write.

## 6. Data Model and Persistence

### 6.1 SQLite Tables

- `sessions`: id, spec JSON, outline JSON, status, created_at, updated_at, current_artifact_version.
- `slides`: session_id, index, role, layout, theme, content JSON, html, version.
- `artifacts`: session_id, version, file_path, slide_count, checksum, created_at.
- `events`: correlation_id, session_id, type, stage, status, created_at.
- `settings`: key/value pairs for non-secret settings.
- `migrations`: migration name and applied_at.

### 6.2 Integrity Rules

- All multi-row writes use SQLite transactions.
- Migration from `sessions.json` is idempotent and transactional.
- Artifact writes use a temporary file plus atomic rename where possible.
- Each artifact checksum is stored and verified before export.
- Version tokens include the template id and `TEMPLATE_SCHEMA_VERSION`.
- Cancelled or stale generation results cannot overwrite a newer session version.

## 7. IPC Contract Additions

| Channel | Direction | Purpose |
| --- | --- | --- |
| `settings:get` | renderer → main | Return non-secret settings and mode |
| `settings:set` | renderer → main | Set endpoint, model, telemetry opt-in |
| `credentials:set` | renderer → main | Store API key via `safeStorage` |
| `credentials:clear` | renderer → main | Delete stored key |
| `credentials:status` | renderer → main | Return only `hasKey` boolean |
| `telemetry:list` | renderer → main | Return redacted JSONL entries |
| `telemetry:clear` | renderer → main | Delete local telemetry log |
| `deck:export-pdf` | renderer → main | Export a specific artifact version as PDF |
| `deck:export-pptx` | renderer → main | Export a specific artifact version as PPTX |
| `app:diagnostics` | renderer → main | Return version, platform, storage paths, gateway status |

Every channel uses a Zod request and response schema. Credential values are never returned to the renderer.

## 8. Security Boundaries

1. `contextIsolation: true` and `nodeIntegration: false`.
2. Strict Content Security Policy in `renderer/index.html`: no inline or remote script, `eval`, or external asset loading; inline styles are allowed only for React/template preview layout, and slide previews remain in `sandbox=""` iframes.
3. Zod validation on every IPC boundary.
4. No credentials or encryption operations in React.
5. No unrestricted IPC channels.
6. SQLite access exclusively in the main process.
7. Generated slide HTML passes DOMPurify with an allowlisted inline-style hook; scripts, iframes, event handlers, `url()`, `data:`, and `@import` remain blocked.
8. PDF rendering uses only trusted, sanitized local artifacts.
9. Export/open paths are validated against allowed roots and user-selected destinations.
10. Reference documents are treated as data, never instructions.
11. Telemetry contains no secrets, prompts, or full slide content.
12. macOS hardened runtime and entitlements config are present; signing/notarization activates only when credentials are supplied.

## 9. Test Strategy

### 9.1 Commands

- `npm run test:unit` — Vitest unit tests.
- `npm run test:integration` — Vitest integration tests for SQLite, migration, export mapping, and IPC validation.
- `npm run test:e2e` — Playwright + Electron end-to-end tests.
- `npm run verify` — typecheck + build + smoke build + unit + integration.
- `npm run verify:all` — `npm run verify` + `npm run test:e2e`.

### 9.2 Unit and Integration Coverage

- Parser, outline engine, page generator, template catalog, sanitizer, and edit orchestrator.
- Golden prompt suite with curated prompts and expected slide count, role sequence, language, and structural quality checks.
- Deterministic mock responses for CI and a separate opt-in provider-backed evaluation path for real endpoint quality.
- SQLite schema, transactional writes, migration idempotency, crash recovery, and interrupted-write recovery.
- Credential round-trip using a mocked `safeStorage`; renderer payloads must never contain the key.
- IPC authorization, path traversal, malformed payloads, unknown template ids, and credential exposure attempts.
- PDF/PPTX mapping tests proving content and checksum match the requested artifact version.
- Retry classification, exponential backoff, cancellation, stale-result protection, and version fencing.
- Large-deck performance tests for memory usage and throughput.

### 9.3 E2E Coverage

- Fresh launch, settings, Offline Preview badge, key entry, and mode switch.
- Brief → streaming slides → completed artifact → HTML/PDF/PPTX export.
- Edit → targeted regeneration → new version → untouched slides unchanged.
- Provider failure → retry → cancel flows.
- Telemetry opt-in, redacted view, and clear.
- Crash/interrupted migration recovery from a copied userData fixture.

### 9.4 Visual Regression

- Screenshot baselines for the main window, template gallery, settings, and template previews.
- PDF page screenshot baselines with fixed viewport, fonts, and rendering environment.
- Baselines are stored in-repo and reviewed when template or theme tokens change.

## 10. Acceptance Criteria

- A one-line brief yields a coherent deck with `cover`, `catalog`, chapter/content, and `end` slides.
- Requested page-count bucket is respected within one slide.
- Requested language is honored end-to-end.
- Style preset and template visibly change the rendered look without changing slide text.
- Editing one slide leaves untouched slides byte-for-byte unchanged.
- HTML, PDF, and PPTX exports open correctly and match the requested artifact version.
- No active content exists in generated pages.
- Offline Preview mode is explicit and cannot be mistaken for real AI output.
- SQLite writes survive interruption tests and migration is idempotent.
- Cancellation prevents stale results from overwriting newer edits.
- Telemetry contains no credentials, prompts, or full slide text.
- `npm run verify` and `npm run verify:all` pass locally and in CI.
- Polished unsigned macOS DMG builds successfully; signing/notarization config is ready but inactive.

## 11. Implementation Milestones

Ordered slices; each slice ends with tests and `npm run verify`.

### Slice 1 — Credentials and Gateway

- Add `credentials/keychain.ts` with `safeStorage` encryption, 0600 file permissions, env fallback, and mocked tests.
- Add settings UI and IPC channels.
- Add timeout, bounded retry, cancellation, and gateway diagnostics.
- **Exit:** real endpoint can be configured without exposing the key; offline mode is clearly labeled.

### Slice 2 — SQLite and Telemetry

- Add schema, migrations, transaction helpers, JSON migration, checksum storage, and version snapshots.
- Add opt-in JSONL telemetry with viewer/clear UI.
- **Exit:** session data survives interruption tests; telemetry contains no forbidden data.

### Slice 3 — Test Harness

- Add `test:unit`, `test:integration`, `test:e2e`, golden prompt suite, visual snapshots, and load/cancellation tests.
- **Exit:** all commands run independently and `verify:all` passes.

### Slice 4 — Export

- Implement PDF export from sanitized artifacts.
- Implement PPTX export from structured slide content with `pptxgenjs`.
- Add checksum/version verification tests.
- **Exit:** exports open and match their artifact version.

### Slice 5 — UI and Packaging Polish

- Settings screen, telemetry controls, export menu, Offline Preview badge, retry/cancel controls, session snapshots, and accessibility polish.
- electron-builder DMG/zip config, icon, hardened runtime entitlements, signing/notarization env hooks.
- Update README, architecture.md, desktop.md, todos.md, and milestone.md.
- **Exit:** unsigned DMG builds; docs reflect shipped behavior; acceptance criteria pass.

## 12. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| `safeStorage` unavailable on a machine | Disable credential setting, show Offline Preview, keep env fallback documented |
| Provider outage | Bounded retries, clear error category, cancel/retry UI, mock fallback labeled |
| SQLite corruption | Transactions, backup before migration, integrity checks, crash tests |
| Export/version mismatch | Store checksum, verify before export, test pinned artifact versions |
| Visual regressions | Snapshot baselines and template-token tests |
| Stale async results | Cancellation plus session-version fencing |
| Unsigned DMG Gatekeeper warnings | Documented unsigned build plus ready signing/notarization config |

## 13. Definition of Done

- All five implementation slices complete.
- All P0/P1 desktop items in `todos.md` are checked or explicitly moved to P2 with rationale.
- `npm run verify` and `npm run verify:all` pass.
- Acceptance criteria in §10 pass.
- Docs updated and committed.
- Working tree clean and final commit pushed when explicitly authorized.
