import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpModelGateway, ModelGatewayError } from '../src/main/agent/modelGateway'

afterEach(() => vi.unstubAllGlobals())

function success(content = 'ok') {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }
}

describe('HttpModelGateway', () => {
  it('retries a transient 429 response and then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce(success('generated'))
    vi.stubGlobal('fetch', fetchMock)
    const gateway = new HttpModelGateway('https://provider.example', 'test-key', 'test-model', 5000)
    await expect(gateway.complete({ system: 'system', prompt: 'prompt' })).resolves.toBe('generated')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-key')
  })

  it('does not retry authentication failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 })
    vi.stubGlobal('fetch', fetchMock)
    const gateway = new HttpModelGateway('https://provider.example', 'bad-key', 'test-model', 5000)
    await expect(gateway.complete({ system: 'system', prompt: 'prompt' })).rejects.toMatchObject({
      category: 'auth',
      retryable: false
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry malformed provider JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    const gateway = new HttpModelGateway('https://provider.example', 'key', 'test-model', 5000)
    await expect(gateway.complete({ system: 'system', prompt: 'prompt' })).rejects.toBeInstanceOf(ModelGatewayError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('honors an already-aborted caller signal without making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()
    const gateway = new HttpModelGateway('https://provider.example', 'key', 'test-model', 5000)
    await expect(gateway.complete({ system: 'system', prompt: 'prompt', signal: controller.signal })).rejects.toMatchObject({
      category: 'cancelled'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
