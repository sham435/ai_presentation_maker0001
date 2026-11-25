import createDOMPurify from 'dompurify'
import { JSDOM } from 'jsdom'

const window = new JSDOM('').window
const DOMPurify = createDOMPurify(window as unknown as any)

/**
 * Theme previews use inline styles. Allow only layout/paint declarations from a
 * fixed allowlist, and reject the usual CSS execution/loading vectors.
 */
const SAFE_STYLE_PROPERTIES = new Set([
  'align-items', 'background', 'background-color', 'background-image', 'background-size',
  'border', 'border-bottom', 'border-radius', 'border-top', 'bottom', 'box-shadow',
  'box-sizing', 'color', 'display', 'flex', 'flex-direction', 'flex-shrink', 'font-family',
  'font-size', 'font-weight', 'gap', 'height', 'inset', 'justify-content', 'left',
  'letter-spacing', 'line-height', 'list-style', 'margin', 'margin-bottom', 'margin-left',
  'margin-top', 'max-width', 'min-height', 'min-width', 'opacity', 'overflow', 'padding',
  'padding-bottom', 'padding-left', 'padding-right', 'padding-top', 'position', 'right',
  'text-align', 'text-overflow', 'text-transform', 'top', 'transform', 'white-space',
  'width', 'z-index'
])
const UNSAFE_STYLE_VALUE = /(javascript:|vbscript:|expression\s*\(|url\s*\(|@import|behavior\s*:|-moz-binding|data:|[<>\\{}])/i

function sanitizeStyleAttribute(value: string): string | null {
  const declarations = value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!declarations.length) return null

  const safe: string[] = []
  for (const declaration of declarations) {
    const colon = declaration.indexOf(':')
    if (colon < 1) return null
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const declarationValue = declaration.slice(colon + 1).trim()
    if (!SAFE_STYLE_PROPERTIES.has(property) || UNSAFE_STYLE_VALUE.test(declarationValue)) return null
    safe.push(`${property}:${declarationValue}`)
  }
  return safe.join(';')
}

DOMPurify.setConfig({
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'],
  ALLOW_DATA_ATTR: true
})

DOMPurify.addHook('uponSanitizeAttribute', (_node: unknown, event: { attrName: string; attrValue: string; keepAttr: boolean }) => {
  if (event.attrName.toLowerCase() !== 'style') return
  const safeStyle = sanitizeStyleAttribute(String(event.attrValue || ''))
  if (!safeStyle) {
    event.keepAttr = false
    return
  }
  event.attrValue = safeStyle
})

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html)
}

export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
