import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  artifactChecksum,
  artifactPath,
  listArtifactVersions,
  verifyArtifact,
  writeArtifactHtml
} from '../../src/main/store/artifactStore'

const dirs: string[] = []

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-artifacts-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('artifact versioning and integrity', () => {
  it('writes atomically and records a SHA-256 checksum of the final bytes', () => {
    const dataDir = makeDir()
    const html = '<html><body><section class="slide">A</section></body></html>'
    const artifact = writeArtifactHtml({
      sessionId: 'session-1',
      version: 1,
      html,
      slideCount: 1,
      templateVersion: 'v1',
      dataDir
    })

    expect(artifact.checksum).toBe(artifactChecksum(artifact.filePath))
    expect(artifact.filePath).toBe(artifactPath('session-1', 1, dataDir))
    expect(fs.readFileSync(artifact.filePath, 'utf8')).toBe(html)
    expect(verifyArtifact(artifact)).toBe(true)
    expect(listArtifactVersions('session-1', dataDir)).toEqual([1])
  })

  it('detects tampering and never rewrites an existing version', () => {
    const dataDir = makeDir()
    const first = writeArtifactHtml({
      sessionId: 'session-1',
      version: 1,
      html: '<section>original</section>',
      slideCount: 1,
      dataDir
    })
    const bytes = fs.readFileSync(first.filePath, 'utf8')

    const second = writeArtifactHtml({
      sessionId: 'session-1',
      version: 1,
      html: '<section>changed</section>',
      slideCount: 1,
      dataDir
    })

    expect(second.checksum).toBe(first.checksum)
    expect(fs.readFileSync(first.filePath, 'utf8')).toBe(bytes)

    fs.appendFileSync(first.filePath, '<!-- tampered -->')
    expect(verifyArtifact(first)).toBe(false)
  })

  it('leaves no partial artifact when a write is interrupted before rename', () => {
    const dataDir = makeDir()
    expect(() =>
      writeArtifactHtml({
        sessionId: 'session-1',
        version: 2,
        html: '<section>partial</section>',
        slideCount: 1,
        dataDir,
        onTempWritten: () => {
          throw new Error('simulated interruption')
        }
      })
    ).toThrow('simulated interruption')

    expect(fs.existsSync(artifactPath('session-1', 2, dataDir))).toBe(false)
    expect(listArtifactVersions('session-1', dataDir)).toEqual([])
  })
})
