import { useEffect, useRef, useState } from 'react'
import { STYLE_PRESETS } from '@shared/constants'
import { TEMPLATE_CATALOG, getTemplatesByStyle } from '@shared/templateCatalog'
import TemplatePickerModal, { TemplateThumb } from './TemplatePickerModal'
import SettingsModal, { type SettingsState } from './components/SettingsModal'
import type { AgentEvent, DeckSession, PageCountBucket, Slide, StylePreset } from '@shared/types'

const defaultBrief = 'A 10-slide presentation about renewable energy for investors'

function getApi() {
  return (window as any).desktopApi as Window['desktopApi'] | undefined
}

function newOperationId() {
  return globalThis.crypto?.randomUUID?.() || `op-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function App() {
  const [brief, setBrief] = useState(defaultBrief)
  const [audience, setAudience] = useState('')
  const [language, setLanguage] = useState('')
  const [pageCount, setPageCount] = useState<PageCountBucket | string>('10-15')
  const [style, setStyle] = useState<StylePreset>('Business')
  const [templateId, setTemplateId] = useState<string>('auto')
  const [includeCitations, setIncludeCitations] = useState(false)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [sessions, setSessions] = useState<DeckSession[]>([])
  const [current, setCurrent] = useState<DeckSession | null>(null)
  const [slides, setSlides] = useState<Slide[]>([])
  const [status, setStatus] = useState('Ready')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editInstruction, setEditInstruction] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const activeSessionId = useRef<string | null>(null)
  const activeOperationId = useRef<string | null>(null)

  useEffect(() => {
    const api = getApi()
    if (!api) {
      setError('Desktop API unavailable. Run inside the Electron app.')
      return
    }
    api.listSessions().then(setSessions).catch((e) => setError(String(e)))
    api.getSettings?.().then(setSettings).catch((e) => setError(String(e)))
    const off = api.onAgentEvent((event: AgentEvent) => {
      // Correlated events belong to the active operation even before its new session is known.
      if ('correlationId' in event) {
        if (event.correlationId !== activeOperationId.current) return
      } else if (activeSessionId.current && event.sessionId !== activeSessionId.current) return
      if (event.type === 'plan') {
        setStatus(`Outline ready: ${event.outline.slides.length} slides`)
        setSlides([])
      }
      if (event.type === 'slide') {
        setSlides((prev) => {
          const next = [...prev.filter((s) => s.index !== event.slide.index), event.slide]
          return next.sort((a, b) => a.index - b.index)
        })
        setStatus(`Generating slide ${event.slide.index}...`)
      }
      if (event.type === 'completed') {
        setStatus('Deck completed')
        setBusy(false)
        activeSessionId.current = event.sessionId
        api.getSession(event.sessionId).then((s) => {
          if (s) setCurrent(s)
        })
        api.listSessions().then(setSessions).catch(() => {})
      }
      if (event.type === 'error') {
        setError(event.message)
        setStatus('Error')
        setBusy(false)
      }
      if (event.type === 'retry' && event.correlationId === activeOperationId.current) {
        setStatus(`Retrying (${event.attempt}/${event.maxRetries}): ${event.category}`)
      }
      if (event.type === 'cancelled' && event.correlationId === activeOperationId.current) {
        setStatus('Generation cancelled')
        setBusy(false)
        activeOperationId.current = null
      }
      if (event.type === 'warning') {
        setStatus(`Warning: ${event.message}`)
      }
    })
    return off
  }, [])

  async function createDeck() {
    const api = getApi()
    if (!api) return
    const operationId = newOperationId()
    activeOperationId.current = operationId
    setBusy(true)
    setError('')
    setSlides([])
    setCurrent(null)
    setStatus('Planning outline...')
    try {
      const session = await api.createDeck({
        brief,
        operationId,
        options: {
          audience: audience || undefined,
          language: language || undefined,
          pageCount: pageCount as PageCountBucket,
          style,
          templateId: templateId || undefined,
          includeCitations
        }
      })
      // A cancelled operation must not overwrite the cancellation status with its partial session.
      if (activeOperationId.current !== operationId) return
      activeSessionId.current = session.id
      setCurrent(session)
      setSlides(session.slides || [])
      setStatus(session.status === 'completed' ? 'Deck completed' : session.status)
      setSessions(await api.listSessions())
    } catch (e: any) {
      setError(e?.message || String(e))
      setStatus('Error')
    } finally {
      if (activeOperationId.current === operationId) activeOperationId.current = null
      setBusy(false)
    }
  }

  async function editDeck() {
    const api = getApi()
    if (!api || !current || !editInstruction.trim()) return
    const operationId = newOperationId()
    activeOperationId.current = operationId
    setBusy(true)
    setError('')
    setStatus('Applying edit...')
    try {
      const session = await api.editDeck({
        sessionId: current.id,
        instruction: editInstruction.trim(),
        operationId
      })
      if (activeOperationId.current !== operationId) return
      activeSessionId.current = session.id
      setCurrent(session)
      setSlides(session.slides || [])
      setEditInstruction('')
      setStatus(session.status === 'completed' ? 'Deck completed' : session.status)
      setSessions(await api.listSessions())
    } catch (e: any) {
      setError(e?.message || String(e))
      setStatus('Error')
    } finally {
      if (activeOperationId.current === operationId) activeOperationId.current = null
      setBusy(false)
    }
  }

  async function cancelDeck() {
    const api = getApi()
    if (!api || !activeOperationId.current) return
    try {
      await api.cancelDeck?.(activeOperationId.current)
      setStatus('Cancelling...')
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }

  async function openSession(id: string) {
    const api = getApi()
    if (!api) return
    const s = await api.getSession(id)
    if (!s) return
    activeSessionId.current = s.id
    setCurrent(s)
    setSlides(s.slides || [])
    setStatus(s.status)
    // Keep the gallery and style selector in sync with the loaded deck.
    setTemplateId(s.spec.templateId || 'auto')
    setStyle(s.spec.styleClass || 'Business')
    setError('')
  }

  const artifactPath = current?.artifact?.filePath
  const canExport = Boolean(artifactPath)

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">AI Presentation Maker</div>
        <div className="sub">Desktop agent stack · brief → outline → slides → deck</div>

        <div className="card">
          <label className="label">Brief</label>
          <textarea className="textarea" value={brief} onChange={(e) => setBrief(e.target.value)} />
          <div style={{ height: 10 }} />
          <div className="row">
            <div>
              <label className="label">Audience</label>
              <input className="input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Investors" />
            </div>
            <div>
              <label className="label">Language</label>
              <input className="input" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en / zh / auto" />
            </div>
          </div>
          <div style={{ height: 10 }} />
          <div className="row">
            <div>
              <label className="label">Length</label>
              <select className="select" value={pageCount} onChange={(e) => setPageCount(e.target.value as PageCountBucket)}>
                <option value="short">Short</option>
                <option value="medium">Medium</option>
                <option value="10-15">10-15</option>
                <option value="long">Long</option>
              </select>
            </div>
            <div>
              <label className="label">Style</label>
              <select className="select" value={style} onChange={(e) => {
                const next = e.target.value as StylePreset
                setStyle(next)
                const first = getTemplatesByStyle(next)[0]
                if (first) setTemplateId(first.id)
              }}>
                {STYLE_PRESETS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{ height: 10 }} />
          <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={includeCitations} onChange={(e) => setIncludeCitations(e.target.checked)} />
            Include citations / sources
          </label>
          <div style={{ height: 12 }} />
          <div className="actions">
            <button className="btn" onClick={createDeck} disabled={busy || !brief.trim()}>{busy ? 'Working...' : 'Generate Deck'}</button>
            <button className="btn secondary" onClick={async () => { if (!artifactPath) return; try { await getApi()?.openArtifact(artifactPath) } catch (e: any) { setError(e?.message || String(e)) } }} disabled={!canExport || busy}>Open</button>
            <button className="btn secondary" onClick={async () => { if (!artifactPath) return; try { await getApi()?.exportDeck(artifactPath) } catch (e: any) { setError(e?.message || String(e)) } }} disabled={!canExport || busy}>Export</button>
          </div>
          {error && <div className="error">{error}</div>}
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <label className="label" style={{ margin: 0 }}>Template gallery</label>
            <button className="btn secondary" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setShowTemplatePicker(true)}>Browse all</button>
          </div>
          <div className="small" style={{ margin: '8px 0 10px' }}>Pick a visual template. Style follows the template.</div>
          <div className="template-grid">
            {TEMPLATE_CATALOG.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`template-item ${templateId === t.id ? 'active' : ''}`}
                onClick={() => { setTemplateId(t.id); setStyle(t.style) }}
                title={t.description}
              >
                <TemplateThumb template={t} className="template-preview" />
                <div className="template-name">{t.name}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <label className="label">Edit current deck</label>
          <textarea className="textarea" style={{ minHeight: 72 }} value={editInstruction} onChange={(e) => setEditInstruction(e.target.value)} placeholder="Make slide 2 more concise..." />
          <div style={{ height: 10 }} />
          <button className="btn secondary" onClick={editDeck} disabled={busy || !current || !editInstruction.trim()}>Apply Edit</button>
        </div>

        <div className="card">
          <label className="label">Sessions</label>
          {sessions.length === 0 && <div className="small">No sessions yet.</div>}
          {sessions.map((s) => (
            <div key={s.id} className={`session-item ${current?.id === s.id ? 'active' : ''}`} onClick={() => openSession(s.id)}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.outline?.title || s.spec.topic}</div>
              <div className="small">{s.status} · {s.slides?.length || 0} slides · v{s.artifact?.version || 0}</div>
            </div>
          ))}
        </div>
      </aside>

      <main className="main">
        <div className="toolbar">
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{current?.outline?.title || 'Workspace'}</div>
            <div className="status">Status: <span className={status === 'Deck completed' ? 'ok' : ''}>{status}</span>{current?.artifact ? ` · v${current.artifact.version} · ${current.artifact.slideCount} slides` : ''}</div>
          </div>
          <div className="toolbar-actions">
            {settings?.mode === 'offline-preview' && (
              <span className="pill pill-warn" data-testid="offline-badge">Offline Preview</span>
            )}
            <span className="pill" data-testid="model-pill">{settings?.model || 'default model'}</span>
            <button className="btn secondary small-btn" type="button" onClick={cancelDeck} disabled={!busy} data-testid="cancel-deck">Cancel</button>
            <button className="btn secondary small-btn" type="button" onClick={() => setShowSettings(true)} data-testid="open-settings">Settings</button>
          </div>
        </div>

        {slides.length === 0 ? (
          <div className="empty">{busy ? 'Generating slides...' : 'Enter a brief and generate a deck. Slides will stream in here.'}</div>
        ) : (
          <div className="slides">
            {slides.map((slide) => (
              <div className="slide-card" key={slide.index}>
                <div className="slide-meta"><span>Slide {slide.index} · {slide.role}</span><span>{slide.theme}</span></div>
                <div className="slide-preview">
                  <iframe title={`slide-${slide.index}`} sandbox="" srcDoc={`<!doctype html><html><body style="margin:0">${slide.html}</body></html>`} />
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <TemplatePickerModal
        open={showTemplatePicker}
        selectedId={templateId}
        onSelect={(t) => { setTemplateId(t.id); setStyle(t.style) }}
        onClose={() => setShowTemplatePicker(false)}
      />
      <SettingsModal
        open={showSettings}
        settings={settings}
        onClose={() => setShowSettings(false)}
        onSaved={setSettings}
      />
    </div>
  )
}
