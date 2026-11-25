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
  audience?: string
  referenceFiles?: string[]
  includeCitations?: boolean
}

export interface CreatePresentationRequest {
  brief: string
  options?: CreatePresentationOptions
}

export interface EditPresentationRequest {
  sessionId: string
  instruction: string
  targetSlides?: number[]
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

export type SlideRole = 'cover' | 'body' | 'close'

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
  layout: 'cover' | 'title-and-bullets' | 'section' | 'closing'
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
  | { type: 'error'; sessionId: string; message: string; correlationId: string }
  | { type: 'completed'; sessionId: string; deck: DeckArtifact }

export interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: string
}
