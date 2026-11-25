import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { AgentEvent, AppSettings, AppSettingsUpdate, CreatePresentationRequest, EditPresentationRequest } from '@shared/types'

const api = {
  createDeck: (req: CreatePresentationRequest) => ipcRenderer.invoke(IPC.CREATE_DECK, req),
  editDeck: (req: EditPresentationRequest) => ipcRenderer.invoke(IPC.EDIT_DECK, req),
  getSession: (id: string) => ipcRenderer.invoke(IPC.GET_SESSION, id),
  listSessions: () => ipcRenderer.invoke(IPC.LIST_SESSIONS),
  exportDeck: (filePath: string) => ipcRenderer.invoke(IPC.EXPORT_DECK, filePath),
  openArtifact: (filePath: string) => ipcRenderer.invoke(IPC.OPEN_ARTIFACT, filePath),
  getAppInfo: () => ipcRenderer.invoke(IPC.GET_APP_INFO),
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET) as Promise<AppSettings>,
  updateSettings: (settings: AppSettingsUpdate) => ipcRenderer.invoke(IPC.SETTINGS_SET, settings) as Promise<AppSettings>,
  getCredentialStatus: () => ipcRenderer.invoke(IPC.CREDENTIALS_STATUS) as Promise<Pick<AppSettings, 'hasKey' | 'canEncrypt'>>,
  setApiKey: (apiKey: string) => ipcRenderer.invoke(IPC.CREDENTIALS_SET, { apiKey }) as Promise<AppSettings>,
  clearApiKey: () => ipcRenderer.invoke(IPC.CREDENTIALS_CLEAR) as Promise<AppSettings>,
  getGatewayStatus: () => ipcRenderer.invoke(IPC.GATEWAY_STATUS) as Promise<AppSettings>,
  onAgentEvent: (handler: (event: AgentEvent) => void) => {
    const listener = (_: unknown, event: AgentEvent) => handler(event)
    ipcRenderer.on(IPC.AGENT_EVENT, listener)
    return () => {
      ipcRenderer.removeListener(IPC.AGENT_EVENT, listener)
    }
  }
}

contextBridge.exposeInMainWorld('desktopApi', api)

export type DesktopApi = typeof api
