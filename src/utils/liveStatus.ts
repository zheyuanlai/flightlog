import type { FlightLiveStatus } from '../types'

const FIVE_MINUTES_MS = 5 * 60 * 1000

export function canRefreshLiveStatus(lastFetchedAt?: string): boolean {
  if (!lastFetchedAt) return true
  const last = new Date(lastFetchedAt).getTime()
  if (Number.isNaN(last)) return true
  return Date.now() - last >= FIVE_MINUTES_MS
}

export async function fetchLiveStatus(flightNumber: string, date: string): Promise<FlightLiveStatus> {
  if (import.meta.env.VITE_FLIGHTLOG_MOCK_LIVE_STATUS === 'true') {
    await new Promise((resolve) => window.setTimeout(resolve, 350))
    return {
      status: 'scheduled',
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

  const baseUrl = import.meta.env.VITE_FLIGHTLOG_API_BASE_URL
  if (!baseUrl) {
    throw new Error('Live flight status is not configured. You can still log flights manually.')
  }

  const url = new URL('/flight-status', baseUrl)
  url.searchParams.set('flightNumber', flightNumber)
  url.searchParams.set('date', date)
  const response = await fetch(url)
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || 'Unable to fetch live flight status')
  }
  return (await response.json()) as FlightLiveStatus
}
