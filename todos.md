# AI Presentation Maker — TODOs / Task Checklist

Part of the MyAI agent suite.

> Related docs: [Architecture](./architecture.md) · [Blueprint](./blueprint.md) · [Integration](./integration.md) · [Milestones](./milestone.md)

**Legend:** `P0` = blocking · `P1` = important · `P2` = nice-to-have.

## 1. Contracts & Foundations

- [x] `P0` Freeze `PresentationSpec` schema.
- [x] `P0` Freeze `Outline` schema + validation.
- [x] `P0` Freeze `Slide` and `Deck` contracts.
- [ ] `P0` Set up CI + lint + type checks.
- [ ] `P1` Telemetry scaffolding (trace ids, per-stage metrics).

## 2. Request Gateway

- [x] `P0` Auth + payload validation (local desktop session scope).
- [x] `P0` Create-vs-edit routing.
- [ ] `P1` Idempotency-key handling.
- [ ] `P2` Rate limiting per user.

## 3. Intent & Parameter Parser

- [x] `P0` Topic & audience extraction.
- [x] `P0` Page-count bucket mapping.
- [x] `P0` Style-preset selection (with sane default).
- [x] `P0` Language detection (explicit > prompt > default).
- [ ] `P2` Audience-aware tone hints.

## 4. Outline Engine

- [x] `P0` Outline generation prompt + JSON-schema validation.
- [x] `P0` Cover → body → close structure.
- [ ] `P1` Slide-count targeting to match the bucket.
- [ ] `P2` Outline self-critique pass.

## 5. Page Generator & Layout

- [x] `P0` Per-slide content generation.
- [x] `P0` Layout binding (content/style separation).
- [x] `P0` Streaming emission one slide at a time.
- [ ] `P1` Overflow detection (text too long for layout).
- [ ] `P2` Simple chart block support.

## 6. Templates & Themes

- [x] `P1` 6–9 style presets shipped.
- [ ] `P1` Template versioning + pinning per session.
- [ ] `P2` Dark/light variants.

## 7. Assembly & Rendering

- [x] `P0` Slide ordering + outline validation.
- [x] `P0` Sandboxed renderer (no scripts / active content).
- [ ] `P1` Thumbnail preview generation.
- [ ] `P1` Final overflow / blank-page validation gate.

## 8. Delivery

- [x] `P0` Object storage write + content addressing (local artifact store).
- [x] `P0` Time-scoped download link (local file reveal/export path).
- [ ] `P1` Preview card metadata.
- [ ] `P2` Link revocation.

## 9. Edit Loop

- [x] `P0` Load session + outline diff.
- [x] `P0` Regenerate only affected slides.
- [ ] `P1` Deck versioning + re-delivery.
- [ ] `P2` Preserve untouched slides byte-for-byte.

## 10. Internationalization

- [ ] `P1` Localized prompts per supported language.
- [ ] `P1` Font coverage for non-Latin scripts.
- [ ] `P2` RTL layout support.

## 11. Reference-Document Grounding

- [ ] `P1` Ingest + truncate/summarise references.
- [x] `P1` Treat references as data, never instructions.
- [ ] `P2` Citation of referenced material.

## 12. Platform Integration

- [x] `P0` Model Gateway client + retries + failover (mock/local adapter + interface).
- [x] `P0` Session Store read/write (SQLite/local JSON store).
- [ ] `P1` Template & Asset service clients.
- [ ] `P1` Telemetry wiring across stages.

## 13. Performance & Scalability

- [ ] `P1` Stateless, horizontally scalable workers.
- [ ] `P1` Template/theme caching.
- [ ] `P2` Token-budget guardrails per deck.

## 14. Security & Privacy

- [x] `P0` Sanitize all generated markup.
- [x] `P0` Session ownership checks (local desktop user scope).
- [x] `P0` No secrets in client payloads.
- [ ] `P1` Audit log for create/edit.

## 15. Quality & Testing

- [ ] `P0` Unit tests per stage (parser, outline, generator).
- [ ] `P0` End-to-end test: brief → downloadable deck.
- [ ] `P1` Golden-set prompt evaluation.
- [ ] `P1` Cancellation / retry tests.
- [ ] `P2` Load testing at target throughput.

## 16. Documentation & Ops

- [x] `P1` Keep this doc set current.
- [ ] `P1` Runbook for failed decks / provider outages.
- [ ] `P2` User-facing how-to.

## Definition of Done (task)

- [ ] Code + tests merged.
- [ ] Telemetry in place.
- [ ] Docs updated.
- [ ] No regressions in the end-to-end deck test.
