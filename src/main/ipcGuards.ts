import fs from 'fs'
import path from 'path'
import type { ZodType } from 'zod'
import { IPC, type IpcChannel } from '@shared/ipc'
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

/**
 * Pure, Electron-free IPC guards. Keeping these separate from the handler
 * registration makes every privileged boundary directly executable in tests.
 */

export function validationMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues.map((issue) => issue.message).join('; ')
}

/** Validates renderer-bound responses against strict, credential-free schemas. */
export function validated<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new Error(`Invalid IPC response: ${validationMessage(parsed.error)}`)
  return parsed.data
}

/** Accepts only regular files that resolve inside the artifact root. */
export function isSafeArtifactPath(filePath: unknown, artifactsRoot: string): filePath is string {
  if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) return false
  const resolved = path.resolve(filePath)
  const root = path.resolve(artifactsRoot) + path.sep
  if (!resolved.startsWith(root)) return false
  try {
    const stat = fs.lstatSync(resolved)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

export type RequestValidator = (payload: unknown) => unknown

function schemaValidator<T>(schema: ZodType<T>): RequestValidator {
  return (payload) => {
    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new Error(validationMessage(parsed.error))
    return parsed.data
  }
}

/** Zero-argument handlers must reject unexpected renderer payloads. */
export const noPayload: RequestValidator = (payload) => {
  if (payload !== undefined) throw new Error('Unexpected IPC payload')
  return payload
}

const nonEmptyString: RequestValidator = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new Error('Invalid identifier')
  }
  return value
}

/**
 * Every privileged channel must appear here. New IPC handlers without a guard
 * fail the dedicated security suite instead of silently widening the boundary.
 */
export const PRIVILEGED_CHANNELS: Record<Exclude<IpcChannel, typeof IPC.AGENT_EVENT>, RequestValidator> = {
  [IPC.CREATE_DECK]: schemaValidator(createDeckSchema),
  [IPC.EDIT_DECK]: schemaValidator(editDeckSchema),
  [IPC.CANCEL_DECK]: schemaValidator(operationIdSchema),
  [IPC.GET_SESSION]: nonEmptyString,
  [IPC.LIST_SESSIONS]: noPayload,
  [IPC.EXPORT_DECK]: nonEmptyString,
  [IPC.OPEN_ARTIFACT]: nonEmptyString,
  [IPC.GET_SETTINGS]: noPayload,
  [IPC.SET_SETTINGS]: schemaValidator(settingsSetSchema),
  [IPC.GET_CREDENTIAL_STATUS]: noPayload,
  [IPC.SET_API_KEY]: schemaValidator(credentialSetSchema),
  [IPC.CLEAR_API_KEY]: noPayload,
  [IPC.GET_GATEWAY_STATUS]: noPayload,
  [IPC.DIAGNOSE_GATEWAY]: noPayload,
  [IPC.TELEMETRY_LIST]: noPayload,
  [IPC.TELEMETRY_CLEAR]: noPayload,
  [IPC.GET_APP_INFO]: noPayload
}

/** Channels whose renderer payloads must be validated against response schemas. */
export const RESPONSE_SCHEMAS = {
  credentialStatus: credentialStatusSchema,
  settingsState: settingsStateSchema,
  gatewayStatus: gatewayStatusSchema,
  gatewayDiagnosis: gatewayDiagnosisSchema,
  telemetryList: telemetryListSchema
} as const
