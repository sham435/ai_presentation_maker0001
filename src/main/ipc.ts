import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC } from '@shared/ipc'
import { createDeckSchema, editDeckSchema } from '@shared/schema'
import type { CreatePresentationRequest, EditPresentationRequest } from '@shared/types'
import { PresentationOrchestrator } from './agent/orchestrator'

let registered = false

function artifactsRoot() {
  return path.join(process.env.STORAGE_DIR || path.join(app.getPath('userData'), 'data'), 'artifacts')
}

function isSafeArtifactPath(filePath: unknown): filePath is string {
  if (typeof filePath !== 'string' || !filePath.trim()) return false
  const resolved = path.resolve(filePath)
  const root = path.resolve(artifactsRoot()) + path.sep
  return resolved.startsWith(root) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()
}

export function registerIpc(orchestrator: PresentationOrchestrator) {
  if (registered) return
  registered = true

  const emit = (event: any) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.AGENT_EVENT, event)
    }
  }

  ipcMain.handle(IPC.CREATE_DECK, async (_e, req: CreatePresentationRequest) => {
    const parsed = createDeckSchema.safeParse(req)
    if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '))
    return orchestrator.create(parsed.data as CreatePresentationRequest, emit)
  })

  ipcMain.handle(IPC.EDIT_DECK, async (_e, req: EditPresentationRequest) => {
    const parsed = editDeckSchema.safeParse(req)
    if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '))
    return orchestrator.edit(parsed.data as EditPresentationRequest, emit)
  })

  ipcMain.handle(IPC.GET_SESSION, async (_e, id: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid session id')
    return orchestrator.getSession(id)
  })
  ipcMain.handle(IPC.LIST_SESSIONS, async () => orchestrator.listSessions())

  ipcMain.handle(IPC.EXPORT_DECK, async (e, filePath: string) => {
    if (!isSafeArtifactPath(filePath)) throw new Error('Invalid artifact path')
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = {
      defaultPath: path.basename(filePath),
      filters: [{ name: 'HTML Presentation', extensions: ['html'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return { ok: false }
    fs.copyFileSync(filePath, res.filePath)
    return { ok: true, path: res.filePath }
  })

  ipcMain.handle(IPC.OPEN_ARTIFACT, async (_e, filePath: string) => {
    if (!isSafeArtifactPath(filePath)) throw new Error('Invalid artifact path')
    await shell.openPath(filePath)
    return { ok: true }
  })

  ipcMain.handle(IPC.GET_APP_INFO, async () => ({
    name: 'AI Presentation Maker',
    version: app.getVersion(),
    platform: process.platform
  }))
}
