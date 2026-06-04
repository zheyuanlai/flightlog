import type { AppMetadata, FlightLogEntry, ProviderAirportSnapshot, TripMetadata } from '../types'
import { createFullBackup } from './backup'
import { activeRecords, deletedRecords } from './deletedRecords'

export interface LocalStorageSummary {
  flightCount: number
  activeFlightCount: number
  deletedFlightCount: number
  tripMetadataCount: number
  providerAirportCount: number
  appMetadataCount: number
  estimatedBackupBytes: number
  estimatedBackupLabel: string
  localSchemaVersion: number
}

function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function estimateFullBackupSize(input: {
  flights: FlightLogEntry[]
  tripMetadata: TripMetadata[]
  providerAirports: ProviderAirportSnapshot[]
  appMetadata: AppMetadata[]
}): number {
  const backup = createFullBackup({ ...input, exportedAt: '1970-01-01T00:00:00.000Z' })
  return new TextEncoder().encode(JSON.stringify(backup)).byteLength
}

export function localStorageSummary(input: {
  flights: FlightLogEntry[]
  allFlights?: FlightLogEntry[]
  tripMetadata: TripMetadata[]
  providerAirports: ProviderAirportSnapshot[]
  appMetadata: AppMetadata[]
  localSchemaVersion: number
}): LocalStorageSummary {
  const allFlights = input.allFlights ?? input.flights
  const estimatedBackupBytes = estimateFullBackupSize({ ...input, flights: allFlights })
  return {
    flightCount: allFlights.length,
    activeFlightCount: activeRecords(allFlights).length,
    deletedFlightCount: deletedRecords(allFlights).length,
    tripMetadataCount: input.tripMetadata.length,
    providerAirportCount: input.providerAirports.length,
    appMetadataCount: input.appMetadata.length,
    estimatedBackupBytes,
    estimatedBackupLabel: bytesLabel(estimatedBackupBytes),
    localSchemaVersion: input.localSchemaVersion,
  }
}
