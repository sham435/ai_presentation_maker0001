import { nanoid } from 'nanoid'
import { DEFAULT_LANGUAGE, DEFAULT_PAGE_BUCKET, DEFAULT_STYLE, STYLE_PRESETS } from '@shared/constants'
import { getTemplateById } from '@shared/templateCatalog'
import type { CreatePresentationRequest, PresentationSpec, StylePreset } from '@shared/types'

function detectLanguage(text: string, explicit?: string): string {
  if (explicit) return explicit
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh'
  if (/[\u3040-\u30ff]/.test(text)) return 'ja'
  if (/[\uac00-\ud7af]/.test(text)) return 'ko'
  return DEFAULT_LANGUAGE
}

function normalizeStyle(style?: string): StylePreset {
  const found = STYLE_PRESETS.find((s) => s.toLowerCase() === style?.toLowerCase())
  return found || DEFAULT_STYLE
}

function pageBucket(input: CreatePresentationRequest['options']): string {
  const raw = input?.pageCount
  if (typeof raw === 'number') {
    if (raw <= 5) return 'short'
    if (raw <= 12) return 'medium'
    return 'long'
  }
  return raw || DEFAULT_PAGE_BUCKET
}

export function parseCreateRequest(req: CreatePresentationRequest): PresentationSpec {
  const brief = req.brief?.trim()
  if (!brief) throw new Error('brief is required')
  const audience = req.options?.audience?.trim() || inferAudience(brief)
  const requestedTemplateId = req.options?.templateId?.trim()
  const template = getTemplateById(requestedTemplateId)
  // Unknown ids are normalized once at the boundary; downstream code can trust the catalog.
  const templateId = template ? requestedTemplateId! : 'auto'
  const styleClass = template?.style || normalizeStyle(req.options?.style)
  return {
    sessionId: nanoid(),
    mode: 'create',
    topic: brief,
    audience,
    language: detectLanguage(brief, req.options?.language),
    pageCountBucket: pageBucket(req.options),
    styleClass,
    templateId,
    referenceDocs: req.options?.referenceFiles || [],
    brief,
    includeCitations: Boolean(req.options?.includeCitations)
  }
}

function inferAudience(brief: string): string {
  const b = brief.toLowerCase()
  if (b.includes('investor')) return 'Investors'
  if (b.includes('student') || b.includes('lecture')) return 'Students'
  if (b.includes('executive') || b.includes('leadership')) return 'Executives'
  if (b.includes('customer') || b.includes('marketing')) return 'Customers'
  return 'General audience'
}
