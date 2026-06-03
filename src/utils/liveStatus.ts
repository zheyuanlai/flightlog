import type { FlightLiveStatus, LookupDateRole } from '../types'

const FIVE_MINUTES_MS = 5 * 60 * 1000

export interface FetchLiveStatusOptions {
  dateRole?: LookupDateRole
  useMock?: boolean
  fetcher?: typeof fetch
}

export function canRefreshLiveStatus(lastFetchedAt?: string): boolean {
  if (!lastFetchedAt) return true
  const last = new Date(lastFetchedAt).getTime()
  if (Number.isNaN(last)) return true
  return Date.now() - last >= FIVE_MINUTES_MS
}

export function refreshStatusLabel(lastFetchedAt?: string, nowMs = Date.now()): string {
  if (!lastFetchedAt) return 'Not checked yet'
  const last = new Date(lastFetchedAt).getTime()
  if (Number.isNaN(last)) return 'Refresh available'
  const elapsedMinutes = Math.max(0, Math.floor((nowMs - last) / 60000))
  if (elapsedMinutes < 1) return 'Updated just now'
  if (elapsedMinutes < 5) return `Refresh available in ${5 - elapsedMinutes} minute${5 - elapsedMinutes === 1 ? '' : 's'}`
  return `Last checked ${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`
}

export function normalizeFlightNumber(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '')
}

export function buildFlightStatusUrl(baseUrl: string, flightNumber: string, date: string, dateRole: LookupDateRole = 'Departure'): string {
  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
  const url = new URL(`${trimmedBaseUrl}/flight-status`)
  url.searchParams.set('flightNumber', normalizeFlightNumber(flightNumber))
  url.searchParams.set('date', date)
  url.searchParams.set('dateRole', dateRole)
  return url.toString()
}

function normalizeDateTimeInput(value?: string): string | undefined {
  if (!value) return undefined
  return value.trim().replace(' ', 'T') || undefined
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim())
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map((value) => Number(value))
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export async function readFlightStatusError(response: Response): Promise<string> {
  try {
    const body = (await response.clone().json()) as { error?: unknown; message?: unknown }
    const error = typeof body.error === 'string' ? body.error : undefined
    const message = typeof body.message === 'string' ? body.message : undefined
    return error || message || 'Unable to fetch live flight status'
  } catch {
    const text = await response.text()
    return text || 'Unable to fetch live flight status'
  }
}

