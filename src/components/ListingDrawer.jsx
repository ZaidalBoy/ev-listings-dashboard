import React, { useEffect, useMemo, useState } from 'react';
import { X, Star, ExternalLink, RefreshCw, MapPin, Gauge, Palette, Building2, Check, Award, EyeOff, RotateCcw, Calculator } from 'lucide-react';
import { formatCurrency, formatMiles, formatRelativeTime, getPriceDropAmount } from '../utils/formatters.js';
import { IONIQ5_DIMENSIONS } from '../utils/evRanker.js';
import { estimateListingMsrp } from '../utils/msrpEstimator.js';

export default function ListingDrawer({
  listing,
  rankingInfo,
  liveApiConfigured,
  onClose,
  onToggleStar,
  onToggleSold,
  onSaveNotes,
  onRefreshVin,
}) {
  const [notes, setNotes] = useState(listing?.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [savedFlag, setSavedFlag] = useState(false);
  const [refreshingVin, setRefreshingVin] = useState(false);
  const [includeDestination, setIncludeDestination] = useState(true);
  const [customOptionsMsrp, setCustomOptionsMsrp] = useState(0);

  useEffect(() => {
    setNotes(listing?.notes || '');
    setSavedFlag(false);
    setIncludeDestination(true);
    setCustomOptionsMsrp(0);
  }, [listing]);

  const msrpCalc = useMemo(
    () =>
      listing
        ? estimateListingMsrp(listing, {
            includeDestination,
            includeKnownAdas: true,
            customOptionsMsrp,
          })
        : null,
    [listing, includeDestination, customOptionsMsrp]
  );

  if (!listing) return null;

  const drop = getPriceDropAmount(listing);
  const isSold = Boolean(listing.removed_at);

  async function handleSaveNotes() {
    setSavingNotes(true);
    try {
      await onSaveNotes(listing.vin, notes);
      setSavedFlag(true);
      setTimeout(() => setSavedFlag(false), 1800);
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleVerifyLive() {
    setRefreshingVin(true);
    try {
      await onRefreshVin(listing.vin);
    } finally {
      setRefreshingVin(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
              <span className="badge badge-cond">{listing.condition}</span>
              {isSold && <span className="badge badge-sold">SOLD / REMOVED</span>}
              <span className="mono" style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                VIN: {listing.vin}
              </span>
            </div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>
              {listing.year} {listing.make} {listing.model}
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: 'var(--ink-secondary)' }}>
              {listing.trim || 'Standard EV Trim'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              className="btn btn-sm"
              onClick={() => onToggleStar(listing)}
              title={listing.is_starred ? 'Remove from watchlist' : 'Star EV'}
            >
              <Star
                size={15}
                fill={listing.is_starred ? '#d97706' : 'none'}
                color={listing.is_starred ? '#d97706' : 'currentColor'}
              />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close drawer">
              <X size={18} />
            </button>
          </div>
        </div>

        {isSold && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>Marked Sold / Removed {formatRelativeTime(listing.removed_at)}</span>
            {onToggleSold && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onToggleSold(listing)}
              >
                <RotateCcw size={13} /> Restore
              </button>
            )}
          </div>
        )}

        <div className="card-media" style={{ borderRadius: 'var(--radius-md)' }}>
          <img
            src={
              listing.primary_image?.startsWith('/images/')
                ? `.${listing.primary_image}`
                : listing.primary_image || './images/ev_suv_emerald.jpg'
            }
            alt={`${listing.year} ${listing.make} ${listing.model}`}
            onError={(e) => {
              if (e.currentTarget.dataset.fallbackApplied) return;
              e.currentTarget.dataset.fallbackApplied = '1';
              e.currentTarget.src =
                listing.make === 'Lucid'
                  ? './images/ev_sedan_silver.jpg'
                  : './images/ev_suv_emerald.jpg';
            }}
          />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-hover)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
              Listed Price
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '24px', fontWeight: 700 }}>{formatCurrency(listing.price)}</span>
              {drop > 0 && (
                <span className="badge badge-drop">-{formatCurrency(drop)}</span>
              )}
            </div>
            {listing.previous_price && listing.previous_price !== listing.price && (
              <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                Previously {formatCurrency(listing.previous_price)}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--ink-muted)' }}>
            <div>Cached {formatRelativeTime(listing.last_seen_at)}</div>
            <div>Source: <span className="mono">{listing.source}</span></div>
          </div>
        </div>

        {msrpCalc?.effectiveMsrp && (
          <div className="msrp-calc-card" aria-label="MSRP Savings Calculator">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
                <Calculator size={14} style={{ color: 'var(--status-good)' }} />
                <span>Savings vs. Original MSRP</span>
                <span className="status-pill cache" style={{ fontSize: '10px', padding: '1px 6px' }}>
                  {msrpCalc.msrpSource === 'autodev_base' ? 'Auto.dev Base' : 'Trim Lookup'}
                </span>
              </div>
              <div
                className="mono"
                style={{
                  fontSize: '15px',
                  fontWeight: 800,
                  color: (msrpCalc.savingsAmount ?? 0) > 0 ? 'var(--status-good)' : 'var(--ink-secondary)',
                }}
              >
                {(msrpCalc.savingsAmount ?? 0) > 0
                  ? `-${formatCurrency(msrpCalc.savingsAmount)} (${msrpCalc.savingsPct.toFixed(1)}% off)`
                  : msrpCalc.savingsAmount != null
                    ? `+${formatCurrency(Math.abs(msrpCalc.savingsAmount))} vs MSRP`
                    : '—'}
              </div>
            </div>

            <div className="msrp-calc-grid">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                <span style={{ color: 'var(--ink-muted)' }}>Base MSRP</span>
                <strong className="mono">{formatCurrency(msrpCalc.baseMsrp)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                <span style={{ color: 'var(--ink-muted)' }}>Est. Sticker</span>
                <strong className="mono">{formatCurrency(msrpCalc.effectiveMsrp)}</strong>
              </div>
              {msrpCalc.knownAdasLabel && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', gridColumn: '1 / -1' }}>
                  <span style={{ color: 'var(--ink-muted)' }}>ADAS ({msrpCalc.knownAdasLabel})</span>
                  <strong className="mono">
                    {msrpCalc.knownAdasMsrp > 0 ? `+${formatCurrency(msrpCalc.knownAdasMsrp)}` : 'Included'}
                  </strong>
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                paddingTop: '8px',
                borderTop: '1px solid var(--border-subtle)',
                fontSize: '12px',
              }}
            >
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={includeDestination}
                  onChange={(e) => setIncludeDestination(e.target.checked)}
                />
                <span>Dest. (+{formatCurrency(msrpCalc.destinationMsrp)})</span>
              </label>

              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ color: 'var(--ink-muted)' }}>Added options $</span>
                <input
                  type="number"
                  min={0}
                  step={500}
                  className="input-control mono"
                  style={{ width: '82px', height: '26px', padding: '2px 6px', fontSize: '12px' }}
                  value={customOptionsMsrp}
                  onChange={(e) => setCustomOptionsMsrp(Math.max(0, Number(e.target.value) || 0))}
                  aria-label="Added factory options USD"
                />
                {[0, 2900, 6000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`filter-chip ${customOptionsMsrp === preset ? 'active-ev' : ''}`}
                    style={{ padding: '2px 6px', fontSize: '10px' }}
                    onClick={() => setCustomOptionsMsrp(preset)}
                  >
                    {preset === 0 ? '$0' : `+$${(preset / 1000).toFixed(preset % 1000 === 0 ? 0 : 1)}k`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '13px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Gauge size={15} style={{ color: 'var(--ink-muted)' }} />
            <span><strong>Mileage:</strong> {formatMiles(listing.miles)}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <MapPin size={15} style={{ color: 'var(--ink-muted)' }} />
            <span><strong>Location:</strong> {listing.city}, {listing.state} {listing.zip}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Palette size={15} style={{ color: 'var(--ink-muted)' }} />
            <span><strong>Exterior:</strong> {listing.exterior_color || '—'}</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Building2 size={15} style={{ color: 'var(--ink-muted)' }} />
            <span><strong>Dealer:</strong> {listing.dealer || '—'}</span>
          </div>
        </div>

        {rankingInfo && (
          <div
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
              background: rankingInfo.eligible ? 'var(--accent-ev-soft)' : 'var(--status-danger-bg)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                marginBottom: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700 }}>
                <Award size={14} style={{ color: rankingInfo.eligible ? 'var(--accent-ev-dark)' : 'var(--status-danger)' }} />
                <span>Ioniq 5 Ranker Assessment</span>
              </div>
              {rankingInfo.eligible ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className={`badge ${rankingInfo.rank === 1 ? 'badge-rank-1' : rankingInfo.isTop5 ? 'badge-rank' : 'badge-cond'}`}>
                    #{rankingInfo.rank}
                  </span>
                  <span className="badge badge-score mono">{rankingInfo.score.toFixed(1)} / 100</span>
                </div>
              ) : (
                <span className="badge" style={{ background: 'var(--status-danger)', color: '#fff' }}>
                  Disqualified
                </span>
              )}
            </div>

            {rankingInfo.eligible ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '11px', color: 'var(--ink-secondary)', marginBottom: '2px' }}>
                  Est. EPA Range: <strong className="mono">{rankingInfo.epaRange} mi</strong> ({rankingInfo.normTrim} · {rankingInfo.normDrivetrain})
                </div>
                {IONIQ5_DIMENSIONS.map((dim) => {
                  const b = rankingInfo.breakdown[dim.key];
                  return (
                    <div key={dim.key} className="score-mini-row">
                      <span className="score-mini-label" style={{ width: '92px' }}>
                        {dim.label} ({b.weightPct.toFixed(0)}%)
                      </span>
                      <div className="score-mini-track">
                        <div
                          className="score-mini-fill"
                          style={{
                            width: `${Math.max(4, b.subScore)}%`,
                            background: dim.color,
                          }}
                        />
                      </div>
                      <span className="score-mini-val mono" style={{ width: '62px' }}>
                        +{b.contribution.toFixed(1)} pts
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--status-danger)', fontWeight: 600 }}>
                {rankingInfo.disqualifyReasons.join(' · ')}
              </div>
            )}
          </div>
        )}

        {Array.isArray(listing.price_history) && listing.price_history.length > 0 && (
          <div
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 14px',
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>
              Snapshot Price History ({listing.price_history.length} observations)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {listing.price_history.map((pt, idx) => (
                <div
                  key={`${pt.recordedAt}-${idx}`}
                  style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}
                >
                  <span style={{ color: 'var(--ink-muted)' }}>{formatRelativeTime(pt.recordedAt)}</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{formatCurrency(pt.price)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '12px', fontWeight: 700 }}>
            Personal Notes (saved locally · 0 API calls)
          </label>
          <textarea
            rows={3}
            className="input-control"
            style={{ height: 'auto', padding: '8px 10px', resize: 'vertical' }}
            placeholder="Battery check, dealer fee notes, target offer price..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-sm"
              disabled={savingNotes}
              onClick={handleSaveNotes}
            >
              {savedFlag ? (
                <>
                  <Check size={14} /> Saved Locally
                </>
              ) : savingNotes ? (
                'Saving...'
              ) : (
                'Save Note'
              )}
            </button>
          </div>
        </div>

        <div
          style={{
            marginTop: 'auto',
            paddingTop: '14px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {onToggleSold && (
            <button
              type="button"
              className="btn"
              onClick={() => onToggleSold(listing)}
              title={
                isSold
                  ? 'Restore this listing to active inventory (0 API calls)'
                  : 'Hide this listing and preserve notes/price history (0 API calls)'
              }
            >
              {isSold ? <RotateCcw size={14} /> : <EyeOff size={14} />}
              {isSold ? 'Restore to Active Inventory (0 API Calls)' : 'Mark Sold / Hide (0 API Calls)'}
            </button>
          )}

          <button
            type="button"
            className="btn"
            disabled={!liveApiConfigured || refreshingVin || listing.source === 'lucid_direct'}
            onClick={handleVerifyLive}
            title={
              listing.source === 'lucid_direct'
                ? 'Lucid Direct imports do not use Auto.dev VIN lookups (0 API calls)'
                : liveApiConfigured
                  ? 'Fetches GET /listings/{vin} directly from Auto.dev'
                  : 'Add AUTODEV_API_KEY in .env to verify live VIN pricing'
            }
          >
            <RefreshCw size={14} className={refreshingVin ? 'spin' : ''} />
            {listing.source === 'lucid_direct'
              ? 'Lucid Direct Import (0 API Calls)'
              : refreshingVin
                ? 'Verifying VIN...'
                : liveApiConfigured
                  ? 'Verify Live Price (Costs 1 API Call)'
                  : 'Verify Live Price (Requires AUTODEV_API_KEY)'}
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            {listing.vdp_url && (
              <a
                href={listing.vdp_url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-primary"
                style={{ flex: 1, textDecoration: 'none' }}
              >
                Dealer Listing <ExternalLink size={14} />
              </a>
            )}
            {listing.carfax_url && (
              <a
                href={listing.carfax_url}
                target="_blank"
                rel="noreferrer"
                className="btn"
                style={{ textDecoration: 'none' }}
              >
                Carfax <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
