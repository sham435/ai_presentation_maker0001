# AI Presentation Maker — Delivery Milestones

Part of the MyAI agent suite.

> Related docs: [Architecture](./architecture.md) · [Blueprint](./blueprint.md) · [Integration](./integration.md) · [TODOs](./todos.md)

## 1. Approach

Phased delivery: get a thin end-to-end pipeline working first (a bad-but-complete deck beats a
perfect half-deck), then layer on style, streaming UX, editing, languages, and scale.

Durations are indicative and assume a small dedicated team.

## 2. Milestone Summary

| Phase | Name | Focus | Indicative duration |
| --- | --- | --- | --- |
| M0 | Foundations | Contracts, skeleton, infra | 1–2 weeks |
| M1 | MVP: brief → deck | Linear pipeline, one default theme | 2–3 weeks |
| M2 | Style & templates | Preset catalogue, layout engine | 2 weeks |
| M3 | Streaming UX | Progressive preview | 1–2 weeks |
| M4 | Edit loop | Slide-scoped regeneration | 2 weeks |
| M5 | Languages & grounding | i18n + reference docs | 1–2 weeks |
| M6 | Scale & GA | Perf, reliability, polish | 2–3 weeks |

## 3. Phase Detail

### M0 — Foundations

**Objectives**

- Freeze the `PresentationSpec → Outline → Slide → Deck` contracts.
- Stand up the pipeline skeleton and supporting-service stubs.

**Deliverables**

- Typed contracts + schemas.
- Gateway + session store stub.
- CI, telemetry scaffolding.

**Exit criteria**

- A hard-coded spec flows end-to-end to a dummy file.

### M1 — MVP: Brief → Deck

**Objectives**

- Implement parser, outline engine, page generator, renderer, delivery.

**Deliverables**

- One default theme.
- A downloadable deck from a real brief.

**Exit criteria**

- A one-line brief produces a coherent, correct-length deck that opens cleanly.
- Success rate ≥ target on an internal prompt set.

### M2 — Style & Templates

**Objectives**

- Introduce the preset catalogue and a real layout engine.

**Deliverables**

- 6–9 style presets.
- Content/style separation enforced.
- Template versioning.

**Exit criteria**

- Same content renders visibly differently across presets.
- Template swap never mutates slide text.

### M3 — Streaming UX

**Objectives**

- Deliver slides progressively.

**Deliverables**

- Stream events (`plan`, `slide`, `completed`).
- Skeleton placeholders; download gated on completion.

**Exit criteria**

- First slide visible within the latency target.
- Stream always ends in exactly one terminal event.

### M4 — Edit Loop

**Objectives**

- Natural-language, slide-scoped editing.

**Deliverables**

- Edit orchestrator with outline diffing.
- Versioned decks.

**Exit criteria**

- Editing slide N leaves other slides unchanged.
- Re-delivery returns a new version with a fresh link.

### M5 — Languages & Grounding

**Objectives**

- Multi-language output and reference-document grounding.

**Deliverables**

- Language detection + localized generation.
- Reference ingestion (truncate/summarise) feeding the outline.

**Exit criteria**

- Requested language honoured end-to-end.
- Grounded decks reflect reference content without leaking instructions from it.

### M6 — Scale & GA

**Objectives**

- Performance, reliability, and polish for general availability.

**Deliverables**

- Horizontal scaling, caching, cost guardrails.
- Overflow validation, quality dashboards.
- Docs & support runbooks.

**Exit criteria**

- Sustains target throughput at p95 latency.
- Crash/blank-deck rate under threshold.

## 4. Dependencies

- M1 depends on the Model Gateway (see [Integration](./integration.md)).
- M2 depends on the Template/Asset services.
- M4 depends on durable session state (M0).
- M6 depends on telemetry quality signals from all earlier phases.

## 5. Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Model latency variance | Streaming + stage-level retries |
| Layout overflow | Pre-render validation gate |
| Scope creep on editing | Slide-scoped edits only in v1 |
| Provider outage | Multi-provider gateway failover |

**Buffer:** reserve ~15–20% of each phase for integration and rework.

## 6. Definition of Done (per milestone)

- [ ] Feature demoed on a real brief.
- [ ] Automated tests for the affected stage.
- [ ] Telemetry emitted.
- [ ] Docs updated (this set).
- [ ] No open P0 tasks in [TODOs](./todos.md) for that area.
