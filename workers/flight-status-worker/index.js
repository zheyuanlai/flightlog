const AERODATABOX_BASE_URL = 'https://aerodatabox.p.rapidapi.com'
const DEFAULT_AERODATABOX_HOST = 'aerodatabox.p.rapidapi.com'

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://zheyuanlai.github.io',
])

const statusMap = {
  Unknown: 'unknown',
  Expected: 'scheduled',
  EnRoute: 'active',
  CheckIn: 'scheduled',
  Boarding: 'scheduled',
  GateClosed: 'scheduled',
  Departed: 'active',
  Delayed: 'scheduled',
  Approaching: 'active',
  Arrived: 'landed',
  Canceled: 'cancelled',
  Diverted: 'diverted',
  CanceledUncertain: 'cancelled',
}

class ProviderError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}

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

export function normalizeFlightNumber(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

export function validateFlightStatusRequest(url) {
  const flightNumber = normalizeFlightNumber(url.searchParams.get('flightNumber'))
  const date = String(url.searchParams.get('date') ?? '').trim()

  if (!flightNumber) return { error: 'flightNumber is required' }
  if (!/^[A-Z0-9]{2,10}$/.test(flightNumber)) return { error: 'flightNumber must be 2-10 letters or numbers' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'date must be YYYY-MM-DD' }

  const parsedDate = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return { error: 'date must be a valid calendar date' }
  }

  return { flightNumber, date }
}

export function providerMode(env = {}) {
  const mode = String(env.FLIGHTLOG_PROVIDER_MODE ?? env.PROVIDER_MODE ?? '').trim().toLowerCase()
  if (mode === 'mock' || mode === 'real') return mode
  return env.MOCK_FLIGHT_STATUS === 'true' ? 'mock' : 'real'
}

function airportSummary(airport) {
  if (!airport) return undefined
  return {
    iata: airport.iata || undefined,
    icao: airport.icao || undefined,
    name: airport.name || airport.shortName || undefined,
  }
}

function localTime(time) {
  if (!time) return undefined
  if (typeof time === 'string') return time
  if (typeof time.local === 'string') return time.local
  return undefined
}

function datePart(value) {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : undefined
}

function normalizedNumber(value) {
  return normalizeFlightNumber(value)
}

function scheduledDateMatches(flight, date) {
  const departureDate = datePart(localTime(flight?.departure?.scheduledTime))
  const arrivalDate = datePart(localTime(flight?.arrival?.scheduledTime))
  return departureDate === date || arrivalDate === date
}

export function selectBestFlight(flights, flightNumber, date) {
  if (!Array.isArray(flights) || flights.length === 0) return { flight: undefined, warning: undefined }

  const exactNumber = flights.filter((flight) => normalizedNumber(flight?.number) === flightNumber)
  const candidates = exactNumber.length > 0 ? exactNumber : flights
  const sameDate = candidates.filter((flight) => scheduledDateMatches(flight, date))
  const selectedFrom = sameDate.length > 0 ? sameDate : candidates
  const warning = selectedFrom.length > 1
    ? `AeroDataBox returned ${selectedFrom.length} matching flights; using the first match.`
    : undefined

  return { flight: selectedFrom[0], warning }
}

export function mapAeroDataBoxStatus(status) {
  return statusMap[status] ?? 'unknown'
}

export function normalizeAeroDataBoxFlight(flight, warning) {
  if (!flight) return undefined

  const departure = flight.departure ?? {}
  const arrival = flight.arrival ?? {}
  const airline = flight.airline ?? {}
  const aircraft = flight.aircraft ?? {}
  const departureAirport = airportSummary(departure.airport)
  const arrivalAirport = airportSummary(arrival.airport)

  return {
    status: mapAeroDataBoxStatus(flight.status),
    airlineName: airline.name || undefined,
    airlineIata: airline.iata || undefined,
    airlineIcao: airline.icao || undefined,
    flightNumber: flight.number || undefined,
    departureAirport,
    arrivalAirport,
    scheduledDeparture: localTime(departure.scheduledTime),
    estimatedDeparture: localTime(departure.revisedTime) || localTime(departure.predictedTime),
    actualDeparture: localTime(departure.runwayTime),
    scheduledArrival: localTime(arrival.scheduledTime),
    estimatedArrival: localTime(arrival.revisedTime) || localTime(arrival.predictedTime),
    actualArrival: localTime(arrival.runwayTime),
    departureTerminal: departure.terminal || undefined,
    departureGate: departure.gate || undefined,
    arrivalTerminal: arrival.terminal || undefined,
    arrivalGate: arrival.gate || undefined,
    baggageClaim: arrival.baggageBelt || undefined,
    aircraftType: aircraft.model || undefined,
    aircraftRegistration: aircraft.reg || undefined,
    provider: 'AeroDataBox',
    rawProviderStatus: flight.status || undefined,
    warning,
  }
}

