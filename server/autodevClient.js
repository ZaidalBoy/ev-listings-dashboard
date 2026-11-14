import { getMonthKey, getQuotaSummary, getSettings, updateSettings } from './db.js';
import { fallbackImageForBodyStyle } from './seedData.js';

const AUTO_DEV_BASE_URL = 'https://api.auto.dev';
const MIN_REQUEST_INTERVAL_MS = 300; // <= 3.33 req/s (safely below Free tier 5 req/s)

let lastRequestAt = 0;
let inFlightSyncPromise = null;

export function getApiKey() {
  const key = process.env.AUTODEV_API_KEY || process.env.AUTO_DEV_API_KEY || '';
  return key.trim();
}

export function hasLiveApiKey() {
  return Boolean(getApiKey());
}

export function formatAutoDevTimestamp(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  // Auto.dev expects YYYY-MM-DDTHH:MM:SS (UTC, no milliseconds or trailing Z)
  return d.toISOString().slice(0, 19);
}

async function throttleRateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

export function normalizeListingRow(raw) {
  const v = raw.vehicle || {};
  const r = raw.retailListing || {};
  const vin = raw.vin || v.vin;
  if (!vin) return null;

  let condition = 'used';
  if (r.cpo === true) condition = 'cpo';
  else if (r.used === false) condition = 'new';

  const bodyStyle = v.bodyStyle || '';
  const model = v.model || 'EV';
  const primaryImage = r.primaryImage || fallbackImageForBodyStyle(bodyStyle, model);

  return {
    vin,
    year: Number(v.year) || new Date().getUTCFullYear(),
    make: v.make || 'Unknown',
    model,
    trim: v.trim || '',
    bodyStyle,
    drivetrain: v.drivetrain || '',
    fuel: v.fuel || 'Electric',
    exteriorColor: v.exteriorColor || '',
    interiorColor: v.interiorColor || '',
    price: r.price != null ? Number(r.price) : null,
    miles: r.miles != null ? Number(r.miles) : null,
    condition,
    dealer: r.dealer || '',
    city: r.city || '',
    state: r.state || '',
    zip: r.zip ? String(r.zip) : '',
    vdpUrl: r.vdp || '',
    carfaxUrl: r.carfaxUrl || '',
    primaryImage,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    removedAt: raw.removedAt || null,
    rawJson: JSON.stringify(raw),
  };
}

export function upsertListingRecord(db, normalized, source = 'autodev') {
  const nowIso = new Date().toISOString();
  const existing = db
    .prepare('SELECT vin, price, previous_price, price_history, first_seen_at FROM listings WHERE vin = ?')
    .get(normalized.vin);

  let isNew = false;
  let isPriceDrop = false;
  let previousPrice = existing ? existing.previous_price : null;
  let history = [];

  if (existing) {
    try {
      history = JSON.parse(existing.price_history || '[]');
    } catch {
      history = [];
    }
    if (
      normalized.price != null &&
      existing.price != null &&
      normalized.price !== existing.price
    ) {
      previousPrice = existing.price;
      if (normalized.price < existing.price) {
        isPriceDrop = true;
      }
      history.push({ price: normalized.price, recordedAt: nowIso });
    }
  } else {
    isNew = true;
    if (normalized.price != null) {
      history.push({ price: normalized.price, recordedAt: normalized.createdAt || nowIso });
    }
  }

  db.prepare(`
    INSERT INTO listings (
      vin, year, make, model, trim, body_style, drivetrain, fuel,
      exterior_color, interior_color, price, previous_price, miles, condition,
      dealer, city, state, zip, vdp_url, carfax_url, primary_image,
      source, first_seen_at, last_seen_at, updated_at, removed_at,
      price_history, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(vin) DO UPDATE SET
      year = excluded.year,
      make = excluded.make,
      model = excluded.model,
      trim = excluded.trim,
      body_style = excluded.body_style,
      drivetrain = excluded.drivetrain,
      fuel = excluded.fuel,
      exterior_color = excluded.exterior_color,
      interior_color = excluded.interior_color,
      price = excluded.price,
      previous_price = ?,
      miles = excluded.miles,
      condition = excluded.condition,
      dealer = excluded.dealer,
      city = excluded.city,
      state = excluded.state,
      zip = excluded.zip,
      vdp_url = excluded.vdp_url,
      carfax_url = excluded.carfax_url,
      primary_image = excluded.primary_image,
      source = excluded.source,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at,
      removed_at = excluded.removed_at,
      price_history = ?,
      raw_json = excluded.raw_json
  `).run(
    normalized.vin,
    normalized.year,
    normalized.make,
    normalized.model,
    normalized.trim,
    normalized.bodyStyle,
    normalized.drivetrain,
    normalized.fuel,
    normalized.exteriorColor,
    normalized.interiorColor,
    normalized.price,
    previousPrice,
    normalized.miles,
    normalized.condition,
    normalized.dealer,
    normalized.city,
    normalized.state,
    normalized.zip,
    normalized.vdpUrl,
    normalized.carfaxUrl,
    normalized.primaryImage,
    source,
    existing ? existing.first_seen_at : nowIso,
    nowIso,
    normalized.updatedAt,
    normalized.removedAt,
    JSON.stringify(history),
    normalized.rawJson,
    previousPrice,
    JSON.stringify(history)
  );

  return { isNew, isPriceDrop };
}

