# FlightLog Flight Status Worker

Optional Cloudflare Worker proxy for FlightLog live status. The static app does not require this worker.

## Development

```sh
cd workers/flight-status-worker
wrangler dev --var MOCK_FLIGHT_STATUS:true
```

Point the app at the local worker:

```sh
VITE_FLIGHTLOG_API_BASE_URL=http://localhost:8787
```

## Deployment

```sh
wrangler deploy
wrangler secret put AERODATABOX_API_KEY
```

Use `MOCK_FLIGHT_STATUS=true` as a Worker environment variable to demo the endpoint without a provider key.

The Worker never returns or exposes provider secrets. Update `allowedOrigins` in `index.js` if your GitHub Pages account or custom domain differs.
