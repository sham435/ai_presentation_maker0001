import { nanoid } from 'nanoid'
import type { AgentEvent, CreatePresentationRequest, DeckSession, EditPresentationRequest } from '@shared/types'
import { SessionStore } from '../store/sessionStore'
import { logger } from '../telemetry/logger'
import { createModelGateway, ModelGatewayError, type RetryInfo } from './modelGateway'
import { parseCreateRequest } from './parser'
import { generateOutline } from './outlineEngine'
import { generateSlide } from './pageGenerator'
import { renderDeck } from './renderer'
import { regenerateSlides } from './editOrchestrator'

export class PresentationOrchestrator {
  private store = new SessionStore()
  private model = createModelGateway()

  private retryHandler(sessionId: string, correlationId: string, emit: (e: AgentEvent) => void) {
    return (info: RetryInfo) => {
      emit({
        type: 'retry',
        sessionId,
        attempt: info.attempt,
        maxRetries: info.maxRetries,
        category: info.category,
        correlationId
      })
    }
  }

  private failure(
    session: DeckSession,
    err: unknown,
    correlationId: string,
    emit: (e: AgentEvent) => void
  ): DeckSession {
    const message = err instanceof Error ? err.message : String(err)
    const category = err instanceof ModelGatewayError ? err.category : 'unknown'
    const failed: DeckSession = { ...session, status: 'error' }
    this.store.save(failed)
    logger.error('presentation operation failed', { sessionId: session.id, category, correlationId, message })
    if (category === 'cancelled') emit({ type: 'cancelled', sessionId: session.id, correlationId })
    else emit({ type: 'error', sessionId: session.id, message, category, correlationId })
    return failed
  }

  async create(
    req: CreatePresentationRequest,
    emit: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<DeckSession> {
    const spec = parseCreateRequest(req)
    const sessionId = spec.sessionId
    const correlationId = nanoid()
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
      const outline = await generateOutline(
        spec,
        this.model,
        signal,
        this.retryHandler(sessionId, correlationId, emit)
      )
      session = { ...session, outline, status: 'generating' }
      this.store.save(session)
      emit({ type: 'plan', sessionId, outline })

      const slides = [] as DeckSession['slides']
      for (const plan of outline.slides) {
        if (signal?.aborted) throw new ModelGatewayError('Generation cancelled', 'cancelled', false)
        const slide = await generateSlide(
          spec,
          outline,
          plan,
          this.model,
          signal,
          this.retryHandler(sessionId, correlationId, emit)
        )
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
      return this.failure(session, err, correlationId, emit)
    }
  }

  async edit(
    req: EditPresentationRequest,
    emit: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<DeckSession> {
    const existing = this.store.get(req.sessionId)
    if (!existing) throw new Error('Session not found')
    const correlationId = nanoid()

    try {
      const updated = await regenerateSlides(
        req,
        existing,
        this.model,
        signal,
        this.retryHandler(existing.id, correlationId, emit)
      )
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
      return this.failure(existing, err, correlationId, emit)
    }
  }

  getSession(id: string) {
    return this.store.get(id)
  }

  listSessions() {
    return this.store.list()
  }
}
