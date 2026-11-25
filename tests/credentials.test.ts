import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  createCredentialStore,
  gatewayConfigFrom,
  sanitizeEndpoint,
  type SafeStorageLike
} from '../src/main/credentials/keychain'

const tempDirs: string[] = []

function mockStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').replace(/^enc:/, '')
  }
}

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-credentials-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('credential store', () => {
  it('round-trips an API key through injectable safeStorage', () => {
    const file = path.join(tempDir(), 'settings.json')
    const store = createCredentialStore(mockStorage(), file)

    expect(store.hasApiKey()).toBe(false)
    store.setApiKey('sk-super-secret')
    expect(store.hasApiKey()).toBe(true)
    expect(store.getApiKey()).toBe('sk-super-secret')

    const raw = fs.readFileSync(file, 'utf8')
    expect(raw).not.toContain('sk-super-secret')
    expect(raw).toContain('apiKeyCipher')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700)
    expect(fs.readdirSync(path.dirname(file)).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('never exposes the key or ciphertext in public settings', () => {
    const file = path.join(tempDir(), 'settings.json')
    const store = createCredentialStore(mockStorage(), file)
    store.setApiKey('sk-secret')
    store.updateSettings({ endpoint: 'https://api.example.com', model: 'gpt-test', telemetryOptIn: true })

    expect(store.getSettings()).toEqual({
      endpoint: 'https://api.example.com',
      model: 'gpt-test',
      telemetryOptIn: true
    })
    expect(JSON.stringify(store.getSettings())).not.toContain('apiKey')
  })

  it('blocks key storage when OS encryption is unavailable', () => {
    const file = path.join(tempDir(), 'settings.json')
    const store = createCredentialStore(mockStorage(false), file)
    expect(store.canEncrypt()).toBe(false)
    expect(() => store.setApiKey('sk-secret')).toThrow(/encryption/i)
    expect(store.hasApiKey()).toBe(false)
  })

  it('treats a corrupt settings file as empty', () => {
    const dir = tempDir()
    const file = path.join(dir, 'settings.json')
    fs.writeFileSync(file, '{not json', 'utf8')
    const store = createCredentialStore(mockStorage(), file)
    expect(store.getSettings()).toEqual({ endpoint: undefined, model: undefined, telemetryOptIn: false })
    expect(store.hasApiKey()).toBe(false)
  })

  it('never exposes environment keys through public settings', () => {
    const file = path.join(tempDir(), 'settings.json')
    const store = createCredentialStore(mockStorage(), file)
    const config = gatewayConfigFrom(store, {
      MODEL_GATEWAY_URL: 'https://env.example.com',
      MODEL_GATEWAY_API_KEY: 'sk-env-secret'
    })
    expect(config.apiKey).toBe('sk-env-secret')
    expect(store.getSettings()).not.toHaveProperty('apiKey')
    expect(JSON.stringify(store.getSettings())).not.toContain('sk-env-secret')
  })

  it('clears the stored key without dropping other settings', () => {
    const file = path.join(tempDir(), 'settings.json')
    const store = createCredentialStore(mockStorage(), file)
    store.updateSettings({ model: 'gpt-test' })
    store.setApiKey('sk-secret')
    store.clearApiKey()

    expect(store.hasApiKey()).toBe(false)
    expect(store.getSettings().model).toBe('gpt-test')
  })
})

describe('gateway config resolution', () => {
  it('prefers stored settings over environment values', () => {
    const file = path.join(tempDir(), 'settings.json')
    const store = createCredentialStore(mockStorage(), file)
    store.updateSettings({ endpoint: 'https://stored.example.com', model: 'stored-model' })
    store.setApiKey('sk-stored')

    const config = gatewayConfigFrom(store, {
      MODEL_GATEWAY_URL: 'https://env.example.com',
      MODEL_GATEWAY_API_KEY: 'sk-env',
      MODEL_NAME: 'env-model'
    })
    expect(config).toEqual({
      baseUrl: 'https://stored.example.com',
      apiKey: 'sk-stored',
      model: 'stored-model'
    })
  })

  it('falls back to environment values when nothing is stored', () => {
    const file = path.join(tempDir(), 'settings.json')
    const store = createCredentialStore(mockStorage(), file)
    const config = gatewayConfigFrom(store, {
      MODEL_GATEWAY_URL: 'https://env.example.com',
      MODEL_GATEWAY_API_KEY: 'sk-env',
      MODEL_NAME: 'env-model'
    })
    expect(config.baseUrl).toBe('https://env.example.com')
    expect(config.apiKey).toBe('sk-env')
    expect(config.model).toBe('env-model')
  })

  it('strips userinfo from endpoints before they reach the renderer', () => {
    expect(sanitizeEndpoint('https://user:secret@api.example.com/v1')).toBe('https://api.example.com/v1')
    expect(sanitizeEndpoint(undefined)).toBeUndefined()
  })
})
