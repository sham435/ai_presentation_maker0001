import { z } from 'zod'
import { STYLE_PRESETS } from './constants'
import { TEMPLATE_IDS } from './templateCatalog'

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
    .optional()
})

export const editDeckSchema = z.object({
  sessionId: z.string().trim().min(1).max(200),
  instruction: z.string().trim().min(3).max(2000),
  targetSlides: z.array(z.number().int().positive()).max(50).optional()
})

function isAllowedModelEndpoint(value: string): boolean {
  if (!value) return true
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return true
    if (host.startsWith('10.') || host.startsWith('192.168.')) return true
    const parts = host.split('.').map(Number)
    return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
      parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
  } catch {
    return false
  }
}

export const settingsUpdateSchema = z.object({
  endpoint: z.string().trim().max(2048).refine(isAllowedModelEndpoint, 'Use HTTPS or a local/private HTTP endpoint'),
  model: z.string().trim().min(1).max(128),
  telemetryOptIn: z.boolean()
}).strict()

export const credentialInputSchema = z.object({
  apiKey: z.string().trim().min(1).max(4096)
}).strict()
