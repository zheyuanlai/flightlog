import Dexie, { type Table } from 'dexie'
import type { AppMetadata, FlightLiveStatus, FlightLogEntry, ProviderAirportSnapshot, SyncEventLog, TripMetadata, TripType } from './types'

export const LOCAL_SCHEMA_VERSION = 4

class FlightLogDatabase extends Dexie {
  flights!: Table<FlightLogEntry, string>
  providerAirports!: Table<ProviderAirportSnapshot, string>
  tripMetadata!: Table<TripMetadata, string>
  appMetadata!: Table<AppMetadata, string>
  syncEvents!: Table<SyncEventLog, string>

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
    this.version(4).stores({
      flights: 'id, date, flightNumber, airline, origin, destination, updatedAt, deletedAt, restoredAt, source, providerFetchedAt',
      providerAirports: 'iata, countryCode, source, updatedAt, deletedAt',
      tripMetadata: 'id, type, isFavorite, updatedAt, deletedAt',
      appMetadata: 'key, updatedAt',
      syncEvents: 'id, eventType, createdAt, deviceId',
    })
  }
}

export const db = new FlightLogDatabase()

export async function getFlights(): Promise<FlightLogEntry[]> {
  const flights = await db.flights.orderBy('date').reverse().toArray()
  return flights.filter((flight) => !flight.deletedAt)
}

export async function getAllFlights(): Promise<FlightLogEntry[]> {
  return db.flights.orderBy('date').reverse().toArray()
}

export async function getDeletedFlights(): Promise<FlightLogEntry[]> {
  const flights = await db.flights.where('deletedAt').above('').toArray()
  return flights.sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '') || b.date.localeCompare(a.date))
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
    lastOperation: flight.deletedAt ? 'delete' : flight.restoredAt ? 'restore' : flight.lastOperation ?? (flight.createdAt ? 'update' : 'create'),
  })
  return id
}

export async function softDeleteFlight(id: string, options: { deviceId?: string; reason?: string; deletedAt?: string } = {}): Promise<void> {
  const existing = await db.flights.get(id)
  if (!existing) return
  const now = options.deletedAt ?? new Date().toISOString()
  await db.flights.put({
    ...existing,
    deletedAt: now,
    deletedByDeviceId: options.deviceId,
    deleteReason: options.reason ?? existing.deleteReason ?? 'Deleted from FlightLog',
    restoredAt: undefined,
    tombstoneVersion: existing.tombstoneVersion ?? 1,
    lastOperation: 'delete',
    updatedAt: now,
  })
}

export async function deleteFlight(id: string, options: { deviceId?: string; reason?: string; deletedAt?: string } = {}): Promise<void> {
  await softDeleteFlight(id, options)
}

export async function restoreFlight(id: string, options: { restoredAt?: string } = {}): Promise<void> {
  const existing = await db.flights.get(id)
  if (!existing) return
  const now = options.restoredAt ?? new Date().toISOString()
  await db.flights.put({
    ...existing,
    deletedAt: undefined,
    deletedByDeviceId: undefined,
    deleteReason: undefined,
    restoredAt: now,
    lastOperation: 'restore',
    updatedAt: now,
  })
}

export async function permanentlyDeleteFlight(id: string): Promise<void> {
  await db.flights.delete(id)
}

export async function bulkRestoreFlights(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => restoreFlight(id)))
}

export async function bulkPermanentlyDeleteFlights(ids: string[]): Promise<void> {
  await db.flights.bulkDelete(ids)
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

export async function bulkPutProviderAirportsRaw(airports: ProviderAirportSnapshot[]): Promise<void> {
  const cleaned = airports
    .map((airport) => {
      const iata = typeof airport.iata === 'string' ? airport.iata.trim().toUpperCase() : ''
      return /^[A-Z]{3}$/.test(iata) ? { ...airport, iata } : undefined
    })
    .filter((airport): airport is ProviderAirportSnapshot => Boolean(airport))
  if (cleaned.length > 0) await db.providerAirports.bulkPut(cleaned)
}

function cleanTripMetadata(metadata: Partial<TripMetadata> & Pick<TripMetadata, 'id'>, touch = true): TripMetadata {
  const now = new Date().toISOString()
  const type: TripType = metadata.type === 'work' || metadata.type === 'school' || metadata.type === 'other' ? metadata.type : 'personal'
  return {
    id: metadata.id,
    name: metadata.name?.trim() || undefined,
    notes: metadata.notes?.trim() || undefined,
    type,
    isFavorite: Boolean(metadata.isFavorite),
    createdAt: metadata.createdAt ?? now,
    updatedAt: touch ? now : metadata.updatedAt ?? now,
    deletedAt: metadata.deletedAt,
    deletedByDeviceId: metadata.deletedByDeviceId,
    deleteReason: metadata.deleteReason,
    restoredAt: metadata.restoredAt,
    tombstoneVersion: metadata.tombstoneVersion,
    lastOperation: metadata.lastOperation,
  }
}

export async function getTripMetadata(): Promise<TripMetadata[]> {
  const metadata = await db.tripMetadata.toArray()
  return metadata.filter((item) => !item.deletedAt)
}

export async function getAllTripMetadata(): Promise<TripMetadata[]> {
  return db.tripMetadata.toArray()
}

export async function saveTripMetadata(metadata: Partial<TripMetadata> & Pick<TripMetadata, 'id'>): Promise<void> {
  const existing = await db.tripMetadata.get(metadata.id)
  await db.tripMetadata.put(cleanTripMetadata({ ...existing, ...metadata, createdAt: existing?.createdAt ?? metadata.createdAt }))
}

export async function bulkSaveTripMetadata(metadata: TripMetadata[]): Promise<void> {
  const cleaned = metadata.map((item) => cleanTripMetadata(item, false))
  if (cleaned.length > 0) await db.tripMetadata.bulkPut(cleaned)
}

export async function bulkPutTripMetadataRaw(metadata: TripMetadata[]): Promise<void> {
  const cleaned = metadata
    .filter((item) => item.id && item.createdAt && item.updatedAt)
    .map((item) => ({
      ...item,
      type: (item.type === 'work' || item.type === 'school' || item.type === 'other' ? item.type : 'personal') as TripType,
      isFavorite: Boolean(item.isFavorite),
    }))
  if (cleaned.length > 0) await db.tripMetadata.bulkPut(cleaned)
}

export async function replaceTripMetadata(metadata: TripMetadata[]): Promise<void> {
  await db.tripMetadata.clear()
  await bulkSaveTripMetadata(metadata)
}

export async function addSyncEvent(event: Omit<SyncEventLog, 'id' | 'createdAt'> & Partial<Pick<SyncEventLog, 'id' | 'createdAt'>>): Promise<SyncEventLog> {
  const now = event.createdAt ?? new Date().toISOString()
  const item: SyncEventLog = {
    ...event,
    id: event.id ?? crypto.randomUUID(),
    createdAt: now,
  }
  await db.syncEvents.put(item)
  return item
}

export async function listLocalSyncEvents(limit = 20): Promise<SyncEventLog[]> {
  const events = await db.syncEvents.orderBy('createdAt').reverse().limit(limit).toArray()
  return events
}

export async function replaceSyncEvents(events: SyncEventLog[]): Promise<void> {
  await db.syncEvents.clear()
  if (events.length > 0) await db.syncEvents.bulkPut(events)
}

export async function migrateLegacyTripNames(legacyNames: Record<string, string>): Promise<TripMetadata[]> {
  const existing = await getAllTripMetadata()
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
