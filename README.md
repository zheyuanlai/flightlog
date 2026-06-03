# FlightLog

FlightLog is a static personal flight passport for logging trips, reviewing travel stats, mapping routes, and moving data in and out of the browser. The core app runs entirely in the browser and stores data locally with IndexedDB.

## MVP Features

- Manual flight logging with airport autocomplete and validation.
- Local persistence through IndexedDB; no backend is required for the main app.
- Dashboard, searchable flight list, route map, passport-style statistics, and import/export tools.
- Automatic route distance and duration calculation.
- JSON and CSV import/export with sample data.
- Optional live flight status through a serverless proxy. API keys stay in the proxy environment, never in frontend code.
- GitHub Pages deployment through GitHub Actions.

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

## Deployment

The app is built with Vite and can be deployed as a static site. For this repository, GitHub Pages should use the `/flightlog/` base path. The included GitHub Actions workflow sets `VITE_BASE_PATH=/flightlog/` during the production build.

In GitHub, enable Pages with "GitHub Actions" as the source. Pushing to `main` will run the deployment workflow.

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

## Cloudflare Worker

The optional proxy lives in `workers/flight-status-worker`.

```sh
cd workers/flight-status-worker
cp .dev.vars.example .dev.vars
npx wrangler dev
```

The Worker exposes:

```txt
GET /flight-status?flightNumber=SQ38&date=2026-06-02
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

## Data Privacy

FlightLog stores flight data in your browser. There is no core backend. Export your data periodically if you want a backup. Clearing browser storage can delete local FlightLog data.

## CSV Import Format

CSV imports use these columns:

```txt
date,flightNumber,airline,origin,destination,scheduledDeparture,scheduledArrival,actualDeparture,actualArrival,aircraftType,aircraftRegistration,cabin,seat,purpose,notes,source
```

Airport codes must be valid IATA codes from the bundled airport dataset. Dates should use `YYYY-MM-DD`; date-times should use browser-friendly local date-time values such as `2026-06-02T20:45`.

Sample files are available at:

- `public/samples/sample_flights.csv`
- `public/samples/sample_flights.json`

## Roadmap

- PWA install support and offline app shell.
- Generate a larger airport dataset from OurAirports.
- Richer airline and aircraft metadata.
- More complete live-status provider adapters.
- iOS-focused interaction polish.