export function resolveSyncProfile(db, options = {}) {
  const settings = getSettings(db);
  const requested = options.syncProfile || 'auto';
  const hasPreviousLiveSync = Boolean(settings.lastLiveSyncAt);
  const resolvedProfile =
    requested === 'auto' ? (hasPreviousLiveSync ? 'daily' : 'backfill') : requested;

  const defaultPages =
    resolvedProfile === 'backfill' ? settings.backfillPagesPerPreset : settings.dailyPagesPerPreset;
  const pagesPerQuery = options.pagesPerQuery
    ? Math.min(15, Math.max(1, Number(options.pagesPerQuery)))
    : defaultPages;

  // On Day 2+ daily incremental runs, filter by updatedAt >= lastLiveSyncAt to skip unchanged cars
  const updatedSince =
    resolvedProfile === 'daily' && settings.lastLiveSyncAt
      ? formatAutoDevTimestamp(settings.lastLiveSyncAt)
      : null;

  return {
    syncProfile: resolvedProfile,
    pagesPerQuery,
    updatedSince,
  };
}

export function buildSyncPlan(db, options = {}) {
  const settings = getSettings(db);
  const quota = getQuotaSummary(db);
  const enabledPresets = settings.watchlistPresets.filter((p) => p.enabled);

  const selectedPresets = options.quickSingleCall
    ? enabledPresets.slice(0, 1)
    : options.presetIds?.length
      ? settings.watchlistPresets.filter((p) => options.presetIds.includes(p.id))
      : enabledPresets;

  const { syncProfile, pagesPerQuery, updatedSince } = resolveSyncProfile(db, options);
  const effectivePages = options.quickSingleCall ? 1 : pagesPerQuery;

  const rawCallCount = selectedPresets.length * effectivePages;
  const maxAllowedForSync = Math.min(settings.maxCallsPerSync, rawCallCount);

  const isAutomated = options.triggerType === 'auto_daily' || options.triggerType === 'cli';
  const availableBudget = isAutomated ? quota.autoSyncBudgetRemaining : quota.remaining;

  const callsPlanned = Math.min(maxAllowedForSync, availableBudget);
  const maxListingsExpected = callsPlanned * 20; // Free tier clamps limit to 20

  const queries = [];
  outer: for (const preset of selectedPresets) {
    for (let page = 1; page <= effectivePages; page++) {
      if (queries.length >= callsPlanned) break outer;
      const params = {
        ...preset.params,
        limit: 20, // Free tier max limit
        page,
      };
      if (updatedSince) {
        params.updatedAt = `${updatedSince}-`;
      }
      if (options.zip) {
        params.zip = options.zip;
        params.distance = options.distance ?? settings.distance ?? 300;
      }
      if (options.state ?? settings.stateFilter) {
        params['retailListing.state'] = options.state ?? settings.stateFilter;
      }
      if (options.maxPrice) {
        params['retailListing.price'] = `1-${Number(options.maxPrice)}`;
      }
      queries.push({
        presetId: preset.id,
        presetLabel: preset.label,
        page,
        params,
      });
    }
  }

  let blockedReason = null;
  if (rawCallCount === 0) {
    blockedReason = 'No watchlist presets enabled.';
  } else if (quota.remaining <= 0) {
    blockedReason = `Monthly hard cap reached (${quota.used}/${quota.cap}). Zero calls remaining until next month.`;
  } else if (isAutomated && quota.autoSyncBudgetRemaining <= 0) {
    blockedReason = `Automated sync paused to protect your ${settings.reserveBuffer}-call emergency reserve (${quota.used}/${quota.cap} used).`;
  }

  return {
    liveApiConfigured: hasLiveApiKey(),
    mode: hasLiveApiKey() && !options.forceDemo ? 'live' : 'demo',
    syncProfile,
    pagesPerQuery: effectivePages,
    updatedSince,
    triggerType: options.triggerType || 'manual',
    callsPlanned: queries.length,
    rawCallsRequested: rawCallCount,
    cappedBySyncLimit: rawCallCount > settings.maxCallsPerSync,
    maxCallsPerSync: settings.maxCallsPerSync,
    maxListingsExpected,
    quotaBefore: quota,
    projectedUsedAfter: quota.used + (hasLiveApiKey() && !options.forceDemo ? queries.length : 0),
    projectedRemainingAfter:
      quota.remaining - (hasLiveApiKey() && !options.forceDemo ? queries.length : 0),
    blockedReason,
    queries,
  };
}

