import Dexie, { type Table } from 'dexie'
import type { FlightLiveStatus, FlightLogEntry, ProviderAirportSnapshot } from './types'

class FlightLogDatabase extends Dexie {
  flights!: Table<FlightLogEntry, string>
  providerAirports!: Table<ProviderAirportSnapshot, string>

  constructor() {
    super('flightlog')
    this.version(1).stores({
      flights: 'id, date, flightNumber, airline, origin, destination, updatedAt',
    })
    this.version(2).stores({
      flights: 'id, date, flightNumber, airline, origin, destination, updatedAt, source, providerFetchedAt',
      providerAirports: 'iata, countryCode, source, updatedAt',
    })
  }
}

export const db = new FlightLogDatabase()

export async function getFlights(): Promise<FlightLogEntry[]> {
  return db.flights.orderBy('date').reverse().toArray()
}

export async function saveFlight(
  flight: Omit<FlightLogEntry, 'id' | 'createdAt' | 'updatedAt'> &
    Partial<Pick<FlightLogEntry, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<string> {
  const now = new Date().toISOString()
  const id = flight.id ?? crypto.randomUUID()
  await db.flights.put({
    ...flight,
    id,
    createdAt: flight.createdAt ?? now,
    updatedAt: now,
  })
  return id
}

export async function deleteFlight(id: string): Promise<void> {
  await db.flights.delete(id)
}

export async function bulkSaveFlights(flights: FlightLogEntry[]): Promise<void> {
  await db.flights.bulkPut(flights)
}

function cleanAirportSnapshot(airport: Partial<ProviderAirportSnapshot> | undefined, source = 'provider'): ProviderAirportSnapshot | undefined {
  if (!airport) return undefined
  const iata = typeof airport?.iata === 'string' ? airport.iata.trim().toUpperCase() : ''
  if (!/^[A-Z]{3}$/.test(iata)) return undefined
  const snapshot = airport
  return {
    ...snapshot,
    iata,
    icao: snapshot.icao?.trim().toUpperCase() || undefined,
    name: snapshot.name?.trim() || undefined,
    city: snapshot.city?.trim() || undefined,
    country: snapshot.country?.trim() || snapshot.countryName?.trim() || undefined,
    countryCode: snapshot.countryCode?.trim().toUpperCase() || undefined,
    countryName: snapshot.countryName?.trim() || snapshot.country?.trim() || undefined,
    lat: typeof snapshot.lat === 'number' && Number.isFinite(snapshot.lat) ? snapshot.lat : undefined,
    lon: typeof snapshot.lon === 'number' && Number.isFinite(snapshot.lon) ? snapshot.lon : undefined,
    timezone: snapshot.timezone?.trim() || undefined,
    source,
    updatedAt: new Date().toISOString(),
  }
}

export function providerAirportSnapshotsFromLiveStatus(liveStatus: FlightLiveStatus): ProviderAirportSnapshot[] {
  const origin = liveStatus.origin ?? liveStatus.departureAirport
  const destination = liveStatus.destination ?? liveStatus.arrivalAirport
  return [cleanAirportSnapshot(origin, liveStatus.provider ?? 'provider'), cleanAirportSnapshot(destination, liveStatus.provider ?? 'provider')]
    .filter((airport): airport is ProviderAirportSnapshot => Boolean(airport))
}

export async function getProviderAirports(): Promise<ProviderAirportSnapshot[]> {
  return db.providerAirports.toArray()
}

export async function saveProviderAirports(airports: ProviderAirportSnapshot[]): Promise<void> {
  const cleaned = airports
    .map((airport) => cleanAirportSnapshot(airport, airport.source ?? 'provider'))
    .filter((airport): airport is ProviderAirportSnapshot => Boolean(airport))
  if (cleaned.length === 0) return
  await db.providerAirports.bulkPut(cleaned)
}
