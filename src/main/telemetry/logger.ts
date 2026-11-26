import type { TelemetryRecord } from '@shared/types'
import { appendTelemetry, redactTelemetryMeta, safeText } from './jsonl'

/**
 * Structured logger. Console output and the optional local JSONL sink both
 * pass through the same allowlist, so prompts, keys and slide text are never
 * written to either destination.
 */
function emit(level: TelemetryRecord['level'], message: string, meta: Record<string, unknown> = {}): void {
  const safeMessage = safeText(message, 200) || 'diagnostic event'
  const payload = JSON.stringify({
    level,
    message: safeMessage,
    ts: new Date().toISOString(),
    ...redactTelemetryMeta(meta)
  })
  if (level === 'error') console.error(payload)
  else if (level === 'warn') console.warn(payload)
  else console.log(payload)
  appendTelemetry(level, message, meta)
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => emit('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit('error', message, meta)
}
