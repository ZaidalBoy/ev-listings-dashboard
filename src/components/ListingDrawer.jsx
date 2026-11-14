import React, { useEffect, useState } from 'react';
import { X, Star, ExternalLink, RefreshCw, MapPin, Gauge, Palette, Building2, Check } from 'lucide-react';
import { formatCurrency, formatMiles, formatRelativeTime, getPriceDropAmount } from '../utils/formatters.js';

export default function ListingDrawer({
  listing,
  liveApiConfigured,
  onClose,
  onToggleStar,
  onSaveNotes,
  onRefreshVin,
}) {
  const [notes, setNotes] = useState(listing?.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [savedFlag, setSavedFlag] = useState(false);
  const [refreshingVin, setRefreshingVin] = useState(false);

  useEffect(() => {
    setNotes(listing?.notes || '');
    setSavedFlag(false);
  }, [listing]);

  if (!listing) return null;

  const drop = getPriceDropAmount(listing);

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span className="badge badge-cond">{listing.condition}</span>
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
          <button
            type="button"
            className="btn"
            disabled={!liveApiConfigured || refreshingVin}
            onClick={handleVerifyLive}
            title={
              liveApiConfigured
                ? 'Fetches GET /listings/{vin} directly from Auto.dev'
                : 'Add AUTODEV_API_KEY in .env to verify live VIN pricing'
            }
          >
            <RefreshCw size={14} className={refreshingVin ? 'spin' : ''} />
            {refreshingVin
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
