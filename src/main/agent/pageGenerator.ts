import { ModelGatewayError, type ModelGateway, type RetryInfo } from './modelGateway'
import { getTheme, type Theme } from './templates'
import { escapeText, sanitizeHtml } from '../security/sanitize'
import {
  SLIDE_ROLE_PRESENTATIONS,
  TEMPLATE_SCHEMA_VERSION,
  cssDeclarations,
  getDecorStyle,
  normalizeSlideRole
} from '@shared/templateCatalog'
import type { CanonicalSlideRole, Outline, OutlineSlide, PresentationSpec, Slide } from '@shared/types'

interface GeneratedContent {
  headline: string
  bullets: string[]
  notes: string
  citations: string[]
}

interface RenderSlideInput extends GeneratedContent {
  index: number
  role: string
}

export async function generateSlide(
  spec: PresentationSpec,
  outline: Outline,
  slidePlan: OutlineSlide,
  model: ModelGateway,
  signal?: AbortSignal,
  onRetry?: (info: RetryInfo) => void
): Promise<Slide> {
  const system =
    'You write concise, professional presentation slide content. Return ONLY valid JSON. No scripts, no HTML, no markdown.'
  const prompt = `Return JSON slide content for this slide.
Deck title: ${outline.title}
Topic: ${spec.topic}
Audience: ${spec.audience}
Language: ${spec.language}
Style: ${spec.styleClass}
Headline: ${slidePlan.headline}
Role: ${normalizeSlideRole(slidePlan.role)}
Seed points: ${slidePlan.points.join('; ')}
Include citations: ${spec.includeCitations ? 'yes' : 'no'}
Return JSON: {"headline":string,"bullets":string[],"notes"?:string,"citations"?:string[]}`

  let content: GeneratedContent = {
    headline: slidePlan.headline,
    bullets: slidePlan.points,
    notes: '',
    citations: []
  }
  try {
    const raw = await model.complete({ system, prompt, temperature: 0.4, signal, onRetry })
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      if (parsed?.headline && Array.isArray(parsed?.bullets)) {
        content = {
          headline: String(parsed.headline),
          bullets: parsed.bullets.map((b: unknown) => String(b)).slice(0, 6),
          notes: parsed.notes ? String(parsed.notes) : '',
          citations: Array.isArray(parsed.citations) ? parsed.citations.map((c: unknown) => String(c)).slice(0, 4) : []
        }
      }
    }
  } catch (err) {
    // Provider/transport failures must surface; only malformed model output falls back.
    if (err instanceof ModelGatewayError) throw err
    // fallback to outline seed
  }

  const theme = getTheme(spec.styleClass, spec.templateId)
  const layout = normalizeSlideRole(slidePlan.role)
  const html = sanitizeHtml(
    renderSlideHtml({ ...slidePlan, ...content, role: layout }, layout, theme)
  )

  return {
    index: slidePlan.index,
    role: layout,
    layout,
    theme: `${theme.id}@v${TEMPLATE_SCHEMA_VERSION}`,
    content,
    html
  }
}

