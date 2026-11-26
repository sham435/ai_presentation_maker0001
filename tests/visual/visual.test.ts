import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import type { ModelGateway } from '../../src/main/agent/modelGateway'
import { generateSlide } from '../../src/main/agent/pageGenerator'
import type { CanonicalSlideRole, PresentationSpec } from '@shared/types'
import { CANONICAL_ROLES } from '../golden/prompts'

const baselineDir = path.resolve('tests/visual/baselines')
const pngDir = path.join(baselineDir, 'png')
const jsonDir = path.join(baselineDir, 'json')
const diffDir = path.resolve('artifacts/visual')
const capture = process.env.APM_CAPTURE_VISUAL === '1'
const MAX_DIFF_RATIO = 0.01
const VIEWPORT_WIDTH = 1400
const VIEWPORT_HEIGHT = 841
const TEST_TIMEOUT = 30_000
const UI_GEOMETRY_TOLERANCE = 20
const UI_FLOW_SELECTORS = new Set(['.app', '.sidebar', '.main', '.template-grid'])
const UI_SELECTORS = [
  '.app',
  '.sidebar',
  '.main',
  '.toolbar',
  '.empty',
  '[data-testid="offline-badge"]',
  '[data-testid="model-pill"]',
  '[data-testid="open-settings"]',
  '.template-grid',
  '[role="dialog"]',
  '[data-testid="settings-save"]'
]

