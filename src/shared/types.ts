export type PresentationMode = 'create' | 'edit'

export type PageCountBucket = 'short' | 'medium' | 'long' | '10-15'

export type StylePreset =
  | 'Business'
  | 'Education'
  | 'Research'
  | 'Marketing'
  | 'Technology'
  | 'Portfolio'
  | 'Lifestyle'
  | 'Corporate'
  | 'Healthcare'

export interface CreatePresentationOptions {
  language?: string
  pageCount?: PageCountBucket | number
  style?: StylePreset
  templateId?: string
  audience?: string
  referenceFiles?: string[]
  includeCitations?: boolean
}

export interface CreatePresentationRequest {
  brief: string
  options?: CreatePresentationOptions
  /** Correlates renderer cancel/retry actions with an in-flight generation. */
  operationId?: string
}

export interface EditPresentationRequest {
  sessionId: string
  instruction: string
  targetSlides?: number[]
  operationId?: string
}

export interface PresentationSpec {
  sessionId: string
  mode: PresentationMode
  topic: string
  audience: string
  language: string
  pageCountBucket: PageCountBucket | string
  styleClass: StylePreset
  templateId: string
  referenceDocs: string[]
  brief: string
  includeCitations?: boolean
}

/**
 * Canonical roles mirror the five-part template preview: cover, catalog,
 * chapter, content, end. Legacy body/close values are kept so older saved
 * sessions remain readable; new outlines normalize them to content/end.
 */
export type SlideRole = 'cover' | 'catalog' | 'chapter' | 'content' | 'end' | 'body' | 'close'
export type CanonicalSlideRole = Exclude<SlideRole, 'body' | 'close'>

export interface OutlineSlide {
  index: number
  role: SlideRole
  headline: string
  points: string[]
}

export interface Outline {
  title: string
  subtitle?: string
  slides: OutlineSlide[]
}

export interface SlideContent {
  headline: string
  bullets: string[]
  notes?: string
  citations?: string[]
}

export interface Slide {
  index: number
  role: SlideRole
  // Canonical layouts match the five roles; legacy layouts stay readable.
  layout: 'cover' | 'catalog' | 'chapter' | 'content' | 'end' | 'title-and-bullets' | 'section' | 'closing'
  theme: string
  content: SlideContent
  html: string
}

export interface DeckArtifact {
  sessionId: string
  version: number
  slideCount: number
  filePath: string
  previewPath?: string
  createdAt: string
}

export interface DeckSession {
  id: string
  spec: PresentationSpec
  outline: Outline
  slides: Slide[]
  artifact?: DeckArtifact
  status: 'idle' | 'planning' | 'generating' | 'completed' | 'error'
  updatedAt: string
}

export type AgentEvent =
  | { type: 'plan'; sessionId: string; outline: Outline }
  | { type: 'slide'; sessionId: string; slide: Slide }
  | { type: 'warning'; sessionId: string; message: string }
  | { type: 'retry'; sessionId: string; attempt: number; maxRetries: number; category: string; correlationId: string }
  | { type: 'error'; sessionId: string; message: string; correlationId: string; category?: string }
  | { type: 'cancelled'; sessionId: string; correlationId: string }
  | { type: 'completed'; sessionId: string; deck: DeckArtifact }

export interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: string
}

export interface AppSettings {
  endpoint?: string
  model?: string
  telemetryOptIn?: boolean
}

export interface CredentialStatus {
  hasKey: boolean
  canEncrypt: boolean
}

export interface GatewayStatus {
  mode: 'live' | 'offline-preview'
  endpoint?: string
  model: string
  hasKey: boolean
}

/** Sanitized result of a real provider connectivity probe; never includes credentials. */
export interface GatewayDiagnosis {
  ok: boolean
  mode: GatewayStatus['mode']
  endpoint?: string
  model: string
  latencyMs: number
  statusCode?: number
  category?: string
  message?: string
}
