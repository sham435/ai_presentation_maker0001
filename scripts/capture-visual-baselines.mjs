#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

// Explicit, human-reviewed baseline creation. CI never calls this script.
const result = spawnSync('npx', ['vitest', 'run', 'tests/visual'], {
  stdio: 'inherit',
  env: { ...process.env, APM_CAPTURE_VISUAL: '1' }
})
process.exit(result.status ?? 1)
