import { describe, expect, it } from 'vitest'
import { generateSlide } from '../src/main/agent/pageGenerator'
import { getTheme } from '../src/main/agent/templates'
import { MockModelGateway } from '../src/main/agent/modelGateway'
import { escapeText, sanitizeHtml } from '../src/main/security/sanitize'
import type { Outline, PresentationSpec } from '../src/shared/types'

const model = new MockModelGateway()

function spec(templateId: string): PresentationSpec {
  return {
    sessionId: 'test',
    mode: 'create',
    topic: 'Renewable energy',
    audience: 'Investors',
    language: 'en',
    pageCountBucket: 'short',
    styleClass: 'Business',
    templateId,
    referenceDocs: [],
    brief: 'Renewable energy for investors'
  }
}

const outline: Outline = { title: 'Renewable energy', slides: [] }
const slidePlan = { index: 1, role: 'content', headline: 'Key Points', points: ['Point one', 'Point two'] }

describe('template themes', () => {
  it('resolves tokens from the selected template id', () => {
    expect(getTheme('Business', 'research-teal')).toMatchObject({
      id: 'research-teal',
      preset: 'Research',
      bg: '#111827',
      panel: '#1f2937',
      accent: '#14b8a6'
    })
  })

  it('falls back to style-driven theme for auto/unknown ids', () => {
    expect(getTheme('Business', 'auto').id).toBe('business-navy')
    expect(getTheme('Business', 'unknown-id').id).toBe('business-navy')
  })

  it('propagates the selected theme into sanitized slide HTML', async () => {
    const slide = await generateSlide(spec('research-teal'), outline, slidePlan, model)
    expect(slide.theme).toBe('research-teal@v1')
    expect(slide.html).toContain('background:#111827')
    expect(slide.html).toContain('color:#14b8a6')
    expect(slide.html).toContain('data-role="content"')
    expect(slide.html).toContain('font-family:Inter, system-ui, sans-serif')

    const other = await generateSlide(spec('marketing-sunset'), outline, slidePlan, model)
    expect(other.theme).toBe('marketing-sunset@v1')
    expect(other.html).toContain('background:#18181b')
    expect(other.html).toContain('color:#f97316')
    expect(other.html).not.toContain('#111827')
  })
})

describe('HTML sanitization for themed slides', () => {
  it('keeps safe layout styles and data attributes', () => {
    const html = sanitizeHtml('<section style="background:#0f172a;color:#fff" data-index="1">Hi</section>')
    expect(html).toContain('style="background:#0f172a;color:#fff"')
    expect(html).toContain('data-index="1"')
  })

  it('strips scripts, event handlers, and unsafe style values', () => {
    const html = sanitizeHtml(
      '<div style="background:url(javascript:alert(1))" onclick="alert(1)">x</div><script>alert(1)</script>'
    )
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('style=')
  })

  it('escapes model text', () => {
    expect(escapeText('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })
})
