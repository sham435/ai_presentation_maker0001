# Ultimate macOS Desktop Release — Detailed Implementation Plan

**Date:** 2026-11-26  
**Source of truth:** `docs/superpowers/specs/2026-11-26-ultimate-macos-desktop-design.md` (status: Draft)  
**Approach:** Five dependency-ordered slices from spec §11  
**Current state:** No implementation is performed by this plan. The repository is at the committed spec baseline; the earlier partial Slice 1 edits were reverted.

---

## 0. Repository Inspection Summary

Verified from the actual repository before proposing changes:

- **Stack:** Electron 30.5.1, React 18.3.1, TypeScript 5.9.3, Vite 5.4.21, electron-vite 2.3.0, electron-builder 25.1.8.
- **Build:** `electron.vite.config.ts` already builds separate main, preload, and renderer bundles with `@shared` and `@renderer` aliases.
- **Existing main modules:** `src/main/index.ts`, `src/main/ipc.ts`, `src/main/agent/*`, `src/main/store/sessionStore.ts`, `src/main/security/sanitize.ts`, `src/main/telemetry/logger.ts`.
- **Existing renderer:** `src/renderer/src/App.tsx`, `TemplatePickerModal.tsx`, `styles.css`, `main.tsx`.
- **Shared contracts:** `src/shared/types.ts`, `schema.ts`, `ipc.ts`, `templateCatalog.ts`, `constants.ts`.
- **Tests:** `tests/editOrchestrator.test.ts`, `parser.test.ts`, `schema.test.ts`, `templateCatalog.test.ts`, `templateRendering.test.ts` (24 tests total).
- **Scripts:** `dev`, `build`, `typecheck`, `lint`, `test` (smoke + Vitest), `test:unit`, `verify`, `package:mac`, `package:win`, `package:linux`.
- **CI:** `.github/workflows/ci.yml` runs `npm ci`, typecheck, build, and `npm test` on Ubuntu/Node 24.
- **Packaging:** `electron-builder.yml` targets `dmg`/`zip` on macOS; `resources/` currently contains only `.gitkeep` (no icon or entitlements).
- **Environment template:** `.env.example` already documents `MODEL_GATEWAY_URL`, `MODEL_GATEWAY_API_KEY`, `MODEL_NAME`, `MODEL_TIMEOUT_MS`, `STORAGE_DIR`, `TELEMETRY_ENABLED`, `APP_LOG_LEVEL`.

Preservation rule: keep existing IPC channels, agent pipeline, template catalog, sanitizer, and five-role slide rendering intact. Add new behavior through new modules, additive contracts, and narrow edits.

---

## 1. Slice 1 — Credentials and Model Gateway

### Task 1.1 — Add shared settings, credential, and gateway contracts

**Files/modules affected**
- `src/shared/types.ts`
- `src/shared/schema.ts`
- `src/shared/ipc.ts`

**Dependencies / prerequisites**
- None. Must precede IPC and renderer work.

**Implementation steps**
1. Add `AppSettings`, `CredentialStatus`, and `GatewayStatus` interfaces to `src/shared/types.ts`.
2. Add `settingsSetSchema` and `credentialSetSchema` Zod schemas to `src/shared/schema.ts`.
3. Add IPC channels: `settings:get`, `settings:set`, `credentials:status`, `credentials:set`, `credentials:clear`, `gateway:status` to `src/shared/ipc.ts`.
4. Keep all existing channel names and payload shapes unchanged.

**Tests**
- **Unit:** `tests/schema.test.ts` — valid endpoint URL; invalid endpoint; empty API key rejection; unknown fields stripped.
- **Integration:** `tests/integration/ipcSchemas.test.ts` — every new channel has a matching Zod request/response schema.
- **E2E:** Covered by Task 1.4 settings flow and Slice 3 E2E.

**Verification commands**
```bash
npm run typecheck
npm run test:unit
npm run verify
```

**Acceptance criteria**
- New types compile across main, preload, and renderer.
- Invalid endpoint/key payloads are rejected before reaching main-process handlers.
- No existing IPC contract regresses.

**Risks / rollback**
- Risk: duplicate or conflicting channel names. Rollback: revert the three shared files; no runtime state is changed.
- Risk: Zod URL strictness rejects local endpoints. Mitigation: accept `http://localhost`, `http://127.0.0.1`, and valid HTTPS URLs.

