#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

// Explicit, human-reviewed baseline creation. CI never calls this script.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npm, ['run', 'test:visual'], {
  stdio: 'inherit',
  env: { ...process.env, APM_CAPTURE_VISUAL: '1' }
})
process.exit(result.status ?? 1)