export function buildAeroDataBoxUrl(flightNumber, date) {
  const url = new URL(`/flights/number/${encodeURIComponent(flightNumber)}/${encodeURIComponent(date)}`, AERODATABOX_BASE_URL)
  url.searchParams.set('dateLocalRole', 'Departure')
  return url
}

async function providerErrorFromResponse(response) {
  if (response.status === 204 || response.status === 404) {
    return new ProviderError(404, 'No flight found.')
  }
  if (response.status === 429) {
    return new ProviderError(429, 'API quota or rate limit reached.')
  }
  if (response.status === 401 || response.status === 403) {
    return new ProviderError(502, 'API key or subscription problem.')
  }
  if (response.status >= 500) {
    return new ProviderError(502, 'Aviation data provider unavailable.')
  }

  let providerMessage = ''
  try {
    const body = await response.json()
    providerMessage = typeof body?.message === 'string' ? body.message : ''
  } catch {
    providerMessage = ''
  }
  return new ProviderError(502, providerMessage || 'Unable to fetch flight status.')
}

export async function fetchAeroDataBoxStatus(flightNumber, date, env) {
  if (!env.AERODATABOX_API_KEY) {
    throw new ProviderError(503, 'AeroDataBox API key is not configured')
  }

  const host = env.AERODATABOX_API_HOST || DEFAULT_AERODATABOX_HOST
  const endpoint = buildAeroDataBoxUrl(flightNumber, date)
  const response = await fetch(endpoint, {
    headers: {
      'x-rapidapi-host': host,
      'x-rapidapi-key': env.AERODATABOX_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  })

  if (response.status === 204) throw new ProviderError(404, 'No flight found.')
  if (!response.ok) throw await providerErrorFromResponse(response)

  let data
  try {
    data = await response.json()
  } catch {
    throw new ProviderError(502, 'Unable to parse aviation data provider response.')
  }

  const flights = Array.isArray(data) ? data : Array.isArray(data?.flights) ? data.flights : data ? [data] : []
  const { flight, warning } = selectBestFlight(flights, flightNumber, date)
  if (!flight) throw new ProviderError(404, 'No flight found.')

  const normalized = normalizeAeroDataBoxFlight(flight, warning)
  if (!normalized) throw new ProviderError(502, 'Unable to parse aviation data provider response.')
  return normalized
}

export function mockStatus(flightNumber, date) {
  return {
    status: 'scheduled',
    airlineName: 'Singapore Airlines',
    airlineIata: 'SQ',
    airlineIcao: 'SIA',
    flightNumber,
    departureAirport: { iata: 'SFO', icao: 'KSFO', name: 'San Francisco International Airport' },
    arrivalAirport: { iata: 'SIN', icao: 'WSSS', name: 'Singapore Changi Airport' },
    scheduledDeparture: `${date}T20:45`,
    estimatedDeparture: `${date}T20:55`,
    scheduledArrival: `${date}T23:35`,
    departureTerminal: '1',
    departureGate: 'A12',
    arrivalTerminal: 'B',
    baggageClaim: '4',
    aircraftType: 'Airbus A350-900',
    aircraftRegistration: '9V-MOCK',
    provider: 'mock-worker',
    rawProviderStatus: `Mock status for ${flightNumber}`,
  }
}

function successCacheTtl(date) {
  const today = new Date().toISOString().slice(0, 10)
  return date < today ? 60 * 60 * 24 : 60 * 5
}

async function handleFlightStatus(request, env, ctx, origin, url) {
  const input = validateFlightStatusRequest(url)
  if (input.error) return json({ error: input.error }, 400, origin)

  const cacheUrl = new URL(url)
  cacheUrl.searchParams.set('flightNumber', input.flightNumber)
  cacheUrl.searchParams.set('date', input.date)
  const cacheKey = new Request(cacheUrl.toString(), request)
  const cached = await caches.default.match(cacheKey)
  if (cached) return cached

  try {
    const status = providerMode(env) === 'mock'
      ? mockStatus(input.flightNumber, input.date)
      : await fetchAeroDataBoxStatus(input.flightNumber, input.date, env)
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

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || ''
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) })

    const url = new URL(request.url)
    if (request.method !== 'GET' || url.pathname !== '/flight-status') {
      return json({ error: 'Not found' }, 404, origin)
    }

    return handleFlightStatus(request, env, ctx, origin, url)
  },
}
