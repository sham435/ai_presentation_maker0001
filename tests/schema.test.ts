import { describe, expect, it } from 'vitest'
import {
  createDeckSchema,
  credentialSetSchema,
  credentialStatusSchema,
  editDeckSchema,
  gatewayDiagnosisSchema,
  gatewayStatusSchema,
  settingsSetSchema,
  settingsStateSchema
} from '../src/shared/schema'

describe('createDeckSchema', () => {
  it('accepts a valid brief', () => {
    const r = createDeckSchema.safeParse({ brief: 'A deck about AI for students' })
    expect(r.success).toBe(true)
  })

  it('rejects short brief', () => {
    const r = createDeckSchema.safeParse({ brief: 'hi' })
    expect(r.success).toBe(false)
  })

  it('accepts options', () => {
    const r = createDeckSchema.safeParse({
      brief: 'Renewable energy for investors',
      options: { language: 'en', pageCount: '10-15', style: 'Business', audience: 'Investors' }
    })
    expect(r.success).toBe(true)
  })

  it('accepts a known templateId and rejects unknown ids', () => {
    expect(createDeckSchema.safeParse({ brief: 'Deck', options: { templateId: 'research-teal' } }).success).toBe(true)
    expect(createDeckSchema.safeParse({ brief: 'Deck', options: { templateId: 'auto' } }).success).toBe(true)
    expect(createDeckSchema.safeParse({ brief: 'Deck', options: { templateId: '../../etc/passwd' } }).success).toBe(false)
  })
})

describe('editDeckSchema', () => {
  it('accepts valid edit', () => {
    const r = editDeckSchema.safeParse({ sessionId: 'abc', instruction: 'Make slide 2 shorter', targetSlides: [2] })
    expect(r.success).toBe(true)
  })

  it('rejects missing instruction', () => {
    const r = editDeckSchema.safeParse({ sessionId: 'abc', instruction: '' })
    expect(r.success).toBe(false)
  })

  it('accepts an operation id for cancellation', () => {
    expect(editDeckSchema.safeParse({ sessionId: 'abc', instruction: 'Shorten slide 2', operationId: 'op-1' }).success).toBe(true)
  })
})

describe('settings and credential schemas', () => {
  it('accepts http(s) endpoints and rejects javascript URLs', () => {
    expect(settingsSetSchema.safeParse({ endpoint: 'https://api.example.com' }).success).toBe(true)
    expect(settingsSetSchema.safeParse({ endpoint: 'http://localhost:11434' }).success).toBe(true)
    expect(settingsSetSchema.safeParse({ endpoint: 'javascript:alert(1)' }).success).toBe(false)
  })

  it('allows an empty endpoint to clear the setting', () => {
    expect(settingsSetSchema.safeParse({ endpoint: '' }).success).toBe(true)
  })

  it('rejects public plaintext endpoints and credentials embedded in URLs', () => {
    expect(settingsSetSchema.safeParse({ endpoint: 'http://api.example.com' }).success).toBe(false)
    expect(settingsSetSchema.safeParse({ endpoint: 'https://user:pass@api.example.com' }).success).toBe(false)
    expect(settingsSetSchema.safeParse({ endpoint: 'http://192.168.1.50:11434' }).success).toBe(true)
  })

  it('rejects an empty API key', () => {
    expect(credentialSetSchema.safeParse({ apiKey: '' }).success).toBe(false)
    expect(credentialSetSchema.safeParse({ apiKey: 'sk-test' }).success).toBe(true)
  })
})

describe('renderer-bound response schemas', () => {
  const status = { hasKey: true, canEncrypt: true }

  it('accepts valid status payloads', () => {
    expect(credentialStatusSchema.safeParse(status).success).toBe(true)
    expect(gatewayStatusSchema.safeParse({ mode: 'live', model: 'gpt-test', hasKey: true }).success).toBe(true)
    expect(gatewayDiagnosisSchema.safeParse({ ok: true, mode: 'live', model: 'gpt-test', latencyMs: 12 }).success).toBe(true)
  })

  it('rejects any credential material in responses', () => {
    expect(credentialStatusSchema.safeParse({ ...status, apiKey: 'sk-secret' }).success).toBe(false)
    expect(settingsStateSchema.safeParse({ ...status, mode: 'live', apiKeyCipher: 'cipher' }).success).toBe(false)
    expect(gatewayDiagnosisSchema.safeParse({ ok: true, mode: 'live', model: 'm', latencyMs: 1, apiKey: 'sk-secret' }).success).toBe(false)
  })
})
