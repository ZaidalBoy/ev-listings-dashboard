import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Zap,
  Search,
  SlidersHorizontal,
  RefreshCw,
  Database,
  TrendingDown,
  Sparkles,
  Star,
  LayoutGrid,
  List,
  ShieldCheck,
  MapPin,
  Gauge,
  Activity,
  Upload,
  Award,
  EyeOff,
  RotateCcw,
} from 'lucide-react';
import QuotaAuditView from './components/QuotaAuditView.jsx';
import TopPicksView from './components/TopPicksView.jsx';
import SyncModal from './components/SyncModal.jsx';
import ListingDrawer from './components/ListingDrawer.jsx';
import {
  formatCurrency,
  formatMiles,
  formatRelativeTime,
  getPriceDropAmount,
  isNewToday,
} from './utils/formatters.js';
import {
  findMatchingExistingLucid,
  parseLucidMhtml,
} from './utils/lucidMhtmlParser.js';
import {
  RANKER_STORAGE_KEY,
  cloneDefaultIoniq5Config,
  rankIoniq5Listings,
  sanitizeIoniq5Config,
} from './utils/evRanker.js';
import { estimateListingMsrp } from './utils/msrpEstimator.js';

const IS_STATIC_BUILD = import.meta.env.VITE_STATIC_MODE === 'true';
const STATIC_BUILD_ID = import.meta.env.VITE_BUILD_ID || '';
const STATIC_SNAPSHOT_URL = STATIC_BUILD_ID
  ? `./data/dashboard.json?v=${encodeURIComponent(STATIC_BUILD_ID)}`
  : './data/dashboard.json';
const LOCAL_PREFS_KEY = 'voltwatch_static_prefs_v1';
const LOCAL_LUCID_IMPORT_KEY = 'voltwatch_lucid_direct_v1';

function readLocalPrefs() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeLocalPrefs(prefs) {
  try {
    localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

function readLocalLucidImport() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_LUCID_IMPORT_KEY) || 'null');
    return parsed && Array.isArray(parsed.listings) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalLucidImport(payload) {
  try {
    localStorage.setItem(LOCAL_LUCID_IMPORT_KEY, JSON.stringify(payload));
  } catch {}
}

function readRankerConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RANKER_STORAGE_KEY) || 'null');
    return sanitizeIoniq5Config(parsed?.ioniq5);
  } catch {
    return cloneDefaultIoniq5Config();
  }
}

function writeRankerConfig(ioniq5Config) {
  try {
    localStorage.setItem(RANKER_STORAGE_KEY, JSON.stringify({ ioniq5: ioniq5Config }));
  } catch {}
}

