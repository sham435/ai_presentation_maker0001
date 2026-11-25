import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createModelGateway,
  HttpModelGateway,
  ModelGatewayError,
  type GatewayConfig
} from '../src/main/agent/modelGateway'

const request = { system: 'system', prompt: 'prompt' }

function okResponse(content = 'ok') {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] })
  }
}

function errorResponse(status: number) {
  return { ok: false, status, json: async () => ({}) }
}

function config(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return { baseUrl: 'https://gateway.example.com', model: 'gpt-test', apiKey: 'sk-test', ...overrides }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HttpModelGateway', () => {
  it('calls an OpenAI-compatible endpoint with the API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('done'))
    vi.stubGlobal('fetch', fetchMock)
    const gateway = new HttpModelGateway(() => config())

    await expect(gateway.complete(request)).resolves.toBe('done')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gateway.example.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('retries transient rate limits and reports retry events', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse('recovered'))
    vi.stubGlobal('fetch', fetchMock)
    const onRetry = vi.fn()
    const gateway = new HttpModelGateway(() => config())

    await expect(gateway.complete({ ...request, onRetry })).resolves.toBe('recovered')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, maxRetries: 2, category: 'rate-limit' })
  })

  it('does not retry authorization failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401))
    vi.stubGlobal('fetch', fetchMock)
    const gateway = new HttpModelGateway(() => config())

    await expect(gateway.complete(request)).rejects.toMatchObject({
      category: 'auth',
      retryable: false
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry malformed JSON responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json')
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    const gateway = new HttpModelGateway(() => config())

    await expect(gateway.complete(request)).rejects.toMatchObject({
      category: 'parse',
      retryable: false
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops before calling the endpoint when already cancelled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()
    const gateway = new HttpModelGateway(() => config())

    await expect(gateway.complete({ ...request, signal: controller.signal })).rejects.toBeInstanceOf(ModelGatewayError)
    await expect(gateway.complete({ ...request, signal: controller.signal })).rejects.toMatchObject({ category: 'cancelled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects when no endpoint is configured', async () => {
    const gateway = new HttpModelGateway(() => config({ baseUrl: undefined }))
    await expect(gateway.complete(request)).rejects.toMatchObject({ category: 'config', retryable: false })
  })
})

describe('dynamic gateway', () => {
  it('uses the offline mock when no endpoint is configured', async () => {
    const gateway = createModelGateway(() => ({ model: 'default' }))
    const raw = await gateway.complete({
      system: 'system',
      prompt: 'Return JSON outline\nTopic: Offline deck'
    })
    expect(JSON.parse(raw).title).toBe('Offline deck')
  })
})
