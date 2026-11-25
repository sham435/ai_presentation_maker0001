import { describe, expect, it } from 'vitest'
import { detectTargetSlides } from '../src/main/agent/editOrchestrator'
import type { DeckSession } from '../src/shared/types'

const session = {
  id: 's1',
  spec: {} as any,
  outline: { title: 't', slides: [] },
  slides: [
    { index: 1, role: 'cover' },
    { index: 2, role: 'body' },
    { index: 3, role: 'body' },
    { index: 4, role: 'close' }
  ],
  status: 'completed',
  updatedAt: ''
} as unknown as DeckSession

describe('detectTargetSlides', () => {
  it('uses explicit targetSlides', () => {
    expect(detectTargetSlides({ sessionId: 's1', instruction: 'x', targetSlides: [2, 3] }, session)).toEqual([2, 3])
  })

  it('detects slide numbers in instruction', () => {
    expect(detectTargetSlides({ sessionId: 's1', instruction: 'Update slide 2 and slide 3' }, session)).toEqual([2, 3])
  })

  it('falls back to body slides', () => {
    expect(detectTargetSlides({ sessionId: 's1', instruction: 'Make it shorter' }, session)).toEqual([2, 3])
  })
})
