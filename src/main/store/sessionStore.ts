import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import type { DeckSession } from '@shared/types'

const dataDir = () => process.env.STORAGE_DIR || path.join(app.getPath('userData'), 'data')
const sessionsFile = () => path.join(dataDir(), 'sessions.json')

function ensure() {
  fs.mkdirSync(dataDir(), { recursive: true })
  if (!fs.existsSync(sessionsFile())) fs.writeFileSync(sessionsFile(), '[]', 'utf8')
}

export class SessionStore {
  list(): DeckSession[] {
    ensure()
    return JSON.parse(fs.readFileSync(sessionsFile(), 'utf8')) as DeckSession[]
  }

  get(id: string): DeckSession | undefined {
    return this.list().find((s) => s.id === id)
  }

  save(session: DeckSession): DeckSession {
    ensure()
    const all = this.list()
    const idx = all.findIndex((s) => s.id === session.id)
    const next = { ...session, updatedAt: new Date().toISOString() }
    if (idx >= 0) all[idx] = next
    else all.unshift(next)
    fs.writeFileSync(sessionsFile(), JSON.stringify(all, null, 2), 'utf8')
    return next
  }
}
