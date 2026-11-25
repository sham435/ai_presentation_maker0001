import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { AgentEvent, CreatePresentationRequest, EditPresentationRequest } from '@shared/types'

const api = {
  createDeck: (req: CreatePresentationRequest) => ipcRenderer.invoke(IPC.CREATE_DECK, req),
  editDeck: (req: EditPresentationRequest) => ipcRenderer.invoke(IPC.EDIT_DECK, req),
  getSession: (id: string) => ipcRenderer.invoke(IPC.GET_SESSION, id),
  listSessions: () => ipcRenderer.invoke(IPC.LIST_SESSIONS),
  exportDeck: (filePath: string) => ipcRenderer.invoke(IPC.EXPORT_DECK, filePath),
  openArtifact: (filePath: string) => ipcRenderer.invoke(IPC.OPEN_ARTIFACT, filePath),
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
