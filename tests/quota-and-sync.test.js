import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDatabase,
  getMonthKey,
  getQuotaSummary,
  getSettings,
  updateSettings,
} from '../server/db.js';
import { seedDemoDatabase } from '../server/seedData.js';
import {
  buildSyncPlan,
  executeSync,
  isCacheStale,
  upsertListingRecord,
  normalizeListingRow,
} from '../server/autodevClient.js';

test('seedDemoDatabase populates EV listings with 0 counted API calls', () => {
  const db = createDatabase(':memory:');
  const seeded = seedDemoDatabase(db);
  assert.equal(seeded.seeded, true);
  assert.ok(seeded.count >= 20);

  const quota = getQuotaSummary(db);
  assert.equal(quota.used, 0);
  assert.equal(quota.cap, 1000);
  assert.equal(quota.remaining, 1000);
});

test('default presets target Ioniq 5 and Lucid Air in ZIPs 91311 and 94107 (2025+, <=$50k, updatedAt.desc)', () => {
  const db = createDatabase(':memory:');
  const settings = getSettings(db);
  assert.equal(settings.watchlistPresets.length, 4);

  const ids = settings.watchlistPresets.map((p) => p.id);
  assert.deepEqual(ids, ['ioniq5-91311', 'ioniq5-94107', 'lucid-air-91311', 'lucid-air-94107']);

  for (const p of settings.watchlistPresets) {
    assert.equal(p.enabled, true);
    assert.equal(p.params.distance, 200);
    assert.equal(p.params['retailListing.price'], '1-50000');
    assert.equal(p.params['retailListing.used'], 'true');
    assert.ok(p.params['vehicle.year'].startsWith('2025-'));
    assert.equal(p.params.sort, 'updatedAt.desc');
    assert.equal(p.params.limit, 20);
  }
});

test('buildSyncPlan schedules 10 pages/preset on Day 1 backfill and 3 pages/preset with updatedAt on Day 2+', () => {
  const db = createDatabase(':memory:');

  // Day 1 (no lastLiveSyncAt): auto -> backfill (10 pages * 4 presets = 40 calls)
  const day1 = buildSyncPlan(db, { triggerType: 'cli', syncProfile: 'auto' });
  assert.equal(day1.syncProfile, 'backfill');
  assert.equal(day1.pagesPerQuery, 10);
  assert.equal(day1.callsPlanned, 40);
  assert.equal(day1.updatedSince, null);
  assert.equal(day1.queries[0].params.updatedAt, undefined);

  // Day 2+ (after lastLiveSyncAt is recorded): auto -> daily (3 pages * 4 presets = 12 calls + updatedAt)
  updateSettings(db, { lastLiveSyncAt: '2026-11-13T13:00:00.000Z' });
  const day2 = buildSyncPlan(db, { triggerType: 'cli', syncProfile: 'auto' });
  assert.equal(day2.syncProfile, 'daily');
  assert.equal(day2.pagesPerQuery, 3);
  assert.equal(day2.callsPlanned, 12);
  assert.equal(day2.updatedSince, '2026-11-13T13:00:00');
  assert.equal(day2.queries[0].params.updatedAt, '2026-11-13T13:00:00-');
});

test('executeSync live mode stops early on short pages (<20 rows) and purges seed rows', async () => {
  const db = createDatabase(':memory:');
  seedDemoDatabase(db);
  process.env.AUTODEV_API_KEY = 'test-key';

  let mockFetchCalls = 0;
  const mockFetch = async (url) => {
    mockFetchCalls++;
    const u = new URL(url);
    const model = u.searchParams.get('vehicle.model');
    // Return only 2 listings for each preset on page 1 (<20), so pages 2..10 are skipped!
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            vin: `TEST${mockFetchCalls}00000000001`.slice(0, 17),
            createdAt: '2026-11-13T12:00:00Z',
            updatedAt: '2026-11-13T12:00:00Z',
            vehicle: {
              year: 2025,
              make: model === 'Air' ? 'Lucid' : 'Hyundai',
              model,
              trim: 'Limited',
              bodyStyle: model === 'Air' ? 'Sedan' : 'SUV',
              fuel: 'Electric',
            },
            retailListing: {
              price: 45900,
              miles: 1200,
              used: true,
              cpo: false,
              dealer: 'SoCal EV',
              city: 'Chatsworth',
              state: 'CA',
              zip: u.searchParams.get('zip'),
            },
          },
        ],
      }),
    };
  };

  try {
    const res = await executeSync(db, { triggerType: 'cli', syncProfile: 'auto' }, mockFetch);
    assert.equal(res.status, 'completed');
    assert.equal(res.mode, 'live');
    assert.equal(res.callsUsed, 4); // 1 call per preset instead of 40!
    assert.equal(res.callsSavedByEarlyStop, 36);
    assert.equal(res.listingsFetched, 4);

    // Verify demo seed rows were cleared and only real live listings remain
    const remaining = db.prepare('SELECT COUNT(*) as c, source FROM listings GROUP BY source').all();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].source, 'autodev');
    assert.equal(remaining[0].c, 4);
  } finally {
    delete process.env.AUTODEV_API_KEY;
  }
});

