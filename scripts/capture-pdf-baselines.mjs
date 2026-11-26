#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

// Captures approved PDF page screenshots and their SHA-256 baselines.
// This is an explicit opt-in operation and is never part of the CI test gate.
const result = spawnSync('npx', ['vitest', 'run', 'tests/visual'], {
  stdio: 'inherit',
  env: { ...process.env, APM_CAPTURE_VISUAL: '1', APM_CAPTURE_PDF: '1' }
})
process.exit(result.status ?? 1)
