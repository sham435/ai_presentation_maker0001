import { app, BrowserWindow, safeStorage } from 'electron'
import path from 'path'
import { registerIpc } from './ipc'
import { PresentationOrchestrator } from './agent/orchestrator'
import { configureCredentials, getCredentialStore } from './credentials/keychain'
import { getDatabase } from './store/db'
import { migrateLegacySessions } from './store/migrateJson'
import { SessionStore } from './store/sessionStore'
import { configureTelemetry, readTelemetrySetting } from './telemetry/jsonl'
import { logger } from './telemetry/logger'

const dataDir = () => path.join(app.getPath('userData'), 'data')
process.env.STORAGE_DIR ||= dataDir()

configureCredentials({
  dataDir,
  storage: safeStorage
})
configureTelemetry({ enabled: false, dataDir: dataDir() })

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'AI Presentation Maker',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const db = getDatabase(path.join(dataDir(), 'presentation.db'))
  migrateLegacySessions(db, path.join(dataDir(), 'sessions.json'))
  const telemetryOptIn = readTelemetrySetting(db) || Boolean(getCredentialStore().getSettings().telemetryOptIn)
  configureTelemetry({ enabled: telemetryOptIn, dataDir: dataDir() })

  const orchestrator = new PresentationOrchestrator({ store: new SessionStore({ db }) })
  registerIpc(orchestrator)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((_err) => logger.error('app startup failed', { errorCategory: 'startup' }))
