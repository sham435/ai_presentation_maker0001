import type { CanonicalSlideRole, StylePreset } from './types'

/** Bump when theme tokens or role layouts change in a way saved decks should remember. */
export const TEMPLATE_SCHEMA_VERSION = 1


export interface TemplateDef {
  id: string
  name: string
  description: string
  style: StylePreset
  /** CSS gradient/color for gallery preview */
  previewBg: string
  previewAccent: string
  previewText: string
  previewPanel: string
  /** Slide theme tokens */
  bg: string
  panel: string
  accent: string
  text: string
  muted: string
  fontHeading: string
  fontBody: string
  /** Decorative style for generated slides */
  decor: 'none' | 'gradient' | 'grid' | 'dots' | 'diagonal' | 'circle'
}

/** Canonical five-part deck shape, reused by outlines, generated slides, and picker previews. */
export const SLIDE_ROLES = ['cover', 'catalog', 'chapter', 'content', 'end'] as const satisfies readonly CanonicalSlideRole[]

export interface SlideRolePresentation {
  label: string
  previewTitle: string
  previewPoints: string[]
  titlePx: number
  align: 'center' | 'left'
  justify: 'center' | 'flex-start'
  numbered?: boolean
  section?: boolean
}

/** Single source of truth for role labels, sample copy, and layout intent. */
export const SLIDE_ROLE_PRESENTATIONS: Record<CanonicalSlideRole, SlideRolePresentation> = {
  cover: {
    label: 'Presentation',
    previewTitle: 'Your Presentation Title',
    previewPoints: ['Subtitle and presenter details'],
    titlePx: 56,
    align: 'center',
    justify: 'center'
  },
  catalog: {
    label: 'Contents',
    previewTitle: 'Agenda',
    previewPoints: ['Introduction', 'Key insights', 'Strategy', 'Next steps'],
    titlePx: 40,
    align: 'left',
    justify: 'flex-start',
    numbered: true
  },
  chapter: {
    label: 'Chapter',
    previewTitle: 'Section Title',
    previewPoints: ['A short transition into the next section.'],
    titlePx: 44,
    align: 'left',
    justify: 'center',
    section: true
  },
  content: {
    label: 'Insights',
    previewTitle: 'Key Points',
    previewPoints: ['Clear supporting point one', 'Important insight with context', 'Actionable takeaway for audience'],
    titlePx: 40,
    align: 'left',
    justify: 'flex-start'
  },
  end: {
    label: 'Closing',
    previewTitle: 'Thank You',
    previewPoints: ['Questions and discussion'],
    titlePx: 48,
    align: 'center',
    justify: 'center'
  }
}

/** Accept legacy saved roles without letting them leak into new outlines. */
export function normalizeSlideRole(role: string | undefined): CanonicalSlideRole {
  if (role === 'close') return 'end'
  if (role === 'body') return 'content'
  const roles: readonly string[] = SLIDE_ROLES
  return roles.includes(role || '') ? (role as CanonicalSlideRole) : 'content'
}

export type CssStyle = Record<string, string | number>
export type DecorVariant = 'cover' | 'standard' | 'compact'

/** Decor is authored once here and consumed by both slide HTML and picker previews. */
export function getDecorStyle(template: Pick<TemplateDef, 'accent' | 'decor'>, variant: DecorVariant = 'standard'): CssStyle {
  const a = template.accent
  switch (template.decor) {
    case 'gradient':
      return {
        position: 'absolute',
        inset: '0',
        background: `radial-gradient(circle at 85% 15%, ${a}33, transparent 45%),radial-gradient(circle at 15% 85%, ${a}22, transparent 40%)`
      }
    case 'grid':
      return {
        position: 'absolute',
        inset: '0',
        backgroundImage: `linear-gradient(${a}14 1px, transparent 1px),linear-gradient(90deg, ${a}14 1px, transparent 1px)`,
        backgroundSize: variant === 'compact' ? '18px 18px' : '40px 40px'
      }
    case 'dots':
      return {
        position: 'absolute',
        inset: '0',
        backgroundImage: `radial-gradient(${a}22 1.2px, transparent 1.2px)`,
        backgroundSize: variant === 'compact' ? '12px 12px' : '24px 24px'
      }
    case 'diagonal':
      return { position: 'absolute', top: '-20%', right: '-10%', width: '55%', height: '140%', background: `${a}12`, transform: 'skewX(-12deg)' }
    case 'circle':
      return variant === 'compact'
        ? { position: 'absolute', top: -40, right: -40, width: 120, height: 120, borderRadius: '50%', background: `${a}20` }
        : variant === 'cover'
          ? { position: 'absolute', top: -120, right: -120, width: 360, height: 360, borderRadius: '50%', background: `${a}18` }
          : { position: 'absolute', bottom: -100, right: -80, width: 280, height: 280, borderRadius: '50%', background: `${a}18` }
    default:
      return {}
  }
}

