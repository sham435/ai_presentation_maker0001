import { nanoid } from 'nanoid'
import type { AgentEvent, CreatePresentationRequest, DeckSession, EditPresentationRequest } from '@shared/types'
import { SessionStore } from '../store/sessionStore'
import { logger } from '../telemetry/logger'
import {
  createModelGateway,
  ModelGatewayError,
  type ModelGateway,
  type RetryInfo
} from './modelGateway'
import { parseCreateRequest } from './parser'
import { generateOutline } from './outlineEngine'
import { generateSlide } from './pageGenerator'
import { renderDeck } from './renderer'
import { regenerateSlides } from './editOrchestrator'

export interface OrchestratorOptions {
  store?: SessionStore
  model?: ModelGateway
  render?: typeof renderDeck
  now?: () => number
}

export class PresentationOrchestrator {
  private readonly store: SessionStore
  private readonly model: ModelGateway
  private readonly render: typeof renderDeck
  private readonly now: () => number
  private readonly latestOperationBySession = new Map<string, string>()
  private readonly revisionBySession = new Map<string, number>()

  constructor(options: OrchestratorOptions = {}) {
    this.store = options.store ?? new SessionStore()
    this.model = options.model ?? createModelGateway()
    this.render = options.render ?? renderDeck
    this.now = options.now ?? (() => Date.now())
  }

  private claimOperation(sessionId: string, correlationId: string, revision?: number): void {
    this.latestOperationBySession.set(sessionId, correlationId)
    if (revision !== undefined) this.revisionBySession.set(sessionId, revision)
  }

  private isCurrent(sessionId: string, correlationId: string): boolean {
    return this.latestOperationBySession.get(sessionId) === correlationId
  }

  private assertCurrent(sessionId: string, correlationId: string): void {
    if (!this.isCurrent(sessionId, correlationId)) {
      throw new ModelGatewayError('Generation superseded by a newer operation', 'cancelled', false)
    }
  }

  private save(
    session: DeckSession,
    correlationId: string,
    emit: (event: AgentEvent) => void
  ): DeckSession | undefined {
    const expectedRevision = this.revisionBySession.get(session.id)
    const saved = this.store.save(session, { expectedRevision, operationId: correlationId })
    if (!saved) {
      emit({ type: 'cancelled', sessionId: session.id, correlationId })
      return undefined
    }
    this.revisionBySession.set(session.id, saved.revision ?? (expectedRevision ?? 0) + 1)
    return saved
  }

