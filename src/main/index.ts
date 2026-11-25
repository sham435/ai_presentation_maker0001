import { app, BrowserWindow, safeStorage } from 'electron'
import path from 'path'
import { registerIpc } from './ipc'
import { PresentationOrchestrator } from './agent/orchestrator'
import { createModelGateway } from './agent/modelGateway'
import { CredentialStore } from './credentials/keychain'
import { logger } from './telemetry/logger'

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
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const dataDirectory = path.join(app.getPath('userData'), 'data')
  const credentials = new CredentialStore(path.join(dataDirectory, 'settings.json'), safeStorage)
  const orchestrator = new PresentationOrchestrator(() => createModelGateway(credentials.getGatewayConfig()))
  registerIpc(orchestrator, credentials)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((err) => logger.error('app failed', { err: String(err) }))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
