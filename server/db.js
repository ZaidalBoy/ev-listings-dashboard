import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(__dirname, '../data/ev_dashboard.db');

const MAX_MODEL_YEAR = new Date().getUTCFullYear() + 1;

export const DEFAULT_WATCHLIST_PRESETS = [
  {
    id: 'ioniq5-91311',
    label: 'Hyundai Ioniq 5 · ZIP 91311 (+200 mi)',
    description: 'Used & CPO 2025+ Hyundai Ioniq 5 up to $50,000 within 200 mi of 91311, sorted by updatedAt.desc',
    enabled: true,
    params: {
      'vehicle.make': 'Hyundai',
      'vehicle.model': 'Ioniq 5',
      'vehicle.year': `2025-${MAX_MODEL_YEAR}`,
      'retailListing.price': '1-50000',
      'retailListing.used': 'true',
      zip: '91311',
      distance: 200,
      sort: 'updatedAt.desc',
      limit: 20,
    },
  },
  {
    id: 'ioniq5-94107',
    label: 'Hyundai Ioniq 5 · ZIP 94107 (+200 mi)',
    description: 'Used & CPO 2025+ Hyundai Ioniq 5 up to $50,000 within 200 mi of 94107, sorted by updatedAt.desc',
    enabled: true,
    params: {
      'vehicle.make': 'Hyundai',
      'vehicle.model': 'Ioniq 5',
      'vehicle.year': `2025-${MAX_MODEL_YEAR}`,
      'retailListing.price': '1-50000',
      'retailListing.used': 'true',
      zip: '94107',
      distance: 200,
      sort: 'updatedAt.desc',
      limit: 20,
    },
  },
  {
    id: 'lucid-air-91311',
    label: 'Lucid Air · ZIP 91311 (+200 mi)',
    description: 'Used & CPO 2025+ Lucid Air up to $50,000 within 200 mi of 91311, sorted by updatedAt.desc',
    enabled: true,
    params: {
      'vehicle.make': 'Lucid',
      'vehicle.model': 'Air',
      'vehicle.year': `2025-${MAX_MODEL_YEAR}`,
      'retailListing.price': '1-50000',
      'retailListing.used': 'true',
      zip: '91311',
      distance: 200,
      sort: 'updatedAt.desc',
      limit: 20,
    },
  },
  {
    id: 'lucid-air-94107',
    label: 'Lucid Air · ZIP 94107 (+200 mi)',
    description: 'Used & CPO 2025+ Lucid Air up to $50,000 within 200 mi of 94107, sorted by updatedAt.desc',
    enabled: true,
    params: {
      'vehicle.make': 'Lucid',
      'vehicle.model': 'Air',
      'vehicle.year': `2025-${MAX_MODEL_YEAR}`,
      'retailListing.price': '1-50000',
      'retailListing.used': 'true',
      zip: '94107',
      distance: 200,
      sort: 'updatedAt.desc',
      limit: 20,
    },
  },
];

