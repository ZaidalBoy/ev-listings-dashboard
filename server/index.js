import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createDatabase,
  getQuotaSummary,
  getSettings,
  updateSettings,
} from './db.js';
import { seedDemoDatabase } from './seedData.js';
import {
  buildSyncPlan,
  executeSync,
  hasLiveApiKey,
  isCacheStale,
  refreshSingleVin,
} from './autodevClient.js';
import { importLucidHtmlToDb } from './import-lucid.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

export function createApp({ dbPath } = {}) {
  const db = createDatabase(dbPath);
  seedDemoDatabase(db);

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, liveApiConfigured: hasLiveApiKey() });
  });

  // Pure local SQLite read — NEVER triggers an external Auto.dev API call
  app.get('/api/dashboard', (req, res) => {
    const {
      q = '',
      make = '',
      condition = '',
      drivetrain = '',
      source = '',
      state = '',
      maxPrice = '',
      minYear = '',
      maxMiles = '',
      onlyStarred = '',
      onlyDrops = '',
      onlyNew = '',
      showSold = '',
      sort = 'updated_desc',
    } = req.query;

    const where = ['1=1'];
    const params = [];

    if (!(showSold === 'true' || showSold === '1')) {
      where.push('removed_at IS NULL');
    }
    if (q) {
      where.push(
        '(make LIKE ? OR model LIKE ? OR trim LIKE ? OR drivetrain LIKE ? OR exterior_color LIKE ? OR vin LIKE ? OR city LIKE ? OR dealer LIKE ?)'
      );
      const like = `%${String(q).trim()}%`;
      params.push(like, like, like, like, like, like, like, like);
    }
    if (make) {
      where.push('make = ?');
      params.push(String(make));
    }
    if (condition) {
      where.push('condition = ?');
      params.push(String(condition));
    }
    if (drivetrain) {
      where.push('UPPER(drivetrain) = ?');
      params.push(String(drivetrain).toUpperCase());
    }
    if (source) {
      where.push('source = ?');
      params.push(String(source));
    }
    if (state) {
      where.push('state = ?');
      params.push(String(state).toUpperCase());
    }
    if (maxPrice && Number(maxPrice) > 0) {
      where.push('price <= ?');
      params.push(Number(maxPrice));
    }
    if (minYear && Number(minYear) > 0) {
      where.push('year >= ?');
      params.push(Number(minYear));
    }
    if (maxMiles && Number(maxMiles) > 0) {
      where.push('miles <= ?');
      params.push(Number(maxMiles));
    }
    if (onlyStarred === 'true' || onlyStarred === '1') {
      where.push('is_starred = 1');
    }
    if (onlyDrops === 'true' || onlyDrops === '1') {
      where.push('previous_price IS NOT NULL AND price < previous_price');
    }
    if (onlyNew === 'true' || onlyNew === '1') {
      const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      where.push('first_seen_at >= ?');
      params.push(oneDayAgo);
    }

    const sortMap = {
      updated_desc: 'updated_at DESC',
      price_asc: 'COALESCE(price, 999999999) ASC',
      price_desc: 'COALESCE(price, 0) DESC',
      miles_asc: 'COALESCE(miles, 999999999) ASC',
      year_desc: 'year DESC, COALESCE(price, 999999999) ASC',
      drop_desc: 'COALESCE(previous_price - price, 0) DESC',
    };
    const orderBy = sortMap[sort] || sortMap.updated_desc;

    const listings = db
      .prepare(`SELECT * FROM listings WHERE ${where.join(' AND ')} ORDER BY ${orderBy}`)
      .all(...params)
      .map((row) => ({
        ...row,
        is_starred: Boolean(row.is_starred),
        price_history: (() => {
          try {
            return JSON.parse(row.price_history || '[]');
          } catch {
            return [];
          }
        })(),
      }));

    // Summary stats across ALL active cached EVs (not just filtered view)
    const allStats = db
      .prepare(
        `SELECT
          COUNT(*) as totalListings,
          ROUND(AVG(price)) as avgPrice,
          MIN(price) as minPrice,
          SUM(CASE WHEN previous_price IS NOT NULL AND price < previous_price THEN 1 ELSE 0 END) as priceDropsCount,
          SUM(CASE WHEN is_starred = 1 THEN 1 ELSE 0 END) as starredCount,
          MAX(last_seen_at) as lastCacheUpdate
         FROM listings
         WHERE removed_at IS NULL`
      )
      .get();

    const soldCount = db
      .prepare('SELECT COUNT(*) as c FROM listings WHERE removed_at IS NOT NULL')
      .get().c;

    const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const newTodayCount = db
      .prepare('SELECT COUNT(*) as c FROM listings WHERE removed_at IS NULL AND first_seen_at >= ?')
      .get(oneDayAgo).c;

    const makeFacets = db
      .prepare('SELECT make, COUNT(*) as count FROM listings WHERE removed_at IS NULL GROUP BY make ORDER BY count DESC, make ASC')
      .all();
    const stateFacets = db
      .prepare("SELECT state, COUNT(*) as count FROM listings WHERE removed_at IS NULL AND state IS NOT NULL AND state != '' GROUP BY state ORDER BY count DESC, state ASC")
      .all();

    const snapshots = db
      .prepare('SELECT * FROM sync_snapshots ORDER BY id DESC LIMIT 12')
      .all();
    const recentCalls = db
      .prepare('SELECT * FROM api_call_log ORDER BY id DESC LIMIT 20')
      .all();

    const settings = getSettings(db);
    const quota = getQuotaSummary(db);
    const stale = isCacheStale(db);

    res.json({
      listings,
      kpis: {
        totalListings: allStats.totalListings || 0,
        avgPrice: allStats.avgPrice || 0,
        minPrice: allStats.minPrice || 0,
        priceDropsCount: allStats.priceDropsCount || 0,
        newTodayCount: newTodayCount || 0,
        starredCount: allStats.starredCount || 0,
        soldCount: soldCount || 0,
        lastCacheUpdate: allStats.lastCacheUpdate || null,
      },
      facets: {
        makes: makeFacets,
        states: stateFacets,
      },
      quota,
      settings,
      cacheStatus: {
        isStale: stale,
        lastAutoSyncAt: settings.lastAutoSyncAt || null,
        syncIntervalHours: settings.syncIntervalHours,
        liveApiConfigured: hasLiveApiKey(),
        mode: hasLiveApiKey() ? 'live' : 'demo',
      },
      snapshots,
      recentCalls,
    });
  });

  // Safe auto-sync check called once on app mount; skips immediately if cache is fresh or mode is manual_only
  app.post('/api/sync/auto-check', async (_req, res) => {
    const settings = getSettings(db);
    if (settings.syncMode !== 'daily_auto') {
      return res.json({ triggered: false, reason: 'Sync mode is set to Manual Only.' });
    }
    if (!isCacheStale(db)) {
      return res.json({ triggered: false, reason: 'Cache is fresh within 24h window (0 API calls used).' });
    }
    if (!hasLiveApiKey()) {
      return res.json({
        triggered: false,
        reason: 'Demo mode active (no AUTODEV_API_KEY configured). Using cached EV seed snapshot.',
      });
    }
    const result = await executeSync(db, { triggerType: 'auto_daily' });
    return res.json({ triggered: true, result });
  });

  // Dry-run cost preview — always 0 API calls
  app.post('/api/sync/preview', (req, res) => {
    const plan = buildSyncPlan(db, {
      ...(req.body || {}),
      triggerType: 'manual',
    });
    res.json(plan);
  });

  // Explicit manual sync
  app.post('/api/sync/run', async (req, res) => {
    try {
      const result = await executeSync(db, {
        ...(req.body || {}),
        triggerType: 'manual',
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Zero-cost import from saved Lucid Motors MHTML/HTML page
  app.post('/api/import/lucid', (req, res) => {
    try {
      const { rawContent, filename } = req.body || {};
      if (!rawContent || typeof rawContent !== 'string') {
        return res.status(400).json({ error: 'Missing rawContent HTML/MHTML string.' });
      }
      const result = importLucidHtmlToDb(db, rawContent, filename || 'browser-upload');
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Single-VIN live verification (explicitly spends 1 API call)
  app.post('/api/listings/:vin/refresh', async (req, res) => {
    try {
      const result = await refreshSingleVin(db, req.params.vin);
      res.json(result);
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  // Star, local notes & manual sold/removed toggle (0 API calls)
  app.patch('/api/listings/:vin', (req, res) => {
    const { is_starred, notes, removed_at } = req.body || {};
    const existing = db.prepare('SELECT vin FROM listings WHERE vin = ?').get(req.params.vin);
    if (!existing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    if (is_starred !== undefined) {
      db.prepare('UPDATE listings SET is_starred = ? WHERE vin = ?').run(
        is_starred ? 1 : 0,
        req.params.vin
      );
    }
    if (notes !== undefined) {
      db.prepare('UPDATE listings SET notes = ? WHERE vin = ?').run(
        String(notes),
        req.params.vin
      );
    }
    if (removed_at !== undefined) {
      const nextRemovedAt =
        removed_at === null || removed_at === '' || removed_at === false
          ? null
          : typeof removed_at === 'string'
            ? removed_at
            : new Date().toISOString();
      db.prepare('UPDATE listings SET removed_at = ? WHERE vin = ?').run(
        nextRemovedAt,
        req.params.vin
      );
    }
    const updated = db.prepare('SELECT * FROM listings WHERE vin = ?').get(req.params.vin);
    res.json({
      ...updated,
      is_starred: Boolean(updated.is_starred),
    });
  });

  // Update sync cadence & quota guardrails (0 API calls)
  app.put('/api/settings', (req, res) => {
    const updated = updateSettings(db, req.body || {});
    res.json({ settings: updated, quota: getQuotaSummary(db) });
  });

  // Reset demo seed (0 API calls)
  app.post('/api/demo/reset', (_req, res) => {
    const result = seedDemoDatabase(db, { force: true });
    res.json(result);
  });

  // Serve built Vite frontend when available
  const distDir = path.resolve(__dirname, '../dist');
  const publicDir = path.resolve(__dirname, '../public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return { app, db };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { app } = createApp();
  app.listen(PORT, () => {
    console.log(
      `EV Listings Dashboard API running on http://localhost:${PORT} (mode: ${
        hasLiveApiKey() ? 'LIVE Auto.dev' : 'DEMO Seed'
      })`
    );
  });
}
