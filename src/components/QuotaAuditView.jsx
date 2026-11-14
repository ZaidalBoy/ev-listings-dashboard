import React from 'react';
import { ShieldCheck, Activity, Database, Clock, AlertTriangle } from 'lucide-react';
import { formatRelativeTime } from '../utils/formatters.js';

export default function QuotaAuditView({ quota, settings, snapshots, recentCalls, cacheStatus, onOpenSyncModal }) {
  const reservePct = Math.max(0, Math.min(100, ((quota.cap - quota.reserveBuffer) / quota.cap) * 100));
  const usedPct = Math.min(100, quota.pctUsed);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="audit-grid">
        <div className="panel-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
            <div>
              <h2 className="panel-title">Monthly Free-Tier Budget ({quota.monthKey})</h2>
              <p className="panel-sub">
                Hard cap: {quota.cap.toLocaleString()} calls/month · Emergency reserve: {quota.reserveBuffer} calls
              </p>
            </div>
            <button className="btn btn-sm" onClick={() => onOpenSyncModal('settings')}>
              Configure Guardrails
            </button>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
              <span>
                <strong className="mono">{quota.used}</strong> / {quota.cap} calls used ({quota.pctUsed}%)
              </span>
              <span style={{ color: 'var(--ink-muted)' }}>
                <strong className="mono">{quota.remaining}</strong> remaining
              </span>
            </div>
            <div className="quota-bar-track" style={{ height: '12px' }}>
              <div
                className={`quota-bar-fill ${usedPct >= 90 ? 'danger' : usedPct >= 75 ? 'warn' : ''}`}
                style={{ width: `${usedPct}%` }}
              />
              <div
                className="quota-reserve-marker"
                style={{ left: `${reservePct}%` }}
                title={`Auto-sync stops at ${quota.cap - quota.reserveBuffer} calls (${quota.reserveBuffer} reserve)`}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--ink-muted)', marginTop: '6px' }}>
              <span>Auto-sync budget left: <strong className="mono">{quota.autoSyncBudgetRemaining}</strong></span>
              <span>Reserve threshold: {quota.cap - quota.reserveBuffer} calls</span>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '10px',
              paddingTop: '12px',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', color: 'var(--ink-muted)', fontWeight: 600 }}>DAILY BURN</div>
              <div className="mono" style={{ fontSize: '16px', fontWeight: 700 }}>{quota.dailyBurnRate}/day</div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--ink-muted)', fontWeight: 600 }}>MONTH-END PROJ.</div>
              <div
                className="mono"
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: quota.projectedMonthEnd > quota.cap ? 'var(--status-danger)' : 'var(--status-good)',
                }}
              >
                {quota.projectedMonthEnd} / {quota.cap}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--ink-muted)', fontWeight: 600 }}>SAFE DAILY BUDGET</div>
              <div className="mono" style={{ fontSize: '16px', fontWeight: 700 }}>{quota.safeDailyBudget}/day</div>
            </div>
          </div>
        </div>

        <div className="panel-card">
          <h2 className="panel-title">API Call Preservation Architecture (v1)</h2>
          <p className="panel-sub">How this dashboard protects your 1,000 calls/month limit</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <Database size={16} style={{ color: 'var(--accent-ev)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Zero-Call Page Loads & Filtering:</strong> Opening, reloading, sorting, and searching read exclusively from local SQLite (<span className="mono">ev_dashboard.db</span>).
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <Clock size={16} style={{ color: 'var(--accent-ev)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>{settings.syncIntervalHours}h Snapshot TTL + Single-Flight Lock:</strong> Mode is <span className="mono">{settings.syncMode === 'daily_auto' ? 'Daily Auto (24h)' : 'Manual Only'}</span>. Cache age: {formatRelativeTime(cacheStatus.lastAutoSyncAt)}.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <ShieldCheck size={16} style={{ color: 'var(--accent-ev)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Consolidated OR Queries & Max-20 Cap:</strong> Combines EV makes/models via comma syntax (<span className="mono">limit=20</span> per Free tier) so 3 calls fetch up to 60 EVs/day (~90 calls/mo).
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <AlertTriangle size={16} style={{ color: 'var(--status-warn)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>300ms Rate Limiter & {settings.reserveBuffer}-Call Reserve:</strong> Throttles below 5 req/sec and halts automated syncs before exhausting manual VIN verification credits.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <h2 className="panel-title">Snapshot History</h2>
        <p className="panel-sub">Daily and manual sync runs persisted in SQLite</p>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Trigger</th>
                <th>Mode</th>
                <th>API Calls</th>
                <th>Fetched</th>
                <th>New</th>
                <th>Price Drops</th>
                <th>Status</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.id} style={{ cursor: 'default' }}>
                  <td className="mono" style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                    {formatRelativeTime(s.started_at)}
                  </td>
                  <td><span className="mono">{s.trigger_type}</span></td>
                  <td>
                    <span
                      className={`status-pill ${
                        s.mode === 'live' ? 'live' : s.mode === 'lucid_direct' ? 'cache' : 'demo'
                      }`}
                    >
                      {s.mode === 'lucid_direct' ? 'LUCID DIRECT' : s.mode.toUpperCase()}
                    </span>
                  </td>
                  <td className="mono" style={{ fontWeight: 700 }}>{s.calls_used}</td>
                  <td className="mono">{s.listings_fetched}</td>
                  <td className="mono" style={{ color: s.new_listings > 0 ? 'var(--accent-ev-dark)' : 'inherit' }}>
                    +{s.new_listings}
                  </td>
                  <td className="mono" style={{ color: s.price_drops > 0 ? 'var(--status-good)' : 'inherit' }}>
                    {s.price_drops}
                  </td>
                  <td><span className="mono">{s.status}</span></td>
                  <td style={{ color: 'var(--ink-secondary)', maxWidth: '340px' }}>
                    {s.error_message || s.query_summary}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <Activity size={16} style={{ color: 'var(--accent-ev)' }} />
          <h2 className="panel-title" style={{ margin: 0 }}>API Call Audit Log</h2>
        </div>
        <p className="panel-sub">Every request sent to Auto.dev (plus 0-cost demo seed markers)</p>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Endpoint</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Rows</th>
                <th>Quota Counted</th>
                <th>Query Params</th>
              </tr>
            </thead>
            <tbody>
              {recentCalls.map((c) => (
                <tr key={c.id} style={{ cursor: 'default' }}>
                  <td className="mono" style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
                    {formatRelativeTime(c.called_at)}
                  </td>
                  <td className="mono">{c.endpoint}</td>
                  <td className="mono">{c.trigger_type}</td>
                  <td className="mono">{c.status_code}</td>
                  <td className="mono">{c.latency_ms}ms</td>
                  <td className="mono">{c.rows_returned}</td>
                  <td>
                    {c.counted_against_quota ? (
                      <span className="badge badge-cond">1 call</span>
                    ) : (
                      <span className="status-pill">0 (Demo)</span>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: '11px', color: 'var(--ink-muted)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.query_params || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
