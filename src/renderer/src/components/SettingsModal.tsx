import { useEffect, useRef, useState } from 'react'
import type { AppSettings, CredentialStatus, GatewayDiagnosis, GatewayStatus, TelemetryRecord } from '@shared/types'
import TelemetryViewer from './TelemetryViewer'

export interface SettingsState extends AppSettings, CredentialStatus {
  mode: GatewayStatus['mode']
}

interface SettingsModalProps {
  open: boolean
  settings: SettingsState | null
  onClose: () => void
  onSaved: (settings: SettingsState) => void
}

function getApi() {
  return (window as any).desktopApi as Window['desktopApi'] | undefined
}

export default function SettingsModal({ open, settings, onClose, onSaved }: SettingsModalProps) {
  const [endpoint, setEndpoint] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [telemetryOptIn, setTelemetryOptIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState('')
  const [telemetryRecords, setTelemetryRecords] = useState<TelemetryRecord[]>([])
  const [showTelemetry, setShowTelemetry] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !settings) return
    setEndpoint(settings.endpoint || '')
    setModel(settings.model || 'gpt-4.1-mini')
    setApiKey('')
    setTelemetryOptIn(Boolean(settings.telemetryOptIn))
    setShowTelemetry(false)
    setTelemetryRecords([])
    setMessage('')
  }, [open, settings])

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        ) || []
      )
    firstFieldRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  async function saveSettings() {
    const api = getApi()
    if (!api || busy) return
    setBusy(true)
    setMessage('')
    try {
      const next = await api.setSettings({
        endpoint: endpoint.trim(),
        model: model.trim(),
        telemetryOptIn
      })
      onSaved(next as SettingsState)
      setMessage('Settings saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function saveKey() {
    const api = getApi()
    if (!api || busy || !apiKey.trim()) return
    setBusy(true)
    setMessage('')
    try {
      const status = await api.setApiKey(apiKey.trim())
      setApiKey('')
      onSaved({ ...(settings || {}), ...status } as SettingsState)
      setMessage('API key stored in the OS keychain.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function testConnection() {
    const api = getApi()
    if (!api || busy || testing) return
    setTesting(true)
    setMessage('Checking the configured provider...')
    try {
      const result = await api.diagnoseGateway?.() as GatewayDiagnosis | undefined
      if (!result) {
        setMessage('Connection diagnostics are unavailable in this build.')
      } else if (result.ok) {
        setMessage(`Connection OK · ${result.model} · ${result.latencyMs}ms`)
      } else {
        setMessage(`${result.message || 'Connection failed'}${result.statusCode ? ` (HTTP ${result.statusCode})` : ''}`)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setTesting(false)
    }
  }

  async function clearKey() {
    const api = getApi()
    if (!api || busy) return
    setBusy(true)
    setMessage('')
    try {
      const status = await api.clearApiKey()
      onSaved({ ...(settings || {}), ...status } as SettingsState)
      setMessage('Stored API key removed.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function viewTelemetry() {
    const api = getApi()
    if (!api || busy) return
    setBusy(true)
    setMessage('')
    try {
      const records = await api.getTelemetry()
      setTelemetryRecords(records || [])
      setShowTelemetry(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function clearTelemetryRecords() {
    const api = getApi()
    if (!api || busy) return
    setBusy(true)
    setMessage('')
    try {
      await api.clearTelemetry()
      setTelemetryRecords([])
      setMessage('Local diagnostics cleared.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" ref={dialogRef}>
        <div className="modal-head">
          <div>
            <div className="modal-title" id="settings-title">Model Settings</div>
            <div className="modal-sub">Configure an OpenAI-compatible endpoint. Keys stay in the OS keychain.</div>
          </div>
          <button className="modal-close" type="button" aria-label="Close settings" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="settings-grid">
            <label>
              <span className="label">Endpoint</span>
              <input
                ref={firstFieldRef}
                className="input"
                type="url"
                placeholder="https://api.example.com/v1"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                data-testid="settings-endpoint"
              />
            </label>
            <label>
              <span className="label">Model</span>
              <input
                className="input"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                data-testid="settings-model"
              />
            </label>
            <label>
              <span className="label">API key</span>
              <input
                className="input"
                type="password"
                autoComplete="off"
                placeholder={settings?.hasKey ? 'Stored — leave blank to keep' : 'sk-...'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                data-testid="settings-api-key"
              />
            </label>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={telemetryOptIn}
                onChange={(event) => setTelemetryOptIn(event.target.checked)}
                data-testid="settings-telemetry"
              />
              Enable local diagnostic telemetry (opt-in; never leaves this device)
            </label>
          </div>

          <div className="settings-status">
            <span className={`pill ${settings?.mode === 'offline-preview' ? 'pill-warn' : 'pill-ok'}`}>
              {settings?.mode === 'offline-preview' ? 'Offline Preview' : 'Live endpoint'}
            </span>
            <span className="pill">{settings?.hasKey ? 'API key stored' : 'No API key'}</span>
            <span className="pill">{settings?.canEncrypt ? 'Keychain available' : 'Keychain unavailable'}</span>
          </div>

          {message && <div className="settings-message" role="status">{message}</div>}

          <div className="settings-actions">
            <button className="btn" type="button" onClick={saveSettings} disabled={busy || testing} data-testid="settings-save">Save settings</button>
            <button className="btn secondary" type="button" onClick={saveKey} disabled={busy || testing || !settings?.canEncrypt || !apiKey.trim()} data-testid="settings-save-key">Store key</button>
            <button className="btn secondary" type="button" onClick={testConnection} disabled={busy || testing} data-testid="settings-test-connection">{testing ? 'Testing...' : 'Test connection'}</button>
            <button className="btn secondary" type="button" onClick={clearKey} disabled={busy || testing || !settings?.hasKey} data-testid="settings-clear-key">Clear key</button>
            <button className="btn secondary" type="button" onClick={viewTelemetry} disabled={busy || testing} data-testid="settings-view-telemetry">View diagnostics</button>
          </div>

          {showTelemetry && (
            <TelemetryViewer
              records={telemetryRecords}
              busy={busy}
              onRefresh={viewTelemetry}
              onClear={clearTelemetryRecords}
            />
          )}
        </div>
      </div>
    </div>
  )
}