export default function App() {
  const [rawStaticData, setRawStaticData] = useState(null);
  const [isStaticMode, setIsStaticMode] = useState(IS_STATIC_BUILD);
  const [staticPrefs, setStaticPrefs] = useState(() => readLocalPrefs());
  const [lucidImport, setLucidImport] = useState(() => readLocalLucidImport());
  const [ioniq5Config, setIoniq5Config] = useState(() => readRankerConfig());
  const [unfilteredServerListings, setUnfilteredServerListings] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory' | 'top_picks' | 'audit'
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'table'

  // Zero-call local SQLite filter state
  const [q, setQ] = useState('');
  const [make, setMake] = useState('');
  const [condition, setCondition] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [drivetrain, setDrivetrain] = useState('');
  const [minYear, setMinYear] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState('updated_desc');
  const [onlyDrops, setOnlyDrops] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [showSold, setShowSold] = useState(false);

  const [syncModalState, setSyncModalState] = useState({ open: false, tab: 'sync' });
  const [selectedVin, setSelectedVin] = useState(null);
  const [toast, setToast] = useState(null);
  const autoCheckedRef = useRef(false);
  const lucidFileInputRef = useRef(null);

  const showToast = useCallback((message) => {
    setToast(message);
    setTimeout(() => {
      setToast((prev) => (prev === message ? null : prev));
    }, 4500);
  }, []);

  const buildStaticMerged = useCallback(
    (snapshot) => {
      if (!snapshot) return [];
      const hasNewerLocalLucid =
        lucidImport &&
        (!snapshot.generatedAt || Date.parse(lucidImport.importedAt) > Date.parse(snapshot.generatedAt));

      const baseListings = hasNewerLocalLucid
        ? snapshot.listings.filter((l) => l.source !== 'lucid_direct')
        : snapshot.listings;

      let combinedListings = [...baseListings];
      if (hasNewerLocalLucid) {
        const extraDirect = [];
        for (const item of lucidImport.listings) {
          const match = findMatchingExistingLucid(baseListings, item);
          if (!match) extraDirect.push(item);
        }
        combinedListings = [...baseListings, ...extraDirect];
      }

      return combinedListings.map((l) => {
        const pref = staticPrefs[l.vin];
        return {
          ...l,
          is_starred: pref?.is_starred !== undefined ? pref.is_starred : l.is_starred,
          notes: pref?.notes !== undefined ? pref.notes : l.notes,
          removed_at: pref?.removed_at !== undefined ? pref.removed_at : l.removed_at,
        };
      });
    },
    [staticPrefs, lucidImport]
  );

  const applyStaticFilters = useCallback(
    (snapshot) => {
      const merged = buildStaticMerged(snapshot);
      const activeMerged = merged.filter((l) => !l.removed_at);
      const soldCount = merged.length - activeMerged.length;

      let filtered = merged.filter((l) => {
        if (!showSold && l.removed_at) return false;
        if (q.trim()) {
          const hay =
            `${l.make} ${l.model} ${l.trim} ${l.drivetrain} ${l.exterior_color} ${l.vin} ${l.city} ${l.dealer}`.toLowerCase();
          if (!hay.includes(q.trim().toLowerCase())) return false;
        }
        if (make && l.make !== make) return false;
        if (condition && l.condition !== condition) return false;
        if (sourceFilter && l.source !== sourceFilter) return false;
        if (drivetrain && String(l.drivetrain || '').toUpperCase() !== drivetrain) return false;
        if (minYear && Number(minYear) > 0 && Number(l.year) < Number(minYear)) return false;
        if (maxPrice && Number(maxPrice) > 0 && (l.price == null || l.price > Number(maxPrice))) return false;
        if (onlyStarred && !l.is_starred) return false;
        if (onlyDrops && !(l.previous_price != null && l.price < l.previous_price)) return false;
        if (onlyNew && !isNewToday(l)) return false;
        return true;
      });

      const sorters = {
        updated_desc: (a, b) => Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0),
        price_asc: (a, b) => (a.price ?? 9e9) - (b.price ?? 9e9),
        price_desc: (a, b) => (b.price ?? 0) - (a.price ?? 0),
        miles_asc: (a, b) => (a.miles ?? 9e9) - (b.miles ?? 9e9),
        year_desc: (a, b) => b.year - a.year || (a.price ?? 9e9) - (b.price ?? 9e9),
        drop_desc: (a, b) => getPriceDropAmount(b) - getPriceDropAmount(a),
        msrp_pct_desc: (a, b) =>
          (estimateListingMsrp(b).savingsPct ?? -999) - (estimateListingMsrp(a).savingsPct ?? -999),
        msrp_saved_desc: (a, b) =>
          (estimateListingMsrp(b).savingsAmount ?? -9e9) - (estimateListingMsrp(a).savingsAmount ?? -9e9),
      };
      if (sort !== 'score_desc') {
        filtered = [...filtered].sort(sorters[sort] || sorters.updated_desc);
      }

      const priced = activeMerged.filter((l) => l.price != null);
      const makeCounts = {};
      for (const l of activeMerged) {
        makeCounts[l.make] = (makeCounts[l.make] || 0) + 1;
      }
      const makeFacets = Object.entries(makeCounts)
        .map(([m, count]) => ({ make: m, count }))
        .sort((a, b) => b.count - a.count || a.make.localeCompare(b.make));

      return {
        ...snapshot,
        listings: filtered,
        allListings: activeMerged,
        facets: {
          ...snapshot.facets,
          makes: makeFacets,
        },
        kpis: {
          ...snapshot.kpis,
          totalListings: activeMerged.length,
          avgPrice: priced.length
            ? Math.round(priced.reduce((sum, l) => sum + Number(l.price), 0) / priced.length)
            : 0,
          minPrice: priced.length ? Math.min(...priced.map((l) => Number(l.price))) : 0,
          priceDropsCount: activeMerged.filter((l) => getPriceDropAmount(l) > 0).length,
          newTodayCount: activeMerged.filter((l) => isNewToday(l)).length,
          starredCount: activeMerged.filter((l) => l.is_starred).length,
          soldCount,
        },
      };
    },
    [q, make, condition, sourceFilter, drivetrain, minYear, maxPrice, sort, onlyDrops, onlyNew, onlyStarred, showSold, buildStaticMerged]
  );

  const fetchDashboard = useCallback(async () => {
    if (IS_STATIC_BUILD) {
      if (!rawStaticData) {
        const res = await fetch(STATIC_SNAPSHOT_URL, { cache: 'no-cache' });
        const snap = await res.json();
        setRawStaticData(snap);
        setDashboard(applyStaticFilters(snap));
      } else {
        setDashboard(applyStaticFilters(rawStaticData));
      }
      setIsStaticMode(true);
      setLoading(false);
      return;
    }

    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (make) params.set('make', make);
    if (condition) params.set('condition', condition);
    if (sourceFilter) params.set('source', sourceFilter);
    if (drivetrain) params.set('drivetrain', drivetrain);
    if (minYear) params.set('minYear', minYear);
    if (maxPrice) params.set('maxPrice', maxPrice);
    if (sort && sort !== 'score_desc') params.set('sort', sort);
    if (onlyDrops) params.set('onlyDrops', 'true');
    if (onlyNew) params.set('onlyNew', 'true');
    if (onlyStarred) params.set('onlyStarred', 'true');
    if (showSold) params.set('showSold', 'true');

    const hasFilters = Boolean(
      q.trim() || make || condition || sourceFilter || drivetrain || minYear || maxPrice || onlyDrops || onlyNew || onlyStarred || showSold
    );

    try {
      const res = await fetch(`/api/dashboard?${params.toString()}`);
      if (!res.ok) throw new Error('API unavailable');
      const data = await res.json();
      setDashboard(data);
      setIsStaticMode(false);

      if (!hasFilters) {
        setUnfilteredServerListings(data.listings);
      } else {
        fetch('/api/dashboard')
          .then((r) => (r.ok ? r.json() : null))
          .then((full) => {
            if (full?.listings) setUnfilteredServerListings(full.listings);
          })
          .catch(() => {});
      }
    } catch {
      const res = await fetch(STATIC_SNAPSHOT_URL, { cache: 'no-cache' });
      const snap = await res.json();
      setRawStaticData(snap);
      setDashboard(applyStaticFilters(snap));
      setIsStaticMode(true);
    }
    setLoading(false);
  }, [
    q,
    make,
    condition,
    sourceFilter,
    drivetrain,
    minYear,
    maxPrice,
    sort,
    onlyDrops,
    onlyNew,
    onlyStarred,
    showSold,
    rawStaticData,
    applyStaticFilters,
  ]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Run safe 24h auto-check once on initial mount (skipped in static GitHub Pages builds)
  useEffect(() => {
    if (IS_STATIC_BUILD || isStaticMode || autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    fetch('/api/sync/auto-check', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res?.triggered) {
          fetchDashboard();
          if (res.result?.status === 'completed') {
            showToast(
              `Daily auto-sync complete: ${res.result.listingsFetched} EVs (${res.result.callsUsed} API calls).`
            );
          } else if (res.result?.status === 'blocked') {
            showToast(res.result.reason);
          }
        }
      })
      .catch(() => {});
  }, [fetchDashboard, showToast, isStaticMode]);

  const allUnfilteredListings = useMemo(() => {
    const rawList = isStaticMode
      ? dashboard?.allListings || buildStaticMerged(rawStaticData)
      : unfilteredServerListings || dashboard?.listings || [];
    return rawList.filter((l) => !l.removed_at);
  }, [isStaticMode, dashboard, buildStaticMerged, rawStaticData, unfilteredServerListings]);

  const ioniq5Ranking = useMemo(
    () => rankIoniq5Listings(allUnfilteredListings, ioniq5Config),
    [allUnfilteredListings, ioniq5Config]
  );

  const handleUpdateIoniq5Config = useCallback((nextConfig) => {
    const sanitized = sanitizeIoniq5Config(nextConfig);
    setIoniq5Config(sanitized);
    writeRankerConfig(sanitized);
  }, []);

  const handleResetIoniq5Config = useCallback(() => {
    const defaults = cloneDefaultIoniq5Config();
    setIoniq5Config(defaults);
    writeRankerConfig(defaults);
    showToast('Ioniq 5 ranking weights and dealbreakers reset to defaults.');
  }, [showToast]);

  const selectedListing = useMemo(() => {
    if (!selectedVin) return null;
    return (
      dashboard?.listings?.find((l) => l.vin === selectedVin) ||
      allUnfilteredListings.find((l) => l.vin === selectedVin) ||
      null
    );
  }, [selectedVin, dashboard, allUnfilteredListings]);

  async function handleToggleStar(listing, e) {
    if (e) e.stopPropagation();
    if (isStaticMode) {
      const next = {
        ...staticPrefs,
        [listing.vin]: { ...(staticPrefs[listing.vin] || {}), is_starred: !listing.is_starred },
      };
      setStaticPrefs(next);
      writeLocalPrefs(next);
      return;
    }
    const res = await fetch(`/api/listings/${listing.vin}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_starred: !listing.is_starred }),
    });
    if (res.ok) {
      fetchDashboard();
    }
  }

  async function handleToggleSold(listing, e) {
    if (e) e.stopPropagation();
    const markingSold = !listing.removed_at;
    const nextRemovedAt = markingSold ? new Date().toISOString() : null;

    if (isStaticMode) {
      const next = {
        ...staticPrefs,
        [listing.vin]: { ...(staticPrefs[listing.vin] || {}), removed_at: nextRemovedAt },
      };
      setStaticPrefs(next);
      writeLocalPrefs(next);
    } else {
      const res = await fetch(`/api/listings/${listing.vin}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removed_at: nextRemovedAt }),
      });
      if (!res.ok) return;
      await fetchDashboard();
    }

    if (markingSold && !showSold && selectedVin === listing.vin) {
      setSelectedVin(null);
    }
    showToast(
      markingSold
        ? `Marked ${listing.year} ${listing.make} ${listing.model} as Sold/Hidden (0 API calls). Toggle "Show Sold" to view or restore.`
        : `Restored ${listing.year} ${listing.make} ${listing.model} to active inventory.`
    );
  }

  async function handleSaveNotes(vin, notes) {
    if (isStaticMode) {
      const next = {
        ...staticPrefs,
        [vin]: { ...(staticPrefs[vin] || {}), notes },
      };
      setStaticPrefs(next);
      writeLocalPrefs(next);
      return;
    }
    const res = await fetch(`/api/listings/${vin}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    if (res.ok) {
      fetchDashboard();
    }
  }

  async function handleRefreshVin(vin) {
    if (isStaticMode) {
      showToast('Hosted on GitHub Pages: daily updates run via GitHub Actions (0 API calls per visit).');
      return;
    }
    const res = await fetch(`/api/listings/${vin}/refresh`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to refresh VIN.');
      return;
    }
    await fetchDashboard();
    showToast(`Live VIN ${vin} verified (1 API call used).`);
  }

  async function handleLucidFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const rawContent = await file.text();
      if (!isStaticMode) {
        const res = await fetch('/api/import/lucid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawContent, filename: file.name }),
        });
        const result = await res.json();
        if (!res.ok || !result.ok) {
          showToast(result.error || 'Could not find Lucid vehicles in that file.');
          return;
        }
        await fetchDashboard();
        showToast(
          `Imported ${result.importedDirect} Lucid Direct EVs (${result.matchedAutoDev} matched Auto.dev) · 0 API calls.`
        );
        return;
      }

      const nowIso = new Date().toISOString();
      const parsed = parseLucidMhtml(rawContent, nowIso);
      if (parsed.length === 0) {
        showToast('No Lucid vehicles found. Save page as Webpage, Single File (.mhtml) or Complete (.html).');
        return;
      }

      const prevList = [
        ...(lucidImport?.listings || []),
        ...(rawStaticData?.listings?.filter((l) => l.source === 'lucid_direct') || []),
      ];
      const prevByVin = new Map(prevList.map((l) => [l.vin, l]));

      const enriched = parsed.map((item) => {
        const prev = prevByVin.get(item.vin);
        if (!prev) return item;
        const priceChanged = prev.price != null && item.price != null && item.price !== prev.price;
        const history = Array.isArray(prev.price_history) ? [...prev.price_history] : [];
        if (priceChanged) {
          history.push({ price: item.price, recordedAt: nowIso });
        }
        return {
          ...item,
          first_seen_at: prev.first_seen_at || item.first_seen_at,
          previous_price: priceChanged ? prev.price : prev.previous_price,
          price_history: history.length ? history : item.price_history,
        };
      });

      const payload = { importedAt: nowIso, filename: file.name, listings: enriched };
      setLucidImport(payload);
      writeLocalLucidImport(payload);
      showToast(`Imported ${enriched.length} Lucid Direct EVs from ${file.name} (0 API calls).`);
    } catch (err) {
      showToast(`Lucid import failed: ${err.message}`);
    }
  }

  function handleClearFilters() {
    setQ('');
    setMake('');
    setCondition('');
    setSourceFilter('');
    setDrivetrain('');
    setMinYear('');
    setMaxPrice('');
    setSort('updated_desc');
    setOnlyDrops(false);
    setOnlyNew(false);
    setOnlyStarred(false);
    setShowSold(false);
  }

  const displayedListings = useMemo(() => {
    const raw = dashboard?.listings || [];
    if (sort !== 'score_desc') return raw;
    return [...raw].sort((a, b) => {
      const ra = ioniq5Ranking.byVin.get(a.vin);
      const rb = ioniq5Ranking.byVin.get(b.vin);
      const sa = ra?.eligible ? ra.score : ra ? -1 : -2;
      const sb = rb?.eligible ? rb.score : rb ? -1 : -2;
      if (sb !== sa) return sb - sa;
      return (a.price ?? 9e9) - (b.price ?? 9e9);
    });
  }, [dashboard, sort, ioniq5Ranking]);

  if (loading || !dashboard) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--ink-muted)' }}>
        Loading cached EV market snapshot...
      </div>
    );
  }

  const { kpis, facets, quota, settings, cacheStatus, snapshots, recentCalls } = dashboard;
  const reserveMarkerPct = Math.max(
    0,
    Math.min(100, ((quota.cap - quota.reserveBuffer) / quota.cap) * 100)
  );
  const hasActiveFilters = Boolean(
    q || make || condition || sourceFilter || drivetrain || minYear || maxPrice || onlyDrops || onlyNew || onlyStarred || showSold
  );

  return (
    <div>
      <header className="app-header">
        <div className="header-inner">
          <div className="brand-group">
            <div className="brand-mark" aria-hidden="true">
              <Zap size={20} />
            </div>
            <div>
              <h1 className="brand-title">VoltWatch EV Monitor</h1>
              <p className="brand-sub">
                Auto.dev Free Tier Dashboard · 1,000 Calls/Mo Budget Guard
              </p>
            </div>
          </div>

          <div className="header-actions">
            <span className={`status-pill ${cacheStatus.liveApiConfigured ? 'live' : 'demo'}`}>
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '999px',
                  background: 'currentColor',
                }}
              />
              {isStaticMode
                ? cacheStatus.liveApiConfigured
                  ? 'Daily Live Snapshot (Static)'
                  : 'Demo Static Snapshot'
                : cacheStatus.liveApiConfigured
                  ? 'Live Auto.dev API'
                  : 'Demo Seed Mode'}
            </span>

            <span
              className="status-pill cache"
              title="All browsing, filtering, and sorting read locally (0 API calls)"
            >
              <Database size={13} />
              Cached {formatRelativeTime(kpis.lastCacheUpdate)} · 0 calls on load
            </span>

            <input
              ref={lucidFileInputRef}
              type="file"
              accept=".mhtml,.html,.htm"
              style={{ display: 'none' }}
              onChange={handleLucidFileChange}
            />
            <button
              type="button"
              className="btn"
              onClick={() => lucidFileInputRef.current?.click()}
              title="Import a saved Lucid Motors pre-owned webpage (.mhtml or .html) with 0 API calls"
            >
              <Upload size={15} /> Import Lucid (.mhtml)
            </button>

            {!isStaticMode && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setSyncModalState({ open: true, tab: 'settings' })}
                >
                  <SlidersHorizontal size={15} /> Guardrails
                </button>

                <button
                  type="button"
                  className="btn btn-ev"
                  onClick={() => setSyncModalState({ open: true, tab: 'sync' })}
                >
                  <RefreshCw size={15} /> Preview &amp; Sync
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="main-container">
        {!cacheStatus.liveApiConfigured && (
          <div className="notice-banner">
            <div className="notice-banner-left">
              <ShieldCheck size={18} style={{ color: 'var(--status-info)', flexShrink: 0 }} />
              <span>
                <strong>Demo Seed Mode active:</strong> Browsing {kpis.totalListings} pre-seeded EV listings using{' '}
                <strong>0 Auto.dev API credits</strong>.{' '}
                {isStaticMode
                  ? 'Add AUTODEV_API_KEY in GitHub Repo Settings → Secrets → Actions for automated daily live syncs.'
                  : 'Add AUTODEV_API_KEY to .env whenever you are ready for live daily snapshots.'}
              </span>
            </div>
            {!isStaticMode && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setSyncModalState({ open: true, tab: 'sync' })}
              >
                Test Cost Estimator
              </button>
            )}
          </div>
        )}

        <section className="kpi-grid" aria-label="Quota and Market Summary">
          <div className="kpi-card">
            <div className="kpi-header">
              <span>Monthly API Quota ({quota.monthKey})</span>
              <span className="mono">{quota.pctUsed}%</span>
            </div>
            <div className="kpi-value mono">
              {quota.used}{' '}
              <span style={{ fontSize: '15px', fontWeight: 500, color: 'var(--ink-muted)' }}>
                / {quota.cap.toLocaleString()} calls
              </span>
            </div>
            <div className="quota-bar-track">
              <div
                className={`quota-bar-fill ${
                  quota.pctUsed >= 90 ? 'danger' : quota.pctUsed >= 75 ? 'warn' : ''
                }`}
                style={{ width: `${Math.min(100, quota.pctUsed)}%` }}
              />
              <div
                className="quota-reserve-marker"
                style={{ left: `${reserveMarkerPct}%` }}
                title={`Reserve buffer: ${quota.reserveBuffer} calls`}
              />
            </div>
            <div className="kpi-sub">
              <span>
                <strong className="mono">{quota.remaining}</strong> left
              </span>
              <span>·</span>
              <span>
                Proj. <strong className="mono">{quota.projectedMonthEnd}</strong>/mo
              </span>
              <span>·</span>
              <span>
                {settings.syncMode === 'daily_auto'
                  ? `${settings.syncIntervalHours}h Auto-TTL`
                  : 'Manual Only'}
              </span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <span>Cached EV Inventory</span>
              <Database size={15} />
            </div>
            <div className="kpi-value">{kpis.totalListings}</div>
            <div className="kpi-sub">
              <span style={{ color: 'var(--accent-ev-dark)', fontWeight: 600 }}>
                +{kpis.newTodayCount} new (24h)
              </span>
              <span>·</span>
              <span>{facets.makes.length} EV makers</span>
            </div>
          </div>

          <div
            className="kpi-card"
            style={{ cursor: 'pointer' }}
            onClick={() => {
              setActiveTab('inventory');
              setOnlyDrops((v) => !v);
            }}
            title="Click to filter EVs with price drops"
          >
            <div className="kpi-header">
              <span>Snapshot Price Drops</span>
              <TrendingDown size={15} style={{ color: 'var(--status-good)' }} />
            </div>
            <div className="kpi-value" style={{ color: 'var(--status-good)' }}>
              {kpis.priceDropsCount}
            </div>
            <div className="kpi-sub">
              <span>Detected across local snapshots</span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <span>Market Avg / Entry</span>
              <Sparkles size={15} />
            </div>
            <div className="kpi-value">{formatCurrency(kpis.avgPrice)}</div>
            <div className="kpi-sub">
              <span>From {formatCurrency(kpis.minPrice)}</span>
              <span>·</span>
              <span>{kpis.starredCount} starred</span>
            </div>
          </div>
        </section>

        <div className="view-tabs">
          <div className="tab-group">
            <button
              type="button"
              className={`tab-btn ${activeTab === 'inventory' ? 'active' : ''}`}
              onClick={() => setActiveTab('inventory')}
            >
              <LayoutGrid size={14} /> EV Inventory ({displayedListings.length})
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'top_picks' ? 'active' : ''}`}
              onClick={() => setActiveTab('top_picks')}
            >
              <Award size={14} /> Top 5 Picks
              {ioniq5Ranking.top5.length > 0 && (
                <span
                  className="mono"
                  style={{
                    fontSize: '11px',
                    padding: '1px 6px',
                    borderRadius: '999px',
                    background: 'var(--accent-ev-soft)',
                    color: 'var(--accent-ev-dark)',
                  }}
                >
                  Ioniq 5
                </span>
              )}
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
              onClick={() => setActiveTab('audit')}
            >
              <Activity size={14} /> Quota &amp; Snapshot Audit
            </button>
          </div>

          {activeTab === 'inventory' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="status-pill cache" style={{ fontSize: '11px' }}>
                {isStaticMode ? 'Instant local filter · 0 API calls' : 'Instant SQLite filter · 0 API calls'}
              </span>
              <div className="tab-group">
                <button
                  type="button"
                  className={`tab-btn ${viewMode === 'grid' ? 'active' : ''}`}
                  onClick={() => setViewMode('grid')}
                  title="Grid view"
                >
                  <LayoutGrid size={14} />
                </button>
                <button
                  type="button"
                  className={`tab-btn ${viewMode === 'table' ? 'active' : ''}`}
                  onClick={() => setViewMode('table')}
                  title="Table view"
                >
                  <List size={14} />
                </button>
              </div>
            </div>
          )}
        </div>

        {activeTab === 'top_picks' ? (
          <TopPicksView
            allListings={allUnfilteredListings}
            ioniq5Ranking={ioniq5Ranking}
            ioniq5Config={ioniq5Config}
            onUpdateIoniq5Config={handleUpdateIoniq5Config}
            onResetIoniq5Config={handleResetIoniq5Config}
            onSelectVin={setSelectedVin}
            onToggleStar={handleToggleStar}
          />
        ) : activeTab === 'audit' ? (
          <QuotaAuditView
            quota={quota}
            settings={settings}
            snapshots={snapshots}
            recentCalls={recentCalls}
            cacheStatus={cacheStatus}
            onOpenSyncModal={(tab) => setSyncModalState({ open: true, tab })}
          />
        ) : (
          <>
            <section className="filter-panel" aria-label="Cached Listing Filters">
              <div className="filter-row">
                <div className="search-wrap">
                  <Search size={15} />
                  <input
                    id="ev-search-input"
                    className="input-control"
                    placeholder="Search model, trim, AWD/RWD, color, VIN, dealer..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>

                <select
                  id="ev-make-select"
                  className="select-control"
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                >
                  <option value="">All EV Makers</option>
                  {facets.makes.map((m) => (
                    <option key={m.make} value={m.make}>
                      {m.make} ({m.count})
                    </option>
                  ))}
                </select>

                <select
                  id="ev-condition-select"
                  className="select-control"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                >
                  <option value="">All Conditions</option>
                  <option value="used">Used</option>
                  <option value="cpo">Certified (CPO)</option>
                  <option value="new">New</option>
                </select>

                <select
                  id="ev-drivetrain-select"
                  className="select-control"
                  value={drivetrain}
                  onChange={(e) => setDrivetrain(e.target.value)}
                >
                  <option value="">All Drivetrains</option>
                  <option value="AWD">AWD</option>
                  <option value="RWD">RWD</option>
                </select>

                <select
                  id="ev-source-select"
                  className="select-control"
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                >
                  <option value="">All Sources</option>
                  <option value="autodev">Auto.dev Dealers</option>
                  <option value="lucid_direct">Lucid Direct</option>
                </select>

                <select
                  id="ev-min-year-select"
                  className="select-control"
                  value={minYear}
                  onChange={(e) => setMinYear(e.target.value)}
                >
                  <option value="">All Years</option>
                  <option value="2025">2025+ Only</option>
                  <option value="2024">2024+</option>
                  <option value="2023">2023+</option>
                </select>

                <select
                  id="ev-max-price-select"
                  className="select-control"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                >
                  <option value="">Any Price</option>
                  <option value="25000">Under $25,000</option>
                  <option value="35000">Under $35,000</option>
                  <option value="45000">Under $45,000</option>
                  <option value="60000">Under $60,000</option>
                  <option value="80000">Under $80,000</option>
                </select>

                <select
                  id="ev-sort-select"
                  className="select-control"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="updated_desc">Sort: Recently Updated</option>
                  <option value="score_desc">Sort: Best Match Score (Ioniq 5)</option>
                  <option value="msrp_pct_desc">Sort: Biggest % Off MSRP</option>
                  <option value="msrp_saved_desc">Sort: Most $ Saved vs MSRP</option>
                  <option value="price_asc">Sort: Price Low → High</option>
                  <option value="price_desc">Sort: Price High → Low</option>
                  <option value="miles_asc">Sort: Lowest Mileage</option>
                  <option value="year_desc">Sort: Newest Model Year</option>
                  <option value="drop_desc">Sort: Biggest Price Drop</option>
                </select>
              </div>

              <div className="filter-chips-row">
                <div className="chip-group">
                  <button
                    type="button"
                    className={`filter-chip ${onlyDrops ? 'active-ev' : ''}`}
                    onClick={() => setOnlyDrops((v) => !v)}
                  >
                    <TrendingDown size={13} /> Price Drops ({kpis.priceDropsCount})
                  </button>
                  <button
                    type="button"
                    className={`filter-chip ${onlyNew ? 'active-ev' : ''}`}
                    onClick={() => setOnlyNew((v) => !v)}
                  >
                    <Sparkles size={13} /> New Today ({kpis.newTodayCount})
                  </button>
                  <button
                    type="button"
                    className={`filter-chip ${onlyStarred ? 'active-ev' : ''}`}
                    onClick={() => setOnlyStarred((v) => !v)}
                  >
                    <Star size={13} /> Starred ({kpis.starredCount})
                  </button>
                  <button
                    type="button"
                    className={`filter-chip ${showSold ? 'active-ev' : ''}`}
                    onClick={() => setShowSold((v) => !v)}
                    title="Include cars marked Sold/Removed from clean backfills or manually hidden (preserves starred notes & price history)"
                  >
                    <EyeOff size={13} /> Show Sold ({kpis.soldCount || 0})
                  </button>
                </div>

                {hasActiveFilters && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={handleClearFilters}>
                    Reset filters
                  </button>
                )}
              </div>
            </section>

            {displayedListings.length === 0 ? (
              <div className="empty-state">
                <p style={{ margin: '0 0 10px', fontWeight: 600, color: 'var(--ink-primary)' }}>
                  No cached EV listings match your current filters.
                </p>
                <button type="button" className="btn btn-sm" onClick={handleClearFilters}>
                  Clear Filters
                </button>
              </div>
            ) : viewMode === 'grid' ? (
              <section className="listings-grid" aria-label="EV Listings Grid">
                {displayedListings.map((item) => {
                  const drop = getPriceDropAmount(item);
                  const fresh = isNewToday(item);
                  const isSold = Boolean(item.removed_at);
                  const rankInfo = ioniq5Ranking.byVin.get(item.vin);
                  const msrpInfo = estimateListingMsrp(item);
                  return (
                    <article
                      key={item.vin}
                      className={`listing-card ${isSold ? 'is-sold' : ''}`}
                      onClick={() => setSelectedVin(item.vin)}
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
                            e.currentTarget.src =
                              item.make === 'Lucid'
                                ? './images/ev_sedan_silver.jpg'
                                : './images/ev_suv_emerald.jpg';
                          }}
                        />
                        <div className="card-badges">
                          {isSold && <span className="badge badge-sold">SOLD</span>}
                          {rankInfo?.eligible && (
                            <span
                              className={`badge ${
                                rankInfo.rank === 1
                                  ? 'badge-rank-1'
                                  : rankInfo.isTop5
                                    ? 'badge-rank'
                                    : 'badge-score'
                              } mono`}
                            >
                              {rankInfo.isTop5 ? `#${rankInfo.rank} · ` : ''}
                              {rankInfo.score.toFixed(1)}
                            </span>
                          )}
                          <span className="badge badge-cond">{item.condition}</span>
                          {fresh && !isSold && <span className="badge badge-new">NEW 24H</span>}
                          {drop > 0 && (
                            <span className="badge badge-drop">-{formatCurrency(drop)}</span>
                          )}
                        </div>
                        <div className="card-top-actions">
                          <button
                            type="button"
                            className={`star-btn sold-toggle-btn ${isSold ? 'is-sold' : ''}`}
                            onClick={(e) => handleToggleSold(item, e)}
                            title={isSold ? 'Restore to active inventory (0 API calls)' : 'Mark Sold / Hide (0 API calls)'}
                            aria-label={isSold ? 'Restore EV' : 'Mark EV sold or hide'}
                          >
                            {isSold ? <RotateCcw size={14} /> : <EyeOff size={14} />}
                          </button>
                          <button
                            type="button"
                            className={`star-btn ${item.is_starred ? 'starred' : ''}`}
                            onClick={(e) => handleToggleStar(item, e)}
                            aria-label={item.is_starred ? 'Unstar EV' : 'Star EV'}
                          >
                            <Star
                              size={15}
                              fill={item.is_starred ? '#d97706' : 'none'}
                            />
                          </button>
                        </div>
                      </div>

                      <div className="card-body">
                        <div className="card-top-row">
                          <div>
                            <h3 className="card-title">
                              {item.year} {item.make} {item.model}
                            </h3>
                            <p className="card-trim">
                              {item.trim || item.body_style || 'Electric'}
                              {rankInfo?.epaRange ? ` · ${rankInfo.epaRange} mi EPA` : ''}
                            </p>
                          </div>
                          <div className="card-price-block">
                            <div className="card-price">{formatCurrency(item.price)}</div>
                            {msrpInfo.savingsAmount > 0 && (
                              <div
                                className="card-msrp-save mono"
                                title={`Est. MSRP ${formatCurrency(msrpInfo.effectiveMsrp)}${
                                  msrpInfo.knownAdasLabel ? ` (incl. dest & ${msrpInfo.knownAdasLabel})` : ' (incl. dest)'
                                }`}
                              >
                                {Math.round(msrpInfo.savingsPct)}% off · -{formatCurrency(msrpInfo.savingsAmount)}
                              </div>
                            )}
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
                          {item.drivetrain && (
                            <span className="spec-item mono">{item.drivetrain}</span>
                          )}
                        </div>

                        <div className="card-footer">
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              maxWidth: '190px',
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
              </section>
            ) : (
              <section className="table-card" aria-label="EV Listings Table">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Vehicle</th>
                      <th>Score</th>
                      <th>Condition</th>
                      <th>Price</th>
                      <th>vs. MSRP</th>
                      <th>Delta</th>
                      <th>Mileage</th>
                      <th>Location</th>
                      <th>VIN</th>
                      <th>Updated</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedListings.map((item) => {
                      const drop = getPriceDropAmount(item);
                      const isSold = Boolean(item.removed_at);
                      const rankInfo = ioniq5Ranking.byVin.get(item.vin);
                      const msrpInfo = estimateListingMsrp(item);
                      return (
                        <tr
                          key={item.vin}
                          className={isSold ? 'is-sold' : ''}
                          onClick={() => setSelectedVin(item.vin)}
                        >
                          <td onClick={(e) => handleToggleStar(item, e)}>
                            <Star
                              size={15}
                              color={item.is_starred ? '#d97706' : '#94a3b8'}
                              fill={item.is_starred ? '#d97706' : 'none'}
                            />
                          </td>
                          <td>
                            <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>{item.year} {item.make} {item.model}</span>
                              {isSold && <span className="badge badge-sold">SOLD</span>}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
                              {item.trim} · {item.dealer}
                            </div>
                          </td>
                          <td>
                            {rankInfo?.eligible ? (
                              <span
                                className={`badge mono ${
                                  rankInfo.rank === 1
                                    ? 'badge-rank-1'
                                    : rankInfo.isTop5
                                      ? 'badge-rank'
                                      : 'badge-score'
                                }`}
                              >
                                #{rankInfo.rank} · {rankInfo.score.toFixed(1)}
                              </span>
                            ) : rankInfo ? (
                              <span style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>Excl.</span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            <span className="badge badge-cond">{item.condition}</span>
                          </td>
                          <td className="mono" style={{ fontWeight: 700 }}>
                            {formatCurrency(item.price)}
                          </td>
                          <td className="mono" style={{ fontSize: '12px' }}>
                            {msrpInfo.savingsAmount > 0 ? (
                              <span style={{ color: 'var(--status-good)', fontWeight: 700 }}>
                                {Math.round(msrpInfo.savingsPct)}% (-{formatCurrency(msrpInfo.savingsAmount)})
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            {drop > 0 ? (
                              <span className="badge badge-drop">-{formatCurrency(drop)}</span>
                            ) : isNewToday(item) && !isSold ? (
                              <span className="badge badge-new">NEW</span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="mono">{formatMiles(item.miles)}</td>
                          <td>
                            {item.city}, {item.state}
                          </td>
                          <td className="mono" style={{ fontSize: '12px' }}>
                            {item.vin}
                          </td>
                          <td style={{ color: 'var(--ink-muted)', fontSize: '12px' }}>
                            {formatRelativeTime(item.updated_at)}
                          </td>
                          <td onClick={(e) => handleToggleSold(item, e)}>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              title={isSold ? 'Restore to active inventory' : 'Mark Sold / Hide'}
                              aria-label={isSold ? 'Restore EV' : 'Mark EV sold or hide'}
                            >
                              {isSold ? <RotateCcw size={14} /> : <EyeOff size={14} />}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            )}
          </>
        )}
      </main>

      <SyncModal
        isOpen={syncModalState.open}
        initialTab={syncModalState.tab}
        settings={settings}
        cacheStatus={cacheStatus}
        onClose={() => setSyncModalState({ open: false, tab: 'sync' })}
        onSyncCompleted={async (res) => {
          await fetchDashboard();
          if (res.status === 'blocked') {
            showToast(`Sync blocked: ${res.reason}`);
          } else if (res.mode === 'demo') {
            showToast(res.message);
          } else {
            showToast(
              `Live sync finished: ${res.listingsFetched} EVs fetched (${res.callsUsed} API calls${
                res.markedSold > 0 ? `, ${res.markedSold} marked sold` : ''
              }).`
            );
          }
        }}
        onSettingsSaved={async () => {
          await fetchDashboard();
          showToast('Quota guardrails & watchlist presets saved.');
        }}
        onDemoReset={async () => {
          await fetch('/api/demo/reset', { method: 'POST' });
          await fetchDashboard();
          showToast('Demo EV snapshot reset (0 API calls).');
        }}
      />

      <ListingDrawer
        listing={selectedListing}
        rankingInfo={selectedListing ? ioniq5Ranking.byVin.get(selectedListing.vin) || null : null}
        liveApiConfigured={cacheStatus.liveApiConfigured}
        onClose={() => setSelectedVin(null)}
        onToggleStar={(listing) => handleToggleStar(listing)}
        onToggleSold={(listing) => handleToggleSold(listing)}
        onSaveNotes={handleSaveNotes}
        onRefreshVin={handleRefreshVin}
      />

      {toast && (
        <div className="toast-bar" role="status">
          <Zap size={16} style={{ color: '#2dd4bf', flexShrink: 0 }} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
