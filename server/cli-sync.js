import 'dotenv/config';
import { createDatabase, getQuotaSummary } from './db.js';
import { seedDemoDatabase } from './seedData.js';
import { executeSync, hasLiveApiKey, isCacheStale } from './autodevClient.js';

const force = process.argv.includes('--force');
const db = createDatabase();
seedDemoDatabase(db);

const quota = getQuotaSummary(db);
console.log(`[EV Sync CLI] Month ${quota.monthKey}: ${quota.used}/${quota.cap} calls used (reserve: ${quota.reserveBuffer})`);

if (!force && !isCacheStale(db)) {
  console.log('[EV Sync CLI] Cache is still fresh within configured sync interval. Skipping (0 API calls used). Pass --force to override.');
  process.exit(0);
}

if (!hasLiveApiKey()) {
  console.log('[EV Sync CLI] No AUTODEV_API_KEY configured. Running simulated demo snapshot (0 API calls).');
}

const result = await executeSync(db, { triggerType: 'cli' });
console.log('[EV Sync CLI] Result:', JSON.stringify(result, null, 2));
