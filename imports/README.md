# Lucid Pre-Owned Direct Imports (0 Auto.dev API Calls)

Drop a saved Lucid Motors pre-owned inventory page here (from `https://lucidmotors.com/available-vehicles?condition=used` → **Save Page As → Webpage, Single File (`.mhtml`)**) to automatically merge it into VoltWatch on the next GitHub Pages build.

- **Filename:** Any `.mhtml`, `.html`, or `.htm` filename works (e.g. `lucid-used.mhtml` or `Available Vehicles _ Lucid Motors.mhtml`).
- **Replacing old files:** Keep only your latest `.mhtml` file in this folder (overwrite the same filename or delete the old one when uploading a newer snapshot).
- **Cost:** **0 Auto.dev API calls** — GitHub Actions runs `npm run import:lucid`, deduplicates against Auto.dev listings, and deploys to GitHub Pages automatically.
