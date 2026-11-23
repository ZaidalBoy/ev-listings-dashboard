import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_IONIQ5_CONFIG,
  estimateIoniq5Range,
  normalizeIoniq5Trim,
  rankIoniq5Listings,
} from '../src/utils/evRanker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('normalizeIoniq5Trim maps dealer trim variants cleanly', () => {
  assert.equal(normalizeIoniq5Trim('SEL Sport Utility 4D'), 'SEL');
  assert.equal(normalizeIoniq5Trim('SEL'), 'SEL');
  assert.equal(normalizeIoniq5Trim('Limited'), 'Limited');
  assert.equal(normalizeIoniq5Trim('SE Standard Range'), 'SE Standard Range');
  assert.equal(normalizeIoniq5Trim('SE'), 'SE');
  assert.equal(normalizeIoniq5Trim('XRT'), 'XRT');
  assert.equal(normalizeIoniq5Trim('N'), 'N');
});

test('estimateIoniq5Range returns accurate 2025/2026 EPA ranges by trim and drivetrain', () => {
  assert.equal(estimateIoniq5Range({ year: 2025, trim: 'Limited', drivetrain: 'RWD' }).miles, 318);
  assert.equal(estimateIoniq5Range({ year: 2026, trim: 'SEL Sport Utility 4D', drivetrain: 'RWD' }).miles, 318);
  assert.equal(estimateIoniq5Range({ year: 2026, trim: 'SEL', drivetrain: 'AWD' }).miles, 290);
  assert.equal(estimateIoniq5Range({ year: 2025, trim: 'Limited', drivetrain: 'AWD' }).miles, 269);
});

test('rankIoniq5Listings disqualifies listings above $45k or outside SEL/Limited', () => {
  const sample = [
    { vin: 'VIN_OK_SEL', year: 2026, make: 'Hyundai', model: 'Ioniq 5', trim: 'SEL Sport Utility 4D', drivetrain: 'RWD', price: 35000, miles: 5000, condition: 'used' },
    { vin: 'VIN_EXPENSIVE', year: 2026, make: 'Hyundai', model: 'Ioniq 5', trim: 'Limited', drivetrain: 'RWD', price: 46500, miles: 1000, condition: 'cpo' },
    { vin: 'VIN_SE', year: 2025, make: 'Hyundai', model: 'Ioniq 5', trim: 'SE', drivetrain: 'RWD', price: 26000, miles: 8000, condition: 'used' },
    { vin: 'VIN_XRT', year: 2025, make: 'Hyundai', model: 'Ioniq 5', trim: 'XRT', drivetrain: 'AWD', price: 39000, miles: 3000, condition: 'used' },
    { vin: 'VIN_LUCID', year: 2025, make: 'Lucid', model: 'Air', trim: 'Touring', drivetrain: 'AWD', price: 44000, miles: 10000, condition: 'used' },
  ];

  const res = rankIoniq5Listings(sample, DEFAULT_IONIQ5_CONFIG);
  assert.equal(res.totalIoniq5, 4);
  assert.equal(res.eligibleCount, 1);
  assert.equal(res.disqualifiedCount, 3);
  assert.equal(res.top5.length, 1);
  assert.equal(res.top5[0].vin, 'VIN_OK_SEL');
  assert.equal(res.byVin.get('VIN_EXPENSIVE').eligible, false);
  assert.ok(res.byVin.get('VIN_EXPENSIVE').disqualifyReasons[0].includes('$45,000'));
  assert.equal(res.byVin.get('VIN_LUCID'), undefined);
});

test('range preference outweighs Limited trim when comparing SEL RWD vs Limited AWD at equal price/miles/year/condition', () => {
  const sample = [
    { vin: 'VIN_SEL_RWD', year: 2025, make: 'Hyundai', model: 'Ioniq 5', trim: 'SEL', drivetrain: 'RWD', price: 36000, miles: 8000, condition: 'used' },
    { vin: 'VIN_LIM_AWD', year: 2025, make: 'Hyundai', model: 'Ioniq 5', trim: 'Limited', drivetrain: 'AWD', price: 36000, miles: 8000, condition: 'used' },
  ];

  const res = rankIoniq5Listings(sample, DEFAULT_IONIQ5_CONFIG);
  assert.equal(res.top5[0].vin, 'VIN_SEL_RWD');
  assert.ok(res.top5[0].score > res.top5[1].score);
});

test('Limited RWD beats SEL RWD when price/miles/year/condition are equal', () => {
  const sample = [
    { vin: 'VIN_SEL_RWD', year: 2025, make: 'Hyundai', model: 'Ioniq 5', trim: 'SEL', drivetrain: 'RWD', price: 36000, miles: 8000, condition: 'used' },
    { vin: 'VIN_LIM_RWD', year: 2025, make: 'Hyundai', model: 'Ioniq 5', trim: 'Limited', drivetrain: 'RWD', price: 36000, miles: 8000, condition: 'used' },
  ];

  const res = rankIoniq5Listings(sample, DEFAULT_IONIQ5_CONFIG);
  assert.equal(res.top5[0].vin, 'VIN_LIM_RWD');
  assert.ok(res.top5[0].score > res.top5[1].score);
});

test('ranks real dashboard.json Ioniq 5 snapshot cleanly and produces 5 top picks', () => {
  const snapPath = path.resolve(__dirname, '../public/data/dashboard.json');
  const snapshot = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const res = rankIoniq5Listings(snapshot.listings, DEFAULT_IONIQ5_CONFIG);

  assert.ok(res.totalIoniq5 >= 60);
  assert.ok(res.eligibleCount >= 5);
  assert.equal(res.eligibleCount + res.disqualifiedCount, res.totalIoniq5);
  assert.equal(res.top5.length, 5);
  assert.equal(res.top5[0].rank, 1);
  for (let i = 0; i < res.top5.length; i++) {
    if (i > 0) assert.ok(res.top5[i - 1].score >= res.top5[i].score);
    assert.ok(res.top5[i].price <= 45000);
    assert.ok(['SEL', 'Limited'].includes(res.top5[i].normTrim));
  }
});
