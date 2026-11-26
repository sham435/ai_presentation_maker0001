import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/store/db'
import { migrateLegacySessions } from '../../src/main/store/migrateJson'
import { readSessionFromDb } from '../../src/main/store/sessionStore'

const dirs: string[] = []

function makeEnvironment(): { db: Database.Database; dir: string; sessionsPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-migration-'))
  dirs.push(dir)
  return {
    db: openDatabase(path.join(dir, 'presentation.db')),
    dir,
    sessionsPath: path.join(dir, 'sessions.json')
  }
}

function legacySession(id: string, headline: string) {
  return {
    id,
    spec: {
      sessionId: id,
      mode: 'create',
      topic: headline,
      audience: 'Reviewers',
      language: 'en',
      pageCountBucket: 'short',
      styleClass: 'Business',
      templateId: 'business-classic',
      referenceDocs: [],
      brief: 'Legacy brief'
    },
    outline: {
      title: headline,
      slides: [{ index: 1, role: 'cover', headline, points: ['Legacy point'] }]
    },
    slides: [
      {
        index: 1,
        role: 'cover',
        layout: 'cover',
        theme: 'legacy@v1',
        content: { headline, bullets: ['Legacy point'] },
        html: `<section class="slide">${headline}</section>`
      }
    ],
    status: 'completed',
    updatedAt: '2026-11-25T12:00:00.000Z'
  }
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!
    for (const file of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, file), { recursive: true, force: true })
    }
    fs.rmdirSync(dir)
  }
})

describe('legacy sessions.json migration', () => {
  it('backs up, imports and renames legacy sessions without dropping data', () => {
    const { db, sessionsPath } = makeEnvironment()
    const legacy = [legacySession('legacy-1', 'Alpha'), { broken: true }, legacySession('legacy-2', 'Beta')]
    const original = JSON.stringify(legacy, null, 2)
    fs.writeFileSync(sessionsPath, original, 'utf8')

    const result = migrateLegacySessions(db, sessionsPath)

    expect(result.found).toBe(3)
    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(1)
    expect(result.backupPath).toBeTruthy()
    expect(fs.readFileSync(result.backupPath!, 'utf8')).toBe(original)
    expect(result.renamedPath).toBeTruthy()
    expect(fs.existsSync(result.renamedPath!)).toBe(true)
    expect(fs.existsSync(sessionsPath)).toBe(false)
    expect(readSessionFromDb(db, 'legacy-1')?.outline.title).toBe('Alpha')
    expect(readSessionFromDb(db, 'legacy-2')?.slides[0].html).toContain('Beta')
    db.close()
  })

  it('is a no-op when no legacy file remains', () => {
    const { db, sessionsPath } = makeEnvironment()
    expect(migrateLegacySessions(db, sessionsPath)).toEqual({ found: 0, imported: 0, skipped: 0 })
    db.close()
  })

  it('leaves the source intact and rolls back everything after an interrupted import', () => {
    const { db, dir, sessionsPath } = makeEnvironment()
    const original = JSON.stringify([legacySession('legacy-3', 'Gamma'), legacySession('legacy-4', 'Delta')], null, 2)
    fs.writeFileSync(sessionsPath, original, 'utf8')

    const result = migrateLegacySessions(db, sessionsPath, {
      onSession: () => {
        throw new Error('simulated interruption')
      }
    })

    expect(result.error).toContain('simulated interruption')
    expect(result.imported).toBe(0)
    expect(fs.existsSync(sessionsPath)).toBe(true)
    expect(fs.readFileSync(sessionsPath, 'utf8')).toBe(original)
    expect(fs.readdirSync(dir).some((name) => name.startsWith('sessions.json.backup-'))).toBe(true)
    expect(readSessionFromDb(db, 'legacy-3')).toBeUndefined()
    expect(readSessionFromDb(db, 'legacy-4')).toBeUndefined()
    db.close()
  })
})
