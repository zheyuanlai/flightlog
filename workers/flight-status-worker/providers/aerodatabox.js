import { ProviderError } from './error.js'
import { cleanNumber, cleanString, normalizeFlightNumber, providerErrorFromResponse, stripUndefined } from './util.js'

const AERODATABOX_BASE_URL = 'https://aerodatabox.p.rapidapi.com'
const DEFAULT_AERODATABOX_HOST = 'aerodatabox.p.rapidapi.com'

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
    timeZone: cleanString(airport.timeZone) ?? cleanString(airport.timezone),
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

function utcTime(time) {
  if (!time || typeof time === 'string') return undefined
  if (typeof time.utc === 'string') return time.utc
  return undefined
}

function timeFields(prefix, time) {
  const local = localTime(time)
  const utc = utcTime(time)
  return stripUndefined({
    [prefix]: local,
    [`${prefix}Local`]: local,
    [`${prefix}Utc`]: utc,
  })
}

function datePart(value) {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : undefined
}

function scheduledDateMatches(flight, date, dateRole) {
  const departureDate = datePart(localTime(flight?.departure?.scheduledTime))
  const arrivalDate = datePart(localTime(flight?.arrival?.scheduledTime))
  return dateRole === 'Arrival' ? arrivalDate === date : departureDate === date
}

export function selectBestFlight(flights, flightNumber, date, dateRole = 'Departure') {
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
  const departureEstimate = localTime(departure.revisedTime) || utcTime(departure.revisedTime) ? departure.revisedTime : departure.predictedTime
  const arrivalEstimate = localTime(arrival.revisedTime) || utcTime(arrival.revisedTime) ? arrival.revisedTime : arrival.predictedTime
  const times = stripUndefined({
    ...timeFields('scheduledDeparture', departure.scheduledTime),
    ...timeFields('estimatedDeparture', departureEstimate),
    ...timeFields('actualDeparture', departure.runwayTime),
    ...timeFields('scheduledArrival', arrival.scheduledTime),
    ...timeFields('estimatedArrival', arrivalEstimate),
    ...timeFields('actualArrival', arrival.runwayTime),
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
    providerUpdatedAt: cleanString(flight.lastUpdatedUtc),
    providerFetchedAt: cleanString(flight.lastUpdatedUtc),
    warnings,
    warning,
    originTimeZone: origin?.timeZone ?? origin?.timezone,
    destinationTimeZone: destination?.timeZone ?? destination?.timezone,

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
    scheduledDepartureLocal: times.scheduledDepartureLocal,
    estimatedDepartureLocal: times.estimatedDepartureLocal,
    actualDepartureLocal: times.actualDepartureLocal,
    scheduledArrivalLocal: times.scheduledArrivalLocal,
    estimatedArrivalLocal: times.estimatedArrivalLocal,
    actualArrivalLocal: times.actualArrivalLocal,
    scheduledDepartureUtc: times.scheduledDepartureUtc,
    estimatedDepartureUtc: times.estimatedDepartureUtc,
    actualDepartureUtc: times.actualDepartureUtc,
    scheduledArrivalUtc: times.scheduledArrivalUtc,
    estimatedArrivalUtc: times.estimatedArrivalUtc,
    actualArrivalUtc: times.actualArrivalUtc,
    departureTerminal: terminalGate.departureTerminal,
    departureGate: terminalGate.departureGate,
    arrivalTerminal: terminalGate.arrivalTerminal,
    arrivalGate: terminalGate.arrivalGate,
    baggageClaim: terminalGate.baggageClaim,
    aircraftType: aircraft.type,
    aircraftRegistration: aircraft.registration,
  })
}

