import Dexie, { type Table } from 'dexie'
import type { AppMetadata, FlightLiveStatus, FlightLogEntry, ProviderAirportSnapshot, TripMetadata, TripType } from './types'

export const LOCAL_SCHEMA_VERSION = 3

class FlightLogDatabase extends Dexie {
  flights!: Table<FlightLogEntry, string>
  providerAirports!: Table<ProviderAirportSnapshot, string>
  tripMetadata!: Table<TripMetadata, string>
  appMetadata!: Table<AppMetadata, string>

  constructor() {
    super('flightlog')
    this.version(1).stores({
      flights: 'id, date, flightNumber, airline, origin, destination, updatedAt',
    })
    this.version(2).stores({
      flights: 'id, date, flightNumber, airline, origin, destination, updatedAt, source, providerFetchedAt',
      providerAirports: 'iata, countryCode, source, updatedAt',
    })
    this.version(3).stores({
      flights: 'id, date, flightNumber, airline, origin, destination, updatedAt, source, providerFetchedAt',
      providerAirports: 'iata, countryCode, source, updatedAt',
      tripMetadata: 'id, type, isFavorite, updatedAt',
      appMetadata: 'key, updatedAt',
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

export async function replaceFlights(flights: FlightLogEntry[]): Promise<void> {
  await db.flights.clear()
  if (flights.length > 0) await db.flights.bulkPut(flights)
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
    timezone: snapshot.timezone?.trim() || snapshot.timeZone?.trim() || undefined,
    timeZone: snapshot.timeZone?.trim() || snapshot.timezone?.trim() || undefined,
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

export async function replaceProviderAirports(airports: ProviderAirportSnapshot[]): Promise<void> {
  await db.providerAirports.clear()
  await saveProviderAirports(airports)
}

function cleanTripMetadata(metadata: Partial<TripMetadata> & Pick<TripMetadata, 'id'>): TripMetadata {
  const now = new Date().toISOString()
  const type: TripType = metadata.type === 'work' || metadata.type === 'school' || metadata.type === 'other' ? metadata.type : 'personal'
  return {
    id: metadata.id,
    name: metadata.name?.trim() || undefined,
    notes: metadata.notes?.trim() || undefined,
    type,
    isFavorite: Boolean(metadata.isFavorite),
    createdAt: metadata.createdAt ?? now,
    updatedAt: now,
  }
}

export async function getTripMetadata(): Promise<TripMetadata[]> {
  return db.tripMetadata.toArray()
}

export async function saveTripMetadata(metadata: Partial<TripMetadata> & Pick<TripMetadata, 'id'>): Promise<void> {
  const existing = await db.tripMetadata.get(metadata.id)
  await db.tripMetadata.put(cleanTripMetadata({ ...existing, ...metadata, createdAt: existing?.createdAt ?? metadata.createdAt }))
}

export async function bulkSaveTripMetadata(metadata: TripMetadata[]): Promise<void> {
  const cleaned = metadata.map((item) => cleanTripMetadata(item))
  if (cleaned.length > 0) await db.tripMetadata.bulkPut(cleaned)
}

export async function replaceTripMetadata(metadata: TripMetadata[]): Promise<void> {
  await db.tripMetadata.clear()
  await bulkSaveTripMetadata(metadata)
}

export async function migrateLegacyTripNames(legacyNames: Record<string, string>): Promise<TripMetadata[]> {
  const existing = await getTripMetadata()
  const existingIds = new Set(existing.map((metadata) => metadata.id))
  const toSave = Object.entries(legacyNames)
    .filter(([id, name]) => id && name.trim() && !existingIds.has(id))
    .map(([id, name]) => cleanTripMetadata({ id, name }))
  if (toSave.length > 0) await db.tripMetadata.bulkPut(toSave)
  return getTripMetadata()
}

export async function getAppMetadata(key: string): Promise<string | undefined> {
  return (await db.appMetadata.get(key))?.value
}

export async function getAllAppMetadata(): Promise<AppMetadata[]> {
  return db.appMetadata.toArray()
}

export async function setAppMetadata(key: string, value: string): Promise<void> {
  await db.appMetadata.put({ key, value, updatedAt: new Date().toISOString() })
}

export async function bulkSetAppMetadata(metadata: AppMetadata[]): Promise<void> {
  if (metadata.length === 0) return
  await db.appMetadata.bulkPut(metadata.map((item) => ({ ...item, updatedAt: item.updatedAt || new Date().toISOString() })))
}

export async function replaceAppMetadata(metadata: AppMetadata[]): Promise<void> {
  await db.appMetadata.clear()
  await bulkSetAppMetadata(metadata)
}
