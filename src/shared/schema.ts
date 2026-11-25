import { z } from 'zod'
import { STYLE_PRESETS } from './constants'

export const createDeckSchema = z.object({
  brief: z.string().trim().min(3).max(4000),
  options: z
    .object({
      language: z.string().trim().max(32).optional(),
      pageCount: z.union([z.enum(['short', 'medium', 'long', '10-15']), z.number().int().min(3).max(30)]).optional(),
      style: z.enum(STYLE_PRESETS as [string, ...string[]]).optional(),
      audience: z.string().trim().max(200).optional(),
      referenceFiles: z.array(z.string().max(500)).max(10).optional()
    })
    .optional()
})

export const editDeckSchema = z.object({
  sessionId: z.string().trim().min(1).max(200),
  instruction: z.string().trim().min(3).max(2000),
  targetSlides: z.array(z.number().int().positive()).max(50).optional()
})