interface UiSnapshotEntry {
  selector: string
  present: boolean
  text?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

let app: ElectronApplication
let page: Page
let workDir: string

class FixtureModel implements ModelGateway {
  async complete(): Promise<string> {
    return JSON.stringify({
      headline: 'Visual Baseline',
      bullets: ['First approved point', 'Second approved point', 'Third approved point'],
      notes: '',
      citations: []
    })
  }
}

const spec: PresentationSpec = {
  sessionId: 'visual-fixture',
  mode: 'create',
  topic: 'Visual Baseline',
  audience: 'Reviewers',
  language: 'en',
  pageCountBucket: 'short',
  styleClass: 'Business',
  templateId: 'business-classic',
  referenceDocs: [],
  brief: 'Visual baseline fixture'
}

async function fixtureHtml(role: CanonicalSlideRole, print: boolean): Promise<string> {
  const slide = await generateSlide(
    spec,
    { title: 'Visual Baseline', slides: [] },
    { index: 1, role, headline: 'Visual Baseline', points: ['First approved point', 'Second approved point'] },
    new FixtureModel()
  )
  const printCss = print ? '@page { size: landscape; margin: 0; } html,body{width:1122px;height:794px;}' : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>${printCss}</style></head><body style="margin:0">${slide.html}</body></html>`
}

async function compareOrCapture(name: string, buffer: Buffer) {
  const target = path.join(pngDir, `${name}.png`)
  if (capture) {
    fs.mkdirSync(pngDir, { recursive: true })
    fs.writeFileSync(target, buffer)
    return
  }
  expect(fs.existsSync(target), `approved baseline missing: ${target}. Run scripts/capture-visual-baselines.mjs explicitly.`).toBe(true)
  const baseline = PNG.sync.read(fs.readFileSync(target))
  const actual = PNG.sync.read(buffer)
  expect(`${actual.width}x${actual.height}`).toBe(`${baseline.width}x${baseline.height}`)
  const diff = new PNG({ width: baseline.width, height: baseline.height })
  const changed = pixelmatch(baseline.data, actual.data, diff.data, baseline.width, baseline.height, { threshold: 0.05 })
  const ratio = changed / (baseline.width * baseline.height)
  if (ratio > MAX_DIFF_RATIO) {
    fs.mkdirSync(diffDir, { recursive: true })
    fs.writeFileSync(path.join(diffDir, `diff-${name}.png`), PNG.sync.write(diff))
  }
  expect(ratio, `visual diff for ${name} (${changed} pixels); see artifacts/visual/diff-${name}.png`).toBeLessThanOrEqual(MAX_DIFF_RATIO)
}

async function screenshot(name: string) {
  await page.setViewportSize({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT })
  await compareOrCapture(name, await page.screenshot({ animations: 'disabled', scale: 'css' }))
}

/**
 * UI chrome is compared structurally: exact text/presence plus geometry with a
 * small tolerance. Runner font antialiasing and scrollbar width otherwise
 * produce large pixel diffs for identical application state.
 */
async function uiSnapshot(): Promise<UiSnapshotEntry[]> {
  return page.evaluate((selectors) => selectors.map((selector) => {
    const element = document.querySelector(selector)
    if (!element) return { selector, present: false }
    const rect = element.getBoundingClientRect()
    return {
      selector,
      present: true,
      text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 240),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  }), UI_SELECTORS)
}

async function compareOrCaptureUi(name: string) {
  const target = path.join(jsonDir, `${name}.json`)
  const actual = await uiSnapshot()
  if (capture) {
    fs.mkdirSync(jsonDir, { recursive: true })
    fs.writeFileSync(target, `${JSON.stringify(actual, null, 2)}\n`)
    return
  }
  expect(fs.existsSync(target), `approved UI baseline missing: ${target}. Run scripts/capture-visual-baselines.mjs explicitly.`).toBe(true)
  const baseline = JSON.parse(fs.readFileSync(target, 'utf8')) as UiSnapshotEntry[]
  expect(actual.length).toBe(baseline.length)
  for (let index = 0; index < baseline.length; index += 1) {
    const expected = baseline[index]
    const observed = actual[index]
    expect(observed.selector).toBe(expected.selector)
    expect(observed.present).toBe(expected.present)
    if (!expected.present) continue
    expect(observed.text, `${name} text for ${expected.selector}`).toBe(expected.text)
    if (UI_FLOW_SELECTORS.has(expected.selector)) continue
    for (const axis of ['x', 'y', 'width', 'height'] as const) {
      const delta = Math.abs((observed[axis] ?? 0) - (expected[axis] ?? 0))
      expect(delta, `${name} ${axis} for ${expected.selector}`).toBeLessThanOrEqual(UI_GEOMETRY_TOLERANCE)
    }
  }
}

/** Electron pages controlled over CDP do not expose Page.printToPDF; render in the main process. */
async function pdfFromMainProcess(htmlPath: string): Promise<Buffer> {
  const base64 = await app.evaluate(async ({ BrowserWindow }, file) => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    })
    try {
      await window.loadFile(file)
      const pdf = await window.webContents.printToPDF({
        printBackground: true,
        landscape: true,
        preferCSSPageSize: true
      })
      return pdf.toString('base64')
    } finally {
      if (!window.isDestroyed()) window.destroy()
    }
  }, htmlPath)
  return Buffer.from(base64, 'base64')
}

beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-visual-'))
  if (!fs.existsSync(path.resolve('out/main/index.js'))) throw new Error('Build the Electron app before running visual tests')
  const executablePath = execFileSync(process.execPath, ['-p', "require('electron')"], {
    cwd: process.cwd(),
    encoding: 'utf8'
  }).trim()
  app = await electron.launch({
    executablePath,
    args: ['--force-device-scale-factor=1', path.resolve('out/main/index.js'), `--user-data-dir=${workDir}`],
    env: { ...process.env, STORAGE_DIR: workDir, APM_E2E: '1' }
  })
  page = await app.firstWindow()
  await page.locator('.app').waitFor()
}, 120_000)

afterAll(async () => {
  await app?.close()
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true })
}, 30_000)

describe('approved visual and PDF page baselines', () => {
  it('compares the main window baseline', async () => {
    await compareOrCaptureUi('main-window')
  }, TEST_TIMEOUT)

  it('compares the template gallery baseline', async () => {
    await page.locator('button:has-text("Browse all")').click()
    await page.locator('.template-grid, [role="dialog"]').first().waitFor()
    await compareOrCaptureUi('template-gallery')
    await page.keyboard.press('Escape')
  }, TEST_TIMEOUT)

  it('compares the settings modal baseline', async () => {
    await page.locator('[data-testid="open-settings"]').click()
    await page.locator('[data-testid="settings-save"]').waitFor()
    await compareOrCaptureUi('settings-modal')
    await page.keyboard.press('Escape')
  }, TEST_TIMEOUT)

  for (const role of CANONICAL_ROLES) {
    it(`compares the ${role} slide role and PDF page screenshot`, async () => {
      const html = await fixtureHtml(role, false)
      const fixture = path.join(workDir, `${role}.html`)
      fs.writeFileSync(fixture, html)
      await page.goto(pathToFileURL(fixture).href)
      await page.locator('section.slide').waitFor()
      await screenshot(`slide-${role}`)

      const printHtml = await fixtureHtml(role, true)
      const printFixture = path.join(workDir, `${role}-print.html`)
      fs.writeFileSync(printFixture, printHtml)
      await page.goto(pathToFileURL(printFixture).href)
      await page.emulateMedia({ media: 'print' })
      await screenshot(`pdf-page-${role}`)

      const pdf = await pdfFromMainProcess(printFixture)
      const pdfText = pdf.toString('latin1')
      expect(pdf.subarray(0, 5).toString(), `${role} PDF header`).toBe('%PDF-')
      expect(pdfText.match(/\/Type\s*\/Page\b/g) ?? [], `${role} PDF page count`).toHaveLength(1)
      expect(pdfText, `${role} PDF page box`).toContain('/MediaBox')
      await page.emulateMedia({ media: 'screen' })
    }, TEST_TIMEOUT)
  }
})
