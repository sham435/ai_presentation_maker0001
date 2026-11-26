import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AgentEvent, DeckArtifact, DeckSession, Slide } from '@shared/types'
import { openDatabase } from '../../src/main/store/db'
import { SessionStore } from '../../src/main/store/sessionStore'
import { ModelGatewayError, type ModelGateway, type RetryInfo } from '../../src/main/agent/modelGateway'
import { PresentationOrchestrator } from '../../src/main/agent/orchestrator'

const dirs: string[] = []

class TaggedModel implements ModelGateway {
  constructor(private readonly tag: string, private readonly delayMs = 0) {}

  async complete(req: { prompt: string; signal?: AbortSignal; onRetry?: (info: RetryInfo) => void }): Promise<string> {
    if (req.signal?.aborted) throw new ModelGatewayError('Generation cancelled', 'cancelled', false)
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    if (req.signal?.aborted) throw new ModelGatewayError('Generation cancelled', 'cancelled', false)
    if (req.prompt.includes('Return JSON outline')) {
      return JSON.stringify({
        title: 'Original deck',
        slides: [
          { index: 1, role: 'cover', headline: 'Cover', points: ['Intro'] },
          { index: 2, role: 'catalog', headline: 'Agenda', points: ['One', 'Two'] },
          { index: 3, role: 'content', headline: 'Content', points: ['Point'] },
          { index: 4, role: 'end', headline: 'End', points: ['Thanks'] }
        ]
      })
    }
    return JSON.stringify({ headline: `${this.tag} slide`, bullets: [`${this.tag} point`] })
  }
}

function makeStore(): SessionStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-cancel-'))
  dirs.push(dir)
  return new SessionStore({ db: openDatabase(path.join(dir, 'presentation.db')) })
}

function slide(index: number, role: Slide['role'], headline: string): Slide {
  return {
    index,
    role,
    layout: role,
    theme: 'test@v1',
    content: { headline, bullets: [headline] },
    html: `<section class="slide">${headline}</section>`
  }
}

function existingSession(): DeckSession {
  return {
    id: 'session-1',
    spec: {
      sessionId: 'session-1',
      mode: 'create',
      topic: 'Original deck',
      audience: 'Reviewers',
      language: 'en',
      pageCountBucket: 'short',
      styleClass: 'Business',
      templateId: 'business-classic',
      referenceDocs: [],
      brief: 'Original brief'
    },
    outline: {
      title: 'Original deck',
      slides: [
        { index: 1, role: 'cover', headline: 'Cover', points: ['Intro'] },
        { index: 2, role: 'catalog', headline: 'Agenda', points: ['One', 'Two'] },
        { index: 3, role: 'content', headline: 'Content', points: ['Point'] },
        { index: 4, role: 'end', headline: 'End', points: ['Thanks'] }
      ]
    },
    slides: [
      slide(1, 'cover', 'Cover'),
      slide(2, 'catalog', 'Agenda'),
      slide(3, 'content', 'Original slide 3'),
      slide(4, 'end', 'End')
    ],
    status: 'completed',
    updatedAt: '2026-11-26T00:00:00.000Z'
  }
}

