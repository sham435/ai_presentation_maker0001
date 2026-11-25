import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { sanitizeHtml } from '../security/sanitize'
import type { DeckArtifact, Slide } from '@shared/types'

export function renderDeck(sessionId: string, version: number, title: string, slides: Slide[]): DeckArtifact {
  const dir = path.join(process.env.STORAGE_DIR || path.join(app.getPath('userData'), 'data'), 'artifacts', sessionId)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `deck-v${version}.html`)
  const html = buildHtml(title, slides)
  fs.writeFileSync(filePath, html, 'utf8')
  return {
    sessionId,
    version,
    slideCount: slides.length,
    filePath,
    createdAt: new Date().toISOString()
  }
}

function buildHtml(title: string, slides: Slide[]): string {
  const body = slides
    .map((s, i) => sanitizeHtml(s.html.replace('data-index=""', `data-index="${i + 1}"`)))
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escape(title)}</title>
  <style>
    html,body{margin:0;padding:0;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif;}
    .deck{width:100vw;height:100vh;overflow:auto;scroll-snap-type:y mandatory;}
    .slide{width:100vw;min-height:100vh;scroll-snap-align:start;box-sizing:border-box;}
    @media print { .deck{height:auto;overflow:visible;} .slide{page-break-after:always;} }
  </style>
</head>
<body>
  <main class="deck">${body}</main>
</body>
</html>`
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
