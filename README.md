# FlightLog

FlightLog is a static personal flight passport for logging trips, reviewing travel stats, mapping routes, and moving data in and out of the browser. The core app runs entirely in the browser and stores data locally with IndexedDB.

## MVP Features

- Manual flight logging with airport autocomplete and validation.
- Quick Add by flight number and date through the Cloudflare Worker live-status endpoint.
- Mobile-first v2.0 navigation with Home, Add, Flights, Trips, and More in the PWA bottom nav.
- Mobile Quick Add with offline-aware lookup states, provider preview cards, and a manual fallback.
- Generated airport coverage from OurAirports-style CSVs with more than 9,000 IATA airports.
- Provider-derived airport fallback for live lookups when an airport is missing locally.
- Local persistence through IndexedDB; no backend is required for the main app.
- Dashboard with upcoming flights, searchable flight list, route map, passport-style statistics, trips, and a Backup Center.
- Automatic route distance and duration calculation.
- Full local backup export/import preview, plus backward-compatible JSON and CSV import/export with sample data.
- Optional Supabase Auth and user-owned cloud backup snapshots. The app still works without sign-in.
- Settings for account status, preferences, backup reminders, live data mode, storage tools, and diagnostics.
- Optional Cloud Sync Lite for manual compare, push, pull, tombstone sync, and conflict-safe record sync. It is not realtime sync.
- Optional live flight status through a serverless proxy. API keys stay in the proxy environment, never in frontend code.
- Flight detail pages, trip grouping with local trip metadata, external flight-info links, and no-login calendar export.
- Flight lifecycle assistant with day-of-travel dashboard card, phase chips, and en-route progress.
- Post-flight completion prompts for recently landed flights that are missing actual times.
- HTML share-card previews for flights, trips, and yearly passport summaries, with local PNG export.
- Manual trip editor: create editable trips, add or remove flights, and convert automatic trips.
- Installable PWA app shell with conservative offline caching, standalone safe-area spacing, and cache version `flightlog-v21`.
- GitHub Pages deployment through GitHub Actions.

## v2.0 Mobile/PWA Overview

FlightLog v2.0 focuses on making the web app feel worth adding to an iPhone home screen while keeping the local-first architecture intact.

- Mobile bottom navigation is intentionally limited to Home, Add, Flights, Trips, and More. More contains Passport, Map, Backup, Sync, Settings, and Trash.
- Dashboard is ordered for mobile use: Quick Add, upcoming flights, sync/backup attention states, travel stats, recent flights, and passport highlights.
- Quick Add remains the core mobile action and supports live lookup, edit before saving, cancel, and manual add/edit fallback.
- Flight Detail emphasizes flight number, airline, status, route, local departure/arrival timeline, calendar actions, external links, and a secondary delete section.
- Trips and Passport use denser mobile cards and share-preview surfaces without copying any commercial app UI.
- Settings has section navigation, PWA install guidance, collapsed diagnostics, and redacted diagnostics copy.

## v2.1 Flight Lifecycle and Trips Overview

FlightLog v2.1 focuses on the day of travel and on trip curation, keeping everything local-first.

- Lifecycle assistant: every flight gets a computed phase — scheduled, check-in open (within 24 hours), departing soon (within 3 hours), en route with a progress bar, landed, or completed — with provider cancelled/diverted/active statuses taking priority. The Dashboard shows a day-of-travel card for the most pressing flight with countdown, terminal/gate, an airline check-in link during the check-in window, and live refresh.
- Post-flight completion: after a flight lands, a "Complete your flight log" prompt lists recently landed flights missing actual times, with confirm-details, refresh-from-provider, and dismiss actions. Dismissals are stored on the flight (`completionDismissedAt`) and sync like any other edit.
- PNG share cards: the share panel now exports a branded 1080x1350 PNG rendered locally with the Canvas API. Nothing is uploaded, and no image library is added to the bundle.
- Manual trip editor: create editable trips from the Trips page, add or remove flights with a search picker, and convert an automatically grouped trip into an editable one (name, notes, type, and pin carry over). Editable trips own their flight roster in `TripMetadata.flightIds`, so they survive membership changes; deleting one returns its flights to automatic grouping. Deleted trip metadata becomes a tombstone and shows in Trash.

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

