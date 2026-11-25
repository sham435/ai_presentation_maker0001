import type { StylePreset } from '@shared/types'

export interface Theme {
  id: string
  preset: StylePreset
  bg: string
  panel: string
  accent: string
  text: string
  muted: string
}

const THEMES: Record<StylePreset, Theme> = {
  Business: { id: 'Business/v1', preset: 'Business', bg: '#0f172a', panel: '#111827', accent: '#3b82f6', text: '#f8fafc', muted: '#94a3b8' },
  Education: { id: 'Education/v1', preset: 'Education', bg: '#f8fafc', panel: '#ffffff', accent: '#2563eb', text: '#0f172a', muted: '#475569' },
  Research: { id: 'Research/v1', preset: 'Research', bg: '#111827', panel: '#1f2937', accent: '#14b8a6', text: '#f9fafb', muted: '#9ca3af' },
  Marketing: { id: 'Marketing/v1', preset: 'Marketing', bg: '#18181b', panel: '#27272a', accent: '#f97316', text: '#fafafa', muted: '#a1a1aa' },
  Technology: { id: 'Technology/v1', preset: 'Technology', bg: '#020617', panel: '#0f172a', accent: '#22d3ee', text: '#e2e8f0', muted: '#94a3b8' },
  Portfolio: { id: 'Portfolio/v1', preset: 'Portfolio', bg: '#1c1917', panel: '#292524', accent: '#eab308', text: '#fafaf9', muted: '#d6d3d1' },
  Lifestyle: { id: 'Lifestyle/v1', preset: 'Lifestyle', bg: '#fff7ed', panel: '#ffffff', accent: '#ea580c', text: '#1c1917', muted: '#78716c' },
  Corporate: { id: 'Corporate/v1', preset: 'Corporate', bg: '#f3f4f6', panel: '#ffffff', accent: '#1d4ed8', text: '#111827', muted: '#4b5563' },
  Healthcare: { id: 'Healthcare/v1', preset: 'Healthcare', bg: '#ecfeff', panel: '#ffffff', accent: '#0891b2', text: '#083344', muted: '#155e75' }
}

export function getTheme(preset: StylePreset): Theme {
  return THEMES[preset] || THEMES.Business
}
