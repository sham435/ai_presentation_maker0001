import path from 'path'
import type Database from 'better-sqlite3'
import type { DeckArtifact, DeckSession, PresentationSpec, Slide } from '@shared/types'
import { defaultDataDir, getDatabase } from './db'
import { integrityCheck, migrate } from './migrations'

interface SessionRow {
  id: string
  mode: string
  topic: string
  status: string
  spec_json: string
  outline_json: string
  artifact_json: string | null
  revision: number
  operation_id: string | null
  created_at: string
  updated_at: string
}

interface SlideRow {
  session_id: string
  slide_index: number
  role: string
  layout: string
  theme: string | null
  content_json: string
  html: string
}

export interface StageEventRecord {
  correlationId?: string
  sessionId?: string
  stage: string
  status: 'ok' | 'error' | 'cancelled'
  durationMs: number
  errorCategory?: string
}

export interface SaveOptions {
  /** Enforces optimistic concurrency: save only while the stored revision matches. */
  expectedRevision?: number
  operationId?: string
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function slideFromRow(row: SlideRow): Slide {
  return {
    index: row.slide_index,
    role: row.role as Slide['role'],
    layout: row.layout as Slide['layout'],
    theme: row.theme || '',
    content: parseJson(row.content_json, { headline: '', bullets: [] }),
    html: row.html
  }
}

export function readSessionFromDb(db: Database.Database, id: string): DeckSession | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
  if (!row) return undefined
  const slideRows = db
    .prepare('SELECT * FROM slides WHERE session_id = ? ORDER BY slide_index')
    .all(id) as SlideRow[]
  const spec = parseJson<PresentationSpec>(row.spec_json, {
    sessionId: id,
    mode: 'create',
    topic: row.topic,
    audience: '',
    language: 'en',
    pageCountBucket: '10-15',
    styleClass: 'Business',
    templateId: 'business-classic',
    referenceDocs: [],
    brief: ''
  } as PresentationSpec)
  return {
    id: row.id,
    spec: { ...spec, sessionId: row.id },
    outline: parseJson(row.outline_json, { title: row.topic, slides: [] }),
    slides: slideRows.map(slideFromRow),
    artifact: row.artifact_json ? (parseJson<DeckArtifact | undefined>(row.artifact_json, undefined)) : undefined,
    status: row.status as DeckSession['status'],
    updatedAt: row.updated_at,
    revision: row.revision,
    operationId: row.operation_id || undefined
  }
}

/**
 * Writes a full session aggregate (session + slides + artifact metadata) in
 * one SQLite transaction. A stale expectedRevision makes the write a no-op.
 */
