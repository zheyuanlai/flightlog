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

## Supabase Cloud Backup Setup

Cloud backup is optional. If `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing, FlightLog builds and runs in local-only mode.

1. Create or select a Supabase project.
2. Open the Supabase SQL Editor and run:

```txt
supabase/migrations/001_cloud_backups.sql
```

The migration creates `public.cloud_backups`, enables Row Level Security, and adds authenticated own-row policies using `auth.uid()`.

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

- v1.7: consider client-side encrypted backups, optional automatic rate-limited cloud backups, and richer restore history.
- Future: Apple login after Apple Developer configuration is available.
- Still intentionally out of scope: payments, realtime sync, conflict resolution, and exposing provider API keys in the frontend.
