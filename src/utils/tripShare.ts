import type { FlightLiveStatus, FlightLogEntry, FlightWithComputed, TripMetadata } from '../types'
import type { TripGroup } from './trips'
import { createFullBackup, type FlightLogBackup } from './backup'
import { computeBackupChecksum } from '../lib/cloudBackup'

export const TRIP_SHARE_FORMAT = 'flightlog-trip-share'

/**
 * A trip export is a regular FlightLogBackup (scoped to one trip's flights)
 * plus three extra fields. The base FlightLogBackup shape round-trips through
 * the existing parseFullBackupJson/previewBackupImport pipeline unchanged
 * (those extra fields are simply ignored), so a shared trip file can be
 * merged with the exact same dedupe preview a full backup restore already
 * uses -- callers that care specifically about the share metadata detect it
 * with isTripShareFile/detectAndVerifyTripShare.
 */
export interface TripShareFile extends FlightLogBackup {
  shareFormat: typeof TRIP_SHARE_FORMAT
  shareTripName: string
  shareChecksum: string
}

export interface TripShareDetection {
  tripName: string
  checksumValid: boolean
}

const LOCAL_FLIGHT_FIELDS = [
  'deletedAt', 'deletedByDeviceId', 'deleteReason', 'restoredAt', 'tombstoneVersion', 'lastOperation',
  'lastFetchedAt', 'providerFetchedAt', 'providerFlightId', 'providerWarnings', 'completionDismissedAt', 'lookupDateRole',
] as const satisfies readonly (keyof FlightLogEntry)[]

const COMPUTED_FLIGHT_FIELDS = [
  'distanceKm', 'durationMinutes', 'originAirport', 'destinationAirport', 'hasRouteCoordinates',
] as const satisfies readonly (keyof FlightWithComputed)[]

const LIVE_STATUS_PROVIDER_FIELDS = [
  'provider', 'rawProviderStatus', 'providerFlightId', 'providerUpdatedAt', 'providerFetchedAt', 'warnings',
] as const satisfies readonly (keyof FlightLiveStatus)[]

const LOCAL_TRIP_METADATA_FIELDS = [
  'deletedAt', 'deletedByDeviceId', 'deleteReason', 'restoredAt', 'tombstoneVersion', 'lastOperation',
] as const satisfies readonly (keyof TripMetadata)[]

/**
 * Strips sync/device/provider-session bookkeeping and client-computed fields
 * (distance, resolved airport objects) that are meaningless -- or
 * identifying -- on a recipient's device. Trip flights come in as
 * FlightWithComputed (computeFlight adds distanceKm/originAirport/etc. on
 * top of the real FlightLogEntry fields); only the real fields belong in an
 * exported file.
 */
function stripLocalFlightFields(flight: FlightWithComputed): FlightLogEntry {
  const cleaned = { ...flight } as Record<string, unknown>
  for (const field of LOCAL_FLIGHT_FIELDS) delete cleaned[field]
  for (const field of COMPUTED_FLIGHT_FIELDS) delete cleaned[field]
  const liveStatus = cleaned.liveStatus
  if (liveStatus && typeof liveStatus === 'object') {
    const cleanedLiveStatus = { ...(liveStatus as Record<string, unknown>) }
    for (const field of LIVE_STATUS_PROVIDER_FIELDS) delete cleanedLiveStatus[field]
    cleaned.liveStatus = cleanedLiveStatus
  }
  return cleaned as unknown as FlightLogEntry
}

function stripLocalTripMetadataFields(metadata: TripMetadata): TripMetadata {
  const cleaned: TripMetadata = { ...metadata }
  for (const field of LOCAL_TRIP_METADATA_FIELDS) delete cleaned[field]
  return cleaned
}

/** Builds a shareable, checksum-"signed" export of one trip's flights, ready to JSON.stringify and download (optionally encrypting the result afterward). */
export async function buildTripShareFile(trip: TripGroup): Promise<TripShareFile> {
  const flights = trip.flights.map(stripLocalFlightFields)
  const tripMetadata = trip.metadata ? [stripLocalTripMetadataFields(trip.metadata)] : []
  const backup = createFullBackup({ flights, tripMetadata, providerAirports: [], appMetadata: [] })
  const unsigned: Omit<TripShareFile, 'shareChecksum'> = { ...backup, shareFormat: TRIP_SHARE_FORMAT, shareTripName: trip.name }
  const shareChecksum = await computeBackupChecksum(unsigned as unknown as FlightLogBackup)
  return { ...unsigned, shareChecksum }
}

export function isTripShareFile(value: unknown): value is TripShareFile {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).shareFormat === TRIP_SHARE_FORMAT
}

/**
 * Recomputes the checksum over the file's full content (including the
 * displayed trip name, so relabeling a shared file is also caught) and
 * compares it to the stored one, to detect corruption or tampering in
 * transit. A malformed/corrupted file (e.g. a non-array flights field)
 * simply fails verification rather than throwing.
 */
export async function verifyTripShareChecksum(file: TripShareFile): Promise<boolean> {
  const { shareChecksum, ...unsigned } = file
  try {
    return (await computeBackupChecksum(unsigned as unknown as FlightLogBackup)) === shareChecksum
  } catch {
    return false
  }
}

/** Parses arbitrary imported JSON text and, only if it's a trip-share file, verifies its checksum. Returns undefined for a plain full backup or invalid JSON. */
export async function detectAndVerifyTripShare(json: string): Promise<TripShareDetection | undefined> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!isTripShareFile(parsed)) return undefined
  return { tripName: parsed.shareTripName, checksumValid: await verifyTripShareChecksum(parsed) }
}
