import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/store/db'
import {
  clearTelemetry,
  configureTelemetry,
  readTelemetry,
  readTelemetrySetting,
  setTelemetrySetting,
  telemetryEnabled
} from '../../src/main/telemetry/jsonl'
import { logger } from '../../src/main/telemetry/logger'
import TelemetryViewer from '../../src/renderer/src/components/TelemetryViewer'

const dirs: string[] = []

function makeEnvironment(): { dir: string; filePath: string; db: Database.Database } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-telemetry-'))
  dirs.push(dir)
  const filePath = path.join(dir, 'telemetry.jsonl')
  configureTelemetry({ enabled: false, filePath })
  return { dir, filePath, db: openDatabase(path.join(dir, 'presentation.db')) }
}

afterEach(() => {
  configureTelemetry({ enabled: false, filePath: path.join(process.cwd(), '.data', 'telemetry.jsonl') })
  while (dirs.length) {
    const dir = dirs.pop()!
    for (const file of fs.readdirSync(dir)) fs.rmSync(path.join(dir, file), { force: true })
    fs.rmdirSync(dir)
  }
})

describe('opt-in local telemetry', () => {
  it('writes nothing while opt-out is active', () => {
    const { filePath } = makeEnvironment()
    logger.info('provider request', { prompt: 'secret brief', apiKey: 'sk-secret' })
    expect(telemetryEnabled()).toBe(false)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('redacts prompts, keys and user content when opted in', () => {
    const { filePath } = makeEnvironment()
    configureTelemetry({ enabled: true, filePath })

    logger.error('generation failed', {
      message: 'user typed a secret brief',
      prompt: 'secret brief',
      apiKey: 'sk-secret',
      brief: 'secret brief',
      slideHtml: '<p>secret slide</p>',
      sessionId: 'session-1',
      correlationId: 'op-1',
      stage: 'outline',
      status: 'error',
      durationMs: 12,
      errorCategory: 'server'
    })

    const records = readTelemetry()
    expect(records).toHaveLength(1)
    const serialized = JSON.stringify(records)
    expect(serialized).not.toContain('secret brief')
    expect(serialized).not.toContain('sk-secret')
    expect(serialized).not.toContain('secret slide')
    expect(records[0]).toMatchObject({
      level: 'error',
      sessionId: 'session-1',
      correlationId: 'op-1',
      stage: 'outline',
      status: 'error',
      durationMs: 12,
      errorCategory: 'server'
    })
    expect(fs.readFileSync(filePath, 'utf8').trim().split('\n')).toHaveLength(1)
  })

  it('ignores malformed lines and clears local JSONL on request', () => {
    const { filePath } = makeEnvironment()
    configureTelemetry({ enabled: true, filePath })
    const valid = JSON.stringify({
      ts: '2026-11-26T00:00:00.000Z',
      level: 'info',
      message: 'stage timing',
      stage: 'render',
      status: 'ok',
      durationMs: 4
    })
    fs.writeFileSync(filePath, `{broken line\n${valid}\n`, 'utf8')

    expect(readTelemetry()).toHaveLength(1)
    clearTelemetry()
    expect(fs.existsSync(filePath)).toBe(false)
    expect(readTelemetry()).toEqual([])
  })

  it('persists the opt-in flag and exposes it to the renderer viewer safely', () => {
    const { dir, db } = makeEnvironment()
    expect(readTelemetrySetting(db)).toBe(false)
    setTelemetrySetting(true, dir)
    expect(readTelemetrySetting(db)).toBe(true)
    expect(telemetryEnabled()).toBe(true)

    const markup = renderToStaticMarkup(
      React.createElement(TelemetryViewer, {
        records: [
          {
            ts: '2026-11-26T00:00:00.000Z',
            level: 'info',
            message: 'stage timing',
            stage: 'outline',
            status: 'ok',
            durationMs: 6,
            correlationId: 'op-1'
          }
        ],
        onClear: () => {},
        onRefresh: () => {}
      })
    )
    expect(markup).toContain('Local diagnostics')
    expect(markup).toContain('outline')
    expect(markup).toContain('data-testid="telemetry-clear"')
    db.close()
  })
})
