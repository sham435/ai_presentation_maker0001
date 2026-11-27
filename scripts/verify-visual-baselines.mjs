#!/usr/bin/env node
import fs from 'node:fs'

const roles = ['cover', 'catalog', 'chapter', 'content', 'end']
const uiNames = ['main-window', 'template-gallery', 'settings-modal']
const uiSelectors = [
  '.app',
  '.sidebar',
  '.main',
  '.toolbar',
  '.empty',
  '[data-testid="offline-badge"]',
  '[data-testid="model-pill"]',
  '[data-testid="cancel-deck"]',
  '[data-testid="open-settings"]',
  'button[text="Generate Deck"]',
  'button[text="Browse all"]',
  'button[text="Apply Edit"]',
  '.template-grid',
  '[role="dialog"]',
  '[data-testid="settings-endpoint"]',
  '[data-testid="settings-model"]',
  '[data-testid="settings-api-key"]',
  '[data-testid="settings-telemetry"]',
  '[data-testid="settings-save"]'
]
const relationshipKeys = [
  'sidebarLeftOfMain',
  'toolbarAboveContent',
  'dialogIsModal',
  'templateGridInsideDialog',
  'settingsControlsInsideDialog',
  'cancelDisabledWhenIdle'
]
const pngNames = [
  ...roles.map((role) => `slide-${role}`),
  ...roles.map((role) => `pdf-page-${role}`)
]
const problems = []

function readPng(file) {
  const buffer = fs.readFileSync(file)
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buffer.length < 1000 || !buffer.subarray(0, 8).equals(signature)) {
    problems.push(`Malformed or empty PNG baseline: ${file}`)
    return null
  }
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (width < 100 || height < 100) {
    problems.push(`Invalid PNG dimensions in ${file}: ${width}x${height}`)
  }
  return { width, height }
}

for (const name of pngNames) {
  const file = `tests/visual/baselines/png/${name}.png`
  if (!fs.existsSync(file)) {
    problems.push(`Missing approved PNG baseline: ${file}`)
    continue
  }
  readPng(file)
}

let reviewedUiEntries = 0
for (const name of uiNames) {
  const file = `tests/visual/baselines/json/${name}.json`
  if (!fs.existsSync(file)) {
    problems.push(`Missing approved UI baseline: ${file}`)
    continue
  }
  let snapshot
  try {
    snapshot = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    problems.push(`Malformed UI baseline ${file}: ${error.message}`)
    continue
  }
  if (!Array.isArray(snapshot?.entries) || snapshot.entries.length !== uiSelectors.length) {
    problems.push(`Invalid UI baseline ${file}: expected ${uiSelectors.length} entries`)
    continue
  }
  if (snapshot.entries.filter((entry) => entry?.present).length < 8) {
    problems.push(`Empty/incomplete UI baseline ${file}: fewer than 8 present elements`)
  }
  for (let index = 0; index < snapshot.entries.length; index += 1) {
    const entry = snapshot.entries[index]
    if (!entry || entry.selector !== uiSelectors[index] || typeof entry.present !== 'boolean') {
      problems.push(`Invalid UI baseline entry ${index} in ${file}`)
      continue
    }
    if (!entry.present) continue
    reviewedUiEntries += 1
    if (!entry.role || !entry.hierarchy?.length || typeof entry.visible !== 'boolean' || typeof entry.enabled !== 'boolean' || !entry.layout) {
      problems.push(`Incomplete UI baseline entry ${index} (${entry.selector}) in ${file}`)
    }
  }
  const missingRelationships = relationshipKeys.filter((key) => typeof snapshot.relationships?.[key] !== 'boolean')
  if (missingRelationships.length > 0) {
    problems.push(`Missing layout relationships in ${file}: ${missingRelationships.join(', ')}`)
  }
}

if (problems.length > 0) {
  console.error(`Visual baseline verification failed (${problems.length} problems):\n  ${problems.join('\n  ')}`)
  process.exit(1)
}

console.log(`approved PNG baselines: ${pngNames.length}`)
console.log(`approved UI baselines: ${uiNames.length}`)
console.log(`reviewed UI snapshot entries: ${reviewedUiEntries}`)
console.log(`required comparisons: ${pngNames.length + uiNames.length}`)
