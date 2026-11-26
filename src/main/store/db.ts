import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { integrityCheck, migrate, pendingMigrations } from './migrations'

/**
 * The Electron main process sets STORAGE_DIR to userData/data at startup.
 * Keeping this module Electron-free lets the same code run in node tests.
 */
export function defaultDataDir(): string {
  return process.env.STORAGE_DIR || path.join(process.cwd(), '.data')
}

export function defaultDatabasePath(): string {
  return path.join(defaultDataDir(), 'presentation.db')
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** Copies the database and any WAL sidecars; never removes the originals. */
export function backupDatabaseFile(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined
  const stamp = timestamp()
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${filePath}${suffix}`
    if (fs.existsSync(source)) fs.copyFileSync(source, `${source}.backup-${stamp}`)
  }
  return `${filePath}.backup-${stamp}`
}

export function openDatabase(filePath: string = defaultDatabasePath()): Database.Database {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })

  // Back up an existing database before applying any pending schema change.
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
    const probe = new Database(filePath, { readonly: true })
    try {
      if (pendingMigrations(probe).length > 0) backupDatabaseFile(filePath)
    } finally {
      probe.close()
    }
  }

  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('synchronous = NORMAL')
  migrate(db)
  if (integrityCheck(db) !== 'ok') throw new Error(`SQLite integrity check failed for ${filePath}`)
  return db
}

let cached: { file: string; db: Database.Database } | undefined

export function getDatabase(filePath: string = defaultDatabasePath()): Database.Database {
  const resolved = path.resolve(filePath)
  if (cached && cached.file === resolved) return cached.db
  if (cached) cached.db.close()
  cached = { file: resolved, db: openDatabase(resolved) }
  return cached.db
}

export function closeDatabase(): void {
  if (!cached) return
  cached.db.close()
  cached = undefined
}
