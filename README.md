# FlightLog

FlightLog is a static personal flight passport for logging trips, reviewing travel stats, mapping routes, and moving data in and out of the browser. The core app runs entirely in the browser and stores data locally with IndexedDB.

## MVP Features

- Manual flight logging with airport autocomplete and validation.
- Quick Add by flight number and date through the Cloudflare Worker live-status endpoint.
- Generated airport coverage from OurAirports-style CSVs with more than 9,000 IATA airports.
- Provider-derived airport fallback for live lookups when an airport is missing locally.
- Local persistence through IndexedDB; no backend is required for the main app.
- Dashboard with upcoming flights, searchable flight list, route map, passport-style statistics, trips, and a Backup Center.
- Automatic route distance and duration calculation.
- Full local backup export/import preview, plus backward-compatible JSON and CSV import/export with sample data.
- Optional Supabase Auth and user-owned cloud backup snapshots. The app still works without sign-in.
- Settings for account status, preferences, backup reminders, live data mode, storage tools, and diagnostics.
- Optional Cloud Sync Lite for manual compare, push, pull, and conflict-safe record sync. It is not realtime sync.
- Optional live flight status through a serverless proxy. API keys stay in the proxy environment, never in frontend code.
- Flight detail pages, trip grouping with local trip metadata, external flight-info links, and no-login calendar export.
- Installable PWA app shell with conservative offline caching.
- GitHub Pages deployment through GitHub Actions.

## Timezones

FlightLog displays flight times in airport-local time, not the browser timezone. Departure labels use the origin airport timezone and arrival labels use the destination airport timezone. Live provider responses preserve local and UTC timestamps when available, and calendar exports use UTC event times. If a saved flight has provider local time but no reliable timezone or offset, FlightLog shows the provider-local value with a warning and disables unsafe calendar exports.

## Local Development

```sh
npm install
npm run dev
```

Useful checks:

```sh
npm run lint
npm run typecheck
npm run test
npm run build
```

Airport dataset scripts:

```sh
npm run airports:download
npm run airports:build
```

`airports:download` writes refresh inputs to `data/source/airports.csv` and `data/source/countries.csv`. The generated static app dataset is `public/data/airports.generated.json`.

## Deployment

The app is built with Vite and can be deployed as a static site. For this repository, GitHub Pages should use the `/flightlog/` base path. The included GitHub Actions workflow sets `VITE_BASE_PATH=/flightlog/` during the production build.

In GitHub, enable Pages with "GitHub Actions" as the source. Pushing to `main` will run the deployment workflow.

If cloud backup should be available on the deployed site, add these GitHub repository variables:

```txt
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The Supabase anon key is designed for browser use when Row Level Security is enabled correctly. Never add a Supabase service role key to GitHub Pages variables, Vite env vars, frontend source, or commits.

## Live Flight Status

Live flight status is optional. FlightLog works fully without it.

Create `.env` from `.env.example` and set:

```sh
VITE_FLIGHTLOG_API_BASE_URL=https://flightlog-flight-status.ryanlai-zheyuan.workers.dev
```

The frontend only calls this proxy URL. Do not put RapidAPI or other third-party aviation API keys in Vite environment variables or frontend source code. Configure provider secrets in the Cloudflare Worker environment instead.

For development demos without a real provider, set:

```sh
VITE_FLIGHTLOG_MOCK_LIVE_STATUS=true
```

In the app, use **Add by flight number**, enter a flight number such as `SQ38` and a departure date, preview the returned route/times/aircraft, then choose **Add this flight** or **Edit before saving**. If the Worker URL is not configured, manual logging and the demo lookup mode still work.

## Cloudflare Worker

The optional proxy lives in `workers/flight-status-worker`.

```sh
cd workers/flight-status-worker
cp .dev.vars.example .dev.vars
npx wrangler dev
```

The Worker exposes:

```txt
GET /flight-status?flightNumber=SQ38&date=2026-06-02&dateRole=Departure
```

It validates input, adds CORS for localhost and GitHub Pages, reads provider keys from Worker secrets, normalizes responses into `FlightLiveStatus`, and supports mock mode.

The real provider mode uses AeroDataBox RapidAPI:

```txt
GET https://aerodatabox.p.rapidapi.com/flights/number/{flightNumber}/{dateLocal}?dateLocalRole=Departure
```

Flight plan data is not requested.

Local Worker variables:

```sh
AERODATABOX_API_HOST=aerodatabox.p.rapidapi.com
AERODATABOX_API_KEY=replace_me
FLIGHTLOG_PROVIDER_MODE=real
```

Configure production secrets and deploy:

```sh
cd workers/flight-status-worker
npx wrangler secret put AERODATABOX_API_KEY
npx wrangler secret put AERODATABOX_API_HOST
npx wrangler deploy
```

Test locally or in production:

```sh
curl "http://localhost:8787/flight-status?flightNumber=SQ38&date=2026-06-02"
curl "https://flightlog-flight-status.ryanlai-zheyuan.workers.dev/flight-status?flightNumber=SQ38&date=2026-06-02"
```

## PWA

FlightLog includes `manifest.webmanifest`, install icons, and a conservative service worker. The service worker caches the app shell, sample files, and airport JSON, but it does not aggressively cache live API responses.

On iPhone, open `https://zheyuanlai.github.io/flightlog/` in Safari, use Share, then choose **Add to Home Screen**.

