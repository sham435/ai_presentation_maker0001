import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type Database from 'better-sqlite3'
import type { DeckSession } from '@shared/types'
import { openDatabase } from '../../src/main/store/db'
import { appliedVersions, integrityCheck, migrate, tableColumns, tableNames } from '../../src/main/store/migrations'
import { readSessionFromDb, writeSessionToDb } from '../../src/main/store/sessionStore'

const dirs: string[] = []

function makeDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-sqlite-'))
  dirs.push(dir)
  return openDatabase(path.join(dir, 'presentation.db'))
}

function sampleSession(id = 'session-1'): DeckSession {
  const spec = {
    sessionId: id,
    mode: 'create' as const,
    topic: 'Renewable energy',
    audience: 'Investors',
    language: 'en',
    pageCountBucket: 'short',
    styleClass: 'Business' as const,
    templateId: 'business-classic',
    referenceDocs: [],
    brief: 'A short briefing'
  }
  return {
    id,
    spec,
    outline: {
      title: 'Renewable energy',
      slides: [{ index: 1, role: 'cover', headline: 'Renewable energy', points: ['Overview'] }]
    },
    slides: [
      {
        index: 1,
        role: 'cover',
        layout: 'cover',
        theme: 'business@v1',
        content: { headline: 'Renewable energy', bullets: ['Overview'] },
        html: '<section class="slide">cover</section>'
      }
    ],
    status: 'completed',
    updatedAt: '2026-11-26T00:00:00.000Z'
  }
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('SQLite schema and transactional persistence', () => {
  it('initializes a fresh database with all required tables and columns', () => {
    const db = makeDb()
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(['artifacts', 'events', 'migrations', 'sessions', 'settings', 'slides'])
    )
    expect(tableColumns(db, 'sessions')).toEqual(
      expect.arrayContaining(['id', 'spec_json', 'outline_json', 'artifact_json', 'revision', 'operation_id'])
    )
    expect(tableColumns(db, 'artifacts')).toEqual(
      expect.arrayContaining(['session_id', 'version', 'checksum', 'template_version'])
    )
    expect(integrityCheck(db)).toBe('ok')
    db.close()
  })

  it('applies migrations only once on repeated startup', () => {
    const db = makeDb()
    expect(appliedVersions(db)).toEqual([1])
    expect(migrate(db)).toEqual([])
    expect(appliedVersions(db)).toEqual([1])
    const rows = db.prepare('SELECT COUNT(*) AS count FROM migrations').get() as { count: number }
    expect(rows.count).toBe(1)
    db.close()
  })

  it('rolls back session, slide and artifact writes together when interrupted', () => {
    const db = makeDb()
    const session = sampleSession()

    // Simulate an interruption during the aggregate write on a disposable DB.
    db.exec('DROP TABLE slides')
    expect(() => writeSessionToDb(db, session)).toThrow()
    expect(readSessionFromDb(db, session.id)).toBeUndefined()
    const sessionRows = db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }
    const artifactRows = db.prepare('SELECT COUNT(*) AS count FROM artifacts').get() as { count: number }
    expect(sessionRows.count).toBe(0)
    expect(artifactRows.count).toBe(0)
    expect(integrityCheck(db)).toBe('ok')
    db.close()
  })

  it('rejects stale writes without corrupting the current session', () => {
    const db = makeDb()
    const first = writeSessionToDb(db, sampleSession())
    expect(first?.revision).toBe(1)

    const current = writeSessionToDb(db, { ...sampleSession(), status: 'planning' })
    expect(current?.revision).toBe(2)
    expect(writeSessionToDb(db, sampleSession(), { expectedRevision: 1 })).toBeUndefined()
    expect(readSessionFromDb(db, 'session-1')?.status).toBe('planning')
    db.close()
  })
})
