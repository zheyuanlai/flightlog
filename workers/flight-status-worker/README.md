# FlightLog Flight Status Worker

Cloudflare Worker proxy for FlightLog live status. The static app calls this Worker; the Worker calls AeroDataBox RapidAPI with secrets stored in the Worker environment.

## Endpoint

```txt
GET /flight-status?flightNumber=SQ38&date=2026-06-02&dateRole=Departure
```

The Worker validates and normalizes the query, calls AeroDataBox `GET /flights/number/{flightNumber}/{dateLocal}?dateLocalRole=Departure`, and returns the normalized `FlightLiveStatus` JSON shape used by the frontend. `dateRole` may be `Departure` or `Arrival`; `Departure` is the default. It does not request `withFlightPlan=true`.

The response includes both the original flat fields and the v1.3 nested fields:

```json
{
  "flightNumber": "SQ38",
  "airline": { "name": "Singapore Airlines", "iata": "SQ", "icao": "SIA" },
  "origin": { "iata": "SIN", "icao": "WSSS", "name": "Singapore Changi Airport" },
  "destination": { "iata": "LAX", "icao": "KLAX", "name": "Los Angeles International Airport" },
  "times": { "scheduledDeparture": "2026-06-02T20:45" },
  "terminalGate": { "departureGate": "A12" },
  "aircraft": { "type": "Airbus A350-900", "registration": "9V-SGA" },
  "status": "scheduled",
  "provider": "AeroDataBox",
  "rawProviderStatus": "Expected",
  "warnings": []
}
```

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
curl "http://localhost:8787/flight-status?flightNumber=SQ38&date=2026-06-02&dateRole=Arrival"
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
