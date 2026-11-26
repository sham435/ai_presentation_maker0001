import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AgentEvent, DeckArtifact, Slide } from '@shared/types'
import { openDatabase } from '../../src/main/store/db'
import { SessionStore } from '../../src/main/store/sessionStore'
import { telemetryRecordSchema } from '@shared/schema'
import { ModelGatewayError, type ModelGateway, type ModelRequest } from '../../src/main/agent/modelGateway'
import { PresentationOrchestrator } from '../../src/main/agent/orchestrator'

const dirs: string[] = []

class ImmediateModel implements ModelGateway {
  readonly correlationIds: Array<string | undefined> = []

  async complete(req: ModelRequest): Promise<string> {
    this.correlationIds.push(req.correlationId)
    if (req.signal?.aborted) throw new ModelGatewayError('Generation cancelled', 'cancelled', false)
    if (req.prompt.includes('Return JSON outline')) {
      return JSON.stringify({
        title: 'Timed deck',
        slides: [
          { index: 1, role: 'cover', headline: 'Cover', points: ['Intro'] },
          { index: 2, role: 'catalog', headline: 'Agenda', points: ['One', 'Two'] },
          { index: 3, role: 'content', headline: 'Content', points: ['Point'] },
          { index: 4, role: 'end', headline: 'End', points: ['Thanks'] }
        ]
      })
    }
    return JSON.stringify({ headline: 'Timed slide', bullets: ['Timed point'] })
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

describe('correlation IDs and stage timings', () => {
  it('emits complete, sensitive-free timing events for every generation stage', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-timings-'))
    dirs.push(dir)
    const store = new SessionStore({ db: openDatabase(path.join(dir, 'presentation.db')) })
    let clock = 1000
    const model = new ImmediateModel()
    const orchestrator = new PresentationOrchestrator({
      store,
      model,
      render,
      now: () => (clock += 10)
    })
    const events: AgentEvent[] = []
    const session = await orchestrator.create(
      { brief: 'TOP SECRET BRIEF for timing test', operationId: 'op-timings' },
      (event) => events.push(event)
    )

    const stages = events.filter((event): event is Extract<AgentEvent, { type: 'stage' }> => event.type === 'stage')
    const names = stages.map((stage) => stage.stage)
    expect(names).toEqual(expect.arrayContaining(['outline', 'slide:3', 'render', 'persist']))
    expect(stages.every((stage) => stage.correlationId === 'op-timings')).toBe(true)
    expect(stages.every((stage) => stage.sessionId === session.id)).toBe(true)
    expect(stages.every((stage) => stage.durationMs === 10)).toBe(true)
    expect(model.correlationIds.length).toBeGreaterThan(0)
    expect(model.correlationIds.every((id) => id === 'op-timings')).toBe(true)
    expect(events.filter((event) => 'correlationId' in event).every((event) => event.correlationId === 'op-timings')).toBe(true)

    const stored = store.events(session.id)
    expect(stored.length).toBe(stages.length)
    for (const event of stored) {
      expect(telemetryRecordSchema.safeParse({
        ts: '2026-11-26T00:00:00.000Z',
        level: 'info',
        message: 'stage timing',
        ...event
      }).success).toBe(true)
    }
    expect(JSON.stringify(stored)).not.toContain('TOP SECRET BRIEF')
    expect(JSON.stringify(stages)).not.toContain('TOP SECRET BRIEF')
    store.db.close()
  })
})
