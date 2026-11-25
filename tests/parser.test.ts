import { describe, expect, it } from 'vitest'
import { parseCreateRequest } from '../src/main/agent/parser'

describe('parseCreateRequest', () => {
  it('creates a spec with defaults', () => {
    const spec = parseCreateRequest({ brief: 'A presentation about climate change' })
    expect(spec.mode).toBe('create')
    expect(spec.topic).toContain('climate change')
    expect(spec.language).toBe('en')
    expect(spec.styleClass).toBe('Business')
    expect(spec.sessionId).toBeTruthy()
  })

  it('detects chinese language', () => {
    const spec = parseCreateRequest({ brief: '关于人工智能的演示文稿' })
    expect(spec.language).toBe('zh')
  })

  it('respects explicit options', () => {
    const spec = parseCreateRequest({
      brief: 'AI safety deck',
      options: { language: 'en', style: 'Research', audience: 'Researchers', pageCount: 'short' }
    })
    expect(spec.styleClass).toBe('Research')
    expect(spec.audience).toBe('Researchers')
    expect(spec.pageCountBucket).toBe('short')
  })

  it('accepts templateId and infers style from template', () => {
    const spec = parseCreateRequest({
      brief: 'Startup pitch deck',
      options: { templateId: 'startup-violet' }
    })
    expect(spec.templateId).toBe('startup-violet')
    expect(spec.styleClass).toBe('Technology')
  })

  it('normalizes unknown template ids at the boundary', () => {
    const spec = parseCreateRequest({
      brief: 'Team update',
      options: { templateId: 'not-a-template', style: 'Education' }
    })
    expect(spec.templateId).toBe('auto')
    expect(spec.styleClass).toBe('Education')
  })
})
