import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { DeckArtifact } from '@shared/types'
import { defaultDataDir } from './db'

export interface WriteArtifactOptions {
  sessionId: string
  version: number
  html: string
  slideCount: number
  templateVersion?: string
  dataDir?: string
  /** Test hook: throwing here simulates an interruption before the atomic rename. */
  onTempWritten?: (tempPath: string) => void
}

export function artifactChecksum(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

export function artifactsDir(sessionId: string, dataDir: string = defaultDataDir()): string {
  return path.join(dataDir, 'artifacts', sessionId)
}

export function artifactPath(sessionId: string, version: number, dataDir: string = defaultDataDir()): string {
  return path.join(artifactsDir(sessionId, dataDir), `deck-v${version}.html`)
}

/**
 * Writes to a temp file in the same directory, hashes those exact bytes, then
 * renames into place. Existing versions are immutable and are never rewritten.
 */
export function writeArtifactHtml(options: WriteArtifactOptions): DeckArtifact {
  const dir = artifactsDir(options.sessionId, options.dataDir)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const finalPath = artifactPath(options.sessionId, options.version, options.dataDir)

  if (fs.existsSync(finalPath)) {
    const checksum = artifactChecksum(finalPath)
    return {
      sessionId: options.sessionId,
      version: options.version,
      slideCount: options.slideCount,
      filePath: finalPath,
      checksum,
      templateVersion: options.templateVersion,
      createdAt: fs.statSync(finalPath).mtime.toISOString()
    }
  }

  const tempPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tempPath, options.html, { encoding: 'utf8', mode: 0o600 })
    fs.chmodSync(tempPath, 0o600)
    options.onTempWritten?.(tempPath)
    const checksum = artifactChecksum(tempPath)
    fs.renameSync(tempPath, finalPath)
    fs.chmodSync(finalPath, 0o600)
    return {
      sessionId: options.sessionId,
      version: options.version,
      slideCount: options.slideCount,
      filePath: finalPath,
      checksum,
      templateVersion: options.templateVersion,
      createdAt: new Date().toISOString()
    }
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true })
    } catch {
      // best-effort cleanup
    }
    throw error
  }
}

export function verifyArtifact(artifact: DeckArtifact): boolean {
  if (!artifact.checksum || !fs.existsSync(artifact.filePath)) return false
  return artifactChecksum(artifact.filePath) === artifact.checksum
}

export function listArtifactVersions(sessionId: string, dataDir: string = defaultDataDir()): number[] {
  const dir = artifactsDir(sessionId, dataDir)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .map((name) => /^deck-v(\d+)\.html$/.exec(name)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number)
    .sort((a, b) => a - b)
}
