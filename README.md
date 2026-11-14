# VoltWatch EV Listings Dashboard (v1)

An electric vehicle market monitor built for the **Auto.dev Free Tier** (`1,000 API calls/month` hard cap, `5 requests/sec` rate limit, max `limit=20` per request).

## Quota-Preserving Architecture (1,000 Calls/Month)

1. **Zero-Call Dashboard Opens & Filtering:** Opening, reloading, searching, sorting, and filtering never call Auto.dev. In local/server mode, all reads hit local SQLite (`data/ev_dashboard.db`); in GitHub Pages static mode, all reads hit a pre-built snapshot (`public/data/dashboard.json`).
2. **Once-Daily Snapshot Cadence (`24h` TTL):** Automated sync runs at most once every 24 hours (`0 13 * * *` via GitHub Actions, or `syncIntervalHours=24` in local server mode with a single-flight lock).
3. **Consolidated OR Queries (`~3 calls/day`):** Groups EV makers and models with Auto.dev's comma-separated OR syntax (`vehicle.make=Tesla,Rivian,Lucid,Polestar`, etc.) at `limit=20`. Three enabled presets fetch up to 60 fresh EV listings/day (~90 calls/month, <10% of Free Tier cap).
4. **Hard Monthly Cap & Emergency Reserve:** Tracks every live request in `api_call_log` (`YYYY-MM`). Automated syncs pause automatically when remaining quota reaches the `50`-call emergency reserve, and all live calls are blocked at `1,000/1,000`.
5. **300ms Rate Limiter:** Throttles consecutive requests below `3.33 req/sec` (under Auto.dev's `5 req/sec` Free Tier limit).
6. **Pre-Sync Cost Preview & Snapshot Diffing:** Preview exact call counts before syncing, and track **New 24h** and **Price Drop** badges locally across snapshots without extra API calls.

## GitHub Pages + Automated Daily Sync Setup

1. **Enable GitHub Pages:**
   - Go to **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
2. **Add your Auto.dev API Key (when ready for live data):**
   - Go to **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `AUTODEV_API_KEY`
   - Value: your Auto.dev Free Tier API key.
   - *(Without `AUTODEV_API_KEY`, the workflow runs safely in Demo Seed Mode with `0` live API calls.)*
3. **Workflow permissions:**
   - Ensure **Settings → Actions → General → Workflow permissions** allows **Read and write permissions** so the daily cron job can commit updated `data/ev_dashboard.db` & `public/data/dashboard.json` history back to `main`.
4. **Live URL:**
   - `https://zaidalboy.github.io/ev-listings-dashboard/`

## Local Development

```bash
cp .env.example .env
# Optional: set AUTODEV_API_KEY in .env
npm install
npm test
npm run dev        # Vite on :5173 + Express API on :3001
```

Production build & single-port server:

```bash
npm run build && npm start
```

Manual CLI daily sync (respects 24h cache TTL unless `--force` is passed):

```bash
npm run sync:daily
npm run export:static
```
