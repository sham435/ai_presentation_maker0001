export const IPC = {
  CREATE_DECK: 'deck:create',
  EDIT_DECK: 'deck:edit',
  GET_SESSION: 'deck:get-session',
  LIST_SESSIONS: 'deck:list-sessions',
  EXPORT_DECK: 'deck:export',
  OPEN_ARTIFACT: 'deck:open-artifact',
  GET_APP_INFO: 'app:get-info',
  AGENT_EVENT: 'agent:event',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  CREDENTIALS_STATUS: 'credentials:status',
  CREDENTIALS_SET: 'credentials:set',
  CREDENTIALS_CLEAR: 'credentials:clear',
  GATEWAY_STATUS: 'gateway:status'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