---

### Task 1.2 — Implement Keychain-backed credential store

**Files/modules affected**
- New: `src/main/credentials/keychain.ts`
- New: `src/main/credentials/electronKeychain.ts` (thin Electron adapter, if needed to keep tests Electron-free)
- `src/main/ipc.ts`

**Dependencies / prerequisites**
- Task 1.1 contracts.
- Electron `safeStorage` availability on macOS.

**Implementation steps**
1. Implement an injectable `SafeStorageLike` interface with `isEncryptionAvailable`, `encryptString`, and `decryptString`.
2. Store non-secret settings and an encrypted `apiKeyCipher` in `userData/data/settings.json`.
3. Create the file/directory with `0o600` permissions; re-apply permissions after writes.
4. Expose `getSettings`, `updateSettings`, `hasApiKey`, `getApiKey`, `setApiKey`, `clearApiKey`, and `canEncrypt`.
5. Resolve configuration in this order: stored settings → environment variables → default model name.
6. Never return the API key from IPC; return only `hasKey` and `canEncrypt`.
7. Add IPC handlers for all credential/settings channels with Zod validation.

**Tests**
- **Unit:** `tests/credentials.test.ts` — encrypt/decrypt round-trip with mocked storage; missing file; corrupt JSON; unavailable encryption; env fallback; key never appears in public settings.
- **Integration:** `tests/integration/credentialsIpc.test.ts` — set key → status `hasKey: true` → clear → `hasKey: false`; response payload contains no key.
- **E2E:** Slice 3 settings test enters a key, masks it, clears it, and verifies no plaintext key appears in logs or UI state.

**Verification commands**
```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify
```

**Acceptance criteria**
- API key is encrypted at rest via `safeStorage`.
- `settings.json` permissions are `0600` on macOS.
- Renderer receives only `hasKey` and `canEncrypt`, never the key or ciphertext.
- Env fallback works for development.

**Risks / rollback**
- Risk: `safeStorage` unavailable. Mitigation: disable key save, keep Offline Preview, show clear message. Rollback: remove new credential modules and IPC handlers; settings file remains inert.
- Risk: corrupt settings file. Mitigation: treat as empty and rewrite on next successful update.

---

### Task 1.3 — Add retries, cancellation, and error categories to ModelGateway

**Files/modules affected**
- `src/main/agent/modelGateway.ts`
- `src/main/credentials/keychain.ts` (config resolution from Task 1.2)

**Dependencies / prerequisites**
- Task 1.2 credential config resolution.

**Implementation steps**
1. Extend `ModelRequest` with optional `signal?: AbortSignal`.
2. Add `ModelGatewayError` with categories: config, auth, request, rate-limit, server, network, timeout, parse, cancelled.
3. Retry only transient failures (`429`, `5xx`, network, timeout), maximum two retries, exponential backoff starting at 250 ms.
4. Never retry `401`, `403`, `400`, parse failures, or cancellation.
5. Use `AbortSignal` from the caller and an internal `AbortController` for timeout.
6. Use `MODEL_TIMEOUT_MS` from env with 30000 ms default.
7. Keep `MockModelGateway` behavior unchanged except for honoring abort.
8. Add dynamic gateway selection: live when endpoint configured, offline preview otherwise.

**Tests**
- **Unit:** `tests/modelGateway.test.ts` — success; 429 retry; 500 retry; 401 no retry; malformed JSON no retry; timeout retry; abort rejection; Authorization header present/absent.
- **Integration:** `tests/integration/gatewayConfig.test.ts` — stored config overrides env; env used when no stored config; missing endpoint selects mock.
- **E2E:** Slice 3 failure/retry/cancel scenario.

**Verification commands**
```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify
```

**Acceptance criteria**
- Bounded retries never exceed two attempts after the initial request.
- Cancellation stops in-flight work and cannot produce a late success.
- Error categories are stable and testable.
- Offline mode still works without credentials.

**Risks / rollback**
- Risk: double-abort handling leaks listeners. Mitigation: always remove listeners in `finally`. Rollback: restore previous `modelGateway.ts`; credential store remains usable but gateway reverts to single attempt.

---

### Task 1.4 — Add settings UI and Offline Preview badge

