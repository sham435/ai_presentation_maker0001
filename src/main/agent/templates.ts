import { resolveTemplate, type TemplateDef } from '@shared/templateCatalog'
import type { StylePreset } from '@shared/types'

export interface Theme {
  id: string
  preset: StylePreset
  bg: string
  panel: string
  accent: string
  text: string
  muted: string
  fontHeading: string
  fontBody: string
  decor: TemplateDef['decor']
}

export function getTheme(preset: StylePreset, templateId?: string): Theme {
  const t = resolveTemplate(templateId, preset)
  return {
    id: t.id,
    preset: t.style,
    bg: t.bg,
    panel: t.panel,
    accent: t.accent,
    text: t.text,
    muted: t.muted,
    fontHeading: t.fontHeading,
    fontBody: t.fontBody,
    decor: t.decor
  }
}
