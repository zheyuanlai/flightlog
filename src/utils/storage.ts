import type { AppMetadata, FlightLogEntry, ProviderAirportSnapshot, TripMetadata } from '../types'
import { createFullBackup } from './backup'

export interface LocalStorageSummary {
  flightCount: number
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
  tripMetadata: TripMetadata[]
  providerAirports: ProviderAirportSnapshot[]
  appMetadata: AppMetadata[]
  localSchemaVersion: number
}): LocalStorageSummary {
  const estimatedBackupBytes = estimateFullBackupSize(input)
  return {
    flightCount: input.flights.length,
    tripMetadataCount: input.tripMetadata.length,
    providerAirportCount: input.providerAirports.length,
    appMetadataCount: input.appMetadata.length,
    estimatedBackupBytes,
    estimatedBackupLabel: bytesLabel(estimatedBackupBytes),
    localSchemaVersion: input.localSchemaVersion,
  }
}
