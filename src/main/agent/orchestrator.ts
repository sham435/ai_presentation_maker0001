import { nanoid } from 'nanoid'
import type { AgentEvent, CreatePresentationRequest, DeckSession, EditPresentationRequest } from '@shared/types'
import { SessionStore } from '../store/sessionStore'
import { logger } from '../telemetry/logger'
import { createModelGateway, type ModelGateway } from './modelGateway'
import { parseCreateRequest } from './parser'
import { generateOutline } from './outlineEngine'
import { generateSlide } from './pageGenerator'
import { renderDeck } from './renderer'
import { regenerateSlides } from './editOrchestrator'

export class PresentationOrchestrator {
  private store = new SessionStore()

  constructor(private readonly modelFactory: () => ModelGateway = createModelGateway) {}

  async create(req: CreatePresentationRequest, emit: (e: AgentEvent) => void): Promise<DeckSession> {
    const model = this.modelFactory()
    const spec = parseCreateRequest(req)
    const sessionId = spec.sessionId
    let session: DeckSession = {
      id: sessionId,
      spec,
      outline: { title: spec.topic, slides: [] },
      slides: [],
      status: 'planning',
      updatedAt: new Date().toISOString()
    }
    this.store.save(session)
    try {
      const outline = await generateOutline(spec, model)
      session = { ...session, outline, status: 'generating' }
      this.store.save(session)
      emit({ type: 'plan', sessionId, outline })

      const slides = [] as DeckSession['slides']
      for (const plan of outline.slides) {
        const slide = await generateSlide(spec, outline, plan, model)
        slides.push(slide)
        session = { ...session, slides: [...slides] }
        this.store.save(session)
        emit({ type: 'slide', sessionId, slide })
      }

      const artifact = renderDeck(sessionId, (session.artifact?.version || 0) + 1, outline.title, slides)
      session = { ...session, artifact, status: 'completed' }
      this.store.save(session)
      emit({ type: 'completed', sessionId, deck: artifact })
      return session
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const correlationId = nanoid()
      logger.error('create failed', { sessionId, message, correlationId })
      session = { ...session, status: 'error' }
      this.store.save(session)
      emit({ type: 'error', sessionId, message, correlationId })
      throw err
    }
  }

  async edit(req: EditPresentationRequest, emit: (e: AgentEvent) => void): Promise<DeckSession> {
    const existing = this.store.get(req.sessionId)
    if (!existing) throw new Error('Session not found')
    try {
      const updated = await regenerateSlides(req, existing, this.modelFactory())
      const sessionId = existing.id
      this.store.save({ ...updated, status: 'generating' })
      emit({ type: 'plan', sessionId, outline: updated.outline })
      for (const slide of updated.slides) emit({ type: 'slide', sessionId, slide })
      const artifact = renderDeck(sessionId, (existing.artifact?.version || 0) + 1, updated.outline.title, updated.slides)
      const done: DeckSession = { ...updated, artifact, status: 'completed' }
      this.store.save(done)
      emit({ type: 'completed', sessionId, deck: artifact })
      return done
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const correlationId = nanoid()
      emit({ type: 'error', sessionId: req.sessionId, message, correlationId })
      throw err
    }
  }

  getSession(id: string) {
    return this.store.get(id)
  }

  listSessions() {
    return this.store.list()
  }
}
