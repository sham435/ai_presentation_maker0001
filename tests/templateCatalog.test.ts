import { describe, expect, it } from 'vitest'
import {
  SLIDE_ROLES,
  TEMPLATE_CATALOG,
  TEMPLATE_IDS,
  getTemplateById,
  getTemplatesByStyle,
  normalizeSlideRole,
  resolveTemplate
} from '../src/shared/templateCatalog'
import { STYLE_PRESETS } from '../src/shared/constants'

describe('template catalog', () => {
  it('exposes unique ids and complete theme tokens', () => {
    const ids = TEMPLATE_CATALOG.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(TEMPLATE_IDS[0]).toBe('auto')
    for (const t of TEMPLATE_CATALOG) {
      expect(STYLE_PRESETS).toContain(t.style)
      for (const token of ['previewBg', 'previewAccent', 'bg', 'panel', 'accent', 'text', 'muted', 'fontHeading', 'fontBody'] as const) {
        expect(t[token]).toBeTruthy()
      }
    }
  })

  it('treats auto and unknown ids as unresolved', () => {
    expect(getTemplateById('auto')).toBeUndefined()
    expect(getTemplateById('not-a-template')).toBeUndefined()
    expect(getTemplateById('business-navy')?.name).toBe('Navy Executive')
  })

  it('falls back by style, then to the first catalog template', () => {
    expect(resolveTemplate('not-a-template', 'Marketing').id).toBe('marketing-sunset')
    expect(resolveTemplate(undefined, 'Research').id).toBe('research-teal')
    expect(resolveTemplate('not-a-template', 'Unknown' as never).id).toBe(TEMPLATE_CATALOG[0].id)
    expect(getTemplatesByStyle('Education')).toHaveLength(2)
  })

  it('normalizes legacy roles to the five canonical roles', () => {
    expect(SLIDE_ROLES).toEqual(['cover', 'catalog', 'chapter', 'content', 'end'])
    expect(normalizeSlideRole('body')).toBe('content')
    expect(normalizeSlideRole('close')).toBe('end')
    expect(normalizeSlideRole('unknown')).toBe('content')
    for (const role of SLIDE_ROLES) expect(normalizeSlideRole(role)).toBe(role)
  })
})
