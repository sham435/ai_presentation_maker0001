#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const required = process.argv.slice(2)
if (required.length === 0) {
  console.error('require-tests: no required test paths supplied')
  process.exit(1)
}

const missing = []
let found = 0

function visit(target) {
  let stat
  try {
    stat = fs.statSync(target)
  } catch {
    missing.push(target)
    return
  }
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(target, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      visit(path.join(target, entry.name))
    }
    return
  }
  if (!/\.(?:test|spec)\.tsx?$/.test(target)) return
  const source = fs.readFileSync(target, 'utf8')
  if (!/\b(?:it|test)\s*\(/.test(source)) {
    missing.push(`${target} (no test declarations)`)
    return
  }
  found += 1
}

for (const target of required) visit(target)

if (missing.length > 0) {
  console.error(`Missing required test suite(s):\n  ${missing.join('\n  ')}`)
  process.exit(1)
}
if (found === 0) {
  console.error('No required test files found')
  process.exit(1)
}
console.log(`Required test files present: ${found}`)
