import type { ModelGateway } from './modelGateway'
import { getTheme } from './templates'
import { escapeText, sanitizeHtml } from '../security/sanitize'
import type { Outline, OutlineSlide, PresentationSpec, Slide } from '@shared/types'

export async function generateSlide(
  spec: PresentationSpec,
  outline: Outline,
  slidePlan: OutlineSlide,
  model: ModelGateway
): Promise<Slide> {
  const system =
    'You write concise presentation slide content. Return ONLY valid JSON. No scripts, no HTML, no markdown.'
  const prompt = `Return JSON slide content for this slide.
Deck title: ${outline.title}
Topic: ${spec.topic}
Audience: ${spec.audience}
Language: ${spec.language}
Style: ${spec.styleClass}
Headline: ${slidePlan.headline}
Role: ${slidePlan.role}
Seed points: ${slidePlan.points.join('; ')}
Return JSON: {"headline":string,"bullets":string[],"notes"?:string}`

  let content = { headline: slidePlan.headline, bullets: slidePlan.points, notes: '' }
  try {
    const raw = await model.complete({ system, prompt, temperature: 0.4 })
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      if (parsed?.headline && Array.isArray(parsed?.bullets)) {
        content = {
          headline: String(parsed.headline),
          bullets: parsed.bullets.map((b: unknown) => String(b)).slice(0, 6),
          notes: parsed.notes ? String(parsed.notes) : ''
        }
      }
    }
  } catch {
    // fallback to outline seed
  }

  const theme = getTheme(spec.styleClass)
  const layout = slidePlan.role === 'cover' ? 'cover' : slidePlan.role === 'close' ? 'closing' : 'title-and-bullets'
  const html = sanitizeHtml(renderSlideHtml({ ...slidePlan, ...content }, layout, theme))

  return {
    index: slidePlan.index,
    role: slidePlan.role,
    layout,
    theme: theme.id,
    content,
    html
  }
}

function renderSlideHtml(
  slide: { headline: string; bullets: string[]; role: string },
  layout: Slide['layout'],
  theme: ReturnType<typeof getTheme>
): string {
  const bullets = slide.bullets
    .map((b) => `<li>${escapeText(b)}</li>`)
    .join('')
  const titleSize = layout === 'cover' ? '52px' : '38px'
  const align = layout === 'cover' || layout === 'closing' ? 'center' : 'left'
  const justify = layout === 'cover' || layout === 'closing' ? 'center' : 'flex-start'
  return `<section class="slide" data-index="" style="background:${theme.bg};color:${theme.text};min-height:100%;padding:56px;display:flex;flex-direction:column;justify-content:${justify};align-items:${align};font-family:Inter,system-ui,sans-serif;box-sizing:border-box;">
  <div style="max-width:980px;width:100%;">
    <div style="color:${theme.accent};font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:16px;">${escapeText(slide.role)}</div>
    <h1 style="font-size:${titleSize};line-height:1.1;margin:0 0 24px 0;">${escapeText(slide.headline)}</h1>
    ${bullets ? `<ul style="font-size:24px;line-height:1.6;color:${theme.muted};padding-left:28px;margin:0;">${bullets}</ul>` : ''}
  </div>
</section>`
}