export function buildAeroDataBoxUrl(flightNumber, date, dateRole = 'Departure') {
  const url = new URL(`/flights/number/${encodeURIComponent(flightNumber)}/${encodeURIComponent(date)}`, AERODATABOX_BASE_URL)
  url.searchParams.set('dateLocalRole', dateRole)
  return url
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

function addDays(date, days) {
  const [year, month, day] = date.split('-').map((value) => Number(value))
  const value = new Date(Date.UTC(year, month - 1, day + days))
  return value.toISOString().slice(0, 10)
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
      scheduledTime: { local: `${date}T20:45`, utc: `${addDays(date, 1)}T03:45:00Z` },
      revisedTime: { local: `${date}T20:55`, utc: `${addDays(date, 1)}T03:55:00Z` },
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
      scheduledTime: { local: `${addDays(date, 2)}T06:15`, utc: `${addDays(date, 1)}T22:15:00Z` },
      terminal: 'B',
      baggageBelt: '4',
    },
    aircraft: { model: 'Airbus A350-900', reg: '9V-MOCK' },
  }
  return { ...normalizeAeroDataBoxFlight(flight, []), provider: 'mock-worker', rawProviderStatus: `Mock status for ${flightNumber}` }
}

// --- Airport status board (v2.7) ---

function movementDelayMinutes(movement) {
  const scheduled = movement?.scheduledTime?.utc ?? movement?.scheduledTime?.local
  const revised = movement?.revisedTime?.utc ?? movement?.revisedTime?.local ?? movement?.runwayTime?.utc ?? movement?.predictedTime?.utc
  if (!scheduled || !revised) return undefined
  const scheduledMs = Date.parse(String(scheduled).replace(' ', 'T'))
  const revisedMs = Date.parse(String(revised).replace(' ', 'T'))
  if (Number.isNaN(scheduledMs) || Number.isNaN(revisedMs)) return undefined
  return Math.round((revisedMs - scheduledMs) / 60000)
}

export function summarizeMovements(items, direction) {
  const list = Array.isArray(items) ? items : []
  let onTime = 0
  let delayed = 0
  let cancelled = 0
  const delays = []
  const sample = []
  for (const item of list) {
    const status = String(item?.status ?? '').toLowerCase()
    const movement = direction === 'departure'
      ? (item.departure ?? item.movement ?? item)
      : (item.arrival ?? item.movement ?? item)
    const delay = movementDelayMinutes(movement)
    const isCancelled = status.includes('cancel')
    if (isCancelled) {
      cancelled += 1
    } else {
      if (delay !== undefined && delay > 15) delayed += 1
      else onTime += 1
      // Average delay is over all non-cancelled movements with a known delay.
      if (delay !== undefined) delays.push(delay)
    }
    const otherEnd = direction === 'departure' ? (item.arrival ?? item.movement) : (item.departure ?? item.movement)
    if (sample.length < 8) {
      sample.push(stripUndefined({
        flightNumber: normalizeFlightNumber(item.number ?? item.flightNumber) || undefined,
        direction,
        status: isCancelled ? 'cancelled' : delay !== undefined && delay > 15 ? 'delayed' : 'on-time',
        delayMinutes: delay,
        scheduledLocal: cleanString(movement?.scheduledTime?.local),
        otherAirport: cleanString(otherEnd?.airport?.iata)?.toUpperCase(),
      }))
    }
  }
  const total = onTime + delayed + cancelled
  const avgDelayMinutes = delays.length > 0 ? Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length) : 0
  return { total, onTime, delayed, cancelled, avgDelayMinutes, onTimePercent: total > 0 ? Math.round((onTime / total) * 100) : 0, sample }
}

export function normalizeAirportFids(iata, data, warnings = []) {
  const departures = summarizeMovements(data?.departures, 'departure')
  const arrivals = summarizeMovements(data?.arrivals, 'arrival')
  return stripUndefined({
    airport: iata,
    departures: { total: departures.total, onTime: departures.onTime, delayed: departures.delayed, cancelled: departures.cancelled, avgDelayMinutes: departures.avgDelayMinutes, onTimePercent: departures.onTimePercent },
    arrivals: { total: arrivals.total, onTime: arrivals.onTime, delayed: arrivals.delayed, cancelled: arrivals.cancelled, avgDelayMinutes: arrivals.avgDelayMinutes, onTimePercent: arrivals.onTimePercent },
    sample: [...departures.sample, ...arrivals.sample].slice(0, 12),
    provider: 'AeroDataBox',
    warnings,
  })
}

