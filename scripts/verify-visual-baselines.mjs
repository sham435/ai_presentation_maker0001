#!/usr/bin/env node
import fs from 'node:fs'

const roles = ['cover', 'catalog', 'chapter', 'content', 'end']
const missing = roles
  .map((role) => `tests/visual/baselines/png/pdf-page-${role}.png`)
  .filter((file) => !fs.existsSync(file))

if (missing.length > 0) {
  console.error(`Missing approved PDF page baselines:\n  ${missing.join('\n  ')}`)
  process.exit(1)
}

console.log(`approved PDF page baselines: ${roles.length}`)