## Data Privacy

FlightLog is local-first. Without sign-in, flight data stays in your browser storage. The Backup Center can export a full local backup with flights, trip metadata, provider-derived airports, app metadata, schema version, and export time. Clearing browser storage can delete local FlightLog data, so export a backup periodically.

With Supabase configured and a signed-in user, FlightLog can upload plain JSON backup snapshots to the `cloud_backups` table. Snapshots are protected by Supabase Auth and Row Level Security policies so users can only read, write, update, and delete their own rows. Signing out does not delete local data, and cloud backups remain in Supabase until deleted.

Cloud Sync Lite stores record-level JSON in Supabase under the signed-in user. Cloud backup and Cloud Sync Lite data are protected by Supabase Auth and RLS, but they are not end-to-end encrypted yet. Do not store a Supabase service role key in frontend code, GitHub Pages variables, or Vite env vars.

## Settings

Settings are stored locally in IndexedDB app metadata and are included in full local/cloud backup exports. Existing installs without a settings record are migrated to defaults automatically.

Settings include:

- Account status and sign-in controls.
- Cloud Backup status, latest backup actions, and reminder settings.
- Cloud Sync Lite status and a link to the sync page.
- Display, units, time/date format, and theme.
- Defaults for new manual flight entries.
- Live Flight Data mode: real Worker, mock data, or disabled.
- Data & Storage tools, diagnostics copy, and local data clearing.

Distance preferences affect dashboard stats, flight cards, flight detail, trips, and passport summaries. Time formatting changes display only; FlightLog still resolves departure and arrival times in airport-local time.

## Backup vs Sync Lite

Cloud Backup and Cloud Sync Lite solve different problems:

- Backup is a snapshot restore point. It can be downloaded, previewed, merged, or used to replace local data after a typed confirmation.
- Sync Lite is manual record-level push/pull. It can compare local and cloud records, push local-only records, pull cloud-only records, and show conflicts before overwrite.

Sync Lite does not run automatically, does not poll in the background, and does not do realtime sync. It does not field-merge conflicts in v1.7. Deletions are intentionally not propagated automatically; missing local records are treated as cloud-only records unless future deletion sync is added.

## Supabase Cloud Backup Setup

Cloud backup is optional. If `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing, FlightLog builds and runs in local-only mode.

1. Create or select a Supabase project.
2. Open the Supabase SQL Editor and run:

```txt
supabase/migrations/001_cloud_backups.sql
supabase/migrations/002_cloud_sync_lite.sql
```

The first migration creates `public.cloud_backups`; the second creates `public.synced_records` for Cloud Sync Lite. Both enable Row Level Security and add authenticated own-row policies using `auth.uid()`.

3. In Supabase Project Settings, API, copy:

```txt
VITE_SUPABASE_URL=<project URL>
VITE_SUPABASE_ANON_KEY=<anon/public key>
```

For local development, put those values in `.env.local`. For GitHub Pages, add them as repository variables. Do not use the service role key.

4. In Supabase Auth, URL Configuration, set:

```txt
Site URL: https://zheyuanlai.github.io/flightlog/
Redirect URLs:
https://zheyuanlai.github.io/flightlog/
http://localhost:5173/
http://localhost:5173/flightlog/
```

FlightLog uses hash routes such as `#/account`, but Supabase redirects back to the app root and the app restores the Account page after session initialization.

