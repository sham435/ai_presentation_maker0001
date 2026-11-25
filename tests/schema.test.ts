import { describe, expect, it } from 'vitest'
import { createDeckSchema, editDeckSchema } from '../src/shared/schema'

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
})
