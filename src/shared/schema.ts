import { z } from 'zod'
import { STYLE_PRESETS } from './constants'
import { TEMPLATE_IDS } from './templateCatalog'

const isHttpEndpoint = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
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
})

export const editDeckSchema = z.object({
  sessionId: z.string().trim().min(1).max(200),
  instruction: z.string().trim().min(3).max(2000),
  targetSlides: z.array(z.number().int().positive()).max(50).optional(),
  operationId: z.string().trim().min(1).max(120).optional()
})

export const settingsSetSchema = z
  .object({
    endpoint: z.string().trim().max(500).optional(),
    model: z.string().trim().min(1).max(100).optional(),
    telemetryOptIn: z.boolean().optional()
  })
  .refine((value) => !value.endpoint || isHttpEndpoint(value.endpoint), {
    message: 'Endpoint must be a valid http(s) URL',
    path: ['endpoint']
  })

export const credentialSetSchema = z.object({
  apiKey: z.string().trim().min(1).max(500)
})

export const operationIdSchema = z.string().trim().min(1).max(120)