export function normalizeLiveStatus(liveStatus: FlightLiveStatus): FlightLiveStatus {
  const airline = liveStatus.airline ?? {
    name: liveStatus.airlineName,
    iata: liveStatus.airlineIata,
    icao: liveStatus.airlineIcao,
  }
  const origin = liveStatus.origin ?? liveStatus.departureAirport
  const destination = liveStatus.destination ?? liveStatus.arrivalAirport
  const rawTimes = liveStatus.times ?? {
    scheduledDeparture: liveStatus.scheduledDeparture,
    estimatedDeparture: liveStatus.estimatedDeparture,
    actualDeparture: liveStatus.actualDeparture,
    scheduledArrival: liveStatus.scheduledArrival,
    estimatedArrival: liveStatus.estimatedArrival,
    actualArrival: liveStatus.actualArrival,
    scheduledDepartureLocal: liveStatus.scheduledDepartureLocal,
    estimatedDepartureLocal: liveStatus.estimatedDepartureLocal,
    actualDepartureLocal: liveStatus.actualDepartureLocal,
    scheduledArrivalLocal: liveStatus.scheduledArrivalLocal,
    estimatedArrivalLocal: liveStatus.estimatedArrivalLocal,
    actualArrivalLocal: liveStatus.actualArrivalLocal,
    scheduledDepartureUtc: liveStatus.scheduledDepartureUtc,
    estimatedDepartureUtc: liveStatus.estimatedDepartureUtc,
    actualDepartureUtc: liveStatus.actualDepartureUtc,
    scheduledArrivalUtc: liveStatus.scheduledArrivalUtc,
    estimatedArrivalUtc: liveStatus.estimatedArrivalUtc,
    actualArrivalUtc: liveStatus.actualArrivalUtc,
  }
  const times = {
    scheduledDeparture: normalizeDateTimeInput(firstString(rawTimes.scheduledDeparture, rawTimes.scheduledDepartureLocal, liveStatus.scheduledDepartureLocal)),
    estimatedDeparture: normalizeDateTimeInput(firstString(rawTimes.estimatedDeparture, rawTimes.estimatedDepartureLocal, liveStatus.estimatedDepartureLocal)),
    actualDeparture: normalizeDateTimeInput(firstString(rawTimes.actualDeparture, rawTimes.actualDepartureLocal, liveStatus.actualDepartureLocal)),
    scheduledArrival: normalizeDateTimeInput(firstString(rawTimes.scheduledArrival, rawTimes.scheduledArrivalLocal, liveStatus.scheduledArrivalLocal)),
    estimatedArrival: normalizeDateTimeInput(firstString(rawTimes.estimatedArrival, rawTimes.estimatedArrivalLocal, liveStatus.estimatedArrivalLocal)),
    actualArrival: normalizeDateTimeInput(firstString(rawTimes.actualArrival, rawTimes.actualArrivalLocal, liveStatus.actualArrivalLocal)),
    scheduledDepartureLocal: normalizeDateTimeInput(firstString(rawTimes.scheduledDepartureLocal, liveStatus.scheduledDepartureLocal, rawTimes.scheduledDeparture)),
    estimatedDepartureLocal: normalizeDateTimeInput(firstString(rawTimes.estimatedDepartureLocal, liveStatus.estimatedDepartureLocal, rawTimes.estimatedDeparture)),
    actualDepartureLocal: normalizeDateTimeInput(firstString(rawTimes.actualDepartureLocal, liveStatus.actualDepartureLocal, rawTimes.actualDeparture)),
    scheduledArrivalLocal: normalizeDateTimeInput(firstString(rawTimes.scheduledArrivalLocal, liveStatus.scheduledArrivalLocal, rawTimes.scheduledArrival)),
    estimatedArrivalLocal: normalizeDateTimeInput(firstString(rawTimes.estimatedArrivalLocal, liveStatus.estimatedArrivalLocal, rawTimes.estimatedArrival)),
    actualArrivalLocal: normalizeDateTimeInput(firstString(rawTimes.actualArrivalLocal, liveStatus.actualArrivalLocal, rawTimes.actualArrival)),
    scheduledDepartureUtc: normalizeDateTimeInput(firstString(rawTimes.scheduledDepartureUtc, liveStatus.scheduledDepartureUtc)),
    estimatedDepartureUtc: normalizeDateTimeInput(firstString(rawTimes.estimatedDepartureUtc, liveStatus.estimatedDepartureUtc)),
    actualDepartureUtc: normalizeDateTimeInput(firstString(rawTimes.actualDepartureUtc, liveStatus.actualDepartureUtc)),
    scheduledArrivalUtc: normalizeDateTimeInput(firstString(rawTimes.scheduledArrivalUtc, liveStatus.scheduledArrivalUtc)),
    estimatedArrivalUtc: normalizeDateTimeInput(firstString(rawTimes.estimatedArrivalUtc, liveStatus.estimatedArrivalUtc)),
    actualArrivalUtc: normalizeDateTimeInput(firstString(rawTimes.actualArrivalUtc, liveStatus.actualArrivalUtc)),
  }
  const terminalGate = liveStatus.terminalGate ?? {
    departureTerminal: liveStatus.departureTerminal,
    departureGate: liveStatus.departureGate,
    arrivalTerminal: liveStatus.arrivalTerminal,
    arrivalGate: liveStatus.arrivalGate,
    baggageClaim: liveStatus.baggageClaim,
  }
  const aircraft = liveStatus.aircraft ?? {
    type: liveStatus.aircraftType,
    registration: liveStatus.aircraftRegistration,
  }
  const warnings = liveStatus.warnings ?? (liveStatus.warning ? [liveStatus.warning] : [])

  return {
    ...liveStatus,
    flightNumber: liveStatus.flightNumber ? normalizeFlightNumber(liveStatus.flightNumber) : undefined,
    airline,
    origin,
    destination,
    times,
    terminalGate,
    aircraft,
    warnings,
    warning: liveStatus.warning ?? warnings[0],
    originTimeZone: liveStatus.originTimeZone ?? origin?.timezone ?? origin?.timeZone,
    destinationTimeZone: liveStatus.destinationTimeZone ?? destination?.timezone ?? destination?.timeZone,
    providerUpdatedAt: liveStatus.providerUpdatedAt,
    providerFetchedAt: liveStatus.providerFetchedAt,
    airlineName: liveStatus.airlineName ?? airline.name,
    airlineIata: liveStatus.airlineIata ?? airline.iata,
    airlineIcao: liveStatus.airlineIcao ?? airline.icao,
    departureAirport: liveStatus.departureAirport ?? origin,
    arrivalAirport: liveStatus.arrivalAirport ?? destination,
    scheduledDeparture: liveStatus.scheduledDeparture ?? times.scheduledDeparture,
    estimatedDeparture: liveStatus.estimatedDeparture ?? times.estimatedDeparture,
    actualDeparture: liveStatus.actualDeparture ?? times.actualDeparture,
    scheduledArrival: liveStatus.scheduledArrival ?? times.scheduledArrival,
    estimatedArrival: liveStatus.estimatedArrival ?? times.estimatedArrival,
    actualArrival: liveStatus.actualArrival ?? times.actualArrival,
    scheduledDepartureLocal: liveStatus.scheduledDepartureLocal ?? times.scheduledDepartureLocal,
    estimatedDepartureLocal: liveStatus.estimatedDepartureLocal ?? times.estimatedDepartureLocal,
    actualDepartureLocal: liveStatus.actualDepartureLocal ?? times.actualDepartureLocal,
    scheduledArrivalLocal: liveStatus.scheduledArrivalLocal ?? times.scheduledArrivalLocal,
    estimatedArrivalLocal: liveStatus.estimatedArrivalLocal ?? times.estimatedArrivalLocal,
    actualArrivalLocal: liveStatus.actualArrivalLocal ?? times.actualArrivalLocal,
    scheduledDepartureUtc: liveStatus.scheduledDepartureUtc ?? times.scheduledDepartureUtc,
    estimatedDepartureUtc: liveStatus.estimatedDepartureUtc ?? times.estimatedDepartureUtc,
    actualDepartureUtc: liveStatus.actualDepartureUtc ?? times.actualDepartureUtc,
    scheduledArrivalUtc: liveStatus.scheduledArrivalUtc ?? times.scheduledArrivalUtc,
    estimatedArrivalUtc: liveStatus.estimatedArrivalUtc ?? times.estimatedArrivalUtc,
    actualArrivalUtc: liveStatus.actualArrivalUtc ?? times.actualArrivalUtc,
    departureTerminal: liveStatus.departureTerminal ?? terminalGate.departureTerminal,
    departureGate: liveStatus.departureGate ?? terminalGate.departureGate,
    arrivalTerminal: liveStatus.arrivalTerminal ?? terminalGate.arrivalTerminal,
    arrivalGate: liveStatus.arrivalGate ?? terminalGate.arrivalGate,
    baggageClaim: liveStatus.baggageClaim ?? terminalGate.baggageClaim,
    aircraftType: liveStatus.aircraftType ?? aircraft.type,
    aircraftRegistration: liveStatus.aircraftRegistration ?? aircraft.registration,
  }
}

