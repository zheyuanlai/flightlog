import type { FlightLiveStatus } from '../types'

const FIVE_MINUTES_MS = 5 * 60 * 1000

export function canRefreshLiveStatus(lastFetchedAt?: string): boolean {
  if (!lastFetchedAt) return true
  const last = new Date(lastFetchedAt).getTime()
  if (Number.isNaN(last)) return true
  return Date.now() - last >= FIVE_MINUTES_MS
}

export function buildFlightStatusUrl(baseUrl: string, flightNumber: string, date: string): string {
  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
  const url = new URL(`${trimmedBaseUrl}/flight-status`)
  url.searchParams.set('flightNumber', flightNumber)
  url.searchParams.set('date', date)
  return url.toString()
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

export function mockLiveStatus(flightNumber: string, date: string): FlightLiveStatus {
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
    provider: 'mock',
    rawProviderStatus: `Mock status for ${flightNumber}`,
  }
}

export async function fetchLiveStatus(
  flightNumber: string,
  date: string,
  fetcher: typeof fetch = fetch,
): Promise<FlightLiveStatus> {
  if (import.meta.env.VITE_FLIGHTLOG_MOCK_LIVE_STATUS === 'true') {
    await new Promise((resolve) => window.setTimeout(resolve, 350))
    return mockLiveStatus(flightNumber, date)
  }

  const baseUrl = import.meta.env.VITE_FLIGHTLOG_API_BASE_URL
  if (!baseUrl) {
    throw new Error('Live flight status is not configured. You can still log flights manually.')
  }

  const response = await fetcher(buildFlightStatusUrl(baseUrl, flightNumber, date))
  if (!response.ok) {
    throw new Error(await readFlightStatusError(response))
  }
  return (await response.json()) as FlightLiveStatus
}