**Files/modules affected**
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `src/main/ipc.ts`
- `src/renderer/src/App.tsx`
- New: `src/renderer/src/components/SettingsModal.tsx`
- `src/renderer/src/styles.css`
- `src/renderer/index.html`

**Dependencies / prerequisites**
- Tasks 1.1–1.3.

**Implementation steps**
1. Expose typed preload methods for settings get/set, credential status/set/clear, and gateway status.
2. Add a Settings modal with endpoint, model, API key, save, and clear controls.
3. Show API key status only as a masked badge (`Stored` / `Not set`).
4. Show persistent **Offline Preview** badge when `gatewayStatus.mode === 'offline-preview'`.
5. Add strict CSP meta tag to `renderer/index.html`: no inline/remote script, no eval; inline styles allowed only for React/template preview layout; `frame-src 'self'`; `object-src 'none'`.
6. Preserve existing brief, template gallery, streaming preview, and edit flows.

**Tests**
- **Unit:** `tests/settingsStatus.test.ts` — mode mapping, masked status, default model.
- **Integration:** `tests/integration/preloadApi.test.ts` — preload exposes only expected methods and no generic invoke.
- **E2E:** Slice 3 startup test verifies Offline Preview badge; settings test saves/clears a key and verifies status.

**Verification commands**
```bash
npm run typecheck
npm run build
npm run test:unit
npm run test:integration
npm run verify
```

**Acceptance criteria**
- User can configure endpoint/model/key without restarting the app.
- Key is never displayed or returned.
- Offline Preview is unmistakable.
- Renderer still uses typed IPC only.

**Risks / rollback**
- Risk: CSP blocks Vite dev HMR. Mitigation: allow local `ws://localhost` and `ws://127.0.0.1` connect sources only; verify `npm run dev`. Rollback: revert CSP line and renderer files.
- Risk: settings modal overlaps template picker. Mitigation: reuse modal styles and focus trap pattern.

---

## 2. Slice 2 — SQLite and Telemetry

### Task 2.1 — Add SQLite schema, migrations, and transaction helpers

**Files/modules affected**
- New: `src/main/store/sqlite.ts`
- New: `src/main/store/migrations.ts`
- `src/main/store/sessionStore.ts`
- `src/shared/types.ts` (artifact checksum/snapshot fields if needed)

**Dependencies / prerequisites**
- Slice 1 complete.
- `better-sqlite3` already installed.

**Implementation steps**
1. Create `userData/data/presentation.db`.
2. Define tables: `sessions`, `slides`, `artifacts`, `events`, `settings`, `migrations`.
3. Add idempotent migrations using `CREATE TABLE IF NOT EXISTS` and `PRAGMA user_version` or a migrations table.
4. Add transaction wrappers for create, update, and delete operations.
5. Add integrity check on startup and backup before any schema change.
6. Preserve `sessions.json` as a backup after migration.

**Tests**
- **Unit:** `tests/sqliteSchema.test.ts` — migration applies twice safely; tables/columns exist; transaction rollback works.
- **Integration:** `tests/integration/sessionStoreSqlite.test.ts` — save/get/list session with slides and artifact.
- **E2E:** Slice 3 crash-recovery test copies a fixture userData directory and launches app.

**Verification commands**
```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify
```

**Acceptance criteria**
- Migrations are idempotent and append-only.
- Multi-row writes are atomic.
- Existing JSON sessions remain readable after migration.
- No `DROP TABLE`, `TRUNCATE`, or destructive column changes.

**Risks / rollback**
- Risk: native module mismatch after packaging. Mitigation: electron-builder rebuild config; smoke test packaged app. Rollback: keep JSON store path via feature flag; revert `sessionStore.ts`.

---

### Task 2.2 — Migrate sessions from JSON to SQLite transactionally

**Files/modules affected**
- `src/main/store/sessionStore.ts`
- `src/main/store/migrations.ts`
- New: `tests/fixtures/sessions-legacy.json`

**Dependencies / prerequisites**
- Task 2.1.

**Implementation steps**
1. Detect legacy `sessions.json` when SQLite has no sessions.
2. Parse and validate legacy sessions; skip invalid entries with a logged warning.
3. Insert sessions, slides, and artifact rows in one transaction.
4. Rename original file to `sessions.json.migrated` rather than deleting it.
5. Make repeated launches no-op once migrated.

