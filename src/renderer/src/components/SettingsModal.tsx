import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  onSaved: (settings: AppSettings) => void
}

export default function SettingsModal({ open, onClose, onSaved }: SettingsModalProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [endpoint, setEndpoint] = useState('')
  const [model, setModel] = useState('gpt-4.1-mini')
  const [apiKey, setApiKey] = useState('')
  const [telemetryOptIn, setTelemetryOptIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    window.desktopApi.getSettings().then((value) => {
      setSettings(value)
      setEndpoint(value.endpoint)
      setModel(value.model)
      setTelemetryOptIn(value.telemetryOptIn)
      setApiKey('')
      setError('')
    }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [open])

  if (!open) return null

  async function save() {
    setBusy(true)
    setError('')
    try {
      let next = await window.desktopApi.updateSettings({ endpoint: endpoint.trim(), model: model.trim(), telemetryOptIn })
      if (apiKey.trim()) next = await window.desktopApi.setApiKey(apiKey.trim())
      setApiKey('')
      setSettings(next)
      onSaved(next)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function clearKey() {
    setBusy(true)
    setError('')
    try {
      const next = await window.desktopApi.clearApiKey()
      setSettings(next)
      onSaved(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="settings-head">
          <div>
            <div id="settings-title" className="settings-title">Provider settings</div>
            <div className="small">Credentials are encrypted by macOS-backed Electron safeStorage and are never returned to the renderer.</div>
          </div>
          <button className="tpl-close" type="button" onClick={onClose} aria-label="Close settings">×</button>
        </div>
        <div className="settings-body">
          <label className="label" htmlFor="model-endpoint">OpenAI-compatible endpoint</label>
          <input id="model-endpoint" className="input" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://api.example.com or http://127.0.0.1:8080" autoComplete="url" />
          <label className="label" htmlFor="model-name">Model name</label>
          <input id="model-name" className="input" value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-4.1-mini" />
          <label className="label" htmlFor="model-api-key">API key</label>
          <input id="model-api-key" className="input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings?.hasKey ? 'Key stored — enter a new key to replace it' : 'Enter API key'} autoComplete="new-password" />
          <div className="settings-key-row">
            <span className="small">{settings?.hasKey ? 'Credential stored' : 'No credential stored'} · {settings?.canEncrypt ? 'Secure storage available' : 'Secure storage unavailable'}</span>
            <button className="btn secondary" type="button" disabled={busy || !settings?.hasKey} onClick={clearKey}>Clear key</button>
          </div>
          <label className="settings-checkbox">
            <input type="checkbox" checked={telemetryOptIn} onChange={(event) => setTelemetryOptIn(event.target.checked)} />
            Enable local diagnostic telemetry (opt-in)
          </label>
          {error && <div className="error">{error}</div>}
        </div>
        <div className="settings-actions">
          <button className="btn secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" type="button" onClick={save} disabled={busy || !model.trim()}>{busy ? 'Saving…' : 'Save settings'}</button>
        </div>
      </section>
    </div>
  )
}
