import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './db.js';
import { upsertListingRecord } from './autodevClient.js';
import { findMatchingExistingLucid, parseLucidMhtml } from '../src/utils/lucidMhtmlParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMPORTS_DIR = path.resolve(__dirname, '../imports');

export function importLucidHtmlToDb(db, rawContent, label = 'manual-upload') {
  const nowIso = new Date().toISOString();
  const parsed = parseLucidMhtml(rawContent, nowIso);
  if (parsed.length === 0) {
    return {
      ok: false,
      error: 'No Lucid vehicle cards found. Save the loaded inventory page as Webpage, Single File (.mhtml) or Complete (.html).',
    };
  }

  const existingOtherLucids = db
    .prepare("SELECT vin, year, make, model, trim, price, miles, source FROM listings WHERE make = 'Lucid' AND source != 'lucid_direct'")
    .all();

  const seenDirectVins = new Set();
  let insertedNew = 0;
  let priceDrops = 0;
  let matchedAutoDev = 0;

  for (const item of parsed) {
    const match = findMatchingExistingLucid(existingOtherLucids, item);
    if (match) {
      matchedAutoDev++;
      // Enrich Auto.dev syndicated row with DreamDrive / EPA / direct Lucid URL details if helpful
      const nextTrim =
        item.lucidMeta?.adas && !String(match.trim || '').includes('DreamDrive')
          ? `${match.trim || 'Air'} · ${item.lucidMeta.adas}`
          : match.trim;
      db.prepare('UPDATE listings SET trim = ?, last_seen_at = ? WHERE vin = ?').run(
        nextTrim,
        nowIso,
        match.vin
      );
      continue;
    }

    seenDirectVins.add(item.vin);
    const res = upsertListingRecord(
      db,
      {
        vin: item.vin,
        year: item.year,
        make: item.make,
        model: item.model,
        trim: item.trim,
        bodyStyle: item.body_style,
        drivetrain: item.drivetrain,
        fuel: item.fuel,
        exteriorColor: item.exterior_color,
        interiorColor: item.interior_color,
        price: item.price,
        miles: item.miles,
        condition: item.condition,
        dealer: item.dealer,
        city: item.city,
        state: item.state,
        zip: item.zip,
        vdpUrl: item.vdp_url,
        carfaxUrl: item.carfax_url,
        primaryImage: item.primary_image,
        createdAt: nowIso,
        updatedAt: nowIso,
        removedAt: null,
        rawJson: JSON.stringify(item.lucidMeta || {}),
      },
      'lucid_direct'
    );
    if (res.isNew) insertedNew++;
    if (res.isPriceDrop) priceDrops++;
  }

  // Remove stale lucid_direct rows no longer present in the fresh Lucid page dump
  const existingDirect = db
    .prepare("SELECT vin FROM listings WHERE source = 'lucid_direct'")
    .all();
  let removedSold = 0;
  const delStmt = db.prepare('DELETE FROM listings WHERE vin = ?');
  for (const row of existingDirect) {
    if (!seenDirectVins.has(row.vin)) {
      delStmt.run(row.vin);
      removedSold++;
    }
  }

  db.prepare(`
    INSERT INTO sync_snapshots (
      started_at, completed_at, trigger_type, mode, calls_used,
      listings_fetched, new_listings, price_drops, status, error_message, query_summary
    ) VALUES (?, ?, 'lucid_import', 'lucid_direct', 0, ?, ?, ?, 'completed', NULL, ?)
  `).run(
    nowIso,
    nowIso,
    parsed.length,
    insertedNew,
    priceDrops,
    `[lucid_direct] ${label}: ${parsed.length} cards (${insertedNew} new, ${matchedAutoDev} matched Auto.dev, ${removedSold} removed)`
  );

  return {
    ok: true,
    totalParsed: parsed.length,
    importedDirect: seenDirectVins.size,
    newListings: insertedNew,
    priceDrops,
    matchedAutoDev,
    removedSold,
  };
}

function runCli() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let targetFiles = args.map((p) => path.resolve(process.cwd(), p));

  if (targetFiles.length === 0 && fs.existsSync(IMPORTS_DIR)) {
    targetFiles = fs
      .readdirSync(IMPORTS_DIR)
      .filter((name) => /\.(mhtml|html|htm)$/i.test(name))
      .sort()
      .map((name) => path.join(IMPORTS_DIR, name));
  }

  if (targetFiles.length === 0) {
    console.log('No Lucid .mhtml/.html files found to import.');
    return;
  }

  const db = createDatabase();
  for (const filePath of targetFiles) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const result = importLucidHtmlToDb(db, raw, path.basename(filePath));
    console.log(`Lucid import (${path.basename(filePath)}):`, result);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