5. Enable Auth providers:

- Google: enable Google in Supabase Auth Providers, configure a Google OAuth client, add the Supabase provider callback URL shown by Supabase, then paste the Google client ID and secret into Supabase.
- Email: enable the Email provider for magic links. Supabase default email is fine for testing; production projects should consider custom SMTP.

Apple login is not implemented in v1.6. It is planned for a later release and requires Apple Developer / Services ID configuration.

### Supabase RLS Manual Test

Use two test users after running migrations `001` and `002`:

1. User A signs in, uploads a cloud backup, opens Sync Lite, and pushes local records.
2. User B signs in from another browser profile.
3. User B must not see User A cloud backups or sync records.
4. User B should be able to create and see only their own `cloud_backups` and `synced_records` rows.

If rows leak across users, stop using cloud features and review RLS before deploying.

## Cloud Backup Format

Cloud snapshots reuse the full local backup format:

```txt
app: "FlightLog"
schemaVersion: 3
exportedAt
flights
tripMetadata
providerAirports
appMetadata
```

The Supabase row also stores summary columns: flight count, trip metadata count, provider airport count, schema version, exported time, checksum, label, device ID, app version, and timestamps.

## Cloud Sync Lite Format

Sync Lite uses `public.synced_records`:

```txt
entity_type: flight | tripMetadata | providerAirport | appSettings
local_id
record_json
record_checksum
record_updated_at
deleted_at
device_id
```

Rows are unique by signed-in user, entity type, and local ID. The app compares checksums and requires explicit action for conflicts: keep local, use cloud, or skip.

## New-Device Restore Checklist

When signing in on a browser with no local flights:

1. Restore latest cloud backup for a complete snapshot restore.
2. Or open Sync Lite and pull cloud sync records for record-level recovery.
3. Or start fresh. FlightLog does not auto-restore or auto-pull.

If both backup snapshots and sync records exist, prefer the latest verified backup for full recovery and Sync Lite pull for incremental records.

## Cloud Sync Test Checklist

1. Sign in and create a safety cloud backup.
2. Open Sync Lite and compare local/cloud.
3. Push local-only records.
4. Compare again and confirm pushed records are in sync.
5. Change a local record and a cloud record for the same local ID, then compare.
6. Confirm the conflict list appears and choose keep local, use cloud, or skip.
7. Confirm no local or cloud data is overwritten without an explicit action.

## CSV Import Format

CSV imports use these columns:

```txt
date,flightNumber,airline,origin,destination,scheduledDeparture,scheduledArrival,actualDeparture,actualArrival,aircraftType,aircraftRegistration,cabin,seat,purpose,notes,source
```

Airport codes must be valid three-letter IATA codes. If a provider-derived airport is not in the generated dataset, FlightLog can still save the flight with the provider snapshot. Dates should use `YYYY-MM-DD`; date-times should use browser-friendly local date-time values such as `2026-06-02T20:45`.

Sample files are available at:

- `public/samples/sample_flights.csv`
- `public/samples/sample_flights.json`

## Roadmap

- v1.8: consider client-side encrypted backups, deletion tombstones for Sync Lite, richer restore history, and a safer automatic-sync design only after explicit user opt-in.
- Future: Apple login after Apple Developer configuration is available.
- Still intentionally out of scope: payments, native iOS work, Apple login in v1.7, realtime sync, background polling, and exposing provider API keys in the frontend.

## Troubleshooting

- Cloud backup not configured: verify `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and migration `001`.
- Sync Lite disabled or failing: run migration `002_cloud_sync_lite.sql` and confirm RLS policies exist.
- Redirect mismatch: add the GitHub Pages URL and localhost URLs to Supabase Auth URL Configuration.
- Google login error: verify the Google OAuth client and Supabase provider callback URL.
- Magic link not received: check Supabase Email provider settings, rate limits, and spam folders.
- RLS denied: confirm the user is signed in and rows use `user_id = auth.uid()`.
- GitHub Pages env vars missing: add repository variables, then rerun the Pages workflow.
- Sync conflict: open Sync Lite, compare, then choose keep local, use cloud, or skip.
- Cloud/local mismatch: create a safety backup, compare again, then push or pull only the previewed records.
