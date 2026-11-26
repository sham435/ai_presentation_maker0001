import { describe, expect, it } from 'vitest'
import { isAllowedModelEndpoint } from '@shared/schema'

/**
 * Optional live-provider evaluation. It is excluded from `verify` and
 * `verify:all`; set APM_LIVE_EVAL=1 only when a user authorizes provider use.
 */
describe.skipIf(!process.env.APM_LIVE_EVAL)('live provider evaluation (opt-in)', () => {
  it('requires an explicitly configured HTTPS endpoint', () => {
    expect(isAllowedModelEndpoint('https://api.example.com/v1')).toBe(true)
    expect(process.env.APM_LIVE_EVAL).toBe('1')
  })
})