**Tests**
- **Unit:** `tests/sessionMigration.test.ts` — valid migration; duplicate launch no-op; malformed session skipped; transaction rollback on partial failure.
- **Integration:** `tests/integration/migrationRecovery.test.ts` — interrupted write fixture recovers without data loss.
- **E2E:** Slice 3 launches with copied legacy userData and confirms sessions appear.

**Verification commands**
```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify
```

**Acceptance criteria**
- Migration is idempotent and non-destructive.
- No session is partially written.
- Original JSON remains available as `sessions.json.migrated`.

**Risks / rollback**
- Risk: schema drift in old sessions. Mitigation: tolerant parser with defaults; skipped records logged. Rollback: restore `sessions.json.migrated` to `sessions.json`.

---

### Task 2.3 — Implement local opt-in JSONL telemetry

**Files/modules affected**
- `src/main/telemetry/logger.ts`
- New: `src/main/telemetry/jsonl.ts`
- `src/main/ipc.ts`
- `src/shared/ipc.ts`
- `src/shared/schema.ts`
- `src/renderer/src/components/TelemetryPanel.tsx`
- `src/renderer/src/App.tsx`
- `src/renderer/src/styles.css`

**Dependencies / prerequisites**
- Task 1.1 settings schema.
- Task 2.1 SQLite event table optional but recommended for indexing.

**Implementation steps**
1. Add telemetry channels: `telemetry:list`, `telemetry:clear`.
2. Write JSONL to `userData/data/telemetry.jsonl` only when `telemetryOptIn` is true.
3. Redact prompts, brief text, slide text, file paths beyond basename, and credentials.
4. Include correlation id, stage, status, duration, and error category.
5. Add renderer toggle, redacted viewer, and clear button.
6. Keep console logging for development.

**Tests**
- **Unit:** `tests/telemetry.test.ts` — opt-out writes nothing; redaction removes forbidden fields; malformed lines ignored by reader.
- **Integration:** `tests/integration/telemetryIpc.test.ts` — toggle on/off; list returns redacted records; clear empties file.
- **E2E:** Slice 3 telemetry test toggles, generates a deck, views log, clears log.

**Verification commands**
```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify
```

**Acceptance criteria**
- Telemetry is off by default.
- No credentials, prompts, full slide text, or reference text appear in JSONL.
- User can view and clear telemetry from the app.

**Risks / rollback**
- Risk: accidental sensitive text in error messages. Mitigation: allowlist fields before writing. Rollback: disable writes via setting; delete JSONL.

---

### Task 2.4 — Make create/edit persistence transactional and version-fenced

**Files/modules affected**
- `src/main/agent/orchestrator.ts`
- `src/main/agent/editOrchestrator.ts`
- `src/main/agent/renderer.ts`
- `src/main/store/sessionStore.ts`
- `src/shared/types.ts`

**Dependencies / prerequisites**
- Tasks 2.1–2.3.

**Implementation steps**
1. Store session, slides, artifact, and event metadata in one transaction at completion.
2. Add artifact checksum and template/theme version to `DeckArtifact`.
3. Add session version fencing so stale async results cannot overwrite newer edits.
4. Emit exactly one terminal event (`completed` or `error`) per operation.
5. Preserve streaming `plan` and `slide` events.

**Tests**
- **Unit:** `tests/orchestratorTransactions.test.ts` — rollback on renderer failure; version increments.
- **Integration:** `tests/integration/editVersioning.test.ts` — edit leaves untouched slides byte-for-byte; stale result rejected.
- **E2E:** Slice 3 edit test verifies version bump and untouched slides.

**Verification commands**
```bash
npm run typecheck
npm run test:unit
npm run test:integration
npm run verify
```

**Acceptance criteria**
- No partial session/artifact state after failure.
- Each artifact has a version and checksum.
- Stale generation cannot overwrite a newer session version.

**Risks / rollback**
- Risk: version fencing blocks legitimate rapid edits. Mitigation: explicit operation ids and cancel support from Slice 1. Rollback: revert orchestrator/store changes; JSON store preserved.

---

## 3. Slice 3 — Test Harness

### Task 3.1 — Split test commands and wire CI

