import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, getMonthKey, getQuotaSummary, updateSettings } from '../server/db.js';
import { seedDemoDatabase } from '../server/seedData.js';
import { buildSyncPlan, executeSync, isCacheStale, upsertListingRecord, normalizeListingRow } from '../server/autodevClient.js';

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
      year: 2024,
      make: 'Tesla',
      model: 'Model Y',
      trim: 'Long Range',
      bodyStyle: 'SUV',
      fuel: 'Electric',
    },
    retailListing: {
      price: 42000,
      miles: 5000,
      used: true,
      cpo: false,
      dealer: 'Test EV',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
    },
  };

  const first = upsertListingRecord(db, normalizeListingRow(raw), 'autodev');
  assert.equal(first.isNew, true);
  assert.equal(first.isPriceDrop, false);

  raw.retailListing.price = 39500;
  const second = upsertListingRecord(db, normalizeListingRow(raw), 'autodev');
  assert.equal(second.isNew, false);
  assert.equal(second.isPriceDrop, true);

  const saved = db.prepare('SELECT price, previous_price, price_history FROM listings WHERE vin = ?').get('7SAYGDEE5PF000001');
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
