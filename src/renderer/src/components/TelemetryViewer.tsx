import type { TelemetryRecord } from '@shared/types'

export interface TelemetryViewerProps {
  records: TelemetryRecord[]
  onClear: () => void
  onRefresh: () => void
  busy?: boolean
}

export default function TelemetryViewer({ records, onClear, onRefresh, busy = false }: TelemetryViewerProps) {
  return (
    <section className="telemetry-panel" data-testid="telemetry-viewer" aria-label="Local diagnostics">
      <div className="telemetry-head">
        <div>
          <strong>Local diagnostics</strong>
          <div className="modal-sub">Opt-in, stored on this device only. No prompts, keys or slide text.</div>
        </div>
        <div className="telemetry-actions">
          <button className="btn secondary" type="button" onClick={onRefresh} disabled={busy} data-testid="telemetry-refresh">
            Refresh
          </button>
          <button className="btn secondary" type="button" onClick={onClear} disabled={busy || !records.length} data-testid="telemetry-clear">
            Clear
          </button>
        </div>
      </div>
      {records.length === 0 ? (
        <p className="telemetry-empty" data-testid="telemetry-empty">No diagnostic events recorded.</p>
      ) : (
        <ul className="telemetry-list" data-testid="telemetry-list">
          {records.slice(-50).reverse().map((record, index) => (
            <li key={`${record.ts}-${index}`} data-testid="telemetry-row">
              <span className="pill">{record.stage || record.message}</span>
              <span className="telemetry-meta">{record.status || record.level}</span>
              {typeof record.durationMs === 'number' && (
                <span className="telemetry-meta">{record.durationMs}ms</span>
              )}
              {record.correlationId && <span className="telemetry-id">{record.correlationId.slice(0, 8)}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