**Files/modules affected**
- `package.json`
- `vitest.config.ts`
- New: `vitest.integration.config.ts`
- New: `playwright.config.ts`
- `.github/workflows/ci.yml`

**Dependencies / prerequisites**
- Slices 1–2 code complete.

**Implementation steps**
1. Add `test:integration`, `test:e2e`, and `verify:all`.
2. Keep `test:unit` as Vitest unit suite.
3. Keep `verify` as typecheck + build + smoke + unit + integration.
4. Add CI matrix job for `verify` and a macOS job for E2E/visual if runner availability permits.

**Tests**
- **Unit:** Existing suites continue to pass.
- **Integration:** New integration suites run via `vitest.integration.config.ts`.
- **E2E:** Playwright config launches packaged or dev Electron app.

**Verification commands**
```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run verify
npm run verify:all
```

**Acceptance criteria**
- Each command runs independently.
- `verify:all` runs the complete pipeline.
- CI reproduces local unit/integration results.

**Risks / rollback**
- Risk: macOS E2E runner unavailable. Mitigation: E2E remains locally runnable; CI runs non-E2E by default. Rollback: revert package scripts and CI file.

---

### Task 3.2 — Add golden prompt suite

**Files/modules affected**
- New: `tests/golden/prompts.json`
- New: `tests/golden/expectations.ts`
- New: `tests/golden/evaluate.test.ts`
- `src/main/agent/outlineEngine.ts` (only if hooks needed)

**Dependencies / prerequisites**
- Task 3.1.

**Implementation steps**
1. Curate prompts covering business, education, research, marketing, short/long, and Chinese language.
2. Define expected slide count range, role sequence, language, and structural quality checks.
3. Use deterministic mock responses in CI.
4. Add opt-in provider-backed evaluation script `npm run eval:live` using real credentials.

**Tests**
- **Unit:** `tests/golden/evaluate.test.ts` — all deterministic cases pass.
- **Integration:** `tests/integration/goldenPipeline.test.ts` — brief → outline → slides respects expectations.
- **E2E:** Slice 3 create flow uses one golden prompt fixture.

**Verification commands**
```bash
npm run test:unit
npm run test:integration
npm run verify
```

**Acceptance criteria**
- Golden suite has measurable pass/fail.
- CI uses deterministic mocks.
- Live evaluation is separate from normal verification.

**Risks / rollback**
- Risk: brittle expectations. Mitigation: ranges and role-pattern checks, not exact text. Rollback: remove golden files; no runtime impact.

---

### Task 3.3 — Add visual regression tests

**Files/modules affected**
- New: `tests/e2e/visual.spec.ts`
- New: `tests/visual/baselines/**`
- `playwright.config.ts`

**Dependencies / prerequisites**
- Task 3.1; stable template gallery from previous release.

**Implementation steps**
1. Pin viewport, device scale, fonts, and reduced-motion settings.
2. Capture screenshots for main window, template gallery, settings modal, and five-role previews.
3. Capture PDF page screenshots after Slice 4.
4. Store baselines in repo and document baseline update procedure.

**Tests**
- **Unit:** None (visual tests are E2E by nature).
- **Integration:** `tests/integration/visualBaselineManifest.test.ts` validates baseline manifest entries.
- **E2E:** `npm run test:e2e -- visual.spec.ts` compares screenshots.

**Verification commands**
```bash
npm run test:e2e -- visual.spec.ts
npm run verify:all
```

**Acceptance criteria**
- Visual baseline suite passes on the pinned environment.
- Baseline update command is documented.
- No baseline depends on network assets.

**Risks / rollback**
- Risk: platform font differences. Mitigation: use system font stack and pinned macOS runner for baselines. Rollback: delete new baselines/spec; no app code affected.

---

### Task 3.4 — Add IPC security, load, cancellation, and race tests

**Files/modules affected**
- New: `tests/integration/ipcSecurity.test.ts`
- New: `tests/integration/loadCancellation.test.ts`
- New: `tests/e2e/failureRetryCancel.spec.ts`
- `src/main/ipc.ts` (only if hooks needed)

**Dependencies / prerequisites**
- Tasks 1.3, 2.4, 3.1.

**Implementation steps**
1. Test IPC authorization, path traversal, malformed payloads, unknown channels, and credential exposure attempts.
2. Test large decks (30 slides), concurrent generation, throughput, and memory growth.
3. Test cancellation during generation and verify no stale result overwrites newer edits.
4. Test provider failure → retry → success and failure → cancel.

