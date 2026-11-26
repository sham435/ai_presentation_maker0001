#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const electronDir = path.join(process.cwd(), 'node_modules', 'electron')
const pathFile = path.join(electronDir, 'path.txt')
const installScript = path.join(electronDir, 'install.js')

if (!fs.existsSync(pathFile) || !fs.existsSync(installScript)) {
  console.error('Electron package is not installed; run npm ci before Electron tests')
  process.exit(1)
}

function binaryPath() {
  const relativePath = fs.readFileSync(pathFile, 'utf8').trim()
  return process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(electronDir, 'dist', relativePath)
}

function isExecutable(candidate) {
  try {
    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

const executable = binaryPath()
if (isExecutable(executable)) {
  console.log(`Electron binary ready: ${executable}`)
  process.exit(0)
}

console.log(`Electron binary missing at ${executable}; running Electron install script`)
const result = spawnSync(process.execPath, [installScript], { stdio: 'inherit' })
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

if (!isExecutable(binaryPath())) {
  console.error(`Electron install script completed but binary is still missing: ${binaryPath()}`)
  process.exit(1)
}
console.log(`Electron binary ready: ${binaryPath()}`)
