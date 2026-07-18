import type { LiveDataMode } from '../types'
import { normalizeIata } from './airports'

export interface AirportMovementSummary {
  total: number
  onTime: number
  delayed: number
  cancelled: number
  avgDelayMinutes: number
  onTimePercent: number
}

export interface AirportStatusSampleFlight {
  flightNumber?: string
  direction: 'departure' | 'arrival'
  status: 'on-time' | 'delayed' | 'cancelled'
  delayMinutes?: number
  scheduledLocal?: string
  otherAirport?: string
}

export interface AirportStatus {
  airport: string
  departures: AirportMovementSummary
  arrivals: AirportMovementSummary
  sample: AirportStatusSampleFlight[]
  provider?: string
  warnings?: string[]
}

export interface FetchAirportStatusOptions {
  hours?: number
  useMock?: boolean
  liveDataMode?: LiveDataMode
  baseUrl?: string
  fetcher?: typeof fetch
}

export function buildAirportStatusUrl(baseUrl: string, iata: string, hours = 6): string {
  const normalized = baseUrl.replace(/\/$/, '')
  const params = new URLSearchParams({ iata: normalizeIata(iata), hours: String(hours) })
  return `${normalized}/airport-status?${params.toString()}`
}

const EMPTY_SUMMARY: AirportMovementSummary = { total: 0, onTime: 0, delayed: 0, cancelled: 0, avgDelayMinutes: 0, onTimePercent: 0 }

export function mockAirportStatus(iata: string): AirportStatus {
  const airport = normalizeIata(iata) || 'SIN'
  return {
    airport,
    departures: { total: 20, onTime: 15, delayed: 4, cancelled: 1, avgDelayMinutes: 22, onTimePercent: 75 },
    arrivals: { total: 18, onTime: 14, delayed: 3, cancelled: 1, avgDelayMinutes: 18, onTimePercent: 78 },
    sample: [
      { flightNumber: 'SQ38', direction: 'departure', status: 'on-time', delayMinutes: 0, otherAirport: 'LAX' },
      { flightNumber: 'UA60', direction: 'departure', status: 'delayed', delayMinutes: 35, otherAirport: 'NRT' },
      { flightNumber: 'BA11', direction: 'arrival', status: 'on-time', delayMinutes: 5, otherAirport: 'LHR' },
    ],
    provider: 'mock',
    warnings: [],
  }
}

function normalizeSummary(value: unknown): AirportMovementSummary {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const num = (key: string) => (typeof record[key] === 'number' && Number.isFinite(record[key]) ? (record[key] as number) : 0)
  return {
    total: num('total'),
    onTime: num('onTime'),
    delayed: num('delayed'),
    cancelled: num('cancelled'),
    avgDelayMinutes: num('avgDelayMinutes'),
    onTimePercent: num('onTimePercent'),
  }
}

function normalizeSampleFlight(value: unknown): AirportStatusSampleFlight | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const str = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : undefined)
  const direction: AirportStatusSampleFlight['direction'] = record.direction === 'arrival' ? 'arrival' : 'departure'
  const status: AirportStatusSampleFlight['status'] =
    record.status === 'delayed' || record.status === 'cancelled' ? record.status : 'on-time'
  const flight: AirportStatusSampleFlight = { direction, status }
  const flightNumber = str('flightNumber')
  if (flightNumber) flight.flightNumber = flightNumber
  const scheduledLocal = str('scheduledLocal')
  if (scheduledLocal) flight.scheduledLocal = scheduledLocal
  const otherAirport = str('otherAirport')
  if (otherAirport) flight.otherAirport = otherAirport
  if (typeof record.delayMinutes === 'number' && Number.isFinite(record.delayMinutes)) {
    flight.delayMinutes = record.delayMinutes
  }
  return flight
}

export function normalizeAirportStatus(value: unknown, fallbackIata: string): AirportStatus {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const sample = Array.isArray(record.sample)
    ? (record.sample as unknown[]).map(normalizeSampleFlight).filter((item): item is AirportStatusSampleFlight => Boolean(item))
    : []
  return {
    airport: typeof record.airport === 'string' && record.airport ? record.airport : normalizeIata(fallbackIata),
    departures: normalizeSummary(record.departures),
    arrivals: normalizeSummary(record.arrivals),
    sample,
    provider: typeof record.provider === 'string' ? record.provider : undefined,
    warnings: Array.isArray(record.warnings) ? (record.warnings as unknown[]).filter((item): item is string => typeof item === 'string') : [],
  }
}

export async function fetchAirportStatus(iata: string, options: FetchAirportStatusOptions = {}): Promise<AirportStatus> {
  const normalized = normalizeIata(iata)
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error('Enter a valid 3-letter airport code.')
  }
  const liveDataMode = options.liveDataMode ?? 'real'
  if (liveDataMode === 'disabled') {
    throw new Error('Live data is disabled in Settings.')
  }
  const useMock = options.useMock || liveDataMode === 'mock' || import.meta.env.VITE_FLIGHTLOG_MOCK_LIVE_STATUS === 'true'
  if (useMock) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    return mockAirportStatus(normalized)
  }
  const baseUrl = options.baseUrl ?? import.meta.env.VITE_FLIGHTLOG_API_BASE_URL
  if (!baseUrl) {
    throw new Error('Airport status is unavailable because the live data proxy is not configured.')
  }
  const fetcher = options.fetcher ?? fetch
  let response: Response
  try {
    response = await fetcher(buildAirportStatusUrl(baseUrl, normalized, options.hours ?? 6))
  } catch {
    throw new Error('Airport status is unavailable right now. Try again later.')
  }
  if (!response.ok) {
    let message = 'Unable to fetch airport status.'
    try {
      const body = await response.json() as { error?: string }
      if (typeof body?.error === 'string' && body.error) message = body.error
    } catch {
      // keep default message
    }
    throw new Error(message)
  }
  return normalizeAirportStatus(await response.json(), normalized)
}

export { EMPTY_SUMMARY }
