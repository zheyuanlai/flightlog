const AERODATABOX_BASE_URL = 'https://aerodatabox.p.rapidapi.com'
const DEFAULT_AERODATABOX_HOST = 'aerodatabox.p.rapidapi.com'
const DEFAULT_DATE_ROLE = 'Departure'

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

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanNumber(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function stripUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ''))
}

export function normalizeFlightNumber(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '')
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

export function providerMode(env = {}) {
  const mode = String(env.FLIGHTLOG_PROVIDER_MODE ?? env.PROVIDER_MODE ?? '').trim().toLowerCase()
  if (mode === 'mock' || mode === 'real') return mode
  return env.MOCK_FLIGHT_STATUS === 'true' ? 'mock' : 'real'
}

function airportSummary(airport) {
  if (!airport) return undefined
  const location = airport.location ?? {}
  const city = cleanString(airport.municipalityName) ?? cleanString(airport.city) ?? cleanString(airport.municipality)
  const country = cleanString(airport.countryName) ?? cleanString(airport.country)
  const lat = cleanNumber(location.lat ?? location.latitude ?? airport.lat ?? airport.latitude)
  const lon = cleanNumber(location.lon ?? location.lng ?? location.longitude ?? airport.lon ?? airport.longitude)
  return stripUndefined({
    iata: cleanString(airport.iata)?.toUpperCase(),
    icao: cleanString(airport.icao)?.toUpperCase(),
    name: cleanString(airport.name) ?? cleanString(airport.shortName),
    city,
    country,
    countryCode: cleanString(airport.countryCode)?.toUpperCase(),
    lat,
    lon,
    timezone: cleanString(airport.timeZone) ?? cleanString(airport.timezone),
  })
}

function airlineSummary(airline) {
  if (!airline) return undefined
  return stripUndefined({
    name: cleanString(airline.name),
    iata: cleanString(airline.iata)?.toUpperCase(),
    icao: cleanString(airline.icao)?.toUpperCase(),
  })
}

