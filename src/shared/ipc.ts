export const IPC = {
  CREATE_DECK: 'deck:create',
  EDIT_DECK: 'deck:edit',
  GET_SESSION: 'deck:get-session',
  LIST_SESSIONS: 'deck:list-sessions',
  EXPORT_DECK: 'deck:export',
  OPEN_ARTIFACT: 'deck:open-artifact',
  CANCEL_DECK: 'deck:cancel',
  GET_APP_INFO: 'app:get-info',
  GET_SETTINGS: 'settings:get',
  SET_SETTINGS: 'settings:set',
  GET_CREDENTIAL_STATUS: 'credentials:status',
  SET_API_KEY: 'credentials:set',
  CLEAR_API_KEY: 'credentials:clear',
  GET_GATEWAY_STATUS: 'gateway:status',
  AGENT_EVENT: 'agent:event'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
