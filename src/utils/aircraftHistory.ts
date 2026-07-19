import type { LiveDataMode } from '../types'

export interface AircraftLookup {
  registration: string
  type?: string
  typeCode?: string
  serialNumber?: string
  airlineName?: string
  ageYears?: number
  firstFlightDate?: string
  deliveryDate?: string
  provider?: string
  warnings?: string[]
}

export interface FetchAircraftLookupOptions {
  useMock?: boolean
  liveDataMode?: LiveDataMode
  baseUrl?: string
  fetcher?: typeof fetch
}

export function normalizeRegistration(value: string): string {
  return value.trim().toUpperCase()
}

export function buildAircraftHistoryUrl(baseUrl: string, registration: string): string {
  const normalized = baseUrl.replace(/\/$/, '')
  const params = new URLSearchParams({ registration: normalizeRegistration(registration) })
  return `${normalized}/aircraft-history?${params.toString()}`
}

export function mockAircraftLookup(registration: string): AircraftLookup {
  return {
    registration: normalizeRegistration(registration) || '9V-MOCK',
    type: 'Airbus A350-900',
    typeCode: 'A359',
    serialNumber: '12345',
    airlineName: 'Singapore Airlines',
    ageYears: 5.2,
    firstFlightDate: '2020-02-01',
    deliveryDate: '2020-03-01',
    provider: 'mock',
    warnings: [],
  }
}

export function normalizeAircraftLookup(value: unknown, fallbackRegistration: string): AircraftLookup {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const str = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : undefined)
  const num = (key: string) => (typeof record[key] === 'number' && Number.isFinite(record[key]) ? (record[key] as number) : undefined)
  return {
    registration: str('registration') || normalizeRegistration(fallbackRegistration),
    type: str('type'),
    typeCode: str('typeCode'),
    serialNumber: str('serialNumber'),
    airlineName: str('airlineName'),
    ageYears: num('ageYears'),
    firstFlightDate: str('firstFlightDate'),
    deliveryDate: str('deliveryDate'),
    provider: str('provider'),
    warnings: Array.isArray(record.warnings) ? (record.warnings as unknown[]).filter((item): item is string => typeof item === 'string') : [],
  }
}

export async function fetchAircraftLookup(registration: string, options: FetchAircraftLookupOptions = {}): Promise<AircraftLookup> {
  const normalized = normalizeRegistration(registration)
  if (!normalized) {
    throw new Error('Enter an aircraft registration.')
  }
  const liveDataMode = options.liveDataMode ?? 'real'
  if (liveDataMode === 'disabled') {
    throw new Error('Live data is disabled in Settings.')
  }
  const useMock = options.useMock || liveDataMode === 'mock' || import.meta.env.VITE_FLIGHTLOG_MOCK_LIVE_STATUS === 'true'
  if (useMock) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    return mockAircraftLookup(normalized)
  }
  const baseUrl = options.baseUrl ?? import.meta.env.VITE_FLIGHTLOG_API_BASE_URL
  if (!baseUrl) {
    throw new Error('Aircraft lookup is unavailable because the live data proxy is not configured.')
  }
  const fetcher = options.fetcher ?? fetch
  let response: Response
  try {
    response = await fetcher(buildAircraftHistoryUrl(baseUrl, normalized))
  } catch {
    throw new Error('Aircraft lookup is unavailable right now. Try again later.')
  }
  if (!response.ok) {
    let message = 'Unable to look up this aircraft.'
    try {
      const body = await response.json() as { error?: string }
      if (typeof body?.error === 'string' && body.error) message = body.error
    } catch {
      // keep default message
    }
    throw new Error(message)
  }
  return normalizeAircraftLookup(await response.json(), normalized)
}
