import type { GatewayDiagnosis } from '@shared/types'
import { logger } from '../telemetry/logger'
import { getGatewayConfig, sanitizeEndpoint, type GatewayConfig } from '../credentials/keychain'

export interface RetryInfo {
  attempt: number
  maxRetries: number
  category: GatewayErrorCategory
}

export interface ModelRequest {
  system: string
  prompt: string
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  onRetry?: (info: RetryInfo) => void
  /** Opaque operation identifier; never a prompt, key, or user content. */
  correlationId?: string
}

export interface ModelGateway {
  complete(req: ModelRequest): Promise<string>
}

export type GatewayErrorCategory =
  | 'config'
  | 'auth'
  | 'request'
  | 'rate-limit'
  | 'server'
  | 'network'
  | 'timeout'
  | 'parse'
  | 'cancelled'

export class ModelGatewayError extends Error {
  constructor(
    message: string,
    readonly category: GatewayErrorCategory,
    readonly retryable: boolean,
    readonly statusCode?: number
  ) {
    super(message)
    this.name = 'ModelGatewayError'
  }
}

const MAX_RETRIES = 2
const cancelled = () => new ModelGatewayError('Generation cancelled', 'cancelled', false)

function statusError(status: number): ModelGatewayError {
  if (status === 401 || status === 403) {
    return new ModelGatewayError(`Model gateway authorization failed (${status})`, 'auth', false, status)
  }
  if (status === 429) return new ModelGatewayError('Model gateway rate limit reached', 'rate-limit', true, status)
  if (status >= 500) return new ModelGatewayError(`Model gateway server error (${status})`, 'server', true, status)
  return new ModelGatewayError(`Model gateway rejected the request (${status})`, 'request', false, status)
}

function normalizeError(err: unknown, timedOut: boolean): ModelGatewayError {
  if (timedOut) return new ModelGatewayError('Model gateway request timed out', 'timeout', true)
  if (err instanceof ModelGatewayError) return err
  if (err instanceof SyntaxError) return new ModelGatewayError('Model gateway returned invalid JSON', 'parse', false)
  if (err instanceof TypeError) return new ModelGatewayError('Model gateway network error', 'network', true)
  return new ModelGatewayError(err instanceof Error ? err.message : String(err), 'network', true)
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(cancelled())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class HttpModelGateway implements ModelGateway {
  constructor(private configProvider: () => GatewayConfig = getGatewayConfig) {}

  async complete(req: ModelRequest): Promise<string> {
    const config = this.configProvider()
    if (!config.baseUrl) throw new ModelGatewayError('MODEL_GATEWAY_URL not configured', 'config', false)

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (req.signal?.aborted) throw cancelled()

      const controller = new AbortController()
      let timedOut = false
      const onAbort = () => controller.abort()
      req.signal?.addEventListener('abort', onAbort, { once: true })
      const timeoutMs = Math.max(1000, Number(process.env.MODEL_TIMEOUT_MS || 30000) || 30000)
      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)

      try {
        const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
          },
          body: JSON.stringify({
            model: config.model,
            temperature: req.temperature ?? 0.2,
            ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.prompt }
            ]
          }),
          signal: controller.signal
        })
        if (!res.ok) throw statusError(res.status)
        const json = (await res.json()) as any
        const content = json?.choices?.[0]?.message?.content
        if (typeof content !== 'string' || !content.trim()) {
          throw new ModelGatewayError('Model gateway returned an empty response', 'parse', false, res.status)
        }
        return content
      } catch (err) {
        if (req.signal?.aborted) throw cancelled()
        const error = normalizeError(err, timedOut)
        if (!error.retryable || attempt === MAX_RETRIES) throw error
        logger.warn('model gateway retrying', {
          category: error.category,
          attempt: attempt + 1,
          correlationId: req.correlationId
        })
        req.onRetry?.({ attempt: attempt + 1, maxRetries: MAX_RETRIES, category: error.category })
      } finally {
        clearTimeout(timeout)
        req.signal?.removeEventListener('abort', onAbort)
      }

      await delay(250 * 2 ** attempt, req.signal)
    }

    throw new ModelGatewayError('Model gateway request failed', 'network', false)
  }
}

export class MockModelGateway implements ModelGateway {
  async complete(req: ModelRequest): Promise<string> {
    if (req.signal?.aborted) throw cancelled()
    // Deterministic test hook: E2E cancellation needs a controllable in-flight request.
    const delayMs = Number(process.env.APM_E2E_DELAY_MS || 0)
    if (delayMs > 0) await delay(delayMs, req.signal)
    logger.warn('Using MockModelGateway - configure a model endpoint for real generation')

    if (req.prompt.includes('Return JSON outline')) {
      const topic = req.prompt.match(/Topic: (.*)/)?.[1]?.trim() || 'Presentation'
      return JSON.stringify({
        title: topic,
        subtitle: 'Generated draft',
        slides: [
          { index: 1, role: 'cover', headline: topic, points: ['Overview', 'Key insights', 'Next steps'] },
          { index: 2, role: 'catalog', headline: 'Agenda', points: ['Context', 'Key points', 'Plan'] },
          { index: 3, role: 'content', headline: 'Context', points: ['Why this matters', 'Current state', 'Opportunity'] },
          { index: 4, role: 'content', headline: 'Plan', points: ['Action', 'Owner', 'Timeline'] },
          { index: 5, role: 'end', headline: 'Thank You', points: ['Questions?', 'Discussion', 'Next steps'] }
        ]
      })
    }

    if (req.prompt.includes('Return JSON slide content')) {
      const headline = req.prompt.match(/Headline: (.*)/)?.[1]?.trim() || 'Slide'
      return JSON.stringify({ headline, bullets: ['Key point', 'Supporting detail', 'Impact'], notes: '' })
    }

    return '{}'
  }
}

class DynamicModelGateway implements ModelGateway {
  constructor(private configProvider: () => GatewayConfig = getGatewayConfig) {}

  async complete(req: ModelRequest): Promise<string> {
    const config = this.configProvider()
    if (!config.baseUrl) return new MockModelGateway().complete(req)
    return new HttpModelGateway(() => config).complete(req)
  }
}

export function createModelGateway(configProvider: () => GatewayConfig = getGatewayConfig): ModelGateway {
  return new DynamicModelGateway(configProvider)
}

/** Performs a real, minimal provider request and returns only sanitized status data. */
export async function diagnoseGateway(
  configProvider: () => GatewayConfig = getGatewayConfig
): Promise<GatewayDiagnosis> {
  const config = configProvider()
  const base: GatewayDiagnosis = {
    ok: false,
    mode: config.baseUrl ? 'live' : 'offline-preview',
    endpoint: sanitizeEndpoint(config.baseUrl),
    model: config.model,
    latencyMs: 0
  }
  if (!config.baseUrl) {
    return { ...base, category: 'config', message: 'No endpoint configured; Offline Preview is active.' }
  }

  const started = Date.now()
  try {
    await new HttpModelGateway(configProvider).complete({
      system: 'Connectivity check only. Respond with exactly OK.',
      prompt: 'Reply with OK.',
      temperature: 0,
      maxTokens: 8
    })
    return { ...base, ok: true, latencyMs: Date.now() - started, message: 'Provider responded successfully.' }
  } catch (err) {
    const error = err instanceof ModelGatewayError ? err : new ModelGatewayError(String(err), 'network', false)
    return {
      ...base,
      latencyMs: Date.now() - started,
      category: error.category,
      statusCode: error.statusCode,
      message: error.message
    }
  }
}
