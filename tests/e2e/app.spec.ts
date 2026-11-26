import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'

let app: ElectronApplication
let page: Page
let storageDir: string
let saveDir: string

async function launchApp() {
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apm-playwright-'))
  saveDir = path.join(storageDir, 'exports')
  fs.mkdirSync(saveDir)
  const appPath = path.resolve('out/main/index.js')
  const executablePath = execFileSync(process.execPath, ['-p', "require('electron')"], {
    cwd: process.cwd(),
    encoding: 'utf8'
  }).trim()
  app = await electron.launch({
    executablePath,
    args: [appPath, `--user-data-dir=${storageDir}`],
    env: {
      ...process.env,
      STORAGE_DIR: storageDir,
      APM_E2E: '1',
      APM_E2E_DELAY_MS: '120',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
    }
  })
  page = await app.firstWindow()
  await page.locator('[data-testid="offline-badge"]').waitFor({ state: 'visible' })
}

async function stubSaveDialog() {
  await app.evaluate(async ({ dialog }, dir) => {
    ;(dialog as any).showSaveDialog = async (_window: unknown, options: { defaultPath?: string }) => ({
      canceled: false,
      filePath: `${dir}/${options.defaultPath || 'export.html'}`
    })
  }, saveDir)
}

test.beforeEach(async () => {
  await launchApp()
})

test.afterEach(async () => {
  await app?.close()
  if (storageDir) fs.rmSync(storageDir, { recursive: true, force: true })
})

test('startup shows the Offline Preview badge and empty state', async () => {
  await expect(page.locator('[data-testid="offline-badge"]')).toHaveText('Offline Preview')
  await expect(page.locator('.empty')).toContainText('Enter a brief')
  await expect(page.locator('[data-testid="model-pill"]')).toBeVisible()
})

test('settings workflow saves the model without exposing credentials', async () => {
  await page.locator('[data-testid="open-settings"]').click()
  await page.locator('[data-testid="settings-model"]').fill('offline-fixture-model')
  await page.locator('[data-testid="settings-save"]').click()
  await expect(page.locator('[data-testid="settings-model"]')).toHaveValue('offline-fixture-model')
  await expect(page.locator('[data-testid="settings-api-key"]')).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-testid="model-pill"]')).toHaveText('offline-fixture-model')
})

test('create, stream, edit, export and cancel flows work end to end', async () => {
  await stubSaveDialog()
  await page.locator('textarea').first().fill('A five slide overview of renewable energy')
  await page.locator('button:has-text("Generate Deck")').click()
  await expect(page.getByText('Deck completed')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.slide-card').first()).toBeVisible()

  await page.locator('textarea').nth(1).fill('Make slide 2 more concise')
  await page.locator('button:has-text("Apply Edit")').click()
  await expect(page.getByText('Deck completed')).toBeVisible({ timeout: 60_000 })

  await page.locator('button:has-text("Export")').click()
  await expect.poll(() => fs.readdirSync(saveDir).some((name) => name.endsWith('.html'))).toBe(true)

  await page.locator('textarea').first().fill('Another presentation for cancellation')
  await page.locator('button:has-text("Generate Deck")').click()
  const cancel = page.locator('[data-testid="cancel-deck"]')
  await expect(cancel).toBeEnabled()
  await cancel.click()
  await expect(page.getByText('Generation cancelled')).toBeVisible({ timeout: 60_000 })
})
