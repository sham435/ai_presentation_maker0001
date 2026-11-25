import type { GatewayConfig } from '@shared/types'
import { logger } from '../telemetry/logger'

export interface ModelRequest {
  system: string
  prompt: string
  temperature?: number
  signal?: AbortSignal
}

export interface ModelGateway {
  complete(req: ModelRequest): Promise<string>
}

export type ModelGatewayErrorCategory =
  | 'config' | 'auth' | 'request' | 'rate-limit' | 'server'
  | 'network' | 'timeout' | 'parse' | 'cancelled'

export class ModelGatewayError extends Error {
  constructor(
    message: string,
    readonly category: ModelGatewayErrorCategory,
    readonly statusCode?: number,
    readonly retryable = false
  ) {
    super(message)
    this.name = 'ModelGatewayError'
  }
}

function cancelledError(): ModelGatewayError {
  return new ModelGatewayError('Generation was cancelled', 'cancelled')
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelledError())
    const timer = setTimeout(done, ms)
    function cleanup() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    function done() {
      cleanup()
      resolve()
    }
    function onAbort() {
      cleanup()
      reject(cancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class HttpModelGateway implements ModelGateway {
  constructor(
    private readonly baseUrl = process.env.MODEL_GATEWAY_URL,
    private readonly apiKey = process.env.MODEL_GATEWAY_API_KEY,
    private readonly model = process.env.MODEL_NAME || 'gpt-4.1-mini',
    private readonly timeoutMs = Number(process.env.MODEL_TIMEOUT_MS || 30000)
  ) {}

  async complete(req: ModelRequest): Promise<string> {
    if (!this.baseUrl) throw new ModelGatewayError('Model endpoint is not configured', 'config')
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      if (req.signal?.aborted) throw cancelledError()
      try {
        return await this.request(req)
      } catch (cause) {
        const error = cause instanceof ModelGatewayError
          ? cause
          : new ModelGatewayError('Model provider network request failed', 'network', undefined, true)
        if (error.category === 'cancelled' || req.signal?.aborted) throw cancelledError()
        if (!error.retryable || attempt === 2) throw error
        await wait(250 * Math.pow(2, attempt), req.signal)
      }
    }
    throw new ModelGatewayError('Model provider request failed', 'network', undefined, true)
  }

  private async request(req: ModelRequest): Promise<string> {
    const controller = new AbortController()
    let timedOut = false
    const onAbort = () => controller.abort()
    if (req.signal?.aborted) throw cancelledError()
    req.signal?.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, Math.max(1000, this.timeoutMs || 30000))

    try {
      const response = await fetch(this.baseUrl!.replace(/\/$/, '') + '/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: 'Bearer ' + this.apiKey } : {})
        },
        body: JSON.stringify({
          model: this.model,
          temperature: req.temperature ?? 0.2,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.prompt }
          ]
        }),
        signal: controller.signal
      })
      if (!response.ok) {
        const status = response.status
        if (status === 401 || status === 403) throw new ModelGatewayError('Model provider authentication failed (' + status + ')', 'auth', status)
        if (status === 429) throw new ModelGatewayError('Model provider rate limit reached', 'rate-limit', status, true)
        if (status >= 500) throw new ModelGatewayError('Model provider server error (' + status + ')', 'server', status, true)
        throw new ModelGatewayError('Model provider rejected the request (' + status + ')', 'request', status)
      }
      let payload: any
      try {
        payload = await response.json()
      } catch {
        throw new ModelGatewayError('Model provider returned invalid JSON', 'parse')
      }
      const content = payload?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) {
        throw new ModelGatewayError('Model provider returned an empty or unsupported response', 'parse')
      }
      return content
    } catch (cause) {
      if (cause instanceof ModelGatewayError) throw cause
      if (req.signal?.aborted) throw cancelledError()
      if (timedOut) throw new ModelGatewayError('Model provider request timed out', 'timeout', undefined, true)
      throw new ModelGatewayError('Model provider network request failed', 'network', undefined, true)
    } finally {
      clearTimeout(timeout)
      req.signal?.removeEventListener('abort', onAbort)
    }
  }
}

export class MockModelGateway implements ModelGateway {
  async complete(req: ModelRequest): Promise<string> {
    if (req.signal?.aborted) throw cancelledError()
    logger.warn('Using MockModelGateway - configure model endpoint and key for real generation')
    if (req.prompt.includes('Return JSON outline')) {
      const topicMatch = req.prompt.match(/Topic: (.*)/)
      const topic = topicMatch?.[1]?.trim() || 'Presentation'
      return JSON.stringify({
        title: topic,
        subtitle: 'Offline preview',
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

export function createModelGateway(config?: GatewayConfig): ModelGateway {
  const endpoint = config?.endpoint ?? process.env.MODEL_GATEWAY_URL
  const apiKey = config?.apiKey ?? process.env.MODEL_GATEWAY_API_KEY
  const model = config?.model || process.env.MODEL_NAME || 'gpt-4.1-mini'
  const timeoutMs = config?.timeoutMs ?? Number(process.env.MODEL_TIMEOUT_MS || 30000)
  return endpoint && apiKey
    ? new HttpModelGateway(endpoint, apiKey, model, timeoutMs)
    : new MockModelGateway()
}
