import { z } from 'zod'
import { STYLE_PRESETS } from './constants'
import { TEMPLATE_IDS } from './templateCatalog'

function isPrivateHost(host: string): boolean {
  const hostname = host.toLowerCase()
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  )
}

/** Blocks public plaintext endpoints and credentials embedded in URLs (SSRF hardening). */
export function isAllowedModelEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && isPrivateHost(url.hostname)
  } catch {
    return false
  }
}

export const createDeckSchema = z.object({
  brief: z.string().trim().min(3).max(4000),
  options: z
    .object({
      language: z.string().trim().max(32).optional(),
      pageCount: z.union([z.enum(['short', 'medium', 'long', '10-15']), z.number().int().min(3).max(30)]).optional(),
      style: z.enum(STYLE_PRESETS as [string, ...string[]]).optional(),
      templateId: z.enum(TEMPLATE_IDS).optional(),
      audience: z.string().trim().max(200).optional(),
      referenceFiles: z.array(z.string().max(500)).max(10).optional(),
      includeCitations: z.boolean().optional()
    })
    .optional(),
  operationId: z.string().trim().min(1).max(120).optional()
}).strict()

export const editDeckSchema = z.object({
  sessionId: z.string().trim().min(1).max(200),
  instruction: z.string().trim().min(3).max(2000),
  targetSlides: z.array(z.number().int().positive()).max(50).optional(),
  operationId: z.string().trim().min(1).max(120).optional()
}).strict()

export const settingsSetSchema = z
  .object({
    endpoint: z.string().trim().max(2048).optional(),
    model: z.string().trim().min(1).max(100).optional(),
    telemetryOptIn: z.boolean().optional()
  })
  .strict()
  .refine((value) => !value.endpoint || isAllowedModelEndpoint(value.endpoint), {
    message: 'Endpoint must be HTTPS or a localhost/private HTTP URL',
    path: ['endpoint']
  })

export const credentialSetSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(4096)
  })
  .strict()

export const operationIdSchema = z.string().trim().min(1).max(120)

/** Response schemas keep credential material out of renderer-bound IPC payloads. */
export const credentialStatusSchema = z
  .object({ hasKey: z.boolean(), canEncrypt: z.boolean() })
  .strict()

export const gatewayStatusSchema = z
  .object({
    mode: z.enum(['live', 'offline-preview']),
    endpoint: z.string().optional(),
    model: z.string().min(1),
    hasKey: z.boolean()
  })
  .strict()

export const settingsStateSchema = z
  .object({
    endpoint: z.string().optional(),
    model: z.string().optional(),
    telemetryOptIn: z.boolean().optional(),
    hasKey: z.boolean(),
    canEncrypt: z.boolean(),
    mode: z.enum(['live', 'offline-preview'])
  })
  .strict()

export const gatewayDiagnosisSchema = z
  .object({
    ok: z.boolean(),
    mode: z.enum(['live', 'offline-preview']),
    endpoint: z.string().optional(),
    model: z.string().min(1),
    latencyMs: z.number().int().nonnegative(),
    statusCode: z.number().int().optional(),
    category: z.string().optional(),
    message: z.string().optional()
  })
  .strict()
