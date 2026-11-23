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
import { importLucidHtmlToDb } from '../server/import-lucid.js';
import { parseLucidMhtml } from '../src/utils/lucidMhtmlParser.js';

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
    assert.equal(p.params.distance, 300);
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

test('parseLucidMhtml and importLucidHtmlToDb decode MHTML, deduplicate Auto.dev matches, and use 0 API calls', () => {
  const db = createDatabase(':memory:');
  upsertListingRecord(
    db,
    {
      vin: '50EA1TEA6SA009069',
      year: 2025,
      make: 'Lucid',
      model: 'Air',
      trim: 'Touring',
      bodyStyle: 'Car',
      drivetrain: 'AWD',
      fuel: 'Electric',
      exteriorColor: 'Zenith Red',
      interiorColor: 'Mojave',
      price: 47998,
      miles: 22626,
      condition: 'used',
      dealer: 'Lucid Westfield Valley Fair Studio',
      city: 'San Jose',
      state: 'CA',
      zip: '95050',
      vdpUrl: 'https://www.autolist.com/lucid-air#vin=50EA1TEA6SA009069',
      carfaxUrl: '',
      primaryImage: '',
      createdAt: '2026-11-13T10:00:00Z',
      updatedAt: '2026-11-13T10:00:00Z',
      removedAt: null,
      rawJson: '{}',
    },
    'autodev'
  );

  const sampleMhtml = [
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary="TESTBOUNDARY"',
    '',
    '--TESTBOUNDARY',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<div role=3D"group" aria-label=3D"vehicle card">',
    '<a href=3D"https://lucidmotors.com/inventory-vehicle?UUID=3Du1&amp;id=3D9100003864&amp;zip=3D91326"></a>',
    '<span>2025</span><h3>Air Touring</h3><p>Used</p><p>22,626 mi.</p><h3>$47,998</h3>',
    '<p>DreamDrive=E2=84=A2 Premium</p><p>Driver Assistance System</p>',
    '</div>',
    '<div role=3D"group" aria-label=3D"vehicle card">',
    '<a href=3D"https://lucidmotors.com/inventory-vehicle?UUID=3Du2&amp;id=3D9100005651&amp;zip=3D91326"></a>',
    '<span>2025</span><h3>Air Pure</h3><p>Used</p><p>12,977 mi.</p><h3>$44,098</h3>',
    '<p>DreamDrive=E2=84=A2 Pro</p><p>Driver Assistance System</p>',
    '</div>',
    '--TESTBOUNDARY--',
  ].join('\r\n');

  const parsed = parseLucidMhtml(sampleMhtml);
  assert.equal(parsed.length, 2);
  assert.ok(parsed[0].trim.includes('DreamDrive Premium'));

  const res = importLucidHtmlToDb(db, sampleMhtml, 'sample.mhtml');
  assert.equal(res.ok, true);
  assert.equal(res.matchedAutoDev, 1);
  assert.equal(res.importedDirect, 1);

  const rows = db.prepare('SELECT vin, source, trim FROM listings ORDER BY vin').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].vin, '50EA1TEA6SA009069');
  assert.ok(rows[0].trim.includes('DreamDrive Premium'));
  assert.equal(rows[1].vin, 'LUCID-9100005651');
  assert.equal(getQuotaSummary(db).used, 0);
});

