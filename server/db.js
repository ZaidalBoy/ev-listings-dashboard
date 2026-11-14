import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(__dirname, '../data/ev_dashboard.db');

export const DEFAULT_WATCHLIST_PRESETS = [
  {
    id: 'ev-pure-brands',
    label: 'Pure EV Makers (Tesla, Rivian, Lucid, Polestar)',
    description: 'Captures Tesla, Rivian, Lucid & Polestar listings in 1 consolidated call',
    enabled: true,
    params: {
      'vehicle.make': 'Tesla,Rivian,Lucid,Polestar',
      'vehicle.fuel': 'Electric',
      sort: 'updatedAt.desc',
      limit: 20,
    },
  },
  {
    id: 'ev-korean-crossovers',
    label: 'Hyundai & Kia EVs (Ioniq 5/6, EV6, EV9, Niro)',
    description: 'High-demand E-GMP crossovers & sedans in 1 consolidated call',
    enabled: true,
    params: {
      'vehicle.make': 'Hyundai,Kia',
      'vehicle.model': 'Ioniq 5,Ioniq 6,EV6,EV9,Niro EV,Kona Electric',
      sort: 'updatedAt.desc',
      limit: 20,
    },
  },
  {
    id: 'ev-us-oem',
    label: 'US OEM EVs (Mach-E, Lightning, Bolt, Equinox, Blazer)',
    description: 'Ford, Chevrolet & Cadillac EVs in 1 consolidated call',
    enabled: true,
    params: {
      'vehicle.make': 'Ford,Chevrolet,Cadillac',
      'vehicle.model': 'Mustang Mach-E,F-150 Lightning,Bolt EV,Bolt EUV,Equinox EV,Blazer EV,LYRIQ',
      sort: 'updatedAt.desc',
      limit: 20,
    },
  },
  {
    id: 'ev-luxury-euro',
    label: 'European EVs (BMW, Porsche, VW, Volvo, Audi)',
    description: 'Optional 4th call for i4, iX, Taycan, ID.4, EX30 & Q4/Q8 e-tron',
    enabled: false,
    params: {
      'vehicle.make': 'BMW,Porsche,Volkswagen,Volvo,Audi',
      'vehicle.fuel': 'Electric',
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
    maxCallsPerSync: String(Number(process.env.DAILY_SYNC_MAX_CALLS) || 5),
    zip: '',
    distance: '100',
    stateFilter: '',
    lastAutoSyncAt: '',
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
    maxCallsPerSync: Math.max(1, Number(map.maxCallsPerSync) || 5),
    zip: map.zip || '',
    distance: Number(map.distance) || 100,
    stateFilter: map.stateFilter || '',
    lastAutoSyncAt: map.lastAutoSyncAt || '',
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
    'zip',
    'distance',
    'stateFilter',
    'lastAutoSyncAt',
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
