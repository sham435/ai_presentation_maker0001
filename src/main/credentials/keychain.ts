import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings, AppSettingsUpdate, GatewayConfig } from '@shared/types'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface StoredSettings {
  version: 1
  endpoint?: string
  model?: string
  telemetryOptIn?: boolean
  apiKeyCipher?: string
}

const DEFAULT_MODEL = 'gpt-4.1-mini'

export class CredentialStore {
  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageLike
  ) {}

  private read(): StoredSettings {
    try {
      if (!fs.existsSync(this.filePath)) return { version: 1 }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<StoredSettings>
      return {
        version: 1,
        endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
        model: typeof parsed.model === 'string' ? parsed.model : '',
        telemetryOptIn: parsed.telemetryOptIn === true,
        apiKeyCipher: typeof parsed.apiKeyCipher === 'string' ? parsed.apiKeyCipher : undefined
      }
    } catch {
      // A corrupt settings file must not prevent the app from starting in Offline Preview.
      return { version: 1 }
    }
  }

  private write(settings: StoredSettings): void {
    const directory = path.dirname(this.filePath)
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const temporaryPath = this.filePath + '.' + process.pid + '.tmp'
    fs.writeFileSync(temporaryPath, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 })
    try {
      fs.chmodSync(temporaryPath, 0o600)
      fs.renameSync(temporaryPath, this.filePath)
      fs.chmodSync(this.filePath, 0o600)
    } catch (error) {
      try { fs.rmSync(temporaryPath, { force: true }) } catch { /* best effort */ }
      throw error
    }
  }

  private decryptStoredKey(settings: StoredSettings): string | undefined {
    if (!settings.apiKeyCipher) return undefined
    try {
      if (!this.safeStorage.isEncryptionAvailable()) return undefined
      return this.safeStorage.decryptString(Buffer.from(settings.apiKeyCipher, 'base64'))
    } catch {
      return undefined
    }
  }

  getGatewayConfig(): GatewayConfig {
    const settings = this.read()
    return {
      endpoint: settings.endpoint || process.env.MODEL_GATEWAY_URL || undefined,
      apiKey: this.decryptStoredKey(settings) || process.env.MODEL_GATEWAY_API_KEY || undefined,
      model: settings.model || process.env.MODEL_NAME || DEFAULT_MODEL,
      timeoutMs: Number(process.env.MODEL_TIMEOUT_MS || 30000)
    }
  }

  getSettings(): AppSettings {
    const settings = this.read()
    const config = this.getGatewayConfig()
    let canEncrypt = false
    try { canEncrypt = this.safeStorage.isEncryptionAvailable() } catch { canEncrypt = false }
    const hasKey = Boolean(config.apiKey)
    return {
      endpoint: config.endpoint || '',
      model: config.model,
      telemetryOptIn: settings.telemetryOptIn === true,
      hasKey,
      canEncrypt,
      mode: config.endpoint && hasKey ? 'live' : 'offline-preview'
    }
  }

  updateSettings(input: AppSettingsUpdate): AppSettings {
    const current = this.read()
    this.write({
      ...current,
      version: 1,
      endpoint: input.endpoint,
      model: input.model,
      telemetryOptIn: input.telemetryOptIn
    })
    return this.getSettings()
  }

  setApiKey(apiKey: string): AppSettings {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is unavailable. Configure MODEL_GATEWAY_API_KEY for development instead.')
    }
    const current = this.read()
    const encrypted = this.safeStorage.encryptString(apiKey)
    this.write({ ...current, version: 1, apiKeyCipher: encrypted.toString('base64') })
    return this.getSettings()
  }

  clearApiKey(): AppSettings {
    const current = this.read()
    delete current.apiKeyCipher
    this.write(current)
    return this.getSettings()
  }
}
