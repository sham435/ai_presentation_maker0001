import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '@shared/types'
import { openDatabase } from '../../src/main/store/db'
import { SessionStore } from '../../src/main/store/sessionStore'
import { PresentationOrchestrator } from '../../src/main/agent/orchestrator'
import type { DeckArtifact, Slide } from '@shared/types'
import type { ModelGateway, RetryInfo } from '../../src/main/agent/modelGateway'

const dirs: string[] = []
const SLIDE_COUNT = 30
const MAX_DURATION_MS = 60_000
const MIN_THROUGHPUT_PER_SEC = 0.5
const MAX_HEAP_GROWTH_MB = 512

class LargeDeckModel implements ModelGateway {
  async complete(req: { prompt: string; signal?: AbortSignal; onRetry?: (info: RetryInfo) => void }): Promise<string> {
    if (req.signal?.aborted) throw new Error('cancelled')
    if (req.prompt.includes('Return JSON outline')) {
      return JSON.stringify({
        title: 'Thirty slide deck',
        slides: Array.from({ length: SLIDE_COUNT }, (_, i) => ({
          index: i + 1,
          role: i === 0 ? 'cover' : i === SLIDE_COUNT - 1 ? 'end' : 'content',
          headline: `Section ${i + 1}`,
          points: ['First supporting point', 'Second supporting point', 'Third supporting point']
        }))
      })
    }
    return JSON.stringify({
      headline: 'Load test slide',
      bullets: ['First supporting point', 'Second supporting point', 'Third supporting point'],
      notes: 'Load test note',
      citations: ['load-fixture']
    })
  }
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('30-slide load, memory and throughput', () => {
  it('generates, persists and renders a 30-slide deck within resource budgets', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-load-'))
    dirs.push(dir)
    const store = new SessionStore({ db: openDatabase(path.join(dir, 'presentation.db')) })
    const orchestrator = new PresentationOrchestrator({
      store,
      model: new LargeDeckModel(),
      render: (sessionId, version, _title, slides: Slide[]): DeckArtifact => ({
        sessionId,
        version,
        slideCount: slides.length,
        filePath: path.join(dir, `deck-v${version}.html`),
        checksum: 'load-fixture',
        createdAt: new Date().toISOString()
      })
    })
    const events: AgentEvent[] = []

    global.gc?.()
    const heapBefore = process.memoryUsage().heapUsed
    const started = performance.now()
    const session = await orchestrator.create(
      { brief: 'Generate a thirty slide load fixture', options: { pageCount: 30 } },
      (event) => events.push(event)
    )
    const durationMs = performance.now() - started
    const heapAfter = process.memoryUsage().heapUsed
    const heapGrowthMb = Math.max(0, (heapAfter - heapBefore) / (1024 * 1024))
    const throughput = SLIDE_COUNT / (durationMs / 1000)

    console.log(
      `LOAD_MEASUREMENT slides=${session.slides.length} durationMs=${durationMs.toFixed(1)} ` +
        `throughputPerSec=${throughput.toFixed(2)} heapGrowthMb=${heapGrowthMb.toFixed(2)}`
    )

    expect(session.status).toBe('completed')
    expect(session.slides).toHaveLength(SLIDE_COUNT)
    expect(new Set(session.slides.map((slide) => slide.index)).size).toBe(SLIDE_COUNT)
    expect(session.artifact?.slideCount).toBe(SLIDE_COUNT)
    expect(events.filter((event) => event.type === 'slide')).toHaveLength(SLIDE_COUNT)
    expect(events.filter((event) => event.type === 'completed')).toHaveLength(1)
    expect(durationMs).toBeLessThan(MAX_DURATION_MS)
    expect(throughput).toBeGreaterThan(MIN_THROUGHPUT_PER_SEC)
    expect(heapGrowthMb).toBeLessThan(MAX_HEAP_GROWTH_MB)

    const persisted = store.get(session.id)!
    expect(persisted.slides).toHaveLength(SLIDE_COUNT)
    expect(persisted.status).toBe('completed')
  })
})
