import type Database from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  up: (db: Database.Database) => void
}

/**
 * Append-only schema migrations. Never edit an applied migration; add a new
 * version instead. All DDL is idempotent and non-destructive.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          mode TEXT NOT NULL,
          topic TEXT NOT NULL,
          status TEXT NOT NULL,
          spec_json TEXT NOT NULL,
          outline_json TEXT NOT NULL,
          artifact_json TEXT,
          revision INTEGER NOT NULL DEFAULT 0,
          operation_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);

        CREATE TABLE IF NOT EXISTS slides (
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          slide_index INTEGER NOT NULL,
          role TEXT NOT NULL,
          layout TEXT NOT NULL,
          theme TEXT,
          content_json TEXT NOT NULL,
          html TEXT NOT NULL,
          PRIMARY KEY (session_id, slide_index)
        );
        CREATE INDEX IF NOT EXISTS idx_slides_session ON slides(session_id, slide_index);

        CREATE TABLE IF NOT EXISTS artifacts (
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          version INTEGER NOT NULL,
          slide_count INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          preview_path TEXT,
          checksum TEXT NOT NULL,
          template_version TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY (session_id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id, version);

        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          correlation_id TEXT,
          session_id TEXT,
          stage TEXT NOT NULL,
          status TEXT NOT NULL,
          duration_ms INTEGER,
          error_category TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id);
        CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)
    }
  }
]

function hasMigrationsTable(db: Database.Database): boolean {
  return tableNames(db).includes('migrations')
}

export function tableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>
  return rows.map((row) => row.name)
}

export function tableColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.map((row) => row.name)
}

export function appliedVersions(db: Database.Database): number[] {
  if (!hasMigrationsTable(db)) return []
  const rows = db.prepare('SELECT version FROM migrations ORDER BY version').all() as Array<{ version: number }>
  return rows.map((row) => row.version)
}

export function pendingMigrations(db: Database.Database): Migration[] {
  const applied = new Set(appliedVersions(db))
  return migrations.filter((migration) => !applied.has(migration.version))
}

export function migrate(db: Database.Database): number[] {
  const pending = pendingMigrations(db)
  if (pending.length === 0) return []

  db.transaction(() => {
    for (const migration of pending) {
      migration.up(db)
      db.prepare('INSERT OR IGNORE INTO migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name
      )
    }
  })()

  return pending.map((migration) => migration.version)
}

export function integrityCheck(db: Database.Database): 'ok' | string {
  const row = db.pragma('integrity_check', { simple: true }) as string
  return row === 'ok' ? 'ok' : String(row)
}