**Tests**
- **Unit:** Categorization and fencing helpers.
- **Integration:** IPC security matrix; load/cancellation race matrix.
- **E2E:** failure/retry/cancel UI flow.

**Verification commands**
```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run verify:all
```

**Acceptance criteria**
- Unauthorized and malformed IPC calls are rejected.
- Cancelled operations cannot overwrite newer versions.
- Large-deck tests complete without unbounded memory growth.

**Risks / rollback**
- Risk: flaky timing tests. Mitigation: deterministic injected delays and operation ids. Rollback: remove new tests; no runtime impact.

---

## 4. Slice 4 — PDF and PPTX Export

### Task 4.1 — Implement PDF export from sanitized artifact

**Files/modules affected**
- New: `src/main/export/pdf.ts`
- `src/main/ipc.ts`
- `src/shared/ipc.ts`
- `src/shared/schema.ts`
- `src/preload/index.ts`
- `src/renderer/src/components/ExportMenu.tsx`
- `src/renderer/src/App.tsx`

**Dependencies / prerequisites**
- Slices 1–3 complete; artifact checksum verified.

**Implementation steps**
1. Add `deck:export-pdf` IPC channel with `{ sessionId, version }` payload.
2. Resolve artifact path from session store; validate path under artifact root.
3. Verify stored checksum before export.
4. Load artifact in a hidden, sandboxed `BrowserWindow` and call `printToPDF`.
5. Use native save dialog; write PDF to user-selected path.
6. Add PDF button to renderer export menu.

**Tests**
- **Unit:** `tests/pdfExport.test.ts` — path validation, checksum mismatch rejection, print options mapping.
- **Integration:** `tests/integration/pdfExport.test.ts` — exported PDF contains expected slide count metadata.
- **E2E:** `tests/e2e/export.spec.ts` — create deck → export PDF → file exists and opens.

**Verification commands**
```bash
npm run typecheck
npm run build
npm run test:unit
npm run test:integration
npm run test:e2e
npm run verify
```

**Acceptance criteria**
- PDF export uses only sanitized trusted artifacts.
- Exported content matches requested artifact version.
- Checksum mismatch blocks export.

**Risks / rollback**
- Risk: `printToPDF` timing. Mitigation: wait for `did-finish-load` and document fonts. Rollback: remove channel/button/module.

---

### Task 4.2 — Implement editable PPTX export

**Files/modules affected**
- `package.json` and `package-lock.json` (pin `pptxgenjs@4.0.1`)
- New: `src/main/export/pptx.ts`
- `src/main/ipc.ts`
- `src/shared/ipc.ts`
- `src/shared/schema.ts`
- `src/preload/index.ts`
- `src/renderer/src/components/ExportMenu.tsx`

**Dependencies / prerequisites**
- Task 4.1 export plumbing; structured `Slide[]` content available.

**Implementation steps**
1. Add `deck:export-pptx` channel with `{ sessionId, version }` payload.
2. Map canonical slide roles to PPTX layouts.
3. Use `Slide.content.headline`, `bullets`, and `citations`; never copy generated HTML into PPTX.
4. Apply template theme tokens: background, text, accent, fonts.
5. Use native save dialog and verify artifact checksum before export.
6. Add PPTX button to renderer export menu.

**Tests**
- **Unit:** `tests/pptxExport.test.ts` — role/layout mapping, theme token mapping, text escaping, citation rendering.
- **Integration:** `tests/integration/pptxExport.test.ts` — generated PPTX contains expected text and slide count.
- **E2E:** `tests/e2e/export.spec.ts` — create deck → export PPTX → file exists and opens.

**Verification commands**
```bash
npm run typecheck
npm run build
npm run test:unit
npm run test:integration
npm run test:e2e
npm run verify
```

**Acceptance criteria**
- PPTX is editable, not an image dump.
- Text and theme tokens match the requested artifact version.
- No generated HTML or active content is copied into PPTX.

**Risks / rollback**
- Risk: font differences alter layout. Mitigation: system font stack and simple text boxes. Rollback: remove dependency, module, and channel.
- Risk: native dependency install failure. Mitigation: `pptxgenjs` is pure JS; pin exact version.

