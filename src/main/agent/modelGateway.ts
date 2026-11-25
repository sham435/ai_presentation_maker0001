import { logger } from '../telemetry/logger'

export interface ModelRequest {
  system: string
  prompt: string
  temperature?: number
}

export interface ModelGateway {
  complete(req: ModelRequest): Promise<string>
}

export class HttpModelGateway implements ModelGateway {
  constructor(
    private baseUrl = process.env.MODEL_GATEWAY_URL,
    private apiKey = process.env.MODEL_GATEWAY_API_KEY,
    private model = process.env.MODEL_NAME || 'gpt-4.1-mini'
  ) {}

  async complete(req: ModelRequest): Promise<string> {
    if (!this.baseUrl) throw new Error('MODEL_GATEWAY_URL not configured')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), Number(process.env.MODEL_TIMEOUT_MS || 30000))
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
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
      if (!res.ok) throw new Error(`Model gateway ${res.status}`)
      const json = (await res.json()) as any
      return json.choices?.[0]?.message?.content || ''
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class MockModelGateway implements ModelGateway {
  async complete(req: ModelRequest): Promise<string> {
    logger.warn('Using MockModelGateway - configure MODEL_GATEWAY_URL for real generation')
    // The caller provides prompt with instructions; for mock we return a simple JSON when asked.
    if (req.prompt.includes('Return JSON outline')) {
      const topicMatch = req.prompt.match(/Topic: (.*)/)
      const topic = topicMatch?.[1]?.trim() || 'Presentation'
      return JSON.stringify({
        title: topic,
        subtitle: 'Generated draft',
        slides: [
          { index: 1, role: 'cover', headline: topic, points: ['Overview', 'Key insights', 'Next steps'] },
          { index: 2, role: 'body', headline: 'Context', points: ['Why this matters', 'Current state', 'Opportunity'] },
          { index: 3, role: 'body', headline: 'Key Points', points: ['Point one', 'Point two', 'Point three'] },
          { index: 4, role: 'body', headline: 'Plan', points: ['Action', 'Owner', 'Timeline'] },
          { index: 5, role: 'close', headline: 'Thank You', points: ['Questions?', 'Discussion', 'Next steps'] }
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

export function createModelGateway(): ModelGateway {
  return process.env.MODEL_GATEWAY_URL ? new HttpModelGateway() : new MockModelGateway()
}
