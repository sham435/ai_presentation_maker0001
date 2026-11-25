import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CredentialStore, type SafeStorageLike } from '../src/main/credentials/keychain'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

function setup(available = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'presentation-settings-'))
  directories.push(directory)
  const filePath = path.join(directory, 'settings.json')
  const storage: SafeStorageLike = {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(value.split('').reverse().join('')),
    decryptString: (value) => value.toString('utf8').split('').reverse().join('')
  }
  return { filePath, storage, store: new CredentialStore(filePath, storage) }
}

describe('CredentialStore', () => {
  it('stores encrypted key material and returns only public status', () => {
    const { filePath, store } = setup()
    store.updateSettings({ endpoint: 'https://api.example.com', model: 'test-model', telemetryOptIn: false })
    const result = store.setApiKey('secret-api-key')
    const contents = fs.readFileSync(filePath, 'utf8')
    expect(contents).not.toContain('secret-api-key')
    expect(result.hasKey).toBe(true)
    expect(result.mode).toBe('live')
    expect(result).not.toHaveProperty('apiKey')
    expect(result).not.toHaveProperty('apiKeyCipher')
    if (process.platform !== 'win32') expect(fs.statSync(filePath).mode & 0o777).toBe(0o600)
  })

  it('uses environment fallback without returning the environment key', () => {
    const { store } = setup()
    const previousUrl = process.env.MODEL_GATEWAY_URL
    const previousKey = process.env.MODEL_GATEWAY_API_KEY
    process.env.MODEL_GATEWAY_URL = 'http://127.0.0.1:8080'
    process.env.MODEL_GATEWAY_API_KEY = 'env-secret'
    try {
      expect(store.getSettings()).toMatchObject({ mode: 'live', hasKey: true })
      expect(store.getSettings()).not.toHaveProperty('apiKey')
    } finally {
      if (previousUrl === undefined) delete process.env.MODEL_GATEWAY_URL
      else process.env.MODEL_GATEWAY_URL = previousUrl
      if (previousKey === undefined) delete process.env.MODEL_GATEWAY_API_KEY
      else process.env.MODEL_GATEWAY_API_KEY = previousKey
    }
  })

  it('rejects saving a key when safeStorage is unavailable', () => {
    const { store } = setup(false)
    expect(() => store.setApiKey('secret')).toThrow(/Secure credential storage is unavailable/)
  })
})
