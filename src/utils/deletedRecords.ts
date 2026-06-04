import type { FlightLogEntry, ProviderAirportSnapshot, TombstoneMetadata, TripMetadata } from '../types'

export function isDeletedRecord(record: TombstoneMetadata | undefined): boolean {
  return Boolean(record?.deletedAt)
}

export function activeRecords<T extends TombstoneMetadata>(records: T[]): T[] {
  return records.filter((record) => !isDeletedRecord(record))
}

export function deletedRecords<T extends TombstoneMetadata>(records: T[]): T[] {
  return records.filter(isDeletedRecord)
}

export function deletedFlights(flights: FlightLogEntry[]): FlightLogEntry[] {
  return deletedRecords(flights).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '') || b.date.localeCompare(a.date))
}

export function deletedTripMetadata(metadata: TripMetadata[]): TripMetadata[] {
  return deletedRecords(metadata).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '') || a.id.localeCompare(b.id))
}

export function deletedProviderAirports(airports: ProviderAirportSnapshot[]): ProviderAirportSnapshot[] {
  return deletedRecords(airports).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '') || a.iata.localeCompare(b.iata))
}

export function deletionLabel(record: TombstoneMetadata): string {
  return record.deletedAt ?? 'Not deleted'
}
