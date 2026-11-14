import React, { useMemo, useState } from 'react';
import {
  Award,
  BatteryCharging,
  ChevronDown,
  ChevronUp,
  Filter,
  Gauge,
  MapPin,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Star,
} from 'lucide-react';
import {
  ALL_IONIQ5_TRIMS,
  IONIQ5_DIMENSIONS,
  RANKER_PROFILES,
  isLucidAirListing,
} from '../utils/evRanker.js';
import {
  formatCurrency,
  formatMiles,
  formatRelativeTime,
  getPriceDropAmount,
} from '../utils/formatters.js';

export default function TopPicksView({
  allListings,
  ioniq5Ranking,
  ioniq5Config,
  onUpdateIoniq5Config,
  onResetIoniq5Config,
  onSelectVin,
  onToggleStar,
}) {
  const [selectedProfile, setSelectedProfile] = useState('ioniq5');
  const [controlsOpen, setControlsOpen] = useState(true);
  const [showDisqualified, setShowDisqualified] = useState(false);

  const lucidCount = useMemo(
    () => (allListings || []).filter(isLucidAirListing).length,
    [allListings]
  );

  const {
    totalIoniq5,
    eligibleCount,
    disqualifiedCount,
    top5,
    ranked,
    disqualified,
    normalizedWeights,
    config,
  } = ioniq5Ranking;

  function handleWeightChange(dimKey, nextVal) {
    const val = Math.max(0, Math.min(100, Number(nextVal) || 0));
    onUpdateIoniq5Config({
      ...ioniq5Config,
      weights: {
        ...ioniq5Config.weights,
        [dimKey]: val,
      },
    });
  }

  function handleMaxPriceChange(val) {
    onUpdateIoniq5Config({
      ...ioniq5Config,
      maxPrice: val === '' || val === null ? null : Number(val),
    });
  }

  function handleToggleTrim(trimName) {
    const current = ioniq5Config.allowedTrims || [];
    const exists = current.includes(trimName);
    const next = exists ? current.filter((t) => t !== trimName) : [...current, trimName];
    if (next.length === 0) return; // keep at least one trim active
    onUpdateIoniq5Config({
      ...ioniq5Config,
      allowedTrims: next,
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Separate Profile Switcher: Ioniq 5 vs Lucid Air */}
      <div className="panel-card" style={{ padding: '14px 18px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Award size={18} style={{ color: 'var(--accent-ev)' }} />
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                EV Top 5 Ranking System
              </h2>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--ink-muted)' }}>
              Separated scoring profiles per vehicle model · 0 API calls (scored locally from cached listings)
            </p>
          </div>

          <div className="tab-group">
            {RANKER_PROFILES.map((profile) => {
              const countLabel =
                profile.id === 'ioniq5'
                  ? `${eligibleCount}/${totalIoniq5}`
                  : `${lucidCount} cached`;
              return (
                <button
                  key={profile.id}
                  type="button"
                  className={`tab-btn ${selectedProfile === profile.id ? 'active' : ''}`}
                  onClick={() => setSelectedProfile(profile.id)}
                >
                  <span>{profile.label}</span>
                  <span
                    className="mono"
                    style={{
                      fontSize: '11px',
                      padding: '1px 6px',
                      borderRadius: '999px',
                      background:
                        selectedProfile === profile.id ? 'var(--accent-ev-soft)' : 'var(--bg-hover)',
                      color:
                        selectedProfile === profile.id ? 'var(--accent-ev-dark)' : 'var(--ink-muted)',
                    }}
                  >
                    {countLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {selectedProfile === 'lucid_air' ? (
        <div className="panel-card" style={{ padding: '28px 24px', textAlign: 'center' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'var(--bg-subtle)',
              color: 'var(--ink-secondary)',
              display: 'inline-grid',
              placeItems: 'center',
              marginBottom: '12px',
            }}
          >
            <Sparkles size={20} />
          </div>
          <h3 style={{ margin: '0 0 6px', fontSize: '17px', fontWeight: 700 }}>
            Lucid Air Ranking System — Ready to Configure
          </h3>
          <p
            style={{
              margin: '0 auto 14px',
              maxWidth: '540px',
              fontSize: '13px',
              color: 'var(--ink-secondary)',
            }}
          >
            You currently have <strong className="mono">{lucidCount}</strong> Lucid Air listings cached.
            Its ranking profile is kept separate from the Hyundai Ioniq 5 so it can use Lucid-specific
            dimensions (e.g., Pure vs Touring vs Grand Touring, DreamDrive Pro/Premium, EPA range, price,
            mileage, and warranty).
          </p>
          <span className="status-pill cache">
            Tell me your Lucid Air dimension order &amp; dealbreakers when ready to activate
          </span>
        </div>
      ) : (
        <>
          {/* Weights & Dealbreakers Controls */}
          <section className="panel-card" aria-label="Ioniq 5 Ranking Controls">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <SlidersHorizontal size={16} style={{ color: 'var(--accent-ev)' }} />
                <span style={{ fontWeight: 700, fontSize: '14px' }}>
                  Ioniq 5 Weights &amp; Dealbreakers
                </span>
                <span className="status-pill cache" style={{ fontSize: '11px' }}>
                  {eligibleCount} eligible · {disqualifiedCount} disqualified
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={onResetIoniq5Config}
                  title="Reset weights and dealbreakers to your default preferences"
                >
                  <RotateCcw size={13} /> Reset Defaults
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setControlsOpen((v) => !v)}
                >
                  {controlsOpen ? (
                    <>
                      <ChevronUp size={14} /> Hide Controls
                    </>
                  ) : (
                    <>
                      <ChevronDown size={14} /> Tune Weights
                    </>
                  )}
                </button>
              </div>
            </div>

            {controlsOpen && (
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Dealbreakers Row */}
                <div className="ranker-dealbreakers">
                  <div className="ranker-control-group">
                    <label className="ranker-label" htmlFor="ranker-max-price">
                      <Filter size={12} /> Max Price Dealbreaker
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <select
                        id="ranker-max-price"
                        className="select-control"
                        style={{ width: '160px', height: '32px' }}
                        value={config.maxPrice == null ? '' : String(config.maxPrice)}
                        onChange={(e) => handleMaxPriceChange(e.target.value)}
                      >
                        <option value="35000">$35,000 max</option>
                        <option value="40000">$40,000 max</option>
                        <option value="45000">$45,000 max (Default)</option>
                        <option value="50000">$50,000 max</option>
                        <option value="">No Price Cap</option>
                      </select>
                      {[40000, 45000, 50000].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className={`filter-chip ${config.maxPrice === preset ? 'active-ev' : ''}`}
                          onClick={() => handleMaxPriceChange(preset)}
                        >
                          ≤ ${(preset / 1000).toFixed(0)}k
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ranker-control-group">
                    <span className="ranker-label">Allowed Trims (Disqualifies Unchecked)</span>
                    <div className="chip-group">
                      {ALL_IONIQ5_TRIMS.map((trimName) => {
                        const active = config.allowedTrims.includes(trimName);
                        return (
                          <button
                            key={trimName}
                            type="button"
                            className={`filter-chip ${active ? 'active-ev' : ''}`}
                            onClick={() => handleToggleTrim(trimName)}
                          >
                            {trimName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 6 Dimension Weight Sliders */}
                <div className="ranker-sliders-grid">
                  {IONIQ5_DIMENSIONS.map((dim) => {
                    const rawVal = ioniq5Config.weights?.[dim.key] ?? 0;
                    const normPct = normalizedWeights[dim.key] ?? 0;
                    return (
                      <div key={dim.key} className="ranker-slider-card">
                        <div className="ranker-slider-header">
                          <div>
                            <span className="ranker-dim-rank">#{dim.rank}</span>
                            <span style={{ fontWeight: 700, fontSize: '13px' }}>{dim.label}</span>
                          </div>
                          <span
                            className="mono"
                            style={{
                              fontSize: '12px',
                              fontWeight: 700,
                              color: dim.color,
                            }}
                          >
                            {normPct.toFixed(0)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={60}
                          step={1}
                          value={rawVal}
                          aria-label={`${dim.label} weight`}
                          onChange={(e) => handleWeightChange(dim.key, e.target.value)}
                          style={{ width: '100%', accentColor: dim.color, cursor: 'pointer' }}
                        />
                        <div style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
                          {dim.description}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Top 5 Picks Cards */}
          <section aria-label="Top 5 Ioniq 5 Picks">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
                  Top 5 Ioniq 5 Picks
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--ink-muted)' }}>
                  Ranked out of {eligibleCount} eligible SEL &amp; Limited listings · click any pick for full details &amp; score breakdown
                </p>
              </div>
            </div>

            {top5.length === 0 ? (
              <div className="empty-state">
                <p style={{ margin: '0 0 10px', fontWeight: 600, color: 'var(--ink-primary)' }}>
                  No Ioniq 5 listings passed your current dealbreakers.
                </p>
                <button type="button" className="btn btn-sm" onClick={onResetIoniq5Config}>
                  Reset Dealbreakers
                </button>
              </div>
            ) : (
              <div className="top5-grid">
                {top5.map((item) => {
                  const drop = getPriceDropAmount(item);
                  const isFirst = item.rank === 1;
                  return (
                    <article
                      key={item.vin}
                      className={`listing-card top5-card ${isFirst ? 'top5-first' : ''}`}
                      onClick={() => onSelectVin(item.vin)}
                    >
                      <div className="card-media">
                        <img
                          src={
                            item.primary_image?.startsWith('/images/')
                              ? `.${item.primary_image}`
                              : item.primary_image || './images/ev_suv_emerald.jpg'
                          }
                          alt={`${item.year} ${item.make} ${item.model}`}
                          loading="lazy"
                          onError={(e) => {
                            if (e.currentTarget.dataset.fallbackApplied) return;
                            e.currentTarget.dataset.fallbackApplied = '1';
                            e.currentTarget.src = './images/ev_suv_emerald.jpg';
                          }}
                        />
                        <div className="card-badges">
                          <span className={`badge ${isFirst ? 'badge-rank-1' : 'badge-rank'}`}>
                            #{item.rank} {isFirst ? 'TOP PICK' : 'PICK'}
                          </span>
                          <span className="badge badge-score mono">
                            {item.score.toFixed(1)} / 100
                          </span>
                          <span className="badge badge-cond">{item.condition}</span>
                          {drop > 0 && (
                            <span className="badge badge-drop">-{formatCurrency(drop)}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          className={`star-btn ${item.is_starred ? 'starred' : ''}`}
                          onClick={(e) => onToggleStar(item, e)}
                          aria-label={item.is_starred ? 'Unstar EV' : 'Star EV'}
                        >
                          <Star size={15} fill={item.is_starred ? '#d97706' : 'none'} />
                        </button>
                      </div>

                      <div className="card-body">
                        <div className="card-top-row">
                          <div>
                            <h3 className="card-title">
                              {item.year} {item.make} {item.model}
                            </h3>
                            <p className="card-trim">
                              <strong>{item.normTrim}</strong> · {item.normDrivetrain} ·{' '}
                              <span style={{ color: 'var(--status-info)', fontWeight: 600 }}>
                                {item.epaRange} mi EPA
                              </span>
                            </p>
                          </div>
                          <div className="card-price-block">
                            <div className="card-price">{formatCurrency(item.price)}</div>
                            {drop > 0 && (
                              <div className="card-prev-price">
                                {formatCurrency(item.previous_price)}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="card-specs">
                          <span className="spec-item">
                            <Gauge size={13} /> {formatMiles(item.miles)}
                          </span>
                          <span className="spec-item">
                            <MapPin size={13} /> {item.city}, {item.state}
                          </span>
                          <span className="spec-item">
                            <BatteryCharging size={13} /> {item.epaRange} mi
                          </span>
                        </div>

                        {/* Compact 6-dimension visual breakdown */}
                        <div className="score-mini-breakdown">
                          {IONIQ5_DIMENSIONS.map((dim) => {
                            const b = item.breakdown[dim.key];
                            return (
                              <div key={dim.key} className="score-mini-row">
                                <span className="score-mini-label">{dim.label}</span>
                                <div className="score-mini-track">
                                  <div
                                    className="score-mini-fill"
                                    style={{
                                      width: `${Math.max(4, b.subScore)}%`,
                                      background: dim.color,
                                    }}
                                  />
                                </div>
                                <span className="score-mini-val mono">
                                  +{b.contribution.toFixed(1)}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        <div className="card-footer">
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '185px',
                            }}
                          >
                            {item.dealer || 'Dealer Listing'}
                          </span>
                          <span className="mono" style={{ fontSize: '11px' }}>
                            {item.vin.slice(-6)} · {formatRelativeTime(item.updated_at)}
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Full Ranked Leaderboard */}
          {ranked.length > 0 && (
            <section className="table-card" aria-label="Full Ioniq 5 Ranked Table">
              <div
                style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>
                    Full Eligible Leaderboard ({ranked.length})
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--ink-muted)' }}>
                    All eligible SEL &amp; Limited Ioniq 5s ranked from #1 to #{ranked.length}
                  </p>
                </div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Score</th>
                    <th>Vehicle</th>
                    <th>Trim / Drive</th>
                    <th>EPA Range</th>
                    <th>Price</th>
                    <th>Mileage</th>
                    <th>Condition</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((item) => (
                    <tr
                      key={item.vin}
                      onClick={() => onSelectVin(item.vin)}
                      style={item.isTop5 ? { background: 'rgba(13, 148, 136, 0.04)' } : undefined}
                    >
                      <td>
                        <span
                          className={`badge ${
                            item.rank === 1
                              ? 'badge-rank-1'
                              : item.isTop5
                                ? 'badge-rank'
                                : 'badge-cond'
                          }`}
                        >
                          #{item.rank}
                        </span>
                      </td>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--accent-ev-dark)' }}>
                        {item.score.toFixed(1)}
                      </td>
                      <td>
                        <div style={{ fontWeight: 700 }}>
                          {item.year} {item.make} {item.model}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
                          {item.dealer} · <span className="mono">{item.vin.slice(-6)}</span>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{item.normTrim}</span>{' '}
                        <span className="mono" style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
                          {item.normDrivetrain}
                        </span>
                      </td>
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {item.epaRange} mi
                      </td>
                      <td className="mono" style={{ fontWeight: 700 }}>
                        {formatCurrency(item.price)}
                      </td>
                      <td className="mono">{formatMiles(item.miles)}</td>
                      <td>
                        <span className="badge badge-cond">{item.condition}</span>
                      </td>
                      <td>
                        {item.city}, {item.state}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Disqualified Audit Accordion */}
          {disqualified.length > 0 && (
            <section className="panel-card" style={{ padding: '14px 18px' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', justifyContent: 'space-between', padding: '4px 2px' }}
                onClick={() => setShowDisqualified((v) => !v)}
              >
                <span style={{ fontWeight: 700, fontSize: '13px' }}>
                  Disqualified Ioniq 5 Listings ({disqualified.length})
                </span>
                {showDisqualified ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>

              {showDisqualified && (
                <div style={{ marginTop: '12px', overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Vehicle</th>
                        <th>Trim / Drive</th>
                        <th>Price</th>
                        <th>Mileage</th>
                        <th>Disqualification Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {disqualified.map((item) => (
                        <tr key={item.vin} onClick={() => onSelectVin(item.vin)}>
                          <td>
                            <div style={{ fontWeight: 600 }}>
                              {item.year} {item.make} {item.model}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
                              {item.city}, {item.state} · <span className="mono">{item.vin.slice(-6)}</span>
                            </div>
                          </td>
                          <td>
                            {item.normTrim} · <span className="mono">{item.normDrivetrain}</span>
                          </td>
                          <td className="mono">{formatCurrency(item.price)}</td>
                          <td className="mono">{formatMiles(item.miles)}</td>
                          <td style={{ color: 'var(--status-danger)', fontSize: '12px', fontWeight: 600 }}>
                            {item.disqualifyReasons.join(' · ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
