import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { IPC, type IpcChannel } from '@shared/ipc'
import {
  RESPONSE_SCHEMAS,
  PRIVILEGED_CHANNELS,
  isSafeArtifactPath,
  validated,
  validationMessage
} from '../../src/main/ipcGuards'
import { createDeckSchema, credentialSetSchema, editDeckSchema, isAllowedModelEndpoint, settingsSetSchema } from '@shared/schema'

const dirs: string[] = []
const SECRET = 'sk-live-TESTSECRET-9f3c'

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('IPC request and response validation', () => {
  it('guards every privileged IPC channel', () => {
    const channels = Object.values(IPC).filter((channel) => channel !== IPC.AGENT_EVENT) as IpcChannel[]
    expect(channels.length).toBeGreaterThan(15)
    for (const channel of channels) {
      expect(PRIVILEGED_CHANNELS[channel as keyof typeof PRIVILEGED_CHANNELS]).toBeTypeOf('function')
    }
    expect(Object.keys(PRIVILEGED_CHANNELS)).toHaveLength(channels.length)
  })

  it('rejects malformed payloads on every privileged channel without echoing them', () => {
    for (const [channel, validator] of Object.entries(PRIVILEGED_CHANNELS)) {
      expect(() => validator(null), `${channel} accepted null`).toThrow()
      expect(() => validator(42), `${channel} accepted a number`).toThrow()
      expect(() => validator({ apiKey: SECRET, '__proto__': { polluted: true } }), `${channel} accepted a hostile object`).toThrow()
      try {
        validator({ apiKey: SECRET })
      } catch (error) {
        expect((error as Error).message).not.toContain(SECRET)
      }
    }
  })

  it('rejects schema violations for create, edit, settings and credential payloads', () => {
    expect(createDeckSchema.safeParse({ brief: 'ab' }).success).toBe(false)
    expect(createDeckSchema.safeParse({ brief: 'A valid brief', extra: true }).success).toBe(false)
    expect(createDeckSchema.safeParse({ brief: 'A valid brief', options: { templateId: '../escape' } }).success).toBe(false)
    expect(editDeckSchema.safeParse({ sessionId: 's', instruction: 'ok', targetSlides: [-1] }).success).toBe(false)
    expect(settingsSetSchema.safeParse({ endpoint: 'https://user:pass@public.example' }).success).toBe(false)
    expect(settingsSetSchema.safeParse({ endpoint: 'http://public.example' }).success).toBe(false)
    expect(isAllowedModelEndpoint('http://127.0.0.1:11434')).toBe(true)
    expect(credentialSetSchema.safeParse({ apiKey: '' }).success).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('rejects invalid renderer-bound responses', () => {
    expect(() => validated(RESPONSE_SCHEMAS.credentialStatus, { hasKey: true, canEncrypt: true, apiKey: SECRET })).toThrow()
    expect(() => validated(RESPONSE_SCHEMAS.gatewayStatus, { mode: 'live', model: 'm', hasKey: true, apiKey: SECRET })).toThrow()
    expect(() => validated(RESPONSE_SCHEMAS.gatewayDiagnosis, { ok: true, mode: 'live', model: 'm', latencyMs: 1, apiKey: SECRET })).toThrow()
    expect(() => validated(RESPONSE_SCHEMAS.telemetryList, [{ ts: 'x', level: 'info', message: 'ok', apiKey: SECRET }])).toThrow()
    expect(() => validated(RESPONSE_SCHEMAS.settingsState, { hasKey: true, canEncrypt: true, mode: 'live', ciphertext: SECRET })).toThrow()
  })

  it('never includes credential material or ciphertext in validation errors', () => {
    const errors: string[] = []
    try {
      validated(RESPONSE_SCHEMAS.credentialStatus, { hasKey: SECRET, canEncrypt: true })
    } catch (error) {
      errors.push((error as Error).message)
    }
    try {
      validated(RESPONSE_SCHEMAS.settingsState, { hasKey: true, canEncrypt: true, mode: 'live', apiKey: SECRET })
    } catch (error) {
      errors.push((error as Error).message)
    }
    expect(errors.length).toBe(2)
    for (const message of errors) expect(message).not.toContain(SECRET)
    expect(validationMessage({ issues: [{ message: 'Invalid apiKey' }] })).toBe('Invalid apiKey')
  })
})

describe('artifact path boundary', () => {
  it('accepts only existing regular files inside the artifact root', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-ipc-'))
    dirs.push(dir)
    const root = path.join(dir, 'artifacts')
    fs.mkdirSync(root)
    const allowed = path.join(root, 'deck-v1.html')
    fs.writeFileSync(allowed, '<html></html>')
    const outside = path.join(dir, 'secret.html')
    fs.writeFileSync(outside, 'secret')
    const link = path.join(root, 'escape.html')
    fs.symlinkSync(outside, link)

    expect(isSafeArtifactPath(allowed, root)).toBe(true)
    expect(isSafeArtifactPath(outside, root)).toBe(false)
    expect(isSafeArtifactPath(path.relative(root, outside), root)).toBe(false)
    expect(isSafeArtifactPath(`../${path.basename(outside)}`, root)).toBe(false)
    expect(isSafeArtifactPath(`${allowed}\0.txt`, root)).toBe(false)
    expect(isSafeArtifactPath(link, root)).toBe(false)
    expect(isSafeArtifactPath(root, root)).toBe(false)
    expect(isSafeArtifactPath(path.join(root, 'missing.html'), root)).toBe(false)
    expect(isSafeArtifactPath('', root)).toBe(false)
    expect(isSafeArtifactPath(null, root)).toBe(false)
  })
})