---

### Task 4.3 — Verify export integrity across all formats

**Files/modules affected**
- `tests/integration/exportIntegrity.test.ts`
- `src/main/agent/renderer.ts` (checksum exposure if needed)
- `src/shared/types.ts`

**Dependencies / prerequisites**
- Tasks 4.1 and 4.2.

**Implementation steps**
1. Add a test helper that creates a fixed deck with known slides and template.
2. Verify HTML, PDF, and PPTX exports against the same artifact id, version, and checksum.
3. Verify theme change produces different export output while slide text remains unchanged.
4. Verify stale version requests are rejected.

**Tests**
- **Unit:** Checksum and version comparison helpers.
- **Integration:** Full export integrity matrix.
- **E2E:** Export all three formats from one session and verify filenames/version labels.

**Verification commands**
```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run verify:all
```

**Acceptance criteria**
- Every export is tied to one artifact version.
- Stale or mismatched versions fail clearly.
- Theme changes visibly alter exports without changing text.

**Risks / rollback**
- Risk: checksum stored too late. Mitigation: compute before marking complete. Rollback: revert checksum fields and integrity tests.

---

## 5. Slice 5 — UI and Packaging Polish

### Task 5.1 — Polish settings, export, retry/cancel, and telemetry UI

**Files/modules affected**
- `src/renderer/src/App.tsx`
- `src/renderer/src/components/SettingsModal.tsx`
- New: `src/renderer/src/components/ExportMenu.tsx`
- New: `src/renderer/src/components/TelemetryPanel.tsx`
- New: `src/renderer/src/components/StatusBar.tsx`
- `src/renderer/src/styles.css`
- `src/renderer/src/TemplatePickerModal.tsx`

**Dependencies / prerequisites**
- Slices 1–4 complete.

**Implementation steps**
1. Add status bar showing live/offline mode, gateway model, artifact version, and telemetry state.
2. Add export menu with HTML/PDF/PPTX actions.
3. Add retry/cancel controls tied to correlation ids.
4. Improve focus management, keyboard access, empty/error states, and responsive layout.
5. Keep template picker single-click preview plus explicit apply behavior.

**Tests**
- **Unit:** Status formatting helpers.
- **Integration:** UI state mapping from gateway/session/telemetry status.
- **E2E:** Full create → edit → export → telemetry flow; accessibility focus checks.

**Verification commands**
```bash
npm run typecheck
npm run build
npm run test:unit
npm run test:integration
npm run test:e2e
npm run verify:all
```

**Acceptance criteria**
- All production controls are accessible and visible.
- Offline Preview cannot be mistaken for live generation.
- No regressions in template picker or slide preview.

**Risks / rollback**
- Risk: UI state explosion. Mitigation: small typed view-model helpers. Rollback: revert renderer files; backend behavior remains.

---

### Task 5.2 — Configure unsigned macOS DMG with signing hooks

**Files/modules affected**
- `electron-builder.yml`
- New: `resources/entitlements.mac.plist`
- New: `resources/icon.icns`
- `package.json`
- `.env.example`
- New: `docs/packaging.md`

**Dependencies / prerequisites**
- Build passes; no Apple Developer credentials available per locked decision.

