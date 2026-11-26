import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'
import type { TelemetryRecord } from '@shared/types'
import { telemetryRecordSchema } from '@shared/schema'
import { defaultDataDir, getDatabase } from '../store/db'

interface TelemetryState {
  enabled: boolean
  filePath: string
}

const state: TelemetryState = {
  enabled: false,
  filePath: path.join(process.cwd(), '.data', 'telemetry.jsonl')
}

const ALLOWED_META_KEYS = [
  'sessionId',
  'correlationId',
  'stage',
  'status',
  'durationMs',
  'errorCategory',
  'category',
  'attempt',
  'maxRetries',
  'artifactVersion',
  'slideCount',
  'mode'
] as const

/** Allows only short, single-line internal identifiers/categories into telemetry. */
export function safeText(value: unknown, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7e]/g, '?').trim()
  if (!cleaned) return undefined
  return cleaned.slice(0, max)
}

export function redactTelemetryMeta(meta: Record<string, unknown> = {}): Partial<TelemetryRecord> {
  const safe: Record<string, unknown> = {}
  for (const key of ALLOWED_META_KEYS) {
    const value = meta[key]
    if (typeof value === 'number' && Number.isFinite(value)) safe[key] = Math.round(value)
    else {
      const text = safeText(value, key === 'stage' ? 80 : 200)
      if (text !== undefined) safe[key] = text
    }
  }
  return safe as Partial<TelemetryRecord>
}

export function configureTelemetry(options: { enabled?: boolean; dataDir?: string; filePath?: string } = {}): void {
  if (typeof options.enabled === 'boolean') state.enabled = options.enabled
  if (options.filePath) state.filePath = options.filePath
  else if (options.dataDir) state.filePath = path.join(options.dataDir, 'telemetry.jsonl')
}

export function telemetryEnabled(): boolean {
  return state.enabled
}

export function telemetryFilePath(): string {
  return state.filePath
}

export function appendTelemetry(
  level: TelemetryRecord['level'],
  message: string,
  meta: Record<string, unknown> = {}
): void {
  if (!state.enabled) return
  const candidate = {
    ts: new Date().toISOString(),
    level,
    message: safeText(message, 200) || 'diagnostic event',
    ...redactTelemetryMeta(meta)
  }
  const parsed = telemetryRecordSchema.safeParse(candidate)
  if (!parsed.success) return

  try {
    fs.mkdirSync(path.dirname(state.filePath), { recursive: true, mode: 0o700 })
    fs.appendFileSync(state.filePath, `${JSON.stringify(parsed.data)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.chmodSync(state.filePath, 0o600)
  } catch {
    // Telemetry is best-effort and must never break the app.
  }
}

export function readTelemetry(): TelemetryRecord[] {
  let raw: string
  try {
    raw = fs.readFileSync(state.filePath, 'utf8')
  } catch {
    return []
  }
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return telemetryRecordSchema.safeParse(JSON.parse(line))
      } catch {
        return null
      }
    })
    .flatMap((result) => (result?.success ? [result.data] : []))
}

export function clearTelemetry(): void {
  try {
    fs.rmSync(state.filePath, { force: true })
  } catch {
    // Best-effort clear; absence is already the desired state.
  }
}

export function readTelemetrySetting(db: Database.Database): boolean {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = 'telemetryOptIn'").get() as
    | { value_json: string }
    | undefined
  if (!row) return false
  try {
    return JSON.parse(row.value_json) === true
  } catch {
    return false
  }
}

export function setTelemetrySetting(enabled: boolean, dataDir: string = defaultDataDir()): void {
  configureTelemetry({ enabled, dataDir })
  const db = getDatabase(path.join(dataDir, 'presentation.db'))
  db.prepare(`
    INSERT INTO settings (key, value_json, updated_at)
    VALUES ('telemetryOptIn', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')
  `).run(JSON.stringify(enabled))
}
