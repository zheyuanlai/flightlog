# FlightLog Flight Status Worker

Cloudflare Worker proxy for FlightLog live status. The static app calls this Worker; the Worker calls AeroDataBox RapidAPI with secrets stored in the Worker environment.

## Endpoint

```txt
GET /flight-status?flightNumber=SQ38&date=2026-06-02
```

The Worker validates and normalizes the query, calls AeroDataBox `GET /flights/number/{flightNumber}/{dateLocal}?dateLocalRole=Departure`, and returns the normalized `FlightLiveStatus` JSON shape used by the frontend. It does not request `withFlightPlan=true`.

## Local Development

```sh
cd workers/flight-status-worker
cp .dev.vars.example .dev.vars
npx wrangler dev
```

`.dev.vars`:

```sh
AERODATABOX_API_HOST=aerodatabox.p.rapidapi.com
AERODATABOX_API_KEY=replace_me
FLIGHTLOG_PROVIDER_MODE=real
```

Mock mode does not require a provider key:

```sh
FLIGHTLOG_PROVIDER_MODE=mock npx wrangler dev
```

Local curl:

```sh
curl "http://localhost:8787/flight-status?flightNumber=SQ38&date=2026-06-02"
```

## Deployment

The Worker name in `wrangler.toml` is:

```txt
flightlog-flight-status
```

Configure secrets:

```sh
npx wrangler secret put AERODATABOX_API_KEY
npx wrangler secret put AERODATABOX_API_HOST
```

Deploy:

```sh
npx wrangler deploy
```

Production curl:

```sh
curl "https://flightlog-flight-status.ryanlai-zheyuan.workers.dev/flight-status?flightNumber=SQ38&date=2026-06-02"
```

## Notes

- `AERODATABOX_API_KEY` is never logged, returned, or sent to the frontend.
- `AERODATABOX_API_HOST` should be `aerodatabox.p.rapidapi.com`.
- `FLIGHTLOG_PROVIDER_MODE=mock` returns deterministic mock data.
- If real mode has no API key, the Worker returns `503` with `{ "error": "AeroDataBox API key is not configured" }`.
- CORS allows local Vite dev/preview origins and `https://zheyuanlai.github.io`; `/flightlog/` is covered because browser CORS origins do not include paths.