test('buildSyncPlan enforces maxCallsPerSync and reserveBuffer for automated syncs', () => {
  const db = createDatabase(':memory:');
  seedDemoDatabase(db);
  updateSettings(db, { monthlyCap: 1000, reserveBuffer: 50, maxCallsPerSync: 2 });

  const monthKey = getMonthKey();
  const insertCall = db.prepare(
    `INSERT INTO api_call_log (called_at, month_key, endpoint, query_params, status_code, latency_ms, rows_returned, counted_against_quota, trigger_type)
     VALUES (?, ?, '/listings', 'test', 200, 50, 20, 1, 'manual')`
  );
  for (let i = 0; i < 955; i++) {
    insertCall.run(new Date().toISOString(), monthKey);
  }

  const autoPlan = buildSyncPlan(db, { triggerType: 'auto_daily' });
  assert.ok(autoPlan.blockedReason.includes('emergency reserve'));
  assert.equal(autoPlan.callsPlanned, 0);

  // Manual sync can still use remaining 45 calls, capped at maxCallsPerSync (2)
  const manualPlan = buildSyncPlan(db, { triggerType: 'manual' });
  assert.equal(manualPlan.blockedReason, null);
  assert.equal(manualPlan.callsPlanned, 2);
});

test('isCacheStale respects 24h TTL window to avoid API calls on every dashboard open', () => {
  const db = createDatabase(':memory:');
  updateSettings(db, { syncIntervalHours: 24, lastAutoSyncAt: '' });
  assert.equal(isCacheStale(db), true);

  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  updateSettings(db, { lastAutoSyncAt: twoHoursAgo });
  assert.equal(isCacheStale(db), false);

  const twentyFiveHoursAgo = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  updateSettings(db, { lastAutoSyncAt: twentyFiveHoursAgo });
  assert.equal(isCacheStale(db), true);
});

test('upsertListingRecord detects new listings and price drops across snapshots', () => {
  const db = createDatabase(':memory:');
  const raw = {
    vin: '7SAYGDEE5PF000001',
    createdAt: '2026-11-12T10:00:00Z',
    updatedAt: '2026-11-12T10:00:00Z',
    vehicle: {
      vin: '7SAYGDEE5PF000001',
      year: 2025,
      make: 'Hyundai',
      model: 'Ioniq 5',
      trim: 'Limited',
      bodyStyle: 'SUV',
      fuel: 'Electric',
    },
    retailListing: {
      price: 42000,
      miles: 5000,
      used: true,
      cpo: false,
      dealer: 'Test EV',
      city: 'Chatsworth',
      state: 'CA',
      zip: '91311',
    },
  };

  const first = upsertListingRecord(db, normalizeListingRow(raw), 'autodev');
  assert.equal(first.isNew, true);
  assert.equal(first.isPriceDrop, false);

  raw.retailListing.price = 39500;
  const second = upsertListingRecord(db, normalizeListingRow(raw), 'autodev');
  assert.equal(second.isNew, false);
  assert.equal(second.isPriceDrop, true);

  const saved = db
    .prepare('SELECT price, previous_price, price_history FROM listings WHERE vin = ?')
    .get('7SAYGDEE5PF000001');
  assert.equal(saved.price, 39500);
  assert.equal(saved.previous_price, 42000);
  assert.equal(JSON.parse(saved.price_history).length, 2);
});

test('executeSync in demo mode consumes 0 live API quota calls', async () => {
  const db = createDatabase(':memory:');
  seedDemoDatabase(db);
  delete process.env.AUTODEV_API_KEY;
  delete process.env.AUTO_DEV_API_KEY;

  const res = await executeSync(db, { triggerType: 'manual' });
  assert.equal(res.status, 'completed');
  assert.equal(res.mode, 'demo');
  assert.equal(res.callsUsed, 0);

  const quota = getQuotaSummary(db);
  assert.equal(quota.used, 0);
});
