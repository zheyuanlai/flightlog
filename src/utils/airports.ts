import { airports as curatedAirports } from '../data/airports'
import type { Airport, FlightLogEntry, FlightLiveAirport, ProviderAirportSnapshot } from '../types'

let generatedAirports: Airport[] = []
let providerAirports: Airport[] = []
let airportByIata = new Map<string, Airport>()
let airportSearchPool: Airport[] = []

function normalizeAirport(airport: Airport | ProviderAirportSnapshot | FlightLiveAirport, source: Airport['source'] = 'generated'): Airport | undefined {
  const iata = normalizeIata(airport.iata ?? '')
  if (!/^[A-Z]{3}$/.test(iata)) return undefined
  const lat = typeof airport.lat === 'number' && Number.isFinite(airport.lat) ? airport.lat : undefined
  const lon = typeof airport.lon === 'number' && Number.isFinite(airport.lon) ? airport.lon : undefined
  return {
    iata,
    icao: airport.icao?.trim().toUpperCase() || undefined,
    name: airport.name?.trim() || iata,
    city: ('city' in airport ? airport.city : undefined)?.trim() || airport.name?.trim() || iata,
    country: ('country' in airport ? airport.country : undefined)?.trim() || ('countryName' in airport ? airport.countryName : undefined)?.trim() || '',
    countryCode: ('countryCode' in airport ? airport.countryCode : undefined)?.trim().toUpperCase() || undefined,
    countryName: ('countryName' in airport ? airport.countryName : undefined)?.trim() || ('country' in airport ? airport.country : undefined)?.trim() || undefined,
    lat,
    lon,
    timezone: airport.timezone?.trim() || undefined,
    type: 'type' in airport ? airport.type : undefined,
    scheduledService: 'scheduledService' in airport ? airport.scheduledService : undefined,
    source,
  }
}

function rebuildIndex() {
  const map = new Map<string, Airport>()
  for (const airport of curatedAirports) {
    const normalized = normalizeAirport(airport, 'curated')
    if (normalized) map.set(normalized.iata, normalized)
  }
  for (const airport of generatedAirports) {
    const normalized = normalizeAirport(airport, 'generated')
    if (normalized) map.set(normalized.iata, normalized)
  }
  for (const airport of providerAirports) {
    const normalized = normalizeAirport(airport, 'provider')
    if (normalized && !map.has(normalized.iata)) map.set(normalized.iata, normalized)
  }
  airportByIata = map
  airportSearchPool = [...map.values()].sort((a, b) => a.iata.localeCompare(b.iata))
}

rebuildIndex()

export function normalizeIata(value: string): string {
  return value.trim().toUpperCase()
}

export function isIataFormat(value: string): boolean {
  return /^[A-Z]{3}$/.test(normalizeIata(value))
}

export function lookupAirport(value: string): Airport | undefined {
  return airportByIata.get(normalizeIata(value))
}

export function isValidIata(value: string): boolean {
  return isIataFormat(value)
}

export function hasKnownAirport(value: string): boolean {
  return Boolean(lookupAirport(value))
}

export function hasCoordinates(airport?: Pick<Airport, 'lat' | 'lon'>): airport is Airport & { lat: number; lon: number } {
  return typeof airport?.lat === 'number' && Number.isFinite(airport.lat) && typeof airport.lon === 'number' && Number.isFinite(airport.lon)
}

export function airportFromSnapshot(snapshot?: ProviderAirportSnapshot | FlightLiveAirport): Airport | undefined {
  return snapshot ? normalizeAirport(snapshot, 'provider') : undefined
}

export function resolveFlightAirport(flight: FlightLogEntry, role: 'origin' | 'destination'): Airport | undefined {
  const code = role === 'origin' ? flight.origin : flight.destination
  return lookupAirport(code)
    ?? airportFromSnapshot(role === 'origin' ? flight.originAirportSnapshot : flight.destinationAirportSnapshot)
    ?? airportFromSnapshot(role === 'origin' ? flight.liveStatus?.origin ?? flight.liveStatus?.departureAirport : flight.liveStatus?.destination ?? flight.liveStatus?.arrivalAirport)
}

function searchRank(airport: Airport, normalized: string, lower: string): number {
  if (airport.iata === normalized) return 0
  if (airport.iata.startsWith(normalized)) return 1
  if (airport.icao?.toUpperCase() === normalized) return 2
  if (airport.city.toLowerCase().startsWith(lower)) return 3
  if (airport.name.toLowerCase().startsWith(lower)) return 4
  if (airport.country.toLowerCase().startsWith(lower)) return 5
  return 10
}

export function searchAirports(query: string, limit = 8): Airport[] {
  const normalized = normalizeIata(query)
  const lower = query.trim().toLowerCase()
  if (!lower) return airportSearchPool.slice(0, limit)
  return airportSearchPool
    .filter((airport) =>
      [airport.iata, airport.icao, airport.name, airport.city, airport.country, airport.countryCode]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(lower),
    )
    .sort((a, b) => searchRank(a, normalized, lower) - searchRank(b, normalized, lower) || a.iata.localeCompare(b.iata))
    .slice(0, limit)
}

export function formatAirportOption(airport: Airport): string {
  const place = [airport.city, airport.country].filter(Boolean).join(', ')
  return `${airport.iata} - ${airport.name}${place ? `, ${place}` : ''}`
}

export function setProviderAirports(snapshots: ProviderAirportSnapshot[]): void {
  providerAirports = snapshots
    .map((airport) => normalizeAirport(airport, 'provider'))
    .filter((airport): airport is Airport => Boolean(airport))
  rebuildIndex()
}

export async function loadGeneratedAirports(fetcher: typeof fetch = fetch): Promise<number> {
  const response = await fetcher(`${import.meta.env.BASE_URL}data/airports.generated.json`, { cache: 'force-cache' })
  if (!response.ok) throw new Error('Unable to load generated airport dataset')
  const airports = (await response.json()) as Airport[]
  generatedAirports = airports
    .map((airport) => normalizeAirport(airport, 'generated'))
    .filter((airport): airport is Airport => Boolean(airport))
  rebuildIndex()
  return generatedAirports.length
}

export function airportCount(): number {
  return airportSearchPool.length
}