function renderSlideHtml(slide: RenderSlideInput, inputRole: CanonicalSlideRole, theme: Theme): string {
  const role = normalizeSlideRole(inputRole)
  const preset = SLIDE_ROLE_PRESENTATIONS[role]
  const sectionStyle = cssDeclarations({
    position: 'relative',
    overflow: 'hidden',
    background: theme.bg,
    color: theme.text,
    minHeight: '100%',
    padding: '64px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: preset.justify,
    alignItems: preset.align === 'center' ? 'center' : 'flex-start',
    fontFamily: theme.fontBody,
    boxSizing: 'border-box'
  })
  const decorStyle = getDecorStyle(theme, role === 'cover' || role === 'end' ? 'cover' : 'standard')
  const decor = Object.keys(decorStyle).length
    ? `<div style="${cssDeclarations(decorStyle)}"></div>`
    : ''
  const wrapperStyle = cssDeclarations({
    position: 'relative',
    zIndex: 1,
    maxWidth: '980px',
    width: '100%',
    textAlign: preset.align
  })
  const labelStyle = cssDeclarations({
    color: theme.accent,
    fontWeight: 700,
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    marginBottom: '18px',
    fontSize: '14px'
  })
  const titleStyle = cssDeclarations({
    fontFamily: theme.fontHeading,
    fontSize: `${preset.titlePx}px`,
    lineHeight: 1.1,
    margin: '0 0 28px 0'
  })
  const panelStyle = cssDeclarations({
    background: theme.panel,
    border: `1px solid ${theme.accent}33`,
    borderRadius: '18px',
    padding: '24px 28px',
    marginTop: '8px',
    boxShadow: `0 18px 50px ${theme.accent}12`
  })

  const body = renderBody(slide, role, theme, panelStyle)
  const citations = renderCitations(slide.citations, theme)
  const accentBar = role === 'cover'
    ? `<div style="${cssDeclarations({ width: '72px', height: '4px', background: theme.accent, margin: preset.align === 'center' ? '0 auto 24px auto' : '0 0 24px 0', borderRadius: '2px' })}"></div>`
    : ''

  return `<section class="slide" data-index="" data-role="${role}" style="${sectionStyle}">
  ${decor}
  <div style="${wrapperStyle}">
    <div style="${labelStyle}">${escapeText(preset.label)}</div>
    ${role === 'chapter' ? `<div style="${cssDeclarations({ fontSize: '72px', fontWeight: 800, color: `${theme.accent}44`, lineHeight: 1, marginBottom: '8px' })}">${String(slide.index).padStart(2, '0')}</div>` : ''}
    <h1 style="${titleStyle}">${escapeText(slide.headline)}</h1>
    ${accentBar}
    ${body}
    ${citations}
  </div>
</section>`
}

function renderBody(slide: RenderSlideInput, role: CanonicalSlideRole, theme: Theme, panelStyle: string): string {
  const items = slide.bullets.filter(Boolean).slice(0, 6)
  if (!items.length) return ''

  if (role === 'catalog') {
    const rows = items
      .map(
        (item, i) => `<div style="${cssDeclarations({ display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${theme.accent}22`, fontSize: '20px', color: theme.muted })}">
      <span style="${cssDeclarations({ color: theme.accent, fontWeight: 700, width: '36px' })}">${String(i + 1).padStart(2, '0')}</span><span>${escapeText(item)}</span>
    </div>`
      )
      .join('')
    return `<div style="${panelStyle}">${rows}</div>`
  }

  if (role === 'content') {
    const listStyle = cssDeclarations({
      fontSize: '22px',
      lineHeight: 1.55,
      color: theme.muted,
      paddingLeft: '28px',
      margin: 0
    })
    return `<div style="${panelStyle}"><ul style="${listStyle}">${items.map((item) => `<li style="margin-bottom:10px;">${escapeText(item)}</li>`).join('')}</ul></div>`
  }

  const listStyle = cssDeclarations({
    fontSize: role === 'cover' ? '22px' : '20px',
    lineHeight: 1.55,
    color: theme.muted,
    paddingLeft: SLIDE_ROLE_PRESENTATIONS[role].align === 'center' ? '0' : '24px',
    margin: 0,
    listStyle: SLIDE_ROLE_PRESENTATIONS[role].align === 'center' ? 'none' : 'disc'
  })
  return `<ul style="${listStyle}">${items.map((item) => `<li style="margin-bottom:8px;">${escapeText(item)}</li>`).join('')}</ul>`
}

function renderCitations(citations: string[] | undefined, theme: Theme): string {
  const items = (citations || []).filter(Boolean).slice(0, 4)
  if (!items.length) return ''
  const style = cssDeclarations({
    marginTop: '28px',
    paddingTop: '14px',
    borderTop: `1px solid ${theme.accent}33`,
    color: theme.muted,
    fontSize: '14px',
    lineHeight: 1.5,
    textAlign: 'left'
  })
  return `<div style="${style}"><div style="${cssDeclarations({ fontWeight: 700, color: theme.accent, marginBottom: '6px' })}">Sources</div><ul style="${cssDeclarations({ margin: 0, paddingLeft: '18px' })}">${items.map((item) => `<li>${escapeText(item)}</li>`).join('')}</ul></div>`
}