FlightLog includes `manifest.webmanifest`, install icons, and a conservative service worker. The service worker caches the app shell, sample files, and airport JSON, but it does not aggressively cache live API responses, Supabase calls, or Worker API responses. The current cache name is `flightlog-v21`.

On iPhone, open `https://zheyuanlai.github.io/flightlog/` in Safari, use Share, then choose **Add to Home Screen**.

In Chrome or Edge, use the browser install button or the address-bar menu and choose **Install FlightLog**. In standalone mode, FlightLog applies safe-area spacing so content is not hidden behind the bottom navigation.

## Offline Behavior

FlightLog remains local-first offline. Dashboard, Flights, Flight Detail, Trips, Passport, Trash, and local backup export remain usable with local IndexedDB data.

When offline, FlightLog shows a subtle banner and disables or explains network-only actions:

- Live flight lookup and live status refresh.
- Cloud backup upload, preview, restore, download, and delete.
- Cloud Sync Lite compare, push, pull, tombstone sync, and conflict resolution.
- Supabase login through Google or email magic link.

Local manual add/edit, local stats, local Trash restore/permanent delete confirmations, and full local backup export do not require sign-in or network access.

## Share Cards

FlightLog has share-card previews for:

- Individual flights.
- Trip summaries.
- Yearly passport summaries when flight data exists.

Cards include FlightLog branding, route, date, distance, airports, countries, and summary highlights. Notes are excluded by default; flight and trip share previews expose an **Include notes** checkbox. v2.1 adds **Export PNG**: the card is rendered locally to a 1080x1350 branded PNG with the browser Canvas API, so no image library is bundled and nothing leaves the device.

## Performance Notes

The app keeps Dashboard light by using local data first, route-level loading fallbacks, and lazy-loading Leaflet and its CSS only when the Map page is opened. Supabase remains in a separate Vite chunk and is only used for optional auth, backup, and Sync Lite flows. The service worker avoids aggressive API caching so live provider and Supabase responses do not become stale.

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
- Sync Lite is manual record-level push/pull. It can compare local and cloud records, push local-only records, pull cloud-only records, sync deletion tombstones, and show conflicts before overwrite.

Sync Lite does not run automatically, does not poll in the background, and does not do realtime sync. It does not field-merge conflicts in v1.9. Deleted flights move to Trash and sync as tombstones only after an explicit sync action. Permanent deletion is not automatic.

## Tombstones and Trash

Deleting a flight soft-deletes it locally. The flight disappears from Dashboard, Flights, Trips, Map, Passport, Upcoming flights, and active stats, but remains in `#/trash`.

Trash supports restore, deleted-record JSON export, selected restore, selected permanent delete, and empty trash. Permanent delete requires typed confirmation and is local-only; normal sync keeps cloud tombstones instead of hard-deleting `synced_records` rows.

## v2.0 Data Safety Regression Checklist

Before shipping v2.0 changes, verify:

1. Soft-deleted flights are hidden from active Dashboard, Flights, Trips, Map, Passport, Upcoming, and stats views.
2. Trash loads deleted flights and deleted trip metadata.
3. Restore returns flights to active views.
4. Permanent delete and empty trash still require typed confirmation.
5. Backup Center loads and full local export works.
6. Cloud backup upload/preview/restore/download/delete still requires a signed-in Supabase user.
7. Sync Lite loads, compares, pushes, pulls, syncs tombstones, and shows conflicts without automatic sync.
8. RLS isolation is unchanged because no service role key is exposed and no frontend policy bypass is added.
9. Airport-local timezone formatting remains intact for departure, arrival, calendar, and share-card data.
10. GitHub Pages hash routing still works for direct navigation and Supabase auth redirects.

## Supabase Cloud Backup Setup

