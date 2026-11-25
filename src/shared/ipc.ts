export const IPC = {
  CREATE_DECK: 'deck:create',
  EDIT_DECK: 'deck:edit',
  GET_SESSION: 'deck:get-session',
  LIST_SESSIONS: 'deck:list-sessions',
  EXPORT_DECK: 'deck:export',
  OPEN_ARTIFACT: 'deck:open-artifact',
  GET_APP_INFO: 'app:get-info',
  AGENT_EVENT: 'agent:event'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
