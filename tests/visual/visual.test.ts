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
const TEST_TIMEOUT = 90_000
const UI_SELECTORS = [
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

interface UiSnapshotEntry {
  selector: string
  present: boolean
  tag?: string
  role?: string
  name?: string
  text?: string
  testId?: string
  visible?: boolean
  enabled?: boolean
  selected?: boolean
  expanded?: boolean
  hierarchy?: string[]
  order?: number
  layout?: { xRatio: number; yRatio: number; widthRatio: number; heightRatio: number }
}

interface UiSnapshot {
  entries: UiSnapshotEntry[]
  relationships: Record<string, boolean>
}

const UI_LAYOUT_TOLERANCE = 0.1

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
 * UI chrome is compared structurally: semantic roles/names, control state,
 * hierarchy and coarse normalized layout. Native window size, scrollbars and
 * font antialiasing vary between CI runners, so pixel comparisons are reserved
 * for the deterministic PDF/slide baselines.
 */
async function uiSnapshot(): Promise<UiSnapshot> {
  return page.evaluate((selectors) => {
    const resolve = (selector: string): Element | null => {
      const labelled = /^button\[text="(.+)"\]$/.exec(selector)
      if (labelled) {
        return Array.from(document.querySelectorAll('button'))
          .find((button) => (button.textContent || '').trim() === labelled[1]) || null
      }
      return document.querySelector(selector)
    }
    const textOf = (element: Element) => (element.textContent || '').trim().replace(/\s+/g, ' ')
    const roleOf = (element: Element) => {
      const explicit = element.getAttribute('role')
      if (explicit) return explicit
      const tag = element.tagName.toLowerCase()
      if (tag === 'button') return 'button'
      if (tag === 'textarea') return 'textbox'
      if (tag === 'select') return 'combobox'
      if (tag === 'a') return 'link'
      if (/^h[1-6]$/.test(tag)) return 'heading'
      if (tag === 'input') return (element as HTMLInputElement).type === 'checkbox' ? 'checkbox' : 'textbox'
      return 'generic'
    }
    const nameOf = (element: Element) => {
      const labelledBy = element.getAttribute('aria-labelledby')
      if (labelledBy) {
        const parts = labelledBy.split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter((node): node is HTMLElement => !!node)
          .map(textOf)
        if (parts.length > 0) return parts.join(' ').slice(0, 200)
      }
      return (
        element.getAttribute('aria-label')
        || textOf(element.closest('label') || element).slice(0, 200)
        || element.getAttribute('placeholder')
        || ''
      )
    }
    const hierarchyOf = (element: Element) => {
      const chain: string[] = []
      let node: Element | null = element
      while (node && chain.length < 6) {
        const tag = node.tagName.toLowerCase()
        const className = typeof node.className === 'string' ? node.className.trim().split(/\s+/)[0] : ''
        chain.unshift(className ? `${tag}.${className}` : tag)
        node = node.parentElement
      }
      return chain
    }
    const root = resolve('.app')?.getBoundingClientRect()
    const ratio = (value: number, size: number) => size > 0 ? Math.round((value / size) * 100) / 100 : 0
    const entries: UiSnapshotEntry[] = selectors.map((selector, order) => {
      const element = resolve(selector)
      if (!element) return { selector, present: false, order }
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      const control = element as HTMLButtonElement & HTMLInputElement
      return {
        selector,
        present: true,
        order,
        tag: element.tagName.toLowerCase(),
        role: roleOf(element),
        name: nameOf(element),
        text: textOf(element).slice(0, 240),
        testId: element.getAttribute('data-testid') || undefined,
        visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0,
        enabled: !('disabled' in control && control.disabled) && element.getAttribute('aria-disabled') !== 'true',
        selected: element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-checked') === 'true' || element.getAttribute('aria-pressed') === 'true',
        expanded: element.getAttribute('aria-expanded') || undefined,
        hierarchy: hierarchyOf(element),
        layout: root ? {
          xRatio: ratio(rect.x - root.x, root.width),
          yRatio: ratio(rect.y - root.y, root.height),
          widthRatio: ratio(rect.width, root.width),
          heightRatio: ratio(rect.height, root.height)
        } : undefined
      }
    })
    const rectFor = (selector: string) => resolve(selector)?.getBoundingClientRect()
    const sidebar = rectFor('.sidebar')
    const main = rectFor('.main')
    const toolbar = rectFor('.toolbar')
    const empty = rectFor('.empty')
    const dialog = resolve('[role="dialog"]')
    const grid = resolve('.template-grid')
    const cancel = resolve('[data-testid="cancel-deck"]') as HTMLButtonElement | null
    const relationships: Record<string, boolean> = {
      sidebarLeftOfMain: !!sidebar && !!main && sidebar.right <= main.left + 1,
      toolbarAboveContent: !!toolbar && !!empty && toolbar.top < empty.top,
      dialogIsModal: !!dialog && dialog.getAttribute('aria-modal') === 'true',
      templateGridInsideDialog: !!dialog && !!grid && dialog.contains(grid),
      settingsControlsInsideDialog: !!dialog && ['settings-endpoint', 'settings-model', 'settings-api-key', 'settings-save']
        .every((id) => dialog.contains(document.querySelector(`[data-testid="${id}"]`) as Node)),
      cancelDisabledWhenIdle: !!cancel && cancel.disabled === true
    }
    return { entries, relationships }
  }, UI_SELECTORS)
}

function assertUsableUiSnapshot(snapshot: UiSnapshot, label: string) {
  expect(Array.isArray(snapshot?.entries), `${label} entries`).toBe(true)
  expect(snapshot.entries).toHaveLength(UI_SELECTORS.length)
  expect(snapshot.entries.filter((entry) => entry.present).length, `${label} present elements`).toBeGreaterThanOrEqual(8)
  expect(Object.keys(snapshot.relationships || {}).length, `${label} relationships`).toBeGreaterThanOrEqual(6)
  for (const entry of snapshot.entries.filter((candidate) => candidate.present)) {
    expect(entry.role, `${label} role for ${entry.selector}`).toBeTruthy()
    expect(entry.hierarchy?.length, `${label} hierarchy for ${entry.selector}`).toBeGreaterThan(0)
    expect(typeof entry.visible, `${label} visibility for ${entry.selector}`).toBe('boolean')
    expect(typeof entry.enabled, `${label} enabled state for ${entry.selector}`).toBe('boolean')
    expect(entry.layout, `${label} normalized layout for ${entry.selector}`).toBeTruthy()
  }
}

async function compareOrCaptureUi(name: string) {
  const target = path.join(jsonDir, `${name}.json`)
  const actual = await uiSnapshot()
  assertUsableUiSnapshot(actual, `${name} actual`)
  if (capture) {
    fs.mkdirSync(jsonDir, { recursive: true })
    fs.writeFileSync(target, `${JSON.stringify(actual, null, 2)}\n`)
    return
  }
  expect(fs.existsSync(target), `approved UI baseline missing: ${target}. Run scripts/capture-visual-baselines.mjs explicitly.`).toBe(true)
  const baseline = JSON.parse(fs.readFileSync(target, 'utf8')) as UiSnapshot
  assertUsableUiSnapshot(baseline, `${name} baseline`)
  expect(actual.relationships, `${name} layout relationships`).toEqual(baseline.relationships)
  expect(actual.entries).toHaveLength(baseline.entries.length)
  for (let index = 0; index < baseline.entries.length; index += 1) {
    const expected = baseline.entries[index]
    const observed = actual.entries[index]
    expect(observed.selector).toBe(expected.selector)
    expect(observed.present).toBe(expected.present)
    if (!expected.present) continue
    for (const field of ['tag', 'role', 'name', 'text', 'testId', 'visible', 'enabled', 'selected', 'expanded', 'hierarchy'] as const) {
      expect(observed[field], `${name} ${field} for ${expected.selector}`).toEqual(expected[field])
    }
    for (const axis of ['xRatio', 'yRatio', 'widthRatio', 'heightRatio'] as const) {
      const delta = Math.abs((observed.layout?.[axis] ?? 0) - (expected.layout?.[axis] ?? 0))
      expect(delta, `${name} ${axis} for ${expected.selector}`).toBeLessThanOrEqual(UI_LAYOUT_TOLERANCE)
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
    await page.getByRole('button', { name: 'Close template gallery' }).click()
    await page.locator('.tpl-modal-backdrop').waitFor({ state: 'hidden' })
  }, TEST_TIMEOUT)

  it('compares the settings modal baseline', async () => {
    // Fresh renderer state guarantees no modal from the previous test can intercept clicks.
    await page.reload()
    await page.locator('.app').waitFor()
    await page.locator('[data-testid="open-settings"]').click()
    await page.locator('[data-testid="settings-save"]').waitFor()
    await compareOrCaptureUi('settings-modal')
    await page.getByRole('button', { name: 'Close settings' }).click()
    await page.locator('.modal-backdrop').waitFor({ state: 'hidden' })
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