Cloud backup is optional. If `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing, FlightLog builds and runs in local-only mode.

1. Create or select a Supabase project.
2. Open the Supabase SQL Editor and run:

```txt
supabase/migrations/001_cloud_backups.sql
supabase/migrations/002_cloud_sync_lite.sql
supabase/migrations/003_tombstones_sync_history.sql
```

The first migration creates `public.cloud_backups`; the second creates `public.synced_records` for Cloud Sync Lite; the third extends tombstone metadata and adds optional `sync_events` and `sync_devices`. All enable Row Level Security and add authenticated own-row policies using `auth.uid()`.

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

Apple login is not implemented in v2.0. It is planned for a later release and requires Apple Developer / Services ID configuration.

### Supabase RLS Manual Test

Use two test users after running migrations `001`, `002`, and `003`:

1. User A signs in, uploads a cloud backup, opens Sync Lite, pushes local records, deletes a flight, and pushes the tombstone.
2. User B signs in from another browser profile.
3. User B must not see User A cloud backups, sync records, tombstones, sync history, or devices.
4. User B should be able to create and see only their own `cloud_backups`, `synced_records`, `sync_events`, and `sync_devices` rows.

If rows leak across users, stop using cloud features and review RLS before deploying.

## Cloud Backup Format

Cloud snapshots reuse the full local backup format:

```txt
app: "FlightLog"
schemaVersion: 4
exportedAt
flights
tripMetadata
providerAirports
appMetadata
```

Current backups use schema version 4. Tombstone metadata is stored directly on deleted records, so full backups include active records, deleted records, Trash metadata, trip metadata, provider airports, and app metadata. Restoring a backup with deleted records keeps those records deleted until they are explicitly restored from Trash.

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
deleted_by_device_id
delete_reason
tombstone_version
last_operation
device_id
```

Rows are unique by signed-in user, entity type, and local ID. The app compares stable checksums and requires explicit action for conflicts: keep local, use cloud, keep deleted, restore active, or skip. Sync history is stored locally and, when migration `003` is installed, also in `public.sync_events`. Device names and last-seen timestamps are stored in `public.sync_devices`.

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

## Deletion Sync Test Checklist

1. Delete a flight on device A.
2. Confirm it disappears from active views and appears in Trash.
3. Compare and push tombstones from device A.
4. On device B, compare and pull tombstones.
5. Confirm the flight appears in Trash on device B, not active lists.
6. Restore the flight on device B.
7. Push the restore from device B.
8. Pull or compare on device A and confirm the flight is active again.
9. Create an update/delete conflict and verify the conflict UI offers keep deleted, restore local active, restore cloud active, and skip.

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

- Shipped in v2.1: flight lifecycle assistant, post-flight completion prompt, PNG share cards, and the manual trip editor.
- Future: client-side encrypted backups and richer field-level merge tools.
- Future: airline check-in deep links per airline and richer day-of-travel notifications within PWA constraints.
- Future: Apple login after Apple Developer configuration is available.
- Still intentionally out of scope: payments, native iOS work, Apple login, realtime sync, background polling, and exposing provider API keys in the frontend.

## Troubleshooting

- Cloud backup not configured: verify `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and migration `001`.
- Sync Lite disabled or failing: run migrations `002_cloud_sync_lite.sql` and `003_tombstones_sync_history.sql`, then confirm RLS policies exist.
- Redirect mismatch: add the GitHub Pages URL and localhost URLs to Supabase Auth URL Configuration.
- Google login error: verify the Google OAuth client and Supabase provider callback URL.
- Magic link not received: check Supabase Email provider settings, rate limits, and spam folders.
- RLS denied: confirm the user is signed in and rows use `user_id = auth.uid()`.
- GitHub Pages env vars missing: add repository variables, then rerun the Pages workflow.
- Sync conflict: open Sync Lite, compare, then choose keep local, use cloud, or skip.
- Cloud/local mismatch: create a safety backup, compare again, then push or pull only the previewed records.
- Tombstone table fields missing: run `003_tombstones_sync_history.sql` in Supabase SQL Editor.
- Conflicts after deletion: use the conflict UI to keep deleted or restore the active local/cloud side.
- Deleted record came back: compare Sync Lite and check whether a restore was pushed from another device.
- Cannot permanently delete: export or create a backup first, then type the exact confirmation phrase.
- Local `npm ci` hang: if install is silent and stuck, stop it, document it as not passed, and do not count lint/typecheck/test/build as passed unless dependencies are installed.