export function mockAirportStatus(iata) {
  return {
    airport: iata,
    departures: { total: 20, onTime: 15, delayed: 4, cancelled: 1, avgDelayMinutes: 22, onTimePercent: 75 },
    arrivals: { total: 18, onTime: 14, delayed: 3, cancelled: 1, avgDelayMinutes: 18, onTimePercent: 78 },
    sample: [
      { flightNumber: 'SQ38', direction: 'departure', status: 'on-time', delayMinutes: 0, otherAirport: 'LAX' },
      { flightNumber: 'UA60', direction: 'departure', status: 'delayed', delayMinutes: 35, otherAirport: 'NRT' },
      { flightNumber: 'BA11', direction: 'arrival', status: 'on-time', delayMinutes: 5, otherAirport: 'LHR' },
    ],
    provider: 'mock-worker',
    warnings: [],
  }
}

export function buildAeroDataBoxFidsUrl(iata, fromLocal, toLocal) {
  const url = new URL(`/flights/airports/iata/${encodeURIComponent(iata)}/${encodeURIComponent(fromLocal)}/${encodeURIComponent(toLocal)}`, AERODATABOX_BASE_URL)
  url.searchParams.set('direction', 'Both')
  url.searchParams.set('withLeg', 'false')
  url.searchParams.set('withCancelled', 'true')
  url.searchParams.set('withCodeshared', 'false')
  url.searchParams.set('withCargo', 'false')
  url.searchParams.set('withPrivate', 'false')
  return url
}

// KNOWN REAL-MODE LIMITATION (see Worker README "Airport status board"):
// The AeroDataBox FIDS endpoint interprets the {from}/{to} path segments as the
// airport's LOCAL time, but we emit a UTC wall-clock string here. That shifts the
// real window by the airport's UTC offset (e.g. for SIN, UTC+8, a "next 6h" board
// can surface past flights). A correct fix needs the airport's local offset, which
// this adapter does not have without a timezone lookup or an extra provider call.
// This approximation only affects real mode (mock mode is unaffected) and must be
// corrected during the post-deploy verification step, alongside the FIDS field
// mapping in normalizeAirportFids/summarizeMovements.
function fidsWindow(hours, nowMs = Date.now()) {
  const from = new Date(nowMs).toISOString().slice(0, 16)
  const to = new Date(nowMs + hours * 60 * 60 * 1000).toISOString().slice(0, 16)
  return { from, to }
}

