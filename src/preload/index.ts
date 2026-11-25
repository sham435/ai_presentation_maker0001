import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AgentEvent,
  AppSettings,
  CreatePresentationRequest,
  CredentialStatus,
  EditPresentationRequest,
  GatewayStatus
} from '@shared/types'

const api = {
  createDeck: (req: CreatePresentationRequest) => ipcRenderer.invoke(IPC.CREATE_DECK, req),
  editDeck: (req: EditPresentationRequest) => ipcRenderer.invoke(IPC.EDIT_DECK, req),
  getSession: (id: string) => ipcRenderer.invoke(IPC.GET_SESSION, id),
  listSessions: () => ipcRenderer.invoke(IPC.LIST_SESSIONS),
  exportDeck: (filePath: string) => ipcRenderer.invoke(IPC.EXPORT_DECK, filePath),
  openArtifact: (filePath: string) => ipcRenderer.invoke(IPC.OPEN_ARTIFACT, filePath),
  cancelDeck: (operationId: string) => ipcRenderer.invoke(IPC.CANCEL_DECK, operationId),
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS) as Promise<AppSettings & CredentialStatus & { mode: GatewayStatus['mode'] }>,
  setSettings: (patch: AppSettings) => ipcRenderer.invoke(IPC.SET_SETTINGS, patch) as Promise<AppSettings & CredentialStatus>,
  getCredentialStatus: () => ipcRenderer.invoke(IPC.GET_CREDENTIAL_STATUS) as Promise<CredentialStatus>,
  setApiKey: (apiKey: string) => ipcRenderer.invoke(IPC.SET_API_KEY, { apiKey }) as Promise<CredentialStatus>,
  clearApiKey: () => ipcRenderer.invoke(IPC.CLEAR_API_KEY) as Promise<CredentialStatus>,
  getGatewayStatus: () => ipcRenderer.invoke(IPC.GET_GATEWAY_STATUS) as Promise<GatewayStatus>,
  getAppInfo: () => ipcRenderer.invoke(IPC.GET_APP_INFO),
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