function aircraftSummary(aircraft) {
  if (!aircraft) return undefined
  return stripUndefined({
    type: cleanString(aircraft.model) ?? cleanString(aircraft.typeName) ?? cleanString(aircraft.type),
    registration: cleanString(aircraft.reg)?.toUpperCase() ?? cleanString(aircraft.registration)?.toUpperCase(),
  })
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

function scheduledDateMatches(flight, date, dateRole) {
  const departureDate = datePart(localTime(flight?.departure?.scheduledTime))
  const arrivalDate = datePart(localTime(flight?.arrival?.scheduledTime))
  return dateRole === 'Arrival' ? arrivalDate === date : departureDate === date
}

export function selectBestFlight(flights, flightNumber, date, dateRole = DEFAULT_DATE_ROLE) {
  if (!Array.isArray(flights) || flights.length === 0) return { flight: undefined, warnings: [] }

  const warnings = []
  const exactNumber = flights.filter((flight) => normalizeFlightNumber(flight?.number) === flightNumber)
  const candidates = exactNumber.length > 0 ? exactNumber : flights
  if (exactNumber.length === 0) warnings.push('AeroDataBox did not return an exact flight number match; using the closest result.')

  const sameDate = candidates.filter((flight) => scheduledDateMatches(flight, date, dateRole))
  const selectedFrom = sameDate.length > 0 ? sameDate : candidates
  if (sameDate.length === 0) warnings.push(`AeroDataBox did not return a ${dateRole.toLowerCase()} date match; using the closest result.`)
  if (selectedFrom.length > 1) warnings.push(`AeroDataBox returned ${selectedFrom.length} matching flights; using the first match.`)

  return { flight: selectedFrom[0], warnings }
}

export function mapAeroDataBoxStatus(status) {
  return statusMap[status] ?? 'unknown'
}

export function normalizeAeroDataBoxFlight(flight, warnings = []) {
  if (!flight) return undefined

  const departure = flight.departure ?? {}
  const arrival = flight.arrival ?? {}
  const airline = airlineSummary(flight.airline) ?? {}
  const origin = airportSummary(departure.airport)
  const destination = airportSummary(arrival.airport)
  const times = stripUndefined({
    scheduledDeparture: localTime(departure.scheduledTime),
    estimatedDeparture: localTime(departure.revisedTime) || localTime(departure.predictedTime),
    actualDeparture: localTime(departure.runwayTime),
    scheduledArrival: localTime(arrival.scheduledTime),
    estimatedArrival: localTime(arrival.revisedTime) || localTime(arrival.predictedTime),
    actualArrival: localTime(arrival.runwayTime),
  })
  const terminalGate = stripUndefined({
    departureTerminal: cleanString(departure.terminal),
    departureGate: cleanString(departure.gate),
    arrivalTerminal: cleanString(arrival.terminal),
    arrivalGate: cleanString(arrival.gate),
    baggageClaim: cleanString(arrival.baggageBelt) ?? cleanString(arrival.baggageClaim),
  })
  const aircraft = aircraftSummary(flight.aircraft) ?? {}
  const status = mapAeroDataBoxStatus(flight.status)
  const warning = warnings[0]
  const flightNumber = normalizeFlightNumber(cleanString(flight.number) ?? cleanString(flight.callSign) ?? '')

  return stripUndefined({
    flightNumber: flightNumber || undefined,
    airline,
    origin,
    destination,
    times,
    terminalGate,
    aircraft,
    status,
    provider: 'AeroDataBox',
    rawProviderStatus: cleanString(flight.status),
    providerFlightId: cleanString(flight.id) ?? cleanString(flight.flightId),
    warnings,
    warning,

    airlineName: airline.name,
    airlineIata: airline.iata,
    airlineIcao: airline.icao,
    departureAirport: origin,
    arrivalAirport: destination,
    scheduledDeparture: times.scheduledDeparture,
    estimatedDeparture: times.estimatedDeparture,
    actualDeparture: times.actualDeparture,
    scheduledArrival: times.scheduledArrival,
    estimatedArrival: times.estimatedArrival,
    actualArrival: times.actualArrival,
    departureTerminal: terminalGate.departureTerminal,
    departureGate: terminalGate.departureGate,
    arrivalTerminal: terminalGate.arrivalTerminal,
    arrivalGate: terminalGate.arrivalGate,
    baggageClaim: terminalGate.baggageClaim,
    aircraftType: aircraft.type,
    aircraftRegistration: aircraft.registration,
  })
}

export function buildAeroDataBoxUrl(flightNumber, date, dateRole = DEFAULT_DATE_ROLE) {
  const url = new URL(`/flights/number/${encodeURIComponent(flightNumber)}/${encodeURIComponent(date)}`, AERODATABOX_BASE_URL)
  url.searchParams.set('dateLocalRole', dateRole)
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

export async function fetchAeroDataBoxStatus(flightNumber, date, dateRole, env) {
  if (!env.AERODATABOX_API_KEY) {
    throw new ProviderError(503, 'AeroDataBox API key is not configured')
  }

  const host = env.AERODATABOX_API_HOST || DEFAULT_AERODATABOX_HOST
  const endpoint = buildAeroDataBoxUrl(flightNumber, date, dateRole)
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
  const { flight, warnings } = selectBestFlight(flights, flightNumber, date, dateRole)
  if (!flight) throw new ProviderError(404, 'No flight found.')

  const normalized = normalizeAeroDataBoxFlight(flight, warnings)
  if (!normalized) throw new ProviderError(502, 'Unable to parse aviation data provider response.')
  return normalized
}

export function mockStatus(flightNumber, date) {
  const flight = {
    number: flightNumber,
    status: 'Expected',
    airline: { name: 'Singapore Airlines', iata: 'SQ', icao: 'SIA' },
    departure: {
      airport: {
        iata: 'SFO',
        icao: 'KSFO',
        name: 'San Francisco International Airport',
        municipalityName: 'San Francisco',
        countryName: 'United States',
        countryCode: 'US',
        location: { lat: 37.6213, lon: -122.379 },
        timeZone: 'America/Los_Angeles',
      },
      scheduledTime: { local: `${date}T20:45` },
      revisedTime: { local: `${date}T20:55` },
      terminal: '1',
      gate: 'A12',
    },
    arrival: {
      airport: {
        iata: 'SIN',
        icao: 'WSSS',
        name: 'Singapore Changi Airport',
        municipalityName: 'Singapore',
        countryName: 'Singapore',
        countryCode: 'SG',
        location: { lat: 1.3644, lon: 103.9915 },
        timeZone: 'Asia/Singapore',
      },
      scheduledTime: { local: `${date}T23:35` },
      terminal: 'B',
      baggageBelt: '4',
    },
    aircraft: { model: 'Airbus A350-900', reg: '9V-MOCK' },
  }
  return { ...normalizeAeroDataBoxFlight(flight, []), provider: 'mock-worker', rawProviderStatus: `Mock status for ${flightNumber}` }
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
  cacheUrl.searchParams.set('dateRole', input.dateRole)
  cacheUrl.searchParams.set('schema', 'v13')
  const cacheKey = new Request(cacheUrl.toString(), request)
  const cached = await caches.default.match(cacheKey)
  if (cached) return cached

  try {
    const status = providerMode(env) === 'mock'
      ? mockStatus(input.flightNumber, input.date)
      : await fetchAeroDataBoxStatus(input.flightNumber, input.date, input.dateRole, env)
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
