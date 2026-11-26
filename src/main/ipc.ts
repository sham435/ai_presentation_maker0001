import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import { IPC } from '@shared/ipc'
import {
  createDeckSchema,
  credentialSetSchema,
  credentialStatusSchema,
  editDeckSchema,
  gatewayDiagnosisSchema,
  gatewayStatusSchema,
  operationIdSchema,
  settingsSetSchema,
  settingsStateSchema,
  telemetryListSchema
} from '@shared/schema'
import type { CreatePresentationRequest, EditPresentationRequest } from '@shared/types'
import { diagnoseGateway } from './agent/modelGateway'
import { PresentationOrchestrator } from './agent/orchestrator'
import { isSafeArtifactPath, validated, validationMessage } from './ipcGuards'
import { credentialStatus, gatewayStatus, getCredentialStore } from './credentials/keychain'
import { defaultDataDir } from './store/db'
import { clearTelemetry, readTelemetry, setTelemetrySetting } from './telemetry/jsonl'

let registered = false
const activeOperations = new Map<string, AbortController>()

function artifactsRoot() {
  return path.join(process.env.STORAGE_DIR || path.join(app.getPath('userData'), 'data'), 'artifacts')
}

function safeArtifactPath(filePath: unknown): filePath is string {
  return isSafeArtifactPath(filePath, artifactsRoot())
}

export function registerIpc(orchestrator: PresentationOrchestrator) {
  if (registered) return
  registered = true

  const emit = (event: any) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.AGENT_EVENT, event)
    }
  }

  const withOperation = async (operationId: string | undefined, run: (signal: AbortSignal) => Promise<unknown>) => {
    const id = operationId || nanoid()
    const controller = new AbortController()
    activeOperations.set(id, controller)
    try {
      return await run(controller.signal)
    } finally {
      activeOperations.delete(id)
    }
  }

  ipcMain.handle(IPC.CREATE_DECK, async (_e, req: CreatePresentationRequest) => {
    const parsed = createDeckSchema.safeParse(req)
    if (!parsed.success) throw new Error(validationMessage(parsed.error))
    return withOperation(parsed.data.operationId, (signal) =>
      orchestrator.create(parsed.data as CreatePresentationRequest, emit, signal)
    )
  })

  ipcMain.handle(IPC.EDIT_DECK, async (_e, req: EditPresentationRequest) => {
    const parsed = editDeckSchema.safeParse(req)
    if (!parsed.success) throw new Error(validationMessage(parsed.error))
    return withOperation(parsed.data.operationId, (signal) =>
      orchestrator.edit(parsed.data as EditPresentationRequest, emit, signal)
    )
  })

  ipcMain.handle(IPC.CANCEL_DECK, async (_e, operationId: string) => {
    const parsed = operationIdSchema.safeParse(operationId)
    if (!parsed.success) throw new Error(validationMessage(parsed.error))
    activeOperations.get(parsed.data)?.abort()
    return { ok: true }
  })

  ipcMain.handle(IPC.GET_SESSION, async (_e, id: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid session id')
    return orchestrator.getSession(id)
  })

  ipcMain.handle(IPC.LIST_SESSIONS, async () => orchestrator.listSessions())

  ipcMain.handle(IPC.GET_SETTINGS, async () => {
    const store = getCredentialStore()
    const settings = store.getSettings()
    const gateway = gatewayStatus()
    return validated(settingsStateSchema, {
      ...settings,
      ...credentialStatus(),
      mode: gateway.mode,
      endpoint: gateway.endpoint || settings.endpoint,
      model: gateway.model
    })
  })

  ipcMain.handle(IPC.SET_SETTINGS, async (_e, patch: unknown) => {
    const parsed = settingsSetSchema.safeParse(patch)
    if (!parsed.success) throw new Error(validationMessage(parsed.error))
    const data = parsed.data
    const normalized = {
      ...data,
      endpoint: data.endpoint === '' ? undefined : data.endpoint
    }
    const settings = getCredentialStore().updateSettings(normalized)
    setTelemetrySetting(Boolean(settings.telemetryOptIn), defaultDataDir())
    const gateway = gatewayStatus()
    return validated(settingsStateSchema, {
      ...settings,
      ...credentialStatus(),
      mode: gateway.mode,
      endpoint: gateway.endpoint || settings.endpoint,
      model: gateway.model
    })
  })

  ipcMain.handle(IPC.GET_CREDENTIAL_STATUS, async () => validated(credentialStatusSchema, credentialStatus()))

  ipcMain.handle(IPC.SET_API_KEY, async (_e, payload: unknown) => {
    const parsed = credentialSetSchema.safeParse(payload)
    if (!parsed.success) throw new Error(validationMessage(parsed.error))
    const store = getCredentialStore()
    if (!store.canEncrypt()) throw new Error('OS keychain encryption is unavailable on this device')
    store.setApiKey(parsed.data.apiKey)
    return validated(credentialStatusSchema, credentialStatus())
  })

  ipcMain.handle(IPC.CLEAR_API_KEY, async () => {
    getCredentialStore().clearApiKey()
    return validated(credentialStatusSchema, credentialStatus())
  })

  ipcMain.handle(IPC.GET_GATEWAY_STATUS, async () => validated(gatewayStatusSchema, gatewayStatus()))

  ipcMain.handle(IPC.DIAGNOSE_GATEWAY, async () => validated(gatewayDiagnosisSchema, await diagnoseGateway()))

  ipcMain.handle(IPC.TELEMETRY_LIST, async () => validated(telemetryListSchema, readTelemetry()))

  ipcMain.handle(IPC.TELEMETRY_CLEAR, async () => {
    clearTelemetry()
    return { ok: true }
  })

  ipcMain.handle(IPC.EXPORT_DECK, async (e, filePath: string) => {
    if (!safeArtifactPath(filePath)) throw new Error('Invalid artifact path')
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
    if (!safeArtifactPath(filePath)) throw new Error('Invalid artifact path')
    await shell.openPath(filePath)
    return { ok: true }
  })

  ipcMain.handle(IPC.GET_APP_INFO, async () => {
    const gateway = gatewayStatus()
    return {
      name: 'AI Presentation Maker',
      version: app.getVersion(),
      platform: process.platform,
      mode: gateway.mode,
      model: gateway.model
    }
  })
}