export async function callAutoDevEndpoint(
  db,
  endpointPath,
  queryObj = {},
  { triggerType = 'manual', fetchImpl = fetch } = {}
) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('AUTODEV_API_KEY is not configured in environment.');
  }

  const quota = getQuotaSummary(db);
  if (quota.remaining <= 0) {
    throw new Error(
      `Monthly quota exhausted (${quota.used}/${quota.cap}). Request blocked to protect Free tier limit.`
    );
  }

  await throttleRateLimit();

  const url = new URL(endpointPath, AUTO_DEV_BASE_URL);
  for (const [k, v] of Object.entries(queryObj)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const start = Date.now();
  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  const latencyMs = Date.now() - start;

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const rowsReturned = Array.isArray(body?.data) ? body.data.length : body?.data ? 1 : 0;

  db.prepare(`
    INSERT INTO api_call_log (
      called_at, month_key, endpoint, query_params, status_code,
      latency_ms, rows_returned, counted_against_quota, trigger_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    getMonthKey(),
    endpointPath,
    url.searchParams.toString(),
    response.status,
    latencyMs,
    rowsReturned,
    1,
    triggerType
  );

  if (!response.ok) {
    const errMsg = body?.error || body?.message || response.statusText;
    const err = new Error(`Auto.dev API ${response.status}: ${errMsg}`);
    err.status = response.status;
    throw err;
  }

  return body;
}

export async function executeSync(db, options = {}, fetchImpl = fetch) {
  if (inFlightSyncPromise) {
    return inFlightSyncPromise;
  }

  inFlightSyncPromise = (async () => {
    const plan = buildSyncPlan(db, options);
    const startedAt = new Date().toISOString();

    if (plan.blockedReason && plan.mode === 'live') {
      const snapRes = db
        .prepare(
          `INSERT INTO sync_snapshots (started_at, completed_at, trigger_type, mode, calls_used, listings_fetched, new_listings, price_drops, status, error_message, query_summary)
           VALUES (?, ?, ?, ?, 0, 0, 0, 0, 'blocked', ?, ?)`
        )
        .run(
          startedAt,
          new Date().toISOString(),
          plan.triggerType,
          plan.mode,
          plan.blockedReason,
          'Blocked by monthly quota guard'
        );
      return {
        status: 'blocked',
        snapshotId: Number(snapRes.lastInsertRowid),
        reason: plan.blockedReason,
        plan,
      };
    }

    // Demo mode refresh (0 live calls burned)
    if (plan.mode === 'demo') {
      const rows = db.prepare('SELECT vin, price FROM listings ORDER BY RANDOM() LIMIT 3').all();
      let drops = 0;
      for (const r of rows) {
        if (r.price && r.price > 18000) {
          const newPrice = r.price - 500;
          const existing = db.prepare('SELECT price_history FROM listings WHERE vin = ?').get(r.vin);
          let hist = [];
          try {
            hist = JSON.parse(existing?.price_history || '[]');
          } catch {
            hist = [];
          }
          hist.push({ price: newPrice, recordedAt: new Date().toISOString() });
          db.prepare(
            'UPDATE listings SET previous_price = ?, price = ?, updated_at = ?, last_seen_at = ?, price_history = ? WHERE vin = ?'
          ).run(
            r.price,
            newPrice,
            new Date().toISOString(),
            new Date().toISOString(),
            JSON.stringify(hist),
            r.vin
          );
          drops++;
        }
      }
      db.prepare('UPDATE listings SET last_seen_at = ?').run(new Date().toISOString());
      updateSettings(db, { lastAutoSyncAt: new Date().toISOString() });

      const completedAt = new Date().toISOString();
      const summary = `Demo ${plan.syncProfile} refresh (${plan.queries.length} simulated calls, 0 real API credits used)`;
      const snapRes = db
        .prepare(
          `INSERT INTO sync_snapshots (started_at, completed_at, trigger_type, mode, calls_used, listings_fetched, new_listings, price_drops, status, error_message, query_summary)
           VALUES (?, ?, ?, 'demo', 0, ?, 0, ?, 'completed', NULL, ?)`
        )
        .run(startedAt, completedAt, plan.triggerType, rows.length, drops, summary);

      return {
        status: 'completed',
        mode: 'demo',
        snapshotId: Number(snapRes.lastInsertRowid),
        callsUsed: 0,
        listingsFetched: rows.length,
        newListings: 0,
        priceDrops: drops,
        message:
          'Simulated snapshot updated in Demo Mode (0 Auto.dev API credits used). Add AUTODEV_API_KEY for live sync.',
      };
    }

    // Live Auto.dev Sync with smart early-stop per preset when a page returns < 20 rows
    let callsUsed = 0;
    let listingsFetched = 0;
    let newListings = 0;
    let priceDrops = 0;
    let purgedSeedRows = false;
    const errors = [];
    const exhaustedPresets = new Set();
    const executedQueries = [];

    for (const q of plan.queries) {
      if (exhaustedPresets.has(q.presetId)) {
        continue;
      }

      try {
        const res = await callAutoDevEndpoint(db, '/listings', q.params, {
          triggerType: plan.triggerType,
          fetchImpl,
        });
        callsUsed++;
        executedQueries.push(`${q.presetId}:p${q.page}`);
        const items = Array.isArray(res?.data) ? res.data : [];

        // On first live data arrival, clear demo seed listings so only real matches appear
        if (!purgedSeedRows) {
          db.prepare("DELETE FROM listings WHERE source = 'seed'").run();
          purgedSeedRows = true;
        }

        listingsFetched += items.length;
        for (const item of items) {
          const normalized = normalizeListingRow(item);
          if (!normalized) continue;
          const { isNew, isPriceDrop } = upsertListingRecord(db, normalized, 'autodev');
          if (isNew) newListings++;
          if (isPriceDrop) priceDrops++;
        }

        // Smart early-stop: Free tier max page size is 20; < 20 means no further pages exist
        if (items.length < 20) {
          exhaustedPresets.add(q.presetId);
        }
      } catch (err) {
        callsUsed++;
        executedQueries.push(`${q.presetId}:p${q.page}:err`);
        errors.push(`${q.presetLabel} (p${q.page}): ${err.message}`);
        if (err.status === 401 || err.status === 402 || err.status === 429) {
          break;
        }
      }
    }

    const completedAt = new Date().toISOString();
    if (callsUsed > 0 && errors.length < callsUsed) {
      updateSettings(db, {
        lastAutoSyncAt: completedAt,
        lastLiveSyncAt: startedAt,
      });
    }

    const status =
      errors.length === 0 ? 'completed' : errors.length < callsUsed ? 'partial' : 'failed';
    const summary = `[${plan.syncProfile}${
      plan.updatedSince ? ` since ${plan.updatedSince}` : ''
    }] ${executedQueries.join(', ')}`;
    const snapRes = db
      .prepare(
        `INSERT INTO sync_snapshots (started_at, completed_at, trigger_type, mode, calls_used, listings_fetched, new_listings, price_drops, status, error_message, query_summary)
         VALUES (?, ?, ?, 'live', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        startedAt,
        completedAt,
        plan.triggerType,
        callsUsed,
        listingsFetched,
        newListings,
        priceDrops,
        status,
        errors.length ? errors.join('; ') : null,
        summary
      );

    return {
      status,
      mode: 'live',
      syncProfile: plan.syncProfile,
      snapshotId: Number(snapRes.lastInsertRowid),
      callsUsed,
      callsSavedByEarlyStop: Math.max(0, plan.queries.length - callsUsed),
      listingsFetched,
      newListings,
      priceDrops,
      errors,
    };
  })();

  try {
    return await inFlightSyncPromise;
  } finally {
    inFlightSyncPromise = null;
  }
}