export async function fetchAeroDataBoxAirportStatus(iata, hours, env) {
  if (!env.AERODATABOX_API_KEY) {
    throw new ProviderError(503, 'AeroDataBox API key is not configured')
  }
  const host = env.AERODATABOX_API_HOST || DEFAULT_AERODATABOX_HOST
  const { from, to } = fidsWindow(hours)
  const endpoint = buildAeroDataBoxFidsUrl(iata, from, to)
  const response = await fetch(endpoint, {
    headers: {
      'x-rapidapi-host': host,
      'x-rapidapi-key': env.AERODATABOX_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  })
  // 204 = the provider found no movements in the window. Degrade gracefully to an
  // empty board rather than a 502 parse error.
  if (response.status === 204) return normalizeAirportFids(iata, {}, [])
  if (!response.ok) throw await providerErrorFromResponse(response)
  let data
  try {
    data = await response.json()
  } catch {
    throw new ProviderError(502, 'Unable to parse aviation data provider response.')
  }
  const warnings = []
  if (!Array.isArray(data?.departures) && !Array.isArray(data?.arrivals)) {
    warnings.push('Provider returned an unexpected airport payload shape; counts may be incomplete.')
  }
  return normalizeAirportFids(iata, data, warnings)
}

// --- Aircraft registration history (v4.3) ---

export function buildAeroDataBoxAircraftUrl(registration) {
  return new URL(`/aircrafts/reg/${encodeURIComponent(registration)}`, AERODATABOX_BASE_URL)
}

// KNOWN LIMITATION (see Worker README "Aircraft registration history"): the field
// names below are mapped from AeroDataBox's publicly documented aircraft-by-
// registration response shape, but have not been verified against a live call --
// this repo has no AeroDataBox credentials to test with. Every field is read
// defensively (stripUndefined drops anything missing), so a wrong field name just
// means that one field is blank, not a crash. Verify field names during post-deploy
// verification and adjust this normalizer if fields that should be populated aren't.
export function normalizeAeroDataBoxAircraft(data, warnings = []) {
  if (!data || typeof data !== 'object') return undefined
  const registration = cleanString(data.reg)?.toUpperCase() ?? cleanString(data.registration)?.toUpperCase()
  if (!registration) return undefined
  return stripUndefined({
    registration,
    type: cleanString(data.model) ?? cleanString(data.typeName) ?? cleanString(data.type),
    typeCode: cleanString(data.typeCode),
    serialNumber: cleanString(data.serial) ?? cleanString(data.serialNumber),
    airlineName: cleanString(data.airlineName) ?? cleanString(data.airline?.name),
    ageYears: cleanNumber(data.ageYears),
    firstFlightDate: cleanString(data.firstFlightDate),
    deliveryDate: cleanString(data.deliveryDate),
    provider: 'AeroDataBox',
    warnings,
  })
}

export async function fetchAeroDataBoxAircraft(registration, env) {
  if (!env.AERODATABOX_API_KEY) {
    throw new ProviderError(503, 'AeroDataBox API key is not configured')
  }
  const host = env.AERODATABOX_API_HOST || DEFAULT_AERODATABOX_HOST
  const endpoint = buildAeroDataBoxAircraftUrl(registration)
  const response = await fetch(endpoint, {
    headers: {
      'x-rapidapi-host': host,
      'x-rapidapi-key': env.AERODATABOX_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  })

  // response.ok is true for 204, so it must be checked before the !response.ok
  // guard below -- matches how fetchAeroDataBoxStatus/fetchAeroDataBoxAirportStatus
  // already treat AeroDataBox's 204-for-empty-result convention on their endpoints.
  if (response.status === 204) throw new ProviderError(404, 'No aircraft found for this registration.')
  if (!response.ok) throw await providerErrorFromResponse(response, 'No aircraft found for this registration.')

  let data
  try {
    data = await response.json()
  } catch {
    throw new ProviderError(502, 'Unable to parse aviation data provider response.')
  }

  const normalized = normalizeAeroDataBoxAircraft(data, [])
  if (!normalized) throw new ProviderError(404, 'No aircraft found for this registration.')
  return normalized
}

export function mockAircraft(registration) {
  return {
    registration: (registration || '9V-MOCK').toUpperCase(),
    type: 'Airbus A350-900',
    typeCode: 'A359',
    serialNumber: '12345',
    airlineName: 'Singapore Airlines',
    ageYears: 5.2,
    firstFlightDate: '2020-02-01',
    deliveryDate: '2020-03-01',
    provider: 'mock-worker',
    warnings: [],
  }
}

/**
 * The provider adapter contract every fork-in adapter implements:
 *   - name: a short lowercase identifier, used as the FLIGHTLOG_PROVIDER value.
 *   - supportsFlightStatus / supportsAirportStatus / supportsAircraftHistory:
 *     capability flags returned by GET /capabilities so the frontend can hide
 *     features an adapter can't serve.
 *   - fetchFlightStatus(flightNumber, date, dateRole, env): real-mode lookup for a
 *     single flight; normalize its result to the FlightLiveStatus shape below.
 *   - fetchAirportStatus(iata, hours, env): real-mode lookup for an airport's board.
 *   - fetchAircraftHistory(registration, env): real-mode lookup for an aircraft's
 *     registration/type metadata.
 *   - mockFlightStatus(flightNumber, date) / mockAirportStatus(iata) /
 *     mockAircraftHistory(registration): deterministic data for
 *     FLIGHTLOG_PROVIDER_MODE=mock, so the frontend works without credentials.
 * See providers/index.js to register a new adapter, and the Worker README's
 * "Provider adapters" section for the full guide.
 */
export const aeroDataBoxAdapter = {
  name: 'aerodatabox',
  supportsFlightStatus: true,
  supportsAirportStatus: true,
  supportsAircraftHistory: true,
  fetchFlightStatus: fetchAeroDataBoxStatus,
  fetchAirportStatus: fetchAeroDataBoxAirportStatus,
  fetchAircraftHistory: fetchAeroDataBoxAircraft,
  mockFlightStatus: mockStatus,
  mockAirportStatus,
  mockAircraftHistory: mockAircraft,
}