  private async timed<T>(
    stage: string,
    sessionId: string,
    correlationId: string,
    emit: (event: AgentEvent) => void,
    run: () => Promise<T>
  ): Promise<T> {
    const started = this.now()
    let status: 'ok' | 'error' | 'cancelled' = 'ok'
    let errorCategory: string | undefined
    try {
      return await run()
    } catch (error) {
      errorCategory = error instanceof ModelGatewayError ? error.category : 'unknown'
      status = errorCategory === 'cancelled' ? 'cancelled' : 'error'
      throw error
    } finally {
      const durationMs = Math.max(0, this.now() - started)
      const record = { correlationId, sessionId, stage, status, durationMs, errorCategory }
      this.store.recordEvent(record)
      logger.info('stage timing', record)
      emit({ type: 'stage', sessionId, correlationId, stage, status, durationMs, ...(errorCategory ? { errorCategory } : {}) })
    }
  }

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
    error: unknown,
    correlationId: string,
    emit: (e: AgentEvent) => void
  ): DeckSession {
    const message = error instanceof Error ? error.message : String(error)
    const errorCategory = error instanceof ModelGatewayError ? error.category : 'unknown'
    if (!this.isCurrent(session.id, correlationId) || errorCategory === 'cancelled') {
      emit({ type: 'cancelled', sessionId: session.id, correlationId })
      return session
    }

    const saved = this.save({ ...session, status: 'error' }, correlationId, emit)
    if (!saved) return session

    logger.error('presentation operation failed', {
      sessionId: session.id,
      correlationId,
      stage: 'operation',
      errorCategory
    })
    emit({ type: 'error', sessionId: session.id, message, category: errorCategory, correlationId })
    return saved
  }

  async create(
    req: CreatePresentationRequest,
    emit: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<DeckSession> {
    const spec = parseCreateRequest(req)
    const sessionId = spec.sessionId
    const correlationId = req.operationId || nanoid()
    this.claimOperation(sessionId, correlationId)

    let session: DeckSession = {
      id: sessionId,
      spec,
      outline: { title: spec.topic, slides: [] },
      slides: [],
      status: 'planning',
      updatedAt: new Date().toISOString()
    }
    const initial = this.save(session, correlationId, emit)
    if (!initial) return session
    session = initial

    try {
      const outline = await this.timed('outline', sessionId, correlationId, emit, () =>
        generateOutline(spec, this.model, signal, this.retryHandler(sessionId, correlationId, emit), correlationId)
      )
      this.assertCurrent(sessionId, correlationId)
      const planned = this.save({ ...session, outline, status: 'generating' }, correlationId, emit)
      if (!planned) return session
      session = planned
      emit({ type: 'plan', sessionId, correlationId, outline })

      const slides = [] as DeckSession['slides']
      for (const plan of outline.slides) {
        if (signal?.aborted) throw new ModelGatewayError('Generation cancelled', 'cancelled', false)
        const slide = await this.timed(`slide:${plan.index}`, sessionId, correlationId, emit, () =>
          generateSlide(
            spec,
            outline,
            plan,
            this.model,
            signal,
            this.retryHandler(sessionId, correlationId, emit),
            correlationId
          )
        )
        this.assertCurrent(sessionId, correlationId)
        slides.push(slide)
        const updated = this.save({ ...session, slides: [...slides] }, correlationId, emit)
        if (!updated) return session
        session = updated
        emit({ type: 'slide', sessionId, correlationId, slide })
      }

      this.assertCurrent(sessionId, correlationId)
      if (signal?.aborted) throw new ModelGatewayError('Generation cancelled', 'cancelled', false)
      const artifact = await this.timed('render', sessionId, correlationId, emit, async () =>
        this.render(sessionId, (session.artifact?.version || 0) + 1, outline.title, slides)
      )
      this.assertCurrent(sessionId, correlationId)
      if (signal?.aborted) throw new ModelGatewayError('Generation cancelled', 'cancelled', false)
      const done = await this.timed('persist', sessionId, correlationId, emit, async () =>
        this.save({ ...session, artifact, status: 'completed' }, correlationId, emit)
      )
      if (!done) return session
      emit({ type: 'completed', sessionId, correlationId, deck: artifact })
      return done
    } catch (error) {
      return this.failure(session, error, correlationId, emit)
    }
  }

  async edit(
    req: EditPresentationRequest,
    emit: (e: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<DeckSession> {
    const existing = this.store.get(req.sessionId)
    if (!existing) throw new Error('Session not found')
    const correlationId = req.operationId || nanoid()
    const sessionId = existing.id
    this.claimOperation(sessionId, correlationId, existing.revision)

    try {
      const updated = await this.timed('edit:generate', sessionId, correlationId, emit, () =>
        regenerateSlides(
          req,
          existing,
          this.model,
          signal,
          this.retryHandler(sessionId, correlationId, emit),
          correlationId
        )
      )
      this.assertCurrent(sessionId, correlationId)
      const generating = this.save({ ...updated, status: 'generating' }, correlationId, emit)
      if (!generating) return existing
      emit({ type: 'plan', sessionId, correlationId, outline: generating.outline })
      for (const slide of generating.slides) emit({ type: 'slide', sessionId, correlationId, slide })

      this.assertCurrent(sessionId, correlationId)
      if (signal?.aborted) throw new ModelGatewayError('Generation cancelled', 'cancelled', false)
      const artifact = await this.timed('render', sessionId, correlationId, emit, async () =>
        this.render(sessionId, (existing.artifact?.version || 0) + 1, generating.outline.title, generating.slides)
      )
      this.assertCurrent(sessionId, correlationId)
      if (signal?.aborted) throw new ModelGatewayError('Generation cancelled', 'cancelled', false)
      const done = await this.timed('persist', sessionId, correlationId, emit, async () =>
        this.save({ ...generating, artifact, status: 'completed' }, correlationId, emit)
      )
      if (!done) return existing
      emit({ type: 'completed', sessionId, correlationId, deck: artifact })
      return done
    } catch (error) {
      return this.failure(existing, error, correlationId, emit)
    }
  }

  getSession(id: string): DeckSession | undefined {
    return this.store.get(id)
  }

  listSessions(): DeckSession[] {
    return this.store.list()
  }
}
