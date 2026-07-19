import { describe, expect, it } from 'vitest'
import type { FlightLogEntry, TripMetadata } from '../types'
import { computeFlight } from '../utils/flights'
import type { TripGroup } from '../utils/trips'
import { parseFullBackupJson, previewBackupImport } from '../utils/backup'
import { buildTripShareFile, detectAndVerifyTripShare, isTripShareFile, TRIP_SHARE_FORMAT, verifyTripShareChecksum } from '../utils/tripShare'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'share-flight',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    purpose: 'personal',
    source: 'aerodatabox',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

function tripMetadata(overrides: Partial<TripMetadata> & Pick<TripMetadata, 'id'>): TripMetadata {
  return {
    name: 'Singapore trip',
    type: 'personal',
    isFavorite: false,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

function trip(flights: FlightLogEntry[], metadata?: TripMetadata): TripGroup {
  const computed = flights.map(computeFlight)
  return {
    id: 'trip-1',
    name: metadata?.name ?? 'Singapore trip',
    flights: computed,
    startDate: '2026-06-02',
    endDate: '2026-06-02',
    routeSummary: 'SIN -> LAX',
    distanceKm: computed.reduce((sum, item) => sum + item.distanceKm, 0),
    airports: ['SIN', 'LAX'],
    countries: [],
    metadata,
    notes: metadata?.notes,
    type: metadata?.type ?? 'personal',
    isFavorite: metadata?.isFavorite ?? false,
    isManual: Boolean(metadata?.isManual),
  }
}

describe('buildTripShareFile', () => {
  it('strips local/device bookkeeping fields from flights and trip metadata', async () => {
    const dirtyFlight = flight({
      id: 'a',
      deletedAt: '2026-01-01T00:00:00Z',
      deletedByDeviceId: 'device-123',
      lastFetchedAt: '2026-01-01T00:00:00Z',
      providerFetchedAt: '2026-01-01T00:00:00Z',
      providerFlightId: 'provider-xyz',
      completionDismissedAt: '2026-01-01T00:00:00Z',
    })
    const dirtyMetadata = tripMetadata({ id: 'trip-1', deletedByDeviceId: 'device-123' })
    const file = await buildTripShareFile(trip([dirtyFlight], dirtyMetadata))
    expect(file.flights[0].deletedAt).toBeUndefined()
    expect(file.flights[0].deletedByDeviceId).toBeUndefined()
    expect(file.flights[0].lastFetchedAt).toBeUndefined()
    expect(file.flights[0].providerFetchedAt).toBeUndefined()
    expect(file.flights[0].providerFlightId).toBeUndefined()
    expect(file.flights[0].completionDismissedAt).toBeUndefined()
    expect(file.tripMetadata[0].deletedByDeviceId).toBeUndefined()
    // Substantive content survives.
    expect(file.flights[0].flightNumber).toBe('SQ38')
    expect(file.tripMetadata[0].name).toBe('Singapore trip')
  })

  it('strips client-computed fields (distance, resolved airports) that trip.flights carries at runtime but which are not real flight data', async () => {
    // trip() builds flights via computeFlight, same as the real TripDetailPage -- the
    // resulting flight objects carry distanceKm/originAirport/etc. on top of the real fields.
    const file = await buildTripShareFile(trip([flight()]))
    const shared = file.flights[0] as unknown as Record<string, unknown>
    expect(shared.distanceKm).toBeUndefined()
    expect(shared.durationMinutes).toBeUndefined()
    expect(shared.originAirport).toBeUndefined()
    expect(shared.destinationAirport).toBeUndefined()
    expect(shared.hasRouteCoordinates).toBeUndefined()
  })

  it('strips provider bookkeeping nested inside liveStatus while keeping the status itself', async () => {
    const withLiveStatus = flight({
      liveStatus: {
        status: 'landed',
        provider: 'aerodatabox',
        rawProviderStatus: 'Landed 14:32',
        providerFlightId: 'abc-123',
        providerUpdatedAt: '2026-01-01T00:00:00Z',
        providerFetchedAt: '2026-01-01T00:00:00Z',
        warnings: ['some warning'],
      },
    })
    const file = await buildTripShareFile(trip([withLiveStatus]))
    expect(file.flights[0].liveStatus?.status).toBe('landed')
    const liveStatus = file.flights[0].liveStatus as unknown as Record<string, unknown>
    expect(liveStatus.provider).toBeUndefined()
    expect(liveStatus.rawProviderStatus).toBeUndefined()
    expect(liveStatus.providerFlightId).toBeUndefined()
    expect(liveStatus.providerUpdatedAt).toBeUndefined()
    expect(liveStatus.providerFetchedAt).toBeUndefined()
    expect(liveStatus.warnings).toBeUndefined()
  })

  it('marks the file with the trip-share format and a checksum', async () => {
    const file = await buildTripShareFile(trip([flight()]))
    expect(file.shareFormat).toBe('flightlog-trip-share')
    expect(file.shareTripName).toBe('Singapore trip')
    expect(file.shareChecksum).toMatch(/^[0-9a-f]{64}$/)
  })

  it('round-trips through the existing full-backup parser and dedupe preview unchanged', async () => {
    const file = await buildTripShareFile(trip([flight({ id: 'a' }), flight({ id: 'b', flightNumber: 'SQ39' })]))
    const backup = parseFullBackupJson(JSON.stringify(file))
    expect(backup.flights).toHaveLength(2)
    const preview = previewBackupImport(backup, [])
    expect(preview.flightsToAdd).toBe(2)
    expect(preview.duplicateFlights).toBe(0)
  })
})

describe('isTripShareFile', () => {
  it('is true only for a genuine trip-share file', async () => {
    const file = await buildTripShareFile(trip([flight()]))
    expect(isTripShareFile(file)).toBe(true)
    expect(isTripShareFile({ app: 'FlightLog', flights: [] })).toBe(false)
    expect(isTripShareFile(null)).toBe(false)
    expect(isTripShareFile('not an object')).toBe(false)
  })
})

describe('verifyTripShareChecksum', () => {
  it('passes for an untampered file', async () => {
    const file = await buildTripShareFile(trip([flight()]))
    expect(await verifyTripShareChecksum(file)).toBe(true)
  })

  it('fails when the flight content is altered after export', async () => {
    const file = await buildTripShareFile(trip([flight()]))
    const tampered = { ...file, flights: [{ ...file.flights[0], flightNumber: 'XX999' }] }
    expect(await verifyTripShareChecksum(tampered)).toBe(false)
  })
})

describe('detectAndVerifyTripShare', () => {
  it('detects a trip-share file and verifies its checksum', async () => {
    const file = await buildTripShareFile(trip([flight()]))
    const detection = await detectAndVerifyTripShare(JSON.stringify(file))
    expect(detection).toEqual({ tripName: 'Singapore trip', checksumValid: true })
  })

  it('covers the displayed trip name too, so relabeling a shared file is flagged just like content tampering', async () => {
    const file = await buildTripShareFile(trip([flight()]))
    const renamed = JSON.stringify({ ...file, shareTripName: 'Something else entirely' })
    const detection = await detectAndVerifyTripShare(renamed)
    expect(detection).toEqual({ tripName: 'Something else entirely', checksumValid: false })
  })

  it('flags a genuinely tampered file (flight content altered) as checksum-invalid', async () => {
    const file = await buildTripShareFile(trip([flight()]))
    const tampered = JSON.stringify({ ...file, flights: [{ ...file.flights[0], flightNumber: 'XX999' }] })
    const detection = await detectAndVerifyTripShare(tampered)
    expect(detection?.checksumValid).toBe(false)
  })

  it('resolves to checksumValid: false instead of throwing when a trip-share file has corrupted (non-array) content', async () => {
    const corrupted = JSON.stringify({
      shareFormat: TRIP_SHARE_FORMAT,
      shareTripName: 'Singapore trip',
      shareChecksum: 'deadbeef',
      app: 'FlightLog',
      schemaVersion: 4,
      exportedAt: '2026-01-01T00:00:00Z',
      flights: null,
      tripMetadata: [],
      providerAirports: [],
      appMetadata: [],
    })
    const detection = await detectAndVerifyTripShare(corrupted)
    expect(detection).toEqual({ tripName: 'Singapore trip', checksumValid: false })
  })

  it('returns undefined for a plain (non-share) backup or invalid JSON', async () => {
    const plainBackup = JSON.stringify({ app: 'FlightLog', schemaVersion: 4, exportedAt: '2026-01-01T00:00:00Z', flights: [], tripMetadata: [], providerAirports: [], appMetadata: [] })
    expect(await detectAndVerifyTripShare(plainBackup)).toBeUndefined()
    expect(await detectAndVerifyTripShare('not json')).toBeUndefined()
  })
})