export function getMonthKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function createDatabase(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS listings (
      vin TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      make TEXT NOT NULL,
      model TEXT NOT NULL,
      trim TEXT,
      body_style TEXT,
      drivetrain TEXT,
      fuel TEXT DEFAULT 'Electric',
      exterior_color TEXT,
      interior_color TEXT,
      price INTEGER,
      previous_price INTEGER,
      miles INTEGER,
      condition TEXT DEFAULT 'used',
      dealer TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      vdp_url TEXT,
      carfax_url TEXT,
      primary_image TEXT,
      is_starred INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      source TEXT DEFAULT 'seed',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      removed_at TEXT,
      price_history TEXT DEFAULT '[]',
      raw_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_listings_make ON listings(make);
    CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
    CREATE INDEX IF NOT EXISTS idx_listings_state ON listings(state);
    CREATE INDEX IF NOT EXISTS idx_listings_last_seen ON listings(last_seen_at);

    CREATE TABLE IF NOT EXISTS sync_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      trigger_type TEXT NOT NULL,
      mode TEXT NOT NULL,
      calls_used INTEGER DEFAULT 0,
      listings_fetched INTEGER DEFAULT 0,
      new_listings INTEGER DEFAULT 0,
      price_drops INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      error_message TEXT,
      query_summary TEXT
    );

    CREATE TABLE IF NOT EXISTS api_call_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      called_at TEXT NOT NULL,
      month_key TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      query_params TEXT,
      status_code INTEGER,
      latency_ms INTEGER,
      rows_returned INTEGER DEFAULT 0,
      counted_against_quota INTEGER DEFAULT 1,
      trigger_type TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_api_call_month ON api_call_log(month_key, counted_against_quota);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const defaults = {
    syncMode: 'daily_auto',
    syncIntervalHours: String(Number(process.env.SYNC_INTERVAL_HOURS) || 24),
    monthlyCap: String(Number(process.env.MONTHLY_CALL_CAP) || 1000),
    reserveBuffer: String(Number(process.env.QUOTA_RESERVE_BUFFER) || 50),
    maxCallsPerSync: String(Number(process.env.DAILY_SYNC_MAX_CALLS) || 40),
    backfillPagesPerPreset: '10',
    dailyPagesPerPreset: '3',
    zip: '',
    distance: '200',
    stateFilter: '',
    lastAutoSyncAt: '',
    lastLiveSyncAt: '',
    watchlistPresets: JSON.stringify(DEFAULT_WATCHLIST_PRESETS),
  };

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of Object.entries(defaults)) {
    insertSetting.run(key, value);
  }

  return db;
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  let presets = DEFAULT_WATCHLIST_PRESETS;
  try {
    if (map.watchlistPresets) {
      presets = JSON.parse(map.watchlistPresets);
    }
  } catch {
    presets = DEFAULT_WATCHLIST_PRESETS;
  }
  return {
    syncMode: map.syncMode === 'manual_only' ? 'manual_only' : 'daily_auto',
    syncIntervalHours: Math.max(1, Number(map.syncIntervalHours) || 24),
    monthlyCap: Math.max(1, Number(map.monthlyCap) || 1000),
    reserveBuffer: Math.max(0, Number(map.reserveBuffer) || 50),
    maxCallsPerSync: Math.max(1, Number(map.maxCallsPerSync) || 40),
    backfillPagesPerPreset: Math.min(15, Math.max(1, Number(map.backfillPagesPerPreset) || 10)),
    dailyPagesPerPreset: Math.min(10, Math.max(1, Number(map.dailyPagesPerPreset) || 3)),
    zip: map.zip || '',
    distance: Number(map.distance) || 200,
    stateFilter: map.stateFilter || '',
    lastAutoSyncAt: map.lastAutoSyncAt || '',
    lastLiveSyncAt: map.lastLiveSyncAt || '',
    watchlistPresets: presets,
  };
}

export function updateSettings(db, patch) {
  const allowed = [
    'syncMode',
    'syncIntervalHours',
    'monthlyCap',
    'reserveBuffer',
    'maxCallsPerSync',
    'backfillPagesPerPreset',
    'dailyPagesPerPreset',
    'zip',
    'distance',
    'stateFilter',
    'lastAutoSyncAt',
    'lastLiveSyncAt',
    'watchlistPresets',
  ];
  const upsert = db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      const val =
        key === 'watchlistPresets' && typeof patch[key] !== 'string'
          ? JSON.stringify(patch[key])
          : String(patch[key]);
      upsert.run(key, val);
    }
  }
  return getSettings(db);
}

export function getQuotaSummary(db, now = new Date()) {
  const settings = getSettings(db);
  const monthKey = getMonthKey(now);
  const row = db
    .prepare(
      'SELECT COUNT(*) as used FROM api_call_log WHERE month_key = ? AND counted_against_quota = 1'
    )
    .get(monthKey);
  const used = Number(row?.used || 0);
  const remaining = Math.max(0, settings.monthlyCap - used);
  const autoSyncBudgetRemaining = Math.max(
    0,
    settings.monthlyCap - settings.reserveBuffer - used
  );

  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const daysRemaining = Math.max(1, daysInMonth - dayOfMonth + 1);
  const dailyBurnRate = Number((used / Math.max(1, dayOfMonth)).toFixed(2));
  const projectedMonthEnd = Math.round(dailyBurnRate * daysInMonth);
  const safeDailyBudget = Number((remaining / daysRemaining).toFixed(1));

  // Last 14 days breakdown for chart
  const recentRows = db
    .prepare(
      `SELECT substr(called_at, 1, 10) as day,
              SUM(CASE WHEN counted_against_quota = 1 THEN 1 ELSE 0 END) as live_calls,
              SUM(CASE WHEN counted_against_quota = 0 THEN 1 ELSE 0 END) as cached_or_demo
       FROM api_call_log
       WHERE month_key = ?
       GROUP BY day
       ORDER BY day ASC`
    )
    .all(monthKey);

  return {
    monthKey,
    used,
    cap: settings.monthlyCap,
    remaining,
    reserveBuffer: settings.reserveBuffer,
    autoSyncBudgetRemaining,
    pctUsed: Number(((used / settings.monthlyCap) * 100).toFixed(1)),
    dayOfMonth,
    daysInMonth,
    daysRemaining,
    dailyBurnRate,
    projectedMonthEnd,
    safeDailyBudget,
    dailyHistory: recentRows,
  };
}