/** Serialize shared style tokens into inline HTML without duplicating decor rules. */
export function cssDeclarations(style: CssStyle): string {
  return Object.entries(style)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`)
    .join(';')
}

export const TEMPLATE_CATALOG: TemplateDef[] = [
  {
    id: 'business-navy',
    name: 'Navy Executive',
    description: 'Classic corporate navy with blue accents',
    style: 'Business',
    previewBg: 'linear-gradient(135deg,#0f172a 0%,#1e293b 100%)',
    previewAccent: '#3b82f6',
    previewText: '#f8fafc',
    previewPanel: '#111827',
    bg: '#0f172a',
    panel: '#111827',
    accent: '#3b82f6',
    text: '#f8fafc',
    muted: '#94a3b8',
    fontHeading: 'Inter, system-ui, sans-serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'gradient'
  },
  {
    id: 'education-light',
    name: 'Classroom Light',
    description: 'Clean light theme for lessons and workshops',
    style: 'Education',
    previewBg: 'linear-gradient(135deg,#f8fafc 0%,#e2e8f0 100%)',
    previewAccent: '#2563eb',
    previewText: '#0f172a',
    previewPanel: '#ffffff',
    bg: '#f8fafc',
    panel: '#ffffff',
    accent: '#2563eb',
    text: '#0f172a',
    muted: '#475569',
    fontHeading: 'Inter, system-ui, sans-serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'dots'
  },
  {
    id: 'research-teal',
    name: 'Research Teal',
    description: 'Data-focused dark theme with teal highlights',
    style: 'Research',
    previewBg: 'linear-gradient(135deg,#111827 0%,#134e4a 100%)',
    previewAccent: '#14b8a6',
    previewText: '#f9fafb',
    previewPanel: '#1f2937',
    bg: '#111827',
    panel: '#1f2937',
    accent: '#14b8a6',
    text: '#f9fafb',
    muted: '#9ca3af',
    fontHeading: 'Inter, system-ui, sans-serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'grid'
  },
  {
    id: 'marketing-sunset',
    name: 'Sunset Pitch',
    description: 'Bold dark theme with warm orange energy',
    style: 'Marketing',
    previewBg: 'linear-gradient(135deg,#18181b 0%,#431407 100%)',
    previewAccent: '#f97316',
    previewText: '#fafafa',
    previewPanel: '#27272a',
    bg: '#18181b',
    panel: '#27272a',
    accent: '#f97316',
    text: '#fafafa',
    muted: '#a1a1aa',
    fontHeading: 'Inter, system-ui, sans-serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'diagonal'
  },
  {
    id: 'tech-cyber',
    name: 'Cyber Cyan',
    description: 'Futuristic tech theme with cyan glow',
    style: 'Technology',
    previewBg: 'linear-gradient(135deg,#020617 0%,#082f49 100%)',
    previewAccent: '#22d3ee',
    previewText: '#e2e8f0',
    previewPanel: '#0f172a',
    bg: '#020617',
    panel: '#0f172a',
    accent: '#22d3ee',
    text: '#e2e8f0',
    muted: '#94a3b8',
    fontHeading: 'Inter, system-ui, sans-serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'grid'
  },
  {
    id: 'portfolio-gold',
    name: 'Portfolio Gold',
    description: 'Elegant warm dark theme for showcases',
    style: 'Portfolio',
    previewBg: 'linear-gradient(135deg,#1c1917 0%,#422006 100%)',
    previewAccent: '#eab308',
    previewText: '#fafaf9',
    previewPanel: '#292524',
    bg: '#1c1917',
    panel: '#292524',
    accent: '#eab308',
    text: '#fafaf9',
    muted: '#d6d3d1',
    fontHeading: 'Georgia, serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'circle'
  },
  {
    id: 'lifestyle-rose',
    name: 'Rose Lifestyle',
    description: 'Soft warm theme for lifestyle and wellness',
    style: 'Lifestyle',
    previewBg: 'linear-gradient(135deg,#fff1f2 0%,#ffe4e6 100%)',
    previewAccent: '#e11d48',
    previewText: '#1f2937',
    previewPanel: '#ffffff',
    bg: '#fff1f2',
    panel: '#ffffff',
    accent: '#e11d48',
    text: '#1f2937',
    muted: '#6b7280',
    fontHeading: 'Georgia, serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'circle'
  },
  {
    id: 'corporate-slate',
    name: 'Corporate Slate',
    description: 'Professional slate gray for formal decks',
    style: 'Corporate',
    previewBg: 'linear-gradient(135deg,#f1f5f9 0%,#cbd5e1 100%)',
    previewAccent: '#0f766e',
    previewText: '#0f172a',
    previewPanel: '#ffffff',
    bg: '#f1f5f9',
    panel: '#ffffff',
    accent: '#0f766e',
    text: '#0f172a',
    muted: '#475569',
    fontHeading: 'Inter, system-ui, sans-serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'none'
  },
  {
    id: 'healthcare-mint',
    name: 'Healthcare Mint',
    description: 'Calm clean theme for health and science',
    style: 'Healthcare',
    previewBg: 'linear-gradient(135deg,#ecfeff 0%,#cffafe 100%)',
    previewAccent: '#0891b2',
    previewText: '#164e63',
    previewPanel: '#ffffff',
    bg: '#ecfeff',
    panel: '#ffffff',
    accent: '#0891b2',
    text: '#164e63',
    muted: '#0e7490',
    fontHeading: 'Inter, system-ui, sans-serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'dots'
  },
  {
    id: 'minimal-mono',
    name: 'Minimal Mono',
    description: 'Minimal monochrome with sharp contrast',
    style: 'Business',
    previewBg: 'linear-gradient(135deg,#ffffff 0%,#f5f5f5 100%)',
    previewAccent: '#111111',
    previewText: '#111111',
    previewPanel: '#ffffff',
    bg: '#ffffff',
    panel: '#fafafa',
    accent: '#111111',
    text: '#111111',
    muted: '#525252',
    fontHeading: 'Georgia, serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'none'
  },
  {
    id: 'startup-violet',
    name: 'Startup Violet',
    description: 'Modern startup gradient with violet accent',
    style: 'Technology',
    previewBg: 'linear-gradient(135deg,#1e1b4b 0%,#4c1d95 100%)',
    previewAccent: '#a78bfa',
    previewText: '#f5f3ff',
    previewPanel: '#312e81',
    bg: '#1e1b4b',
    panel: '#312e81',
    accent: '#a78bfa',
    text: '#f5f3ff',
    muted: '#c4b5fd',
    fontHeading: 'Inter, system-ui, sans-serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'gradient'
  },
  {
    id: 'creative-coral',
    name: 'Creative Coral',
    description: 'Vibrant creative theme for bold ideas',
    style: 'Marketing',
    previewBg: 'linear-gradient(135deg,#fff7ed 0%,#fed7aa 100%)',
    previewAccent: '#ea580c',
    previewText: '#431407',
    previewPanel: '#ffffff',
    bg: '#fff7ed',
    panel: '#ffffff',
    accent: '#ea580c',
    text: '#431407',
    muted: '#9a3412',
    fontHeading: 'Georgia, serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'diagonal'
  },
  {
    id: 'academic-forest',
    name: 'Academic Forest',
    description: 'Traditional academic green for lectures',
    style: 'Education',
    previewBg: 'linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%)',
    previewAccent: '#15803d',
    previewText: '#14532d',
    previewPanel: '#ffffff',
    bg: '#f0fdf4',
    panel: '#ffffff',
    accent: '#15803d',
    text: '#14532d',
    muted: '#166534',
    fontHeading: 'Georgia, serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'none'
  },
  {
    id: 'pitch-midnight',
    name: 'Midnight Pitch',
    description: 'High-contrast dark deck for investor pitches',
    style: 'Business',
    previewBg: 'linear-gradient(135deg,#000000 0%,#1f2937 100%)',
    previewAccent: '#60a5fa',
    previewText: '#ffffff',
    previewPanel: '#111827',
    bg: '#030712',
    panel: '#111827',
    accent: '#60a5fa',
    text: '#f9fafb',
    muted: '#9ca3af',
    fontHeading: 'Inter, system-ui, sans-serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'gradient'
  },
  {
    id: 'wellness-sky',
    name: 'Wellness Sky',
    description: 'Airy blue theme for wellness and lifestyle',
    style: 'Lifestyle',
    previewBg: 'linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%)',
    previewAccent: '#2563eb',
    previewText: '#1e3a8a',
    previewPanel: '#ffffff',
    bg: '#eff6ff',
    panel: '#ffffff',
    accent: '#2563eb',
    text: '#1e3a8a',
    muted: '#3b82f6',
    fontHeading: 'Inter, system-ui, sans-serif',
    fontBody: 'Inter, system-ui, sans-serif',
    decor: 'circle'
  }
]

/** 'auto' keeps the documented style-driven default; ids are enumerable for IPC validation. */
export const TEMPLATE_IDS = ['auto', ...TEMPLATE_CATALOG.map((t) => t.id)] as [string, ...string[]]

export function getTemplateById(id: string | undefined): TemplateDef | undefined {
  if (!id || id === 'auto') return undefined
  return TEMPLATE_CATALOG.find((t) => t.id === id)
}

export function getTemplatesByStyle(style: StylePreset): TemplateDef[] {
  return TEMPLATE_CATALOG.filter((t) => t.style === style)
}

export function resolveTemplate(templateId: string | undefined, style: StylePreset): TemplateDef {
  const byId = getTemplateById(templateId)
  if (byId) return byId
  return getTemplatesByStyle(style)[0] || TEMPLATE_CATALOG[0]
}
