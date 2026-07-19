import { ProviderError } from './providers/error.js'
import { normalizeFlightNumber } from './providers/util.js'
import { resolveProvider } from './providers/index.js'

const DEFAULT_DATE_ROLE = 'Departure'

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://zheyuanlai.github.io',
])

export function corsHeaders(origin) {
  const allowedOrigin = allowedOrigins.has(origin) ? origin : 'https://zheyuanlai.github.io'
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

function cacheControl(status, ttlSeconds = 300) {
  if (status !== 200) return 'no-store'
  return `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`
}

function json(body, status, origin, ttlSeconds) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl(status, ttlSeconds),
    },
  })
}

export function normalizeDateRole(value) {
  const role = String(value ?? DEFAULT_DATE_ROLE).trim().toLowerCase()
  if (role === 'departure') return 'Departure'
  if (role === 'arrival') return 'Arrival'
  return undefined
}

export function validateFlightStatusRequest(url) {
  const flightNumber = normalizeFlightNumber(url.searchParams.get('flightNumber'))
  const date = String(url.searchParams.get('date') ?? '').trim()
  const dateRole = normalizeDateRole(url.searchParams.get('dateRole') || DEFAULT_DATE_ROLE)

  if (!flightNumber) return { error: 'flightNumber is required' }
  if (!/^[A-Z0-9]{2,10}$/.test(flightNumber)) return { error: 'flightNumber must be 2-10 letters or numbers' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'date must be YYYY-MM-DD' }
  if (!dateRole) return { error: 'dateRole must be Departure or Arrival' }

  const parsedDate = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return { error: 'date must be a valid calendar date' }
  }

  return { flightNumber, date, dateRole }
}

export function validateAirportStatusRequest(url) {
  const iata = String(url.searchParams.get('iata') ?? '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(iata)) return { error: 'iata must be a 3-letter IATA airport code' }
  const hoursRaw = Number(url.searchParams.get('hours') ?? 6)
  const hours = Number.isFinite(hoursRaw) ? Math.min(12, Math.max(1, Math.round(hoursRaw))) : 6
  return { iata, hours }
}

export function providerMode(env = {}) {
  const mode = String(env.FLIGHTLOG_PROVIDER_MODE ?? env.PROVIDER_MODE ?? '').trim().toLowerCase()
  if (mode === 'mock' || mode === 'real') return mode
  return env.MOCK_FLIGHT_STATUS === 'true' ? 'mock' : 'real'
}

function successCacheTtl(date) {
  const today = new Date().toISOString().slice(0, 10)
  return date < today ? 60 * 60 * 24 : 60 * 5
}

async function handleFlightStatus(request, env, ctx, origin, url) {
  const input = validateFlightStatusRequest(url)
  if (input.error) return json({ error: input.error }, 400, origin)

  const provider = resolveProvider(env)
  if (!provider.supportsFlightStatus) return json({ error: `Provider "${provider.name}" does not support flight status lookups.` }, 501, origin)

  const cacheUrl = new URL(url)
  cacheUrl.searchParams.set('flightNumber', input.flightNumber)
  cacheUrl.searchParams.set('date', input.date)
  cacheUrl.searchParams.set('dateRole', input.dateRole)
  cacheUrl.searchParams.set('schema', `v14-${provider.name}`)
  const cacheKey = new Request(cacheUrl.toString(), request)
  const cached = await caches.default.match(cacheKey)
  if (cached) return cached

  try {
    const status = providerMode(env) === 'mock'
      ? provider.mockFlightStatus(input.flightNumber, input.date)
      : await provider.fetchFlightStatus(input.flightNumber, input.date, input.dateRole, env)
    const response = json(status, 200, origin, successCacheTtl(input.date))
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()))
    return response
  } catch (error) {
    if (error instanceof ProviderError) {
      return json({ error: error.message }, error.status, origin)
    }
    return json({ error: 'Unable to fetch flight status.' }, 500, origin)
  }
}

async function handleAirportStatus(request, env, ctx, origin, url) {
  const input = validateAirportStatusRequest(url)
  if (input.error) return json({ error: input.error }, 400, origin)

  const provider = resolveProvider(env)
  if (!provider.supportsAirportStatus) return json({ error: `Provider "${provider.name}" does not support airport status boards.` }, 501, origin)

  const cacheUrl = new URL(url)
  cacheUrl.searchParams.set('iata', input.iata)
  cacheUrl.searchParams.set('hours', String(input.hours))
  cacheUrl.searchParams.set('schema', `airport-v1-${provider.name}`)
  const cacheKey = new Request(cacheUrl.toString(), request)
  const cached = await caches.default.match(cacheKey)
  if (cached) return cached

  try {
    const status = providerMode(env) === 'mock'
      ? provider.mockAirportStatus(input.iata)
      : await provider.fetchAirportStatus(input.iata, input.hours, env)
    const response = json(status, 200, origin, 60 * 5)
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()))
    return response
  } catch (error) {
    if (error instanceof ProviderError) return json({ error: error.message }, error.status, origin)
    return json({ error: 'Unable to fetch airport status.' }, 500, origin)
  }
}

// Lets the frontend (or a fork's own client) discover what this deployment can do
// without hardcoding a provider name, so features degrade gracefully per deployment.
function handleCapabilities(env, origin) {
  const provider = resolveProvider(env)
  return json({
    provider: provider.name,
    mode: providerMode(env),
    supportsFlightStatus: provider.supportsFlightStatus,
    supportsAirportStatus: provider.supportsAirportStatus,
  }, 200, origin, 300)
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || ''
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) })

    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/flight-status') {
      return handleFlightStatus(request, env, ctx, origin, url)
    }
    if (request.method === 'GET' && url.pathname === '/airport-status') {
      return handleAirportStatus(request, env, ctx, origin, url)
    }
    if (request.method === 'GET' && url.pathname === '/capabilities') {
      return handleCapabilities(env, origin)
    }
    return json({ error: 'Not found' }, 404, origin)
  },
}