test('clean full backfill stamps missing autodev rows as removed_at, preserves stars/notes/lucid_direct, and skips on daily or error runs', async () => {
  const db = createDatabase(':memory:');
  process.env.AUTODEV_API_KEY = 'test-key';

  const makeApiListing = (vin, model) => ({
    vin,
    createdAt: '2026-11-12T10:00:00Z',
    updatedAt: '2026-11-12T10:00:00Z',
    vehicle: {
      year: 2025,
      make: model === 'Air' ? 'Lucid' : 'Hyundai',
      model,
      trim: 'Limited',
      bodyStyle: model === 'Air' ? 'SUV' : 'SUV',
      fuel: 'Electric',
    },
    retailListing: {
      price: 41000,
      miles: 4000,
      used: true,
      cpo: false,
      dealer: 'Test EV',
      city: 'San Jose',
      state: 'CA',
      zip: '94107',
    },
  });

  // Seed two autodev cars (one starred with notes) + one lucid_direct car
  upsertListingRecord(db, normalizeListingRow(makeApiListing('AUTODEVACTIVE0001', 'Ioniq 5')), 'autodev');
  upsertListingRecord(db, normalizeListingRow(makeApiListing('AUTODEVSOLD000002', 'Ioniq 5')), 'autodev');
  db.prepare('UPDATE listings SET is_starred = 1, notes = ? WHERE vin = ?').run('My top pick', 'AUTODEVSOLD000002');
  upsertListingRecord(
    db,
    {
      vin: 'LUCID-DIRECT-KEEP',
      year: 2025,
      make: 'Lucid',
      model: 'Air',
      trim: 'Pure',
      bodyStyle: 'Sedan',
      drivetrain: 'RWD',
      fuel: 'Electric',
      exteriorColor: '',
      interiorColor: '',
      price: 44000,
      miles: 8000,
      condition: 'used',
      dealer: 'Lucid Direct',
      city: 'Los Angeles',
      state: 'CA',
      zip: '90001',
      vdpUrl: '',
      carfaxUrl: '',
      primaryImage: '',
      createdAt: '2026-11-12T10:00:00Z',
      updatedAt: '2026-11-12T10:00:00Z',
      removedAt: null,
      rawJson: '{}',
    },
    'lucid_direct'
  );

  try {
    // 1. Daily sync returning only 1 car must NOT mark AUTODEVSOLD000002 sold
    const dailyFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [makeApiListing('AUTODEVACTIVE0001', 'Ioniq 5')] }),
    });
    const dailyRes = await executeSync(db, { triggerType: 'cli', syncProfile: 'daily' }, dailyFetch);
    assert.equal(dailyRes.cleanFullBackfill, false);
    assert.equal(dailyRes.markedSold, 0);
    assert.equal(
      db.prepare('SELECT removed_at FROM listings WHERE vin = ?').get('AUTODEVSOLD000002').removed_at,
      null
    );

    // 2. Backfill with an API error on one preset must NOT mark AUTODEVSOLD000002 sold
    let errCall = 0;
    const partialErrorFetch = async () => {
      errCall++;
      if (errCall === 4) {
        return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [makeApiListing('AUTODEVACTIVE0001', 'Ioniq 5')] }),
      };
    };
    const errRes = await executeSync(db, { triggerType: 'cli', syncProfile: 'backfill' }, partialErrorFetch);
    assert.equal(errRes.cleanFullBackfill, false);
    assert.equal(errRes.markedSold, 0);
    assert.equal(
      db.prepare('SELECT removed_at FROM listings WHERE vin = ?').get('AUTODEVSOLD000002').removed_at,
      null
    );

    // 3. Clean full backfill stamps AUTODEVSOLD000002 as removed_at, preserves star+notes, and leaves lucid_direct active
    const cleanFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [makeApiListing('AUTODEVACTIVE0001', 'Ioniq 5')] }),
    });
    const cleanRes = await executeSync(db, { triggerType: 'cli', syncProfile: 'backfill' }, cleanFetch);
    assert.equal(cleanRes.cleanFullBackfill, true);
    assert.equal(cleanRes.markedSold, 1);

    const soldRow = db
      .prepare('SELECT removed_at, is_starred, notes FROM listings WHERE vin = ?')
      .get('AUTODEVSOLD000002');
    assert.ok(soldRow.removed_at);
    assert.equal(soldRow.is_starred, 1);
    assert.equal(soldRow.notes, 'My top pick');
    assert.equal(
      db.prepare('SELECT removed_at FROM listings WHERE vin = ?').get('LUCID-DIRECT-KEEP').removed_at,
      null
    );

    // 4. If AUTODEVSOLD000002 re-appears in a future sync, removed_at clears automatically
    const returnFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          makeApiListing('AUTODEVACTIVE0001', 'Ioniq 5'),
          makeApiListing('AUTODEVSOLD000002', 'Ioniq 5'),
        ],
      }),
    });
    await executeSync(db, { triggerType: 'cli', syncProfile: 'backfill' }, returnFetch);
    assert.equal(
      db.prepare('SELECT removed_at FROM listings WHERE vin = ?').get('AUTODEVSOLD000002').removed_at,
      null
    );
  } finally {
    delete process.env.AUTODEV_API_KEY;
  }
});

test('API dashboard hides removed_at by default, supports showSold=true, and toggles removed_at via PATCH', async () => {
  const { createApp } = await import('../server/index.js');
  const { app } = createApp({ dbPath: ':memory:' });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const initial = await (await fetch(`${baseUrl}/api/dashboard`)).json();
    const initialCount = initial.listings.length;
    assert.ok(initialCount > 0);
    assert.equal(initial.kpis.soldCount, 0);

    const targetVin = initial.listings[0].vin;
    const markRes = await fetch(`${baseUrl}/api/listings/${targetVin}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removed_at: '2026-11-23T00:00:00.000Z' }),
    });
    assert.equal(markRes.status, 200);

    const hiddenDash = await (await fetch(`${baseUrl}/api/dashboard`)).json();
    assert.equal(hiddenDash.listings.length, initialCount - 1);
    assert.equal(hiddenDash.kpis.totalListings, initialCount - 1);
    assert.equal(hiddenDash.kpis.soldCount, 1);
    assert.equal(hiddenDash.listings.some((l) => l.vin === targetVin), false);

    const shownDash = await (await fetch(`${baseUrl}/api/dashboard?showSold=true`)).json();
    assert.equal(shownDash.listings.length, initialCount);
    assert.equal(shownDash.kpis.totalListings, initialCount - 1);
    assert.equal(shownDash.kpis.soldCount, 1);
    assert.ok(shownDash.listings.find((l) => l.vin === targetVin)?.removed_at);

    // Restore back to active
    const restoreRes = await fetch(`${baseUrl}/api/listings/${targetVin}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removed_at: null }),
    });
    assert.equal(restoreRes.status, 200);

    const restoredDash = await (await fetch(`${baseUrl}/api/dashboard`)).json();
    assert.equal(restoredDash.listings.length, initialCount);
    assert.equal(restoredDash.kpis.soldCount, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