function render(sessionId: string, version: number, _title: string, slides: Slide[]): DeckArtifact {
  return {
    sessionId,
    version,
    slideCount: slides.length,
    filePath: `/tmp/${sessionId}-v${version}.html`,
    checksum: 'test-checksum',
    createdAt: '2026-11-26T00:00:00.000Z'
  }
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('cancellation, concurrency and stale-result protection', () => {
  it('does not persist error state for a cancelled operation', async () => {
    const store = makeStore()
    store.save(existingSession())
    const orchestrator = new PresentationOrchestrator({ store, model: new TaggedModel('slow', 30), render })
    const controller = new AbortController()

    const pending = orchestrator.edit(
      { sessionId: 'session-1', instruction: 'Change slide 3', operationId: 'op-cancel' },
      () => {},
      controller.signal
    )
    controller.abort()
    await pending

    const stored = store.get('session-1')!
    expect(stored.status).toBe('completed')
    expect(stored.slides.find((s) => s.index === 3)?.content.headline).toBe('Original slide 3')
    expect(stored.operationId).not.toBe('op-cancel')
  })

  it('discards a superseded result while keeping the newer edit', async () => {
    const store = makeStore()
    store.save(existingSession())
    const orchestrator = new PresentationOrchestrator({ store, model: new TaggedModel('slow', 30), render })
    const fastOrchestrator = new PresentationOrchestrator({ store, model: new TaggedModel('fast', 0), render })

    const slow = orchestrator.edit(
      { sessionId: 'session-1', instruction: 'Change slide 3', operationId: 'op-slow' },
      (_event: AgentEvent) => {}
    )
    const fast = fastOrchestrator.edit(
      { sessionId: 'session-1', instruction: 'Change slide 3', operationId: 'op-fast' },
      (_event: AgentEvent) => {}
    )
    await Promise.all([slow, fast])

    const stored = store.get('session-1')!
    expect(stored.operationId).toBe('op-fast')
    expect(stored.slides.find((s) => s.index === 3)?.content.headline).toBe('fast slide')
    expect(stored.status).toBe('completed')
  })

  it('keeps the previous session intact when an interrupted write rolls back', () => {
    const store = makeStore()
    const saved = store.save(existingSession())!
    store.db.exec(`
      CREATE TRIGGER fail_slide_insert BEFORE INSERT ON slides
      BEGIN SELECT RAISE(ABORT, 'simulated interruption'); END
    `)

    expect(() => store.save({ ...saved, status: 'error' }, { expectedRevision: saved.revision })).toThrow()
    expect(store.get('session-1')?.status).toBe('completed')
  })
})

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

/** Deterministic barrier: no sleeps, the test releases the provider explicitly. */
class GatedModel implements ModelGateway {
  readonly observedAbort: boolean[] = []
  abortedAfterGate = false

  constructor(private readonly gate: Promise<void>, private readonly gateAt: 'outline' | 'slide') {}

  async complete(req: { prompt: string; signal?: AbortSignal; onRetry?: (info: RetryInfo) => void }): Promise<string> {
    this.observedAbort.push(Boolean(req.signal?.aborted))
    const isOutline = req.prompt.includes('Return JSON outline')
    if ((isOutline && this.gateAt === 'outline') || (!isOutline && this.gateAt === 'slide')) {
      await this.gate
    }
    if (req.signal?.aborted) {
      this.abortedAfterGate = true
      throw new ModelGatewayError('Generation cancelled', 'cancelled', false)
    }
    if (isOutline) {
      return JSON.stringify({
        title: 'Original deck',
        slides: [
          { index: 1, role: 'cover', headline: 'Cover', points: ['Intro'] },
          { index: 2, role: 'catalog', headline: 'Agenda', points: ['One', 'Two'] },
          { index: 3, role: 'content', headline: 'Content', points: ['Point'] },
          { index: 4, role: 'end', headline: 'End', points: ['Thanks'] }
        ]
      })
    }
    return JSON.stringify({ headline: `${this.gateAt} slide`, bullets: ['Point'] })
  }
}

describe('deterministic cancellation barriers', () => {
  it('aborts an in-flight provider request and emits no completion', async () => {
    const store = makeStore()
    const gate = deferred()
    const model = new GatedModel(gate.promise, 'outline')
    const orchestrator = new PresentationOrchestrator({ store, model, render })
    const controller = new AbortController()
    const events: AgentEvent[] = []

    const pending = orchestrator.create({ brief: 'Original brief', operationId: 'op-abort-request' }, (e) => events.push(e), controller.signal)
    controller.abort()
    gate.resolve()
    await pending

    expect(model.abortedAfterGate).toBe(true)
    expect(events.some((e) => e.type === 'completed')).toBe(false)
    expect(events.some((e) => e.type === 'cancelled' && e.correlationId === 'op-abort-request')).toBe(true)
    expect(store.get('session-1')).toBeUndefined()
  })

  it('aborts during slide generation without emitting a completion or new artifact', async () => {
    const store = makeStore()
    store.save(existingSession())
    const gate = deferred()
    const model = new GatedModel(gate.promise, 'slide')
    const orchestrator = new PresentationOrchestrator({ store, model, render })
    const controller = new AbortController()
    const events: AgentEvent[] = []

    const pending = orchestrator.edit({ sessionId: 'session-1', instruction: 'Change slide 3', operationId: 'op-abort-slide' }, (e) => events.push(e), controller.signal)
    controller.abort()
    gate.resolve()
    await pending

    expect(model.abortedAfterGate).toBe(true)
    expect(events.some((e) => e.type === 'completed')).toBe(false)
    expect(events.some((e) => e.type === 'cancelled' && e.correlationId === 'op-abort-slide')).toBe(true)
    expect(store.get('session-1')?.artifact).toBeUndefined()
    expect(store.get('session-1')?.status).toBe('completed')
  })

  it('suppresses a stale completion after a newer operation owns the session', async () => {
    const store = makeStore()
    store.save(existingSession())
    const gate = deferred()
    const slow = new PresentationOrchestrator({ store, model: new GatedModel(gate.promise, 'slide'), render })
    const fast = new PresentationOrchestrator({ store, model: new TaggedModel('newer', 0), render })
    const slowEvents: AgentEvent[] = []
    const fastEvents: AgentEvent[] = []

    const pendingSlow = slow.edit({ sessionId: 'session-1', instruction: 'Change slide 3', operationId: 'op-stale' }, (e) => slowEvents.push(e))
    const pendingFast = fast.edit({ sessionId: 'session-1', instruction: 'Change slide 3', operationId: 'op-newer' }, (e) => fastEvents.push(e))
    const newer = await pendingFast
    gate.resolve()
    await pendingSlow

    expect(fastEvents.some((e) => e.type === 'completed' && e.correlationId === 'op-newer')).toBe(true)
    expect(slowEvents.some((e) => e.type === 'completed' && e.correlationId === 'op-stale')).toBe(false)
    expect(slowEvents.some((e) => e.type === 'cancelled' && e.correlationId === 'op-stale')).toBe(true)
    expect(newer.operationId).toBe('op-newer')
    const stored = store.get('session-1')!
    expect(stored.operationId).toBe('op-newer')
    expect(stored.slides.find((s) => s.index === 3)?.content.headline).toBe('newer slide')
  })

  it('keeps the newer result when concurrent edits race on the same session', async () => {
    const store = makeStore()
    store.save(existingSession())
    const gate = deferred()
    const older = new PresentationOrchestrator({ store, model: new GatedModel(gate.promise, 'slide'), render })
    const newer = new PresentationOrchestrator({ store, model: new TaggedModel('latest', 0), render })

    const pendingOld = older.edit({ sessionId: 'session-1', instruction: 'older edit', operationId: 'op-older' }, () => {})
    const pendingNew = newer.edit({ sessionId: 'session-1', instruction: 'newer edit', operationId: 'op-latest' }, () => {})
    await pendingNew
    gate.resolve()
    await pendingOld

    const stored = store.get('session-1')!
    expect(stored.operationId).toBe('op-latest')
    expect(stored.slides.find((s) => s.index === 3)?.content.headline).toBe('latest slide')
  })

  it('blocks persistence and completion when cancellation happens before the final save', async () => {
    const store = makeStore()
    const controller = new AbortController()
    const events: AgentEvent[] = []
    const orchestrator = new PresentationOrchestrator({
      store,
      model: new TaggedModel('fast', 0),
      render: (sessionId, version, _title, slides) => {
        controller.abort()
        return render(sessionId, version, _title, slides)
      }
    })

    const result = await orchestrator.create(
      { brief: 'Original brief', operationId: 'op-abort-persist' },
      (e) => events.push(e),
      controller.signal
    )

    expect(events.some((e) => e.type === 'completed')).toBe(false)
    expect(events.some((e) => e.type === 'cancelled' && e.correlationId === 'op-abort-persist')).toBe(true)
    expect(store.get(result.id)?.status).toBe('generating')
    expect(store.get(result.id)?.artifact).toBeUndefined()
  })
})