export async function refreshSingleVin(db, vin, fetchImpl = fetch) {
  if (!hasLiveApiKey()) {
    throw new Error('Demo Mode active: add AUTODEV_API_KEY in .env to verify live VIN pricing.');
  }
  const res = await callAutoDevEndpoint(
    db,
    `/listings/${encodeURIComponent(vin)}`,
    {},
    { triggerType: 'vin_refresh', fetchImpl }
  );
  const raw = res?.data;
  if (!raw) {
    throw new Error('No listing data returned for this VIN.');
  }
  const normalized = normalizeListingRow(raw);
  if (!normalized) {
    throw new Error('Invalid listing format returned for VIN.');
  }
  const result = upsertListingRecord(db, normalized, 'autodev');
  return {
    vin,
    updated: true,
    ...result,
    listing: db.prepare('SELECT * FROM listings WHERE vin = ?').get(vin),
  };
}

export function isCacheStale(db, now = new Date()) {
  const settings = getSettings(db);
  if (!settings.lastAutoSyncAt) return true;
  const lastMs = Date.parse(settings.lastAutoSyncAt);
  if (Number.isNaN(lastMs)) return true;
  const ageHours = (now.getTime() - lastMs) / (3600 * 1000);
  return ageHours >= settings.syncIntervalHours;
}
