import { app, BrowserWindow } from 'electron'
import path from 'path'
import { registerIpc } from './ipc'
import { PresentationOrchestrator } from './agent/orchestrator'
import { logger } from './telemetry/logger'

const orchestrator = new PresentationOrchestrator()

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
  registerIpc(orchestrator)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((err) => logger.error('app failed', { err: String(err) }))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