export function writeSessionToDb(
  db: Database.Database,
  session: DeckSession,
  options: SaveOptions = {}
): DeckSession | undefined {
  migrate(db)
  if (integrityCheck(db) !== 'ok') throw new Error('SQLite integrity check failed before session write')

  const updatedAt = session.updatedAt || new Date().toISOString()
  const spec = { ...session.spec, sessionId: session.id }
  const artifact = session.artifact
  const operationId = options.operationId ?? session.operationId ?? null

  const transaction = db.transaction(() => {
    const existing = db.prepare('SELECT created_at, revision FROM sessions WHERE id = ?').get(session.id) as
      | { created_at: string; revision: number }
      | undefined
    const currentRevision = existing?.revision ?? 0
    if (options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) return undefined
    const nextRevision = currentRevision + 1

    const columns = `
      mode = @mode,
      topic = @topic,
      status = @status,
      spec_json = @spec_json,
      outline_json = @outline_json,
      artifact_json = @artifact_json,
      revision = @revision,
      operation_id = @operation_id,
      updated_at = @updated_at
    `
    const values = {
      id: session.id,
      mode: spec.mode || 'create',
      topic: spec.topic || session.outline.title || 'Untitled presentation',
      status: session.status,
      spec_json: JSON.stringify(spec),
      outline_json: JSON.stringify(session.outline),
      artifact_json: artifact ? JSON.stringify(artifact) : null,
      revision: nextRevision,
      operation_id: operationId,
      updated_at: updatedAt
    }

    if (existing) {
      const result = db.prepare(`UPDATE sessions SET ${columns} WHERE id = @id`).run(values)
      if (result.changes !== 1) return undefined
    } else {
      db.prepare(`
        INSERT INTO sessions (
          id, mode, topic, status, spec_json, outline_json, artifact_json,
          revision, operation_id, created_at, updated_at
        ) VALUES (
          @id, @mode, @topic, @status, @spec_json, @outline_json, @artifact_json,
          @revision, @operation_id, @created_at, @updated_at
        )
      `).run({ ...values, created_at: updatedAt })
    }

    // Slides are an owned child aggregate; replacement is atomic with the session write.
    db.prepare('DELETE FROM slides WHERE session_id = ?').run(session.id)
    const insertSlide = db.prepare(`
      INSERT INTO slides (session_id, slide_index, role, layout, theme, content_json, html)
      VALUES (@session_id, @slide_index, @role, @layout, @theme, @content_json, @html)
    `)
    for (const slide of session.slides) {
      insertSlide.run({
        session_id: session.id,
        slide_index: slide.index,
        role: slide.role,
        layout: slide.layout,
        theme: slide.theme ?? null,
        content_json: JSON.stringify(slide.content),
        html: slide.html
      })
    }

    if (artifact) {
      // Immutable by version: an existing version is never overwritten.
      db.prepare(`
        INSERT OR IGNORE INTO artifacts (
          session_id, version, slide_count, file_path, preview_path, checksum, template_version, created_at
        ) VALUES (
          @session_id, @version, @slide_count, @file_path, @preview_path, @checksum, @template_version, @created_at
        )
      `).run({
        session_id: session.id,
        version: artifact.version,
        slide_count: artifact.slideCount,
        file_path: artifact.filePath,
        preview_path: artifact.previewPath ?? null,
        checksum: artifact.checksum ?? '',
        template_version: artifact.templateVersion ?? null,
        created_at: artifact.createdAt
      })
    }

    return readSessionFromDb(db, session.id)
  })

  return transaction()
}

export function recordStageEvent(db: Database.Database, event: StageEventRecord): void {
  migrate(db)
  db.prepare(`
    INSERT INTO events (correlation_id, session_id, stage, status, duration_ms, error_category)
    VALUES (@correlation_id, @session_id, @stage, @status, @duration_ms, @error_category)
  `).run({
    correlation_id: event.correlationId ?? null,
    session_id: event.sessionId ?? null,
    stage: event.stage,
    status: event.status,
    duration_ms: Math.max(0, Math.round(event.durationMs)),
    error_category: event.errorCategory ?? null
  })
}

export function listStageEvents(db: Database.Database, sessionId?: string): StageEventRecord[] {
  migrate(db)
  const rows = (sessionId
    ? db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY id').all(sessionId)
    : db.prepare('SELECT * FROM events ORDER BY id').all()) as Array<{
    correlation_id: string | null
    session_id: string | null
    stage: string
    status: string
    duration_ms: number | null
    error_category: string | null
  }>
  return rows.map((row) => ({
    correlationId: row.correlation_id || undefined,
    sessionId: row.session_id || undefined,
    stage: row.stage,
    status: row.status as StageEventRecord['status'],
    durationMs: row.duration_ms ?? 0,
    errorCategory: row.error_category || undefined
  }))
}

export interface SessionStoreOptions {
  db?: Database.Database
  dataDir?: string
}

export class SessionStore {
  readonly db: Database.Database

  constructor(options: SessionStoreOptions = {}) {
    const file = options.db ? '' : path.join(options.dataDir ?? defaultDataDir(), 'presentation.db')
    this.db = options.db ?? getDatabase(file)
    migrate(this.db)
  }

  list(): DeckSession[] {
    const rows = this.db.prepare('SELECT id FROM sessions ORDER BY updated_at DESC').all() as Array<{ id: string }>
    return rows.map((row) => readSessionFromDb(this.db, row.id)).filter((s): s is DeckSession => Boolean(s))
  }

  get(id: string): DeckSession | undefined {
    return readSessionFromDb(this.db, id)
  }

  save(session: DeckSession, options?: SaveOptions): DeckSession | undefined {
    return writeSessionToDb(this.db, session, options)
  }

  recordEvent(event: StageEventRecord): void {
    recordStageEvent(this.db, event)
  }

  events(sessionId?: string): StageEventRecord[] {
    return listStageEvents(this.db, sessionId)
  }
}
