import React, { useEffect, useState } from 'react';
import { X, Zap, Shield, Sliders, AlertCircle, CheckCircle2, RotateCcw } from 'lucide-react';

export default function SyncModal({
  isOpen,
  initialTab = 'sync',
  settings,
  cacheStatus,
  onClose,
  onSyncCompleted,
  onSettingsSaved,
  onDemoReset,
}) {
  const [tab, setTab] = useState(initialTab);
  const [quickSingleCall, setQuickSingleCall] = useState(false);
  const [syncProfile, setSyncProfile] = useState('auto');
  const [pagesPerQuery, setPagesPerQuery] = useState('');
  const [zipOverride, setZipOverride] = useState(settings?.zip || '');
  const [stateOverride, setStateOverride] = useState(settings?.stateFilter || '');
  const [maxPriceOverride, setMaxPriceOverride] = useState('');
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [runningSync, setRunningSync] = useState(false);

  // Settings form state
  const [draftSettings, setDraftSettings] = useState(settings);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setDraftSettings(settings);
      setZipOverride(settings?.zip || '');
      setStateOverride(settings?.stateFilter || '');
    }
  }, [isOpen, initialTab, settings]);

  useEffect(() => {
    if (!isOpen || tab !== 'sync') return;
    let active = true;
    setLoadingPreview(true);
    fetch('/api/sync/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quickSingleCall,
        syncProfile,
        pagesPerQuery: pagesPerQuery ? Number(pagesPerQuery) : undefined,
        zip: zipOverride.trim(),
        state: stateOverride.trim().toUpperCase(),
        maxPrice: maxPriceOverride ? Number(maxPriceOverride) : undefined,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (active) setPreview(data);
      })
      .finally(() => {
        if (active) setLoadingPreview(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, tab, quickSingleCall, syncProfile, pagesPerQuery, zipOverride, stateOverride, maxPriceOverride]);

  if (!isOpen) return null;

  async function handleRunSync() {
    setRunningSync(true);
    try {
      const res = await fetch('/api/sync/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quickSingleCall,
          syncProfile,
          pagesPerQuery: pagesPerQuery ? Number(pagesPerQuery) : undefined,
          zip: zipOverride.trim(),
          state: stateOverride.trim().toUpperCase(),
          maxPrice: maxPriceOverride ? Number(maxPriceOverride) : undefined,
        }),
      });
      const result = await res.json();
      onSyncCompleted(result);
      onClose();
    } finally {
      setRunningSync(false);
    }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftSettings),
      });
      const data = await res.json();
      onSettingsSaved(data);
      setTab('sync');
    } finally {
      setSavingSettings(false);
    }
  }

  function togglePreset(presetId) {
    setDraftSettings((prev) => ({
      ...prev,
      watchlistPresets: prev.watchlistPresets.map((p) =>
        p.id === presetId ? { ...p, enabled: !p.enabled } : p
      ),
    }));
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>
              Sync Planner &amp; Quota Guardrails
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--ink-muted)' }}>
              Preview exact Auto.dev API call costs before syncing (previewing uses 0 calls).
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="tab-group" style={{ marginBottom: '18px' }}>
          <button
            type="button"
            className={`tab-btn ${tab === 'sync' ? 'active' : ''}`}
            onClick={() => setTab('sync')}
          >
            <Zap size={14} /> Pre-Sync Cost Preview
          </button>
          <button
            type="button"
            className={`tab-btn ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            <Sliders size={14} /> Cadence &amp; Presets
          </button>
        </div>

        {tab === 'sync' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                background: cacheStatus.liveApiConfigured ? 'var(--status-good-bg)' : 'var(--status-info-bg)',
                border: `1px solid ${cacheStatus.liveApiConfigured ? '#a7f3d0' : '#bae6fd'}`,
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              {cacheStatus.liveApiConfigured ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
              <div>
                {cacheStatus.liveApiConfigured ? (
                  <>
                    <strong>Live Auto.dev API Connected:</strong> Running sync will send real requests and count toward your 1,000/month Free Tier cap (stops early per preset if a page has &lt;20 results).
                  </>
                ) : (
                  <>
                    <strong>Demo Seed Mode Active:</strong> No <span className="mono">AUTODEV_API_KEY</span> detected in <span className="mono">.env</span>. Sync simulates fresh price drops using <strong>0 live API credits</strong>.
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', fontWeight: 600 }}>
                Sync Scope
                <select
                  className="select-control"
                  value={quickSingleCall ? 'quick' : 'presets'}
                  onChange={(e) => setQuickSingleCall(e.target.value === 'quick')}
                >
                  <option value="presets">Enabled Watchlist Presets</option>
                  <option value="quick">1-Call Quick Refresh (20 EVs)</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', fontWeight: 600 }}>
                Sync Profile
                <select
                  className="select-control"
                  value={syncProfile}
                  onChange={(e) => setSyncProfile(e.target.value)}
                >
                  <option value="auto">Auto (10p Day-1 → 3p Daily)</option>
                  <option value="backfill">Backfill (10 pages/preset)</option>
                  <option value="daily">Daily Delta (3p + updatedAt)</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', fontWeight: 600 }}>
                Pages Override (20/page)
                <select
                  className="select-control"
                  value={pagesPerQuery}
                  onChange={(e) => setPagesPerQuery(e.target.value)}
                >
                  <option value="">Profile default</option>
                  <option value="1">1 page / preset</option>
                  <option value="3">3 pages / preset</option>
                  <option value="5">5 pages / preset</option>
                  <option value="10">10 pages / preset</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', fontWeight: 600 }}>
                ZIP Filter (optional)
                <input
                  className="input-control"
                  placeholder="e.g. 94103"
                  value={zipOverride}
                  onChange={(e) => setZipOverride(e.target.value)}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', fontWeight: 600 }}>
                State Code (optional)
                <input
                  className="input-control"
                  placeholder="e.g. CA"
                  maxLength={2}
                  value={stateOverride}
                  onChange={(e) => setStateOverride(e.target.value.toUpperCase())}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', fontWeight: 600 }}>
                Max Price USD (optional)
                <input
                  className="input-control"
                  type="number"
                  placeholder="e.g. 45000"
                  value={maxPriceOverride}
                  onChange={(e) => setMaxPriceOverride(e.target.value)}
                />
              </label>
            </div>

            {loadingPreview || !preview ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--ink-muted)' }}>
                Calculating call cost...
              </div>
            ) : (
              <div
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  background: 'var(--bg-hover)',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--ink-muted)', fontWeight: 600 }}>CALLS THIS SYNC</div>
                    <div className="mono" style={{ fontSize: '20px', fontWeight: 700 }}>
                      {preview.mode === 'live' ? preview.callsPlanned : `0 live (${preview.callsPlanned} sim)`}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--ink-muted)', fontWeight: 600 }}>MAX EVs FETCHED</div>
                    <div className="mono" style={{ fontSize: '20px', fontWeight: 700 }}>
                      up to {preview.maxListingsExpected}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--ink-muted)', fontWeight: 600 }}>MONTH QUOTA AFTER</div>
                    <div className="mono" style={{ fontSize: '20px', fontWeight: 700 }}>
                      {preview.projectedUsedAfter} / {preview.quotaBefore.cap}
                    </div>
                  </div>
                </div>

                {preview.cappedBySyncLimit && (
                  <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--status-warn)' }}>
                    Capped at {preview.maxCallsPerSync} calls/sync by your safety limit ({preview.rawCallsRequested} requested).
                  </p>
                )}

                {preview.blockedReason && preview.mode === 'live' && (
                  <p style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--status-danger)', fontWeight: 600 }}>
                    Blocked: {preview.blockedReason}
                  </p>
                )}

                <div style={{ fontSize: '12px', color: 'var(--ink-secondary)' }}>
                  <strong>Planned queries:</strong>{' '}
                  {preview.queries.map((q) => `${q.presetLabel} (p${q.page})`).join(' · ') || 'None'}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  await onDemoReset();
                  onClose();
                }}
              >
                <RotateCcw size={14} /> Reset Demo Seed (0 calls)
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-ev"
                  disabled={runningSync || (preview?.mode === 'live' && Boolean(preview?.blockedReason))}
                  onClick={handleRunSync}
                >
                  <Zap size={15} />
                  {runningSync
                    ? 'Syncing...'
                    : preview?.mode === 'live'
                      ? `Run Live Sync (${preview?.callsPlanned || 0} calls)`
                      : 'Simulate Daily Sync (0 calls)'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', fontWeight: 600 }}>
                Auto-Refresh Cadence
                <select
                  className="select-control"
                  value={draftSettings.syncMode}
                  onChange={(e) => setDraftSettings({ ...draftSettings, syncMode: e.target.value })}
                >
                  <option value="daily_auto">Daily Snapshot (Auto-sync only if cache &gt; TTL)</option>
                  <option value="manual_only">Manual Sync Only (0 automatic calls on open)</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', fontWeight: 600 }}>
                Cache Freshness Window (Hours)
                <input
                  type="number"
                  min={1}
                  max={168}
                  className="input-control"
                  value={draftSettings.syncIntervalHours}
                  onChange={(e) =>
                    setDraftSettings({ ...draftSettings, syncIntervalHours: Number(e.target.value) })
                  }
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', fontWeight: 600 }}>
                Max API Calls Per Sync
                <input
                  type="number"
                  min={1}
                  max={20}
                  className="input-control"
                  value={draftSettings.maxCallsPerSync}
                  onChange={(e) =>
                    setDraftSettings({ ...draftSettings, maxCallsPerSync: Number(e.target.value) })
                  }
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px', fontWeight: 600 }}>
                Emergency Reserve Buffer (Calls)
                <input
                  type="number"
                  min={0}
                  max={500}
                  className="input-control"
                  value={draftSettings.reserveBuffer}
                  onChange={(e) =>
                    setDraftSettings({ ...draftSettings, reserveBuffer: Number(e.target.value) })
                  }
                />
              </label>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>
                <Shield size={14} style={{ color: 'var(--accent-ev)' }} />
                Consolidated EV Watchlist Presets (1 API call = up to 20 EVs)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {draftSettings.watchlistPresets.map((preset) => (
                  <label key={preset.id} className="preset-row" style={{ cursor: 'pointer' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>{preset.label}</div>
                      <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>{preset.description}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(preset.enabled)}
                      onChange={() => togglePreset(preset.id)}
                      style={{ marginTop: '3px', width: '16px', height: '16px', accentColor: '#0d9488' }}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Save Guardrails'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
