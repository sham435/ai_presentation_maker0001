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
