import type { DeckSession, EditPresentationRequest, Outline } from '@shared/types'
import type { ModelGateway } from './modelGateway'
import { generateSlide } from './pageGenerator'

export function detectTargetSlides(req: EditPresentationRequest, session: DeckSession): number[] {
  if (req.targetSlides?.length) return req.targetSlides.filter((n) => n >= 1 && n <= session.slides.length)
  const nums = Array.from(req.instruction.matchAll(/slide\s*(\d+)/gi)).map((m) => Number(m[1]))
  const valid = nums.filter((n) => n >= 1 && n <= session.slides.length)
  if (valid.length) return Array.from(new Set(valid))
  // default: regenerate body slides
  return session.slides.filter((s) => s.role === 'body').map((s) => s.index)
}

export async function regenerateSlides(
  req: EditPresentationRequest,
  session: DeckSession,
  model: ModelGateway
): Promise<DeckSession> {
  const targets = new Set(detectTargetSlides(req, session))
  const outline: Outline = {
    ...session.outline,
    slides: session.outline.slides.map((s) =>
      targets.has(s.index)
        ? { ...s, headline: `${s.headline}`, points: [...s.points, `Updated per edit: ${req.instruction}`.slice(0, 120)] }
        : s
    )
  }
  const slides = []
  for (const plan of outline.slides) {
    if (targets.has(plan.index)) {
      slides.push(await generateSlide(session.spec, outline, plan, model))
    } else {
      const existing = session.slides.find((s) => s.index === plan.index)
      if (existing) slides.push(existing)
    }
  }
  return { ...session, outline, slides }
}
