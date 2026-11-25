import fs from 'fs'
import path from 'path'

/** Minimal surface used by the credential store; injectable for tests. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface SettingsData {
  endpoint?: string
  model?: string
  telemetryOptIn?: boolean
}

interface StoredSettings extends SettingsData {
  version?: number
  apiKeyCipher?: string
}

export interface GatewayConfig {
  baseUrl?: string
  apiKey?: string
  model: string
}

export interface CredentialStore {
  canEncrypt(): boolean
  getSettings(): SettingsData
  updateSettings(patch: Partial<SettingsData>): SettingsData
  hasApiKey(): boolean
  getApiKey(): string | undefined
  setApiKey(apiKey: string): void
  clearApiKey(): void
}

interface CredentialRuntime {
  dataDir: () => string
  storage: SafeStorageLike
}

const unavailableStorage: SafeStorageLike = {
  isEncryptionAvailable: () => false,
  encryptString: () => {
    throw new Error('OS keychain encryption is unavailable on this device')
  },
  decryptString: () => {
    throw new Error('OS keychain encryption is unavailable on this device')
  }
}

let runtime: CredentialRuntime = {
  dataDir: () => path.join(process.cwd(), '.data'),
  storage: unavailableStorage
}
let defaultStore: CredentialStore | undefined

/** Called once by the Electron main process; keeps Electron out of test imports. */
export function configureCredentials(options: CredentialRuntime): void {
  runtime = options
  defaultStore = undefined
}

const dataDir = () => process.env.STORAGE_DIR || runtime.dataDir()
const settingsFile = () => path.join(dataDir(), 'settings.json')

function readStored(filePath: string): StoredSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : undefined,
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
      telemetryOptIn: parsed.telemetryOptIn === true,
      apiKeyCipher: typeof parsed.apiKeyCipher === 'string' ? parsed.apiKeyCipher : undefined
    }
  } catch {
    return {}
  }
}

function writeStored(filePath: string, data: StoredSettings): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.chmodSync(dir, 0o700)
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(
      tempFile,
      JSON.stringify({ version: 1, ...data }, null, 2),
      { encoding: 'utf8', mode: 0o600 }
    )
    fs.chmodSync(tempFile, 0o600)
    fs.renameSync(tempFile, filePath)
    fs.chmodSync(filePath, 0o600)
  } catch (error) {
    try {
      fs.unlinkSync(tempFile)
    } catch {
      // best-effort cleanup
    }
    throw error
  }
}

function publicSettings(data: StoredSettings): SettingsData {
  return {
    endpoint: data.endpoint || undefined,
    model: data.model || undefined,
    telemetryOptIn: Boolean(data.telemetryOptIn)
  }
}

/**
 * Credentials are encrypted with Electron safeStorage (Keychain-backed on
 * macOS). Only ciphertext is persisted, and public accessors never expose it.
 */
export function createCredentialStore(storage: SafeStorageLike, filePath: string): CredentialStore {
  const requireEncryption = () => {
    if (!storage.isEncryptionAvailable()) {
      throw new Error('OS keychain encryption is unavailable on this device')
    }
  }

  return {
    canEncrypt: () => storage.isEncryptionAvailable(),

    getSettings: () => publicSettings(readStored(filePath)),

    updateSettings: (patch) => {
      const next = { ...readStored(filePath), ...patch }
      writeStored(filePath, next)
      return publicSettings(next)
    },

    hasApiKey: () => Boolean(readStored(filePath).apiKeyCipher),

    getApiKey: () => {
      const cipher = readStored(filePath).apiKeyCipher
      if (!cipher) return undefined
      requireEncryption()
      return storage.decryptString(Buffer.from(cipher, 'base64'))
    },

    setApiKey: (apiKey) => {
      requireEncryption()
      const apiKeyCipher = storage.encryptString(apiKey).toString('base64')
      writeStored(filePath, { ...readStored(filePath), apiKeyCipher })
    },

    clearApiKey: () => {
      const { apiKeyCipher: _ignored, ...rest } = readStored(filePath)
      writeStored(filePath, rest)
    }
  }
}

export function getCredentialStore(): CredentialStore {
  if (!defaultStore) defaultStore = createCredentialStore(runtime.storage, settingsFile())
  return defaultStore
}

export function gatewayConfigFrom(
  store: CredentialStore,
  env: NodeJS.ProcessEnv = process.env
): GatewayConfig {
  const settings = store.getSettings()
  let storedKey: string | undefined
  try {
    storedKey = store.getApiKey()
  } catch {
    storedKey = undefined
  }
  return {
    baseUrl: settings.endpoint || env.MODEL_GATEWAY_URL,
    apiKey: storedKey || env.MODEL_GATEWAY_API_KEY,
    model: settings.model || env.MODEL_NAME || 'gpt-4.1-mini'
  }
}

export function getGatewayConfig(): GatewayConfig {
  return gatewayConfigFrom(getCredentialStore())
}

export function credentialStatus() {
  const store = getCredentialStore()
  return { hasKey: store.hasApiKey(), canEncrypt: store.canEncrypt() }
}

/** Strips userinfo from an endpoint before it is sent to the renderer. */
export function sanitizeEndpoint(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.username || url.password) {
      url.username = ''
      url.password = ''
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return '[invalid endpoint]'
  }
}

export function gatewayStatus() {
  const config = getGatewayConfig()
  return {
    mode: config.baseUrl ? ('live' as const) : ('offline-preview' as const),
    endpoint: sanitizeEndpoint(config.baseUrl),
    model: config.model,
    hasKey: Boolean(config.apiKey)
  }
}
