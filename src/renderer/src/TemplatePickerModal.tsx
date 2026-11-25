import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  SLIDE_ROLES,
  SLIDE_ROLE_PRESENTATIONS,
  TEMPLATE_CATALOG,
  getDecorStyle,
  type TemplateDef
} from '@shared/templateCatalog'
import type { CanonicalSlideRole } from '@shared/types'

interface Props {
  open: boolean
  selectedId: string
  onSelect: (template: TemplateDef) => void
  onClose: () => void
}

const PREVIEW_KINDS = SLIDE_ROLES.map((role) => ({
  kind: role,
  label: role.charAt(0).toUpperCase() + role.slice(1)
}))

/** Shared thumbnail for the sidebar gallery and the modal list. */
export function TemplateThumb({ template, className = '' }: { template: TemplateDef; className?: string }) {
  const decor = getDecorStyle(template, 'compact') as CSSProperties
  const hasDecor = Object.keys(decor).length > 0
  return (
    <div
      className={`tpl-thumb-base ${className}`}
      style={{ background: template.previewBg || template.bg, color: template.previewText || template.text }}
      aria-hidden="true"
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: template.previewAccent || template.accent }} />
      {hasDecor && <div style={decor} />}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 700, fontFamily: template.fontHeading }}>Aa</div>
        <div style={{ marginTop: 6, width: '70%', height: 4, background: template.previewAccent || template.accent, borderRadius: 2 }} />
        <div style={{ marginTop: 4, width: '90%', height: 3, background: `${template.previewText || template.text}30`, borderRadius: 2 }} />
      </div>
    </div>
  )
}

function MockSlide({ template, kind }: { template: TemplateDef; kind: CanonicalSlideRole }) {
  const preset = SLIDE_ROLE_PRESENTATIONS[kind]
  const decor = getDecorStyle(template, 'compact') as CSSProperties
  const base: CSSProperties = {
    position: 'relative',
    height: '100%',
    overflow: 'hidden',
    borderRadius: 10,
    border: `1px solid ${template.accent}33`,
    background: template.bg,
    color: template.text,
    fontFamily: template.fontBody
  }
  const inner: CSSProperties = {
    position: 'relative',
    zIndex: 1,
    height: '100%',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box'
  }
  const labelStyle: CSSProperties = {
    color: template.accent,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    marginBottom: 6
  }
  const titleStyle: CSSProperties = {
    fontFamily: template.fontHeading,
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.15,
    marginBottom: 10
  }
  const mutedStyle: CSSProperties = { color: template.muted, fontSize: 10, lineHeight: 1.4 }
  const bullet = (text: string, index?: number) => (
    <div key={text} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', color: template.muted, fontSize: 10, marginBottom: 5 }}>
      {index === undefined ? (
        <span style={{ width: 5, height: 5, borderRadius: 5, background: template.accent, marginTop: 4, flexShrink: 0 }} />
      ) : (
        <span style={{ color: template.accent, fontWeight: 700, width: 14 }}>{String(index).padStart(2, '0')}</span>
      )}
      <span>{text}</span>
    </div>
  )
  const centered = kind === 'cover' || kind === 'end'

  return (
    <div style={base} aria-label={`${template.name} ${kind} preview`}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: template.accent }} />
      {Object.keys(decor).length > 0 && <div style={decor} />}
      <div style={inner}>
        <div style={labelStyle}>{preset.label}</div>
        {kind === 'chapter' && <div style={{ fontSize: 34, fontWeight: 800, color: `${template.accent}44`, lineHeight: 1 }}>01</div>}
        <div style={{ ...titleStyle, fontSize: centered ? 24 : 20 }}>{preset.previewTitle}</div>
        {kind === 'cover' && <div style={{ width: 36, height: 3, background: template.accent, borderRadius: 2, marginBottom: 10 }} />}
        {kind === 'catalog'
          ? preset.previewPoints.map((text, i) => bullet(text, i + 1))
          : centered || kind === 'chapter'
            ? preset.previewPoints.map((text) => <div key={text} style={mutedStyle}>{text}</div>)
            : preset.previewPoints.map((text) => bullet(text))}
      </div>
    </div>
  )
}

export default function TemplatePickerModal({ open, selectedId, onSelect, onClose }: Props) {
  const initial = useMemo(
    () => TEMPLATE_CATALOG.find((t) => t.id === selectedId) || TEMPLATE_CATALOG[0],
    [open, selectedId]
  )
  const [activeId, setActiveId] = useState(initial?.id)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const firstItemRef = useRef<HTMLButtonElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const active = TEMPLATE_CATALOG.find((t) => t.id === activeId) || TEMPLATE_CATALOG[0]

  useEffect(() => {
    if (open) setActiveId(initial?.id)
  }, [open, initial?.id])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    firstItemRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!dialogRef.current?.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previousFocusRef.current?.focus()
    }
  }, [open, onClose])

  if (!open || !active) return null

  return (
    <div className="tpl-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="tpl-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Template gallery"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tpl-modal-head">
          <div>
            <div className="tpl-modal-title">Choose a template</div>
            <div className="tpl-modal-sub">
              Select a template to preview its cover, catalog, chapter, content, and end layouts, then use “Use template” to apply it.
            </div>
          </div>
          <button className="tpl-close" onClick={onClose} aria-label="Close template gallery">×</button>
        </div>
        <div className="tpl-modal-body">
          <div className="tpl-list" aria-label="Templates">
            {TEMPLATE_CATALOG.map((t, i) => (
              <button
                key={t.id}
                ref={i === 0 ? firstItemRef : undefined}
                type="button"
                className={`tpl-list-item ${active.id === t.id ? 'active' : ''}`}
                onClick={() => setActiveId(t.id)}
              >
                <TemplateThumb template={t} className="tpl-thumb" />
                <div className="tpl-list-meta">
                  <div className="tpl-list-name">{t.name}</div>
                  <div className="tpl-list-desc">{t.description}</div>
                </div>
                {selectedId === t.id && <span className="tpl-selected-badge">Selected</span>}
              </button>
            ))}
          </div>
          <div className="tpl-preview-pane">
            <div className="tpl-preview-head">
              <div>
                <div className="tpl-preview-name">{active.name}</div>
                <div className="tpl-preview-desc">{active.description}</div>
              </div>
              <button className="btn" onClick={() => { onSelect(active); onClose() }}>Use template</button>
            </div>
            <div className="tpl-preview-grid">
              {PREVIEW_KINDS.map(({ kind, label }) => (
                <div key={kind} className="tpl-preview-cell">
                  <MockSlide template={active} kind={kind} />
                  <div className="tpl-preview-label">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
