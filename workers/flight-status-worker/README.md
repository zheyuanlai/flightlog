# FlightLog Flight Status Worker

Cloudflare Worker proxy for FlightLog live status. The static app calls this Worker; the Worker calls an aviation data provider (AeroDataBox RapidAPI by default) with secrets stored in the Worker environment.

## Endpoints

```txt
GET /flight-status?flightNumber=SQ38&date=2026-06-02&dateRole=Departure
GET /airport-status?iata=SIN&hours=6
GET /aircraft-history?registration=9V-SGA
GET /capabilities
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
curl "http://localhost:8787/aircraft-history?registration=9V-SGA"
curl "http://localhost:8787/capabilities"
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

## Airport status board (v2.7)

`GET /airport-status?iata=SIN&hours=6` returns a normalized `AirportStatus`: on-time / delayed / cancelled counts and average delay for departures and arrivals in a short forward window (1–12h, default 6h), plus a small sample of recent flights. `hours` is clamped to `[1, 12]`.

In `FLIGHTLOG_PROVIDER_MODE=mock` (or with no API key path exercised) it returns deterministic demo data. In real mode it calls the AeroDataBox airport FIDS endpoint:

```txt
GET https://aerodatabox.p.rapidapi.com/flights/airports/iata/{iata}/{fromLocal}/{toLocal}?direction=Both&withCancelled=true
```

and maps the response in `normalizeAirportFids` / `summarizeMovements`. **This mapping is best-effort and isolated** — after deploying, verify it against one real response (the exact FIDS field shapes can vary by plan) and adjust `summarizeMovements`/`movementDelayMinutes` if the counts look off. The frontend works in mock mode regardless.

Two separate real-mode caveats to check during that post-deploy verification:

1. **Time window is UTC-approximated.** The FIDS endpoint reads the `{from}`/`{to}` path segments as the airport's **local** time, but `fidsWindow` currently emits a UTC wall-clock string. The queried window is therefore shifted by the airport's UTC offset (e.g. for `SIN` at UTC+8 a "next 6h" board can surface flights from the past). A correct fix requires the airport's local offset, which the Worker does not carry. Resolve this when you verify against a live response — either convert `fidsWindow` to airport-local time (timezone lookup or an extra provider call) or confirm the offset is acceptable for your use. Mock mode is unaffected.
2. **Field mapping** — the `normalizeAirportFids` / `summarizeMovements` shape assumptions described above.

A provider `204` (no movements in the window) degrades to an empty board rather than an error.

## Aircraft registration history (v4.3)

`GET /aircraft-history?registration=9V-SGA` returns aircraft type/age/delivery metadata for a tail number, normalized from AeroDataBox's aircraft-by-registration endpoint:

```txt
GET https://aerodatabox.p.rapidapi.com/aircrafts/reg/{registration}
```

```json
{ "registration": "9V-SGA", "type": "Airbus A350-900", "typeCode": "A359", "airlineName": "Singapore Airlines", "ageYears": 5.2, "firstFlightDate": "2020-02-01", "deliveryDate": "2020-03-01", "provider": "AeroDataBox", "warnings": [] }
```

`registration` must be 2-10 letters, numbers, or hyphens. A `404` means AeroDataBox has no record for that registration. Results are cached for a day (aircraft metadata rarely changes, unlike live flight status).

**Field mapping is best-effort and unverified** — this repo has no AeroDataBox credentials to test against a live response. `normalizeAeroDataBoxAircraft` reads every field defensively (a wrong field name just leaves that field blank, not a crash), but verify the mapping against a real response during post-deploy verification and adjust if fields that should be populated aren't. Mock mode is unaffected.

This endpoint deliberately does **not** attempt "historical route analytics" (typical aircraft per route, seasonal punctuality) — see `docs/ROADMAP.md` §10 for why that half of the original v4.3 scope was skipped rather than built against a data source with unclear licensing.

## Capabilities (v3.2)

`GET /capabilities` reports what this deployment can do, so the frontend (or any client) can degrade gracefully per deployment instead of hardcoding assumptions:

```json
{ "provider": "aerodatabox", "mode": "real", "supportsFlightStatus": true, "supportsAirportStatus": true, "supportsAircraftHistory": true }
```

- `provider` — the active adapter's `name` (see "Provider adapters" below).
- `mode` — `real` or `mock`, from `FLIGHTLOG_PROVIDER_MODE`.
- `supportsFlightStatus` / `supportsAirportStatus` / `supportsAircraftHistory` — capability flags from the adapter. If `false`, the corresponding endpoint returns `501` instead of erroring unpredictably, and the frontend hides the corresponding UI (e.g. the airport delay board, or the aircraft lookup panel) rather than showing a broken one. Note that the frontend treats a *missing* `supportsAircraftHistory` field (an older, un-redeployed Worker) as `false` — unlike the other two flags, which predate `/capabilities` itself and so fail open.

## Provider adapters (v3.2)

Flight data comes from a **provider adapter** — a small module implementing a fixed interface — resolved at request time by `providers/index.js`. This Worker ships one adapter, `providers/aerodatabox.js`, wired up as the default. A fork can add its own by implementing the same interface and registering it, without touching `index.js`'s routing, validation, or caching.

**The adapter contract** (see the JSDoc block at the bottom of `providers/aerodatabox.js` for the authoritative version):

```js
{
  name: 'aerodatabox',                 // lowercase id, also the FLIGHTLOG_PROVIDER value
  supportsFlightStatus: true,          // capability flags surfaced by GET /capabilities
  supportsAirportStatus: true,
  supportsAircraftHistory: true,
  fetchFlightStatus(flightNumber, date, dateRole, env) { /* -> FlightLiveStatus shape, real mode */ },
  fetchAirportStatus(iata, hours, env) { /* -> AirportStatus shape, real mode */ },
  fetchAircraftHistory(registration, env) { /* -> AircraftLookup shape, real mode */ },
  mockFlightStatus(flightNumber, date) { /* -> FlightLiveStatus shape, deterministic */ },
  mockAirportStatus(iata) { /* -> AirportStatus shape, deterministic */ },
  mockAircraftHistory(registration) { /* -> AircraftLookup shape, deterministic */ },
}
```

`index.js` never talks to a provider directly — `handleFlightStatus`/`handleAirportStatus`/`handleAircraftHistory` call `resolveProvider(env)` and then the adapter's methods, gated by its capability flags. Query validation, CORS, response caching, and the mock/real switch (`FLIGHTLOG_PROVIDER_MODE`) all live in `index.js` and are shared by every adapter for free.

**To add a new provider** (e.g. FlightAware, OpenSky, AviationStack):

1. Create `providers/<name>.js`. Use `providers/aerodatabox.js` as the template — reuse `providers/util.js` (`cleanString`, `cleanNumber`, `stripUndefined`, `normalizeFlightNumber`, `providerErrorFromResponse`) and `providers/error.js` (`ProviderError`) rather than reinventing them.
2. Normalize real responses to the same `FlightLiveStatus` / `AirportStatus` shapes AeroDataBox produces (see the endpoint examples above) — the frontend does not know which provider answered.
3. If a capability genuinely isn't available from your provider (e.g. no airport-board equivalent), set that flag to `false` rather than implementing a fake `fetchAirportStatus` — the Worker returns a clean `501` and the frontend hides the corresponding panel instead of erroring.
4. Export the adapter object and register it in `providers/index.js`'s `PROVIDER_ADAPTERS` map.
5. Set `FLIGHTLOG_PROVIDER=<name>` (via `.dev.vars` locally or `wrangler secret put` / a `[vars]` entry in production) to select it. An unset or unrecognized value falls back to `aerodatabox`.
6. Add tests mirroring `index.test.js`'s AeroDataBox coverage: request validation is already shared and tested; focus new tests on your adapter's response normalization and the real/mock code paths.

See `docs/SELF_HOSTING.md` at the repo root for the full fork checklist (deploying this Worker, Pages, and wiring them together).

## Notes

- Provider secrets (e.g. `AERODATABOX_API_KEY`) are never logged, returned, or sent to the frontend.
- `AERODATABOX_API_HOST` should be `aerodatabox.p.rapidapi.com`.
- `FLIGHTLOG_PROVIDER_MODE=mock` returns deterministic mock data for any adapter.
- If real mode has no API key, the Worker returns `503` with `{ "error": "AeroDataBox API key is not configured" }` (or the equivalent message from your adapter).
- CORS allows local Vite dev/preview origins and `https://zheyuanlai.github.io`; `/flightlog/` is covered because browser CORS origins do not include paths.