**Implementation steps**
1. Configure macOS `dmg` and `zip` targets with `hardenedRuntime: true`.
2. Add entitlements file for JIT and native modules.
3. Add icon; current `resources/` has only `.gitkeep`.
4. Add env-driven signing/notarization config that is inactive unless `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, and `APPLE_ID_PASSWORD` are present.
5. Document unsigned DMG behavior and Gatekeeper workaround.
6. Keep Windows/Linux targets buildable.

**Tests**
- **Unit:** Packaging config validation helper.
- **Integration:** `npm run build && npm run package:mac -- --dir` produces app bundle.
- **E2E:** Launch packaged unsigned app and run mock generate flow.

**Verification commands**
```bash
npm run build
npm run package:mac
npm run verify:all
```

**Acceptance criteria**
- `npm run package:mac` produces a DMG locally without signing credentials.
- Signing/notarization activates only when credentials are supplied.
- Packaged app launches and uses SQLite/credentials correctly.

**Risks / rollback**
- Risk: `better-sqlite3` native rebuild inside asar. Mitigation: `asarUnpack` if required.
- Risk: Gatekeeper blocks unsigned app. Mitigation: documented local decision and ready signing config. Rollback: revert `electron-builder.yml` and remove new resources.

---

### Task 5.3 — Update documentation and close checklist

**Files/modules affected**
- `README.md`
- `architecture.md`
- `desktop.md`
- `integration.md`
- `todos.md`
- `milestone.md`
- `docs/superpowers/specs/2026-11-26-ultimate-macos-desktop-design.md`
- `docs/packaging.md`

**Dependencies / prerequisites**
- All implementation tasks complete.

**Implementation steps**
1. Document settings/keychain, Offline Preview, SQLite migration, telemetry, exports, and packaging.
2. Check off completed P0/P1 items in `todos.md`; move deferred P2 items with rationale only if needed.
3. Update architecture diagrams and component tables.
4. Update milestone exit criteria with verified results.
5. Keep spec status Draft unless user explicitly approves final status change.

**Tests**
- **Unit:** None.
- **Integration:** Doc link checker script if added.
- **E2E:** User-facing flow matches README steps.

**Verification commands**
```bash
npm run verify:all
git diff --check
```

**Acceptance criteria**
- Docs match shipped behavior.
- No stale claims about mock-only mode or JSON-only storage.
- Deferred items are explicit.

**Risks / rollback**
- Risk: documentation drift. Mitigation: final review against acceptance criteria. Rollback: revert docs only.

---

### Task 5.4 — Final verification and release commit

**Files/modules affected**
- Entire working tree; no new code expected.

**Dependencies / prerequisites**
- Tasks 5.1–5.3.

**Implementation steps**
1. Run full verification ladder.
2. Review `git status` and final diff.
3. Commit implementation with a descriptive message only when explicitly authorized.
4. Push only when explicitly authorized.

**Tests**
- **Unit:** `npm run test:unit`
- **Integration:** `npm run test:integration`
- **E2E:** `npm run test:e2e`
- **Full:** `npm run verify:all`

**Verification commands**
```bash
npm run verify
npm run verify:all
npm run package:mac
git status --short --branch
git diff --check
```

**Acceptance criteria**
- All verification commands pass.
- Working tree is clean after authorized commit.
- Spec §10 acceptance criteria pass.

**Risks / rollback**
- Risk: late regression from packaging config. Mitigation: rerun `npm run verify:all` after packaging changes. Rollback: revert final commit or use per-slice commits if authorized.

---

## 6. Cross-Slice Verification Matrix

| Slice | Unit | Integration | E2E | Key command |
| --- | --- | --- | --- | --- |
| 1 | schema, credentials, gateway status | IPC, preload surface | settings/offline badge | `npm run verify` |
| 2 | sqlite, migration, telemetry | session store, migration recovery | legacy userData launch | `npm run verify` |
| 3 | golden, helpers | IPC security, load/cancel | visual, failure/retry/cancel | `npm run verify:all` |
| 4 | PDF/PPTX mapping | export integrity | create → export all formats | `npm run verify:all` |
| 5 | status helpers | UI state mapping | full production flow | `npm run verify:all` + `npm run package:mac` |

---

## 7. Outstanding Questions

1. **Push authorization:** Should each slice be committed and pushed as it passes verification, or should all changes remain local until a final review? Project memory currently says not to commit unless explicitly asked; the spec commit was explicitly authorized.
2. **Credential storage form:** Is Electron `safeStorage` ciphertext in `userData/data/settings.json` acceptable, or do you require a direct macOS Keychain item through a native keyring module? The spec currently chooses `safeStorage`.
3. **Live provider credentials:** Are usable endpoint/model/key values available for provider-backed evaluation? If not, CI and local E2E will use deterministic mocks and live evaluation will remain opt-in.
4. **Visual baselines:** Do you accept storing screenshot and PDF baseline images in the repository? Stable baselines require a pinned macOS rendering environment and system fonts.
5. **App icon:** `resources/` contains only `.gitkeep`. Should I generate an original macOS `.icns` icon from the existing app identity, or will you supply one?
6. **Spec status:** You asked to keep the spec Draft until implementation details and dependency versions are verified. Versions are now verified and recorded in §2.1 of the spec; should the status remain Draft until final acceptance, or change to Approved before implementation begins?
