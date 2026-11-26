#!/usr/bin/env node
import fs from 'node:fs'

const roles = ['cover', 'catalog', 'chapter', 'content', 'end']
const uiNames = ['main-window', 'template-gallery', 'settings-modal']
const missingPdf = roles
  .map((role) => `tests/visual/baselines/png/pdf-page-${role}.png`)
  .filter((file) => !fs.existsSync(file))
const missingUi = uiNames
  .map((name) => `tests/visual/baselines/json/${name}.json`)
  .filter((file) => !fs.existsSync(file))

if (missingPdf.length > 0 || missingUi.length > 0) {
  const messages = []
  if (missingPdf.length > 0) messages.push(`Missing approved PDF page baselines:\n  ${missingPdf.join('\n  ')}`)
  if (missingUi.length > 0) messages.push(`Missing approved UI baselines:\n  ${missingUi.join('\n  ')}`)
  console.error(messages.join('\n'))
  process.exit(1)
}

console.log(`approved PDF page baselines: ${roles.length}`)
console.log(`approved UI baselines: ${uiNames.length}`)
