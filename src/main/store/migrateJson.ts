import fs from 'fs'
import type Database from 'better-sqlite3'
import type { DeckArtifact, DeckSession, Slide } from '@shared/types'
import { logger } from '../telemetry/logger'
import { writeSessionToDb } from './sessionStore'

export interface LegacyMigrationOptions {
  now?: () => Date
  /** Test hook: throwing here simulates an interrupted import inside the transaction. */
  onSession?: (session: DeckSession, index: number) => void
}

export interface LegacyMigrationResult {
  found: number
  imported: number
  skipped: number
  backupPath?: string
  renamedPath?: string
  error?: string
}

const STATUSES: DeckSession['status'][] = ['idle', 'planning', 'generating', 'completed', 'error']

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-')
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function normalizeSlide(value: unknown, index: number): Slide | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const content = raw.content && typeof raw.content === 'object' ? (raw.content as Record<string, unknown>) : {}
  const bullets = Array.isArray(content.bullets) ? content.bullets.map((item) => String(item)) : []
  const role = stringOr(raw.role, 'content') as Slide['role']
  const layout = stringOr(raw.layout, role) as Slide['layout']
  return {
    index: typeof raw.index === 'number' ? raw.index : index,
    role,
    layout,
    theme: stringOr(raw.theme, ''),
    content: {
      headline: stringOr(content.headline, `Slide ${index}`),
      bullets,
      notes: typeof content.notes === 'string' ? content.notes : undefined,
      citations: Array.isArray(content.citations) ? content.citations.map((item) => String(item)) : undefined
    },
    html: stringOr(raw.html, '')
  }
}

function normalizeArtifact(value: unknown, updatedAt: string): DeckArtifact | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.filePath !== 'string' || !raw.filePath) return undefined
  return {
    sessionId: stringOr(raw.sessionId, ''),
    version: typeof raw.version === 'number' ? raw.version : 1,
    slideCount: typeof raw.slideCount === 'number' ? raw.slideCount : 0,
    filePath: raw.filePath,
    previewPath: typeof raw.previewPath === 'string' ? raw.previewPath : undefined,
    checksum: typeof raw.checksum === 'string' ? raw.checksum : undefined,
    templateVersion: typeof raw.templateVersion === 'string' ? raw.templateVersion : undefined,
    createdAt: stringOr(raw.createdAt, updatedAt)
  }
}

/** Tolerant legacy reader: malformed records are skipped, never discarded from the backup. */
export function normalizeLegacySession(value: unknown, fallbackUpdatedAt: string): DeckSession | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return undefined

  const spec = raw.spec && typeof raw.spec === 'object' ? (raw.spec as Record<string, unknown>) : {}
  const outline = raw.outline && typeof raw.outline === 'object' ? (raw.outline as Record<string, unknown>) : {}
  const updatedAt = stringOr(raw.updatedAt, fallbackUpdatedAt)
  const slides = Array.isArray(raw.slides)
    ? raw.slides.map((slide, i) => normalizeSlide(slide, i + 1)).filter((slide): slide is Slide => Boolean(slide))
    : []
  const outlineSlides = Array.isArray(outline.slides)
    ? outline.slides.map((slide, i) => {
        const item = slide && typeof slide === 'object' ? (slide as Record<string, unknown>) : {}
        return {
          index: typeof item.index === 'number' ? item.index : i + 1,
          role: stringOr(item.role, 'content') as any,
          headline: stringOr(item.headline, `Slide ${i + 1}`),
          points: Array.isArray(item.points) ? item.points.map((point) => String(point)) : []
        }
      })
    : slides.map((slide) => ({
        index: slide.index,
        role: slide.role,
        headline: slide.content.headline,
        points: slide.content.bullets
      }))

  return {
    id,
    spec: {
      sessionId: id,
      mode: spec.mode === 'edit' ? 'edit' : 'create',
      topic: stringOr(spec.topic, stringOr(outline.title, 'Imported presentation')),
      audience: stringOr(spec.audience, ''),
      language: stringOr(spec.language, 'en'),
      pageCountBucket: stringOr(String(spec.pageCountBucket ?? spec.pageCount ?? ''), '10-15') as any,
      styleClass: stringOr(spec.styleClass ?? spec.style, 'Business') as any,
      templateId: stringOr(spec.templateId, 'business-classic'),
      referenceDocs: Array.isArray(spec.referenceDocs) ? spec.referenceDocs.map((doc) => String(doc)) : [],
      brief: stringOr(spec.brief, ''),
      includeCitations: spec.includeCitations === true
    },
    outline: {
      title: stringOr(outline.title, stringOr(spec.topic, 'Imported presentation')),
      subtitle: typeof outline.subtitle === 'string' ? outline.subtitle : undefined,
      slides: outlineSlides
    },
    slides,
    artifact: normalizeArtifact(raw.artifact, updatedAt),
    status: STATUSES.includes(raw.status as DeckSession['status']) ? (raw.status as DeckSession['status']) : 'completed',
    updatedAt,
    operationId: typeof raw.operationId === 'string' ? raw.operationId : undefined
  }
}

/**
 * Copies sessions.json before importing it, inserts everything in one
 * transaction, and only renames the source after a successful commit.
 */
export function migrateLegacySessions(
  db: Database.Database,
  sessionsPath: string,
  options: LegacyMigrationOptions = {}
): LegacyMigrationResult {
  if (!fs.existsSync(sessionsPath)) return { found: 0, imported: 0, skipped: 0 }

  const now = options.now?.() ?? new Date()
  const time = stamp(now)
  const result: LegacyMigrationResult = { found: 0, imported: 0, skipped: 0 }

  let rawSessions: unknown
  try {
    rawSessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'))
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    logger.warn('legacy sessions.json could not be parsed; source left intact', { stage: 'legacy-migration' })
    return result
  }
  if (!Array.isArray(rawSessions)) {
    result.error = 'legacy sessions.json is not an array; source left intact'
    logger.warn(result.error, { stage: 'legacy-migration' })
    return result
  }

  result.found = rawSessions.length
  result.backupPath = `${sessionsPath}.backup-${time}`
  fs.copyFileSync(sessionsPath, result.backupPath)

  const sessions = rawSessions
    .map((raw) => normalizeLegacySession(raw, now.toISOString()))
    .filter((session): session is DeckSession => Boolean(session))
  result.skipped = result.found - sessions.length

  try {
    db.transaction(() => {
      sessions.forEach((session, index) => {
        options.onSession?.(session, index)
        const saved = writeSessionToDb(db, session, { operationId: session.operationId })
        if (!saved) result.skipped += 1
      })
    })()
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    result.imported = 0
    logger.warn('legacy import rolled back; source left intact', { stage: 'legacy-migration' })
    return result
  }

  result.imported = sessions.length
  result.renamedPath = `${sessionsPath}.migrated-${time}`
  try {
    fs.renameSync(sessionsPath, result.renamedPath)
  } catch (error) {
    logger.warn('legacy import committed but source rename failed; backup and source remain', {
      stage: 'legacy-migration'
    })
    result.error = error instanceof Error ? error.message : String(error)
  }
  return result
}
