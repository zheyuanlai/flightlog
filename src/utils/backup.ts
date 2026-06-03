import type { AppMetadata, FlightLogEntry, ProviderAirportSnapshot, TripMetadata } from '../types'
import { getBestDepartureTime } from './flightTime'
import { normalizeFlightNumber } from './liveStatus'

export const FLIGHTLOG_BACKUP_SCHEMA_VERSION = 3

export interface FlightLogBackup {
  app: 'FlightLog'
  schemaVersion: number
  exportedAt: string
  flights: FlightLogEntry[]
  tripMetadata: TripMetadata[]
  providerAirports: ProviderAirportSnapshot[]
  appMetadata: AppMetadata[]
}

export interface BackupImportPreview {
  backup: FlightLogBackup
  flightsToAdd: number
  existingFlights: number
  duplicateFlights: number
  providerAirports: number
  tripMetadata: number
  warnings: string[]
  mergeFlights: FlightLogEntry[]
}

export function createFullBackup(input: {
  flights: FlightLogEntry[]
  tripMetadata: TripMetadata[]
  providerAirports: ProviderAirportSnapshot[]
  appMetadata: AppMetadata[]
  exportedAt?: string
}): FlightLogBackup {
  return {
    app: 'FlightLog',
    schemaVersion: FLIGHTLOG_BACKUP_SCHEMA_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    flights: input.flights,
    tripMetadata: input.tripMetadata,
    providerAirports: input.providerAirports,
    appMetadata: input.appMetadata,
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

export function parseFullBackupJson(json: string): FlightLogBackup {
  const parsed = JSON.parse(json) as Partial<FlightLogBackup> & { flights?: unknown }
  if (!parsed || typeof parsed !== 'object') throw new Error('Backup JSON must be an object.')
  const flights = asArray<FlightLogEntry>(parsed.flights)
  if (flights.length === 0 && !Array.isArray(parsed.flights)) throw new Error('Backup JSON must include a flights array.')
  return {
    app: 'FlightLog',
    schemaVersion: typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
    flights,
    tripMetadata: asArray<TripMetadata>(parsed.tripMetadata),
    providerAirports: asArray<ProviderAirportSnapshot>(parsed.providerAirports),
    appMetadata: asArray<AppMetadata>(parsed.appMetadata),
  }
}

export function flightDuplicateKey(flight: FlightLogEntry): string {
  const departure = getBestDepartureTime(flight)
  const departureKey = flight.scheduledDepartureUtc
    ?? flight.scheduledDepartureLocal
    ?? departure?.instantIso
    ?? departure?.local
    ?? flight.scheduledDeparture
    ?? flight.date
  return [
    normalizeFlightNumber(flight.flightNumber),
    flight.origin.trim().toUpperCase(),
    flight.destination.trim().toUpperCase(),
    departureKey.trim(),
  ].join('|')
}

export function previewBackupImport(backup: FlightLogBackup, existingFlights: FlightLogEntry[]): BackupImportPreview {
  const warnings: string[] = []
  if (backup.schemaVersion > FLIGHTLOG_BACKUP_SCHEMA_VERSION) warnings.push(`Backup schema v${backup.schemaVersion} is newer than this app schema v${FLIGHTLOG_BACKUP_SCHEMA_VERSION}.`)
  if (backup.flights.length === 0) warnings.push('Backup contains no flights.')

  const existingKeys = new Set(existingFlights.map(flightDuplicateKey))
  const seenBackupKeys = new Set<string>()
  const mergeFlights: FlightLogEntry[] = []
  let duplicateFlights = 0

  for (const flight of backup.flights) {
    const key = flightDuplicateKey(flight)
    if (existingKeys.has(key) || seenBackupKeys.has(key)) {
      duplicateFlights += 1
      continue
    }
    seenBackupKeys.add(key)
    mergeFlights.push(flight)
  }

  return {
    backup,
    flightsToAdd: mergeFlights.length,
    existingFlights: existingFlights.length,
    duplicateFlights,
    providerAirports: backup.providerAirports.length,
    tripMetadata: backup.tripMetadata.length,
    warnings,
    mergeFlights,
  }
}
