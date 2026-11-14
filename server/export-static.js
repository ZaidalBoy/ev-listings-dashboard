import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, getQuotaSummary, getSettings } from './db.js';
import { seedDemoDatabase } from './seedData.js';
import { hasLiveApiKey, isCacheStale } from './autodevClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(__dirname, '../public/data/dashboard.json');

const db = createDatabase();
seedDemoDatabase(db);

const listings = db
  .prepare('SELECT * FROM listings ORDER BY updated_at DESC')
  .all()
  .map((row) => {
    let priceHistory = [];
    try {
      priceHistory = JSON.parse(row.price_history || '[]');
    } catch {
      priceHistory = [];
    }
    return {
      vin: row.vin,
      year: row.year,
      make: row.make,
      model: row.model,
      trim: row.trim,
      body_style: row.body_style,
      drivetrain: row.drivetrain,
      fuel: row.fuel,
      exterior_color: row.exterior_color,
      interior_color: row.interior_color,
      price: row.price,
      previous_price: row.previous_price,
      miles: row.miles,
      condition: row.condition,
      dealer: row.dealer,
      city: row.city,
      state: row.state,
      zip: row.zip,
      vdp_url: row.vdp_url,
      carfax_url: row.carfax_url,
      primary_image:
        row.primary_image && row.primary_image.startsWith('/images/')
          ? `.${row.primary_image}`
          : row.primary_image,
      is_starred: Boolean(row.is_starred),
      notes: row.notes || '',
      source: row.source,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      updated_at: row.updated_at,
      removed_at: row.removed_at,
      price_history: priceHistory,
    };
  });

const allStats = db
  .prepare(
    `SELECT
      COUNT(*) as totalListings,
      ROUND(AVG(price)) as avgPrice,
      MIN(price) as minPrice,
      SUM(CASE WHEN previous_price IS NOT NULL AND price < previous_price THEN 1 ELSE 0 END) as priceDropsCount,
      SUM(CASE WHEN is_starred = 1 THEN 1 ELSE 0 END) as starredCount,
      MAX(last_seen_at) as lastCacheUpdate
     FROM listings`
  )
  .get();

const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const newTodayCount = db
  .prepare('SELECT COUNT(*) as c FROM listings WHERE first_seen_at >= ?')
  .get(oneDayAgo).c;

const makeFacets = db
  .prepare('SELECT make, COUNT(*) as count FROM listings GROUP BY make ORDER BY count DESC, make ASC')
  .all();
const stateFacets = db
  .prepare("SELECT state, COUNT(*) as count FROM listings WHERE state IS NOT NULL AND state != '' GROUP BY state ORDER BY count DESC, state ASC")
  .all();

const snapshots = db.prepare('SELECT * FROM sync_snapshots ORDER BY id DESC LIMIT 12').all();
const recentCalls = db.prepare('SELECT * FROM api_call_log ORDER BY id DESC LIMIT 20').all();
const settings = getSettings(db);
const quota = getQuotaSummary(db);

const payload = {
  generatedAt: new Date().toISOString(),
  staticSnapshot: true,
  listings,
  kpis: {
    totalListings: allStats.totalListings || 0,
    avgPrice: allStats.avgPrice || 0,
    minPrice: allStats.minPrice || 0,
    priceDropsCount: allStats.priceDropsCount || 0,
    newTodayCount: newTodayCount || 0,
    starredCount: allStats.starredCount || 0,
    lastCacheUpdate: allStats.lastCacheUpdate || null,
  },
  facets: {
    makes: makeFacets,
    states: stateFacets,
  },
  quota,
  settings,
  cacheStatus: {
    isStale: isCacheStale(db),
    lastAutoSyncAt: settings.lastAutoSyncAt || null,
    syncIntervalHours: settings.syncIntervalHours,
    liveApiConfigured: hasLiveApiKey(),
    mode: hasLiveApiKey() ? 'live' : 'demo',
  },
  snapshots,
  recentCalls,
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
console.log(`Exported static dashboard snapshot (${listings.length} EVs) -> ${OUT_FILE}`);
