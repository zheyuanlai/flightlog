# Self-hosting FlightLog

FlightLog is designed to be forked and run end to end under your own accounts, with no
dependency on the original deployment. This is the fork checklist — it links out to the
detailed docs for each piece rather than repeating them.

Everything here is optional and independent. At minimum, cloning the repo and running
`npm run dev` gives you a fully working local-only flight tracker with no accounts at all
(see `README.md` → "Local Development"). The steps below are for running your own public
copy.

## 1. Static app (GitHub Pages or any static host)

The app is a Vite build with no server-side rendering — `npm run build` produces a static
`dist/` you can host anywhere (GitHub Pages, Netlify, Cloudflare Pages, S3, ...).

- **GitHub Pages**: fork the repo, enable Pages with source "GitHub Actions", push to
  `main`. See `README.md` → "Deployment" for the `VITE_BASE_PATH` note if you rename the repo.
- **Anywhere else**: `npm run build`, deploy `dist/`, set `VITE_BASE_PATH` to your
  site's base path (empty string for a root domain) at build time.

## 2. Live flight data (optional) — the flight-status Worker

Deploy your own Cloudflare Worker to get automatic flight status, gates, and delays.
Full instructions: `workers/flight-status-worker/README.md`.

Checklist:
1. `cd workers/flight-status-worker && cp .dev.vars.example .dev.vars`, fill in a
   provider API key (AeroDataBox by default — a free-tier RapidAPI key works for testing).
2. `npx wrangler deploy` (needs a Cloudflare account; `wrangler` prompts you to log in).
3. `npx wrangler secret put AERODATABOX_API_KEY` (and `AERODATABOX_API_HOST` if you use a
   different RapidAPI host).
4. Set `VITE_FLIGHTLOG_API_BASE_URL` to your deployed Worker's URL, both locally (`.env`)
   and as a GitHub repository variable for the Pages build.
5. **Update the Worker's CORS allowlist** (`allowedOrigins` in `index.js`) to include your
   fork's actual GitHub Pages URL (or wherever you host the static app) — the shipped list
   only allows the original repo's origin and local dev ports.

Want a different data provider than AeroDataBox? See "Provider adapters" in the Worker
README — implement one module against the adapter interface, register it, and set
`FLIGHTLOG_PROVIDER=<your-adapter-name>`. No changes to `index.js` routing, validation, or
caching are needed.

Skip this section entirely and the app still works — manual flight entry and CSV/ICS
import always work with no Worker configured, and Settings → Live flight data can be set
to "Demo data" to try the live-status UI without any provider at all.

## 3. Cloud backup & Sync (optional) — Supabase

Deploy your own Supabase project to get optional cloud backup and multi-device sync.
Full instructions: `README.md` → "Supabase Cloud Backup Setup", including the exact SQL
migrations to run (`supabase/migrations/001_cloud_backups.sql`,
`002_cloud_sync_lite.sql`, `003_tombstones_sync_history.sql`) and the RLS policies they set up.

Checklist:
1. Create a Supabase project, run the three migrations in order (SQL editor or CLI).
2. Configure the auth providers you want (Google OAuth and/or email magic link) in the
   Supabase dashboard.
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — locally (`.env`) and as GitHub
   repository variables for the Pages build. **Never** use the Supabase service role key
   in a frontend build.
4. If you want end-to-end encrypted sync (v3.1 Sealed Sync), no extra setup is needed —
   it's a per-user opt-in toggle in Settings and reuses the same `synced_records` table;
   see `README.md` → "v3.1 Sealed Sync" for how the passphrase model works.

Skip this section and FlightLog runs entirely local-first — flights live in this
browser's storage, and local backup export/import (a plain or encrypted JSON file) always
works with zero configuration.

## 4. Verifying your fork

- `npm run lint && npm run typecheck && npm run test && npm run build` should all pass
  unmodified — this is exactly the CI-equivalent check the original repo runs.
- `curl https://<your-worker>/capabilities` should report your provider and its
  capability flags (see the Worker README's "Capabilities" section) — the frontend uses
  this to hide features your chosen provider adapter doesn't implement, rather than
  showing a broken UI.
- Add a flight manually first (no configuration needed) before testing the Worker or
  Supabase integrations, to confirm the base app works independent of either.

## Non-negotiables if you fork this

These aren't just style preferences — they're the reasons FlightLog is safe to use without
an account, so please keep them if you publish a fork:

- No first-party analytics or tracking.
- No background network calls without an explicit user action.
- Provider and Supabase secrets never reach the frontend bundle or browser storage.
- The app must remain fully usable — add, edit, view, export — with zero configuration.