export function mockLiveStatus(flightNumber: string, date: string): FlightLiveStatus {
  return normalizeLiveStatus({
    status: 'scheduled',
    flightNumber: normalizeFlightNumber(flightNumber),
    airline: { name: 'Singapore Airlines', iata: 'SQ', icao: 'SIA' },
    origin: {
      iata: 'SFO',
      icao: 'KSFO',
      name: 'San Francisco International Airport',
      city: 'San Francisco',
      country: 'United States',
      countryCode: 'US',
      lat: 37.6213,
      lon: -122.379,
      timezone: 'America/Los_Angeles',
    },
    destination: {
      iata: 'SIN',
      icao: 'WSSS',
      name: 'Singapore Changi Airport',
      city: 'Singapore',
      country: 'Singapore',
      countryCode: 'SG',
      lat: 1.3644,
      lon: 103.9915,
      timezone: 'Asia/Singapore',
    },
    times: {
      scheduledDeparture: `${date}T20:45`,
      estimatedDeparture: `${date}T20:55`,
      scheduledArrival: `${addDays(date, 2)}T06:15`,
      scheduledDepartureLocal: `${date}T20:45`,
      estimatedDepartureLocal: `${date}T20:55`,
      scheduledArrivalLocal: `${addDays(date, 2)}T06:15`,
      scheduledDepartureUtc: `${addDays(date, 1)}T03:45:00Z`,
      estimatedDepartureUtc: `${addDays(date, 1)}T03:55:00Z`,
      scheduledArrivalUtc: `${addDays(date, 1)}T22:15:00Z`,
    },
    terminalGate: {
      departureTerminal: '1',
      departureGate: 'A12',
      arrivalTerminal: 'B',
      baggageClaim: '4',
    },
    aircraft: { type: 'Airbus A350-900', registration: '9V-MOCK' },
    provider: 'mock',
    rawProviderStatus: `Mock status for ${normalizeFlightNumber(flightNumber)}`,
    warnings: [],
  })
}

export async function fetchLiveStatus(
  flightNumber: string,
  date: string,
  optionsOrFetcher: FetchLiveStatusOptions | typeof fetch = {},
): Promise<FlightLiveStatus> {
  const options: FetchLiveStatusOptions = typeof optionsOrFetcher === 'function' ? { fetcher: optionsOrFetcher } : optionsOrFetcher
  const dateRole = options.dateRole ?? 'Departure'
  const useMock = options.useMock || import.meta.env.VITE_FLIGHTLOG_MOCK_LIVE_STATUS === 'true'

  if (useMock) {
    await new Promise((resolve) => window.setTimeout(resolve, 350))
    return mockLiveStatus(flightNumber, date)
  }

  const baseUrl = import.meta.env.VITE_FLIGHTLOG_API_BASE_URL
  if (!baseUrl) {
    throw new Error('Live lookup is unavailable, but you can still add the flight manually.')
  }

  const fetcher = options.fetcher ?? fetch
  let response: Response
  try {
    response = await fetcher(buildFlightStatusUrl(baseUrl, flightNumber, date, dateRole))
  } catch {
    throw new Error('Live lookup is unavailable, but you can still add the flight manually.')
  }
  if (!response.ok) {
    throw new Error(await readFlightStatusError(response))
  }
  return normalizeLiveStatus((await response.json()) as FlightLiveStatus)
}
