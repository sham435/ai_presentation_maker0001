import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const required = [
  'out/main/index.js',
  'out/preload/index.js',
  'out/renderer/index.html',
  'package.json',
  'src/shared/types.ts',
  'src/main/agent/orchestrator.ts'
]

let ok = true
for (const rel of required) {
  const p = path.join(root, rel)
  if (!fs.existsSync(p)) {
    console.error('MISSING', rel)
    ok = false
  } else {
    console.log('OK', rel)
  }
}

if (!ok) process.exit(1)
console.log('smoke-build: passed')
