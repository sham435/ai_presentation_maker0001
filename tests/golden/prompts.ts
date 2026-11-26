import type { CanonicalSlideRole, Outline, OutlineSlide, PresentationSpec, Slide } from '@shared/types'

export const CANONICAL_ROLES: readonly CanonicalSlideRole[] = ['cover', 'catalog', 'chapter', 'content', 'end']

export interface GoldenCase {
  id: string
  role: CanonicalSlideRole
  brief: string
  headline: string
  points: string[]
  /** Frozen expectations for previously accepted prompt behavior. */
  requiredPromptMarkers: string[]
  requiredHtmlMarkers: string[]
}

const hostile = '<img src=x onerror="alert(1)">'

export const GOLDEN_CASES: readonly GoldenCase[] = [
  {
    id: 'cover-investors',
    role: 'cover',
    brief: 'A concise investor update about renewable energy',
    headline: 'Renewable Energy Update',
    points: ['2026 outlook', hostile],
    requiredPromptMarkers: ['Return JSON slide content', 'Role: cover', 'Deck title:', 'Audience:', 'Language:', 'Style:', 'Return JSON: {"headline":string'],
    requiredHtmlMarkers: ['data-role="cover"', '<h1', '&lt;img']
  },
  {
    id: 'catalog-agenda',
    role: 'catalog',
    brief: 'An agenda for a product strategy review',
    headline: 'Agenda',
    points: ['Context', 'Options', 'Decision'],
    requiredPromptMarkers: ['Return JSON slide content', 'Role: catalog', 'Seed points: Context; Options; Decision'],
    requiredHtmlMarkers: ['data-role="catalog"', 'Context', 'Decision']
  },
  {
    id: 'chapter-section',
    role: 'chapter',
    brief: 'A section divider for a research report',
    headline: 'Key Findings',
    points: ['Evidence', 'Implications'],
    requiredPromptMarkers: ['Return JSON slide content', 'Role: chapter', 'Seed points: Evidence; Implications'],
    requiredHtmlMarkers: ['data-role="chapter"', 'Key Findings']
  },
  {
    id: 'content-analysis',
    role: 'content',
    brief: 'A data-driven content slide for operators',
    headline: 'Operating Metrics',
    points: ['Utilisation improved', 'Costs declined'],
    requiredPromptMarkers: ['Return JSON slide content', 'Role: content', 'Include citations: yes'],
    requiredHtmlMarkers: ['data-role="content"', '<li', 'Utilisation improved']
  },
  {
    id: 'end-close',
    role: 'end',
    brief: 'A closing slide with next steps',
    headline: 'Thank You',
    points: ['Questions', 'Next steps'],
    requiredPromptMarkers: ['Return JSON slide content', 'Role: end', 'Seed points: Questions; Next steps'],
    requiredHtmlMarkers: ['data-role="end"', 'Thank You']
  }
]

export const GOLDEN_THRESHOLDS = {
  structure: 1,
  roleCoverage: 1,
  sanitization: 1,
  overall: 0.95
} as const

export interface GoldenScores {
  structure: number
  roleCoverage: number
  sanitization: number
  overall: number
  details: string[]
}

export function goldenSpec(testCase: GoldenCase): PresentationSpec {
  return {
    sessionId: `golden-${testCase.id}`,
    mode: 'create',
    topic: testCase.headline,
    audience: 'Reviewers',
    language: 'en',
    pageCountBucket: 'short',
    styleClass: 'Business',
    templateId: 'business-classic',
    referenceDocs: [],
    brief: testCase.brief,
    includeCitations: testCase.role === 'content'
  }
}

export function goldenOutlineSlide(testCase: GoldenCase, index: number): OutlineSlide {
  return { index, role: testCase.role, headline: testCase.headline, points: testCase.points }
}

export function goldenOutline(testCase: GoldenCase): Outline {
  return {
    title: testCase.headline,
    slides: [
      { index: 1, role: 'cover', headline: testCase.headline, points: ['Intro'] },
      { index: 2, role: 'catalog', headline: 'Agenda', points: ['Overview'] },
      goldenOutlineSlide(testCase, 3),
      { index: 4, role: 'end', headline: 'Thank You', points: ['Questions'] }
    ]
  }
}

/** Evaluates the generated prompt and slide without contacting any provider. */
export function scoreGolden(
  testCase: GoldenCase,
  prompt: string,
  slide: Slide
): GoldenScores {
  const details: string[] = []
  const foundMarkers = testCase.requiredPromptMarkers.filter((marker) => prompt.includes(marker))
  const structure = foundMarkers.length / testCase.requiredPromptMarkers.length
  if (structure < 1) {
    details.push(`missing prompt markers: ${testCase.requiredPromptMarkers.filter((m) => !prompt.includes(m)).join(' | ')}`)
  }

  const foundHtml = testCase.requiredHtmlMarkers.filter((marker) => slide.html.includes(marker))
  const htmlScore = foundHtml.length / testCase.requiredHtmlMarkers.length
  if (htmlScore < 1) {
    details.push(`missing html markers: ${testCase.requiredHtmlMarkers.filter((m) => !slide.html.includes(m)).join(' | ')}`)
  }

  const unsafe = ['<script', '<iframe', 'javascript:', '<img ', '<svg'].filter((token) => slide.html.includes(token))
  const sanitization = unsafe.length === 0 && !slide.html.includes(hostile) ? 1 : 0
  if (sanitization === 0) details.push(`unsafe markup survived sanitization: ${unsafe.join(', ')}`)

  const roles = new Set(GOLDEN_CASES.map((item) => item.role))
  const roleCoverage = roles.size / CANONICAL_ROLES.length
  if (roleCoverage < 1) details.push(`role coverage ${roles.size}/${CANONICAL_ROLES.length}`)

  const overall = structure * 0.35 + htmlScore * 0.35 + sanitization * 0.2 + roleCoverage * 0.1
  return { structure, roleCoverage, sanitization, overall, details }
}
