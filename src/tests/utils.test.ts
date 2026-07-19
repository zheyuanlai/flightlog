import { describe, expect, it } from 'vitest'
import { DateTime, Settings } from 'luxon'
import { readFileSync } from 'node:fs'
import type { FlightLogEntry, ProviderAirportSnapshot, TripMetadata } from '../types'
import { loadGeneratedAirports, lookupAirport, normalizeIata, searchAirports, setProviderAirports } from '../utils/airports'
import { airlineDisplayName, airlineSearchUrl, lookupAirline } from '../utils/airlines'
import { backupAgeWarning, createFullBackup, FLIGHTLOG_BACKUP_SCHEMA_VERSION, flightDuplicateKey, parseFullBackupJson, previewBackupImport, shouldShowFirstRunCloudRestorePrompt } from '../utils/backup'
import { buildCalendarEventDetails, calendarDescription } from '../utils/calendarLinks'
import { parseFlightsCsv, flightsToCsv } from '../utils/csv'
import { analyzeDataHealth, repairFlightsFromAirportDataset } from '../utils/dataHealth'
import { deletedFlights } from '../utils/deletedRecords'
import { durationMinutes } from '../utils/dates'
import { currentDeviceSnapshot, getDeviceName, getOrCreateDeviceId, setDeviceName } from '../utils/device'
import { haversineDistanceKm } from '../utils/distance'
import { externalFlightLinks } from '../utils/externalFlightLinks'
import { diffFlightFields } from '../utils/conflicts'
import { formatAirportLocalTime, formatArrivalLocalTime, formatDepartureLocalTime, getCalendarStartEnd } from '../utils/flightTime'
import { computeFlight } from '../utils/flights'
import { lookupErrorCopy } from '../utils/lookupErrors'
import { buildFlightStatusUrl, mockLiveStatus, normalizeLiveStatus, readFlightStatusError, refreshStatusLabel } from '../utils/liveStatus'
import { mobileNavGroup, routeFromHashValue } from '../utils/navigation'
import { initialOnlineStatus, offlineActionMessage } from '../utils/offline'
import { installGuidance, isStandaloneDisplay } from '../utils/pwa'
import { flightShareCardData, tripShareCardData, yearlyPassportShareCardData } from '../utils/shareCards'
import { createSyncEvent } from '../utils/syncHistory'
import { syncStatusSnapshot } from '../utils/syncStatus'
import { aggregateStats } from '../utils/stats'
import { groupFlightsIntoTrips } from '../utils/trips'
import { flightStaleStatus, formatCountdown, listUpcomingFlights } from '../utils/upcomingFlights'
import { sampleFlights } from '../sampleData'
import { escapeIcsText } from '../utils/ics'

function flight(overrides: Partial<FlightLogEntry>): FlightLogEntry {
  return {
    id: 'test-flight',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    purpose: 'personal',
    source: 'aerodatabox',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('flight utilities', () => {
  it('normalizes and looks up IATA airport codes', () => {
    expect(normalizeIata(' sfo ')).toBe('SFO')
    expect(lookupAirport('lax')?.city).toBe('Los Angeles')
  })

  it('calculates great-circle distance', () => {
    const sfo = lookupAirport('SFO')
    const jfk = lookupAirport('JFK')
    expect(sfo && jfk ? haversineDistanceKm(sfo, jfk) : 0).toBeGreaterThan(4100)
  })

  it('calculates route duration in minutes', () => {
    expect(durationMinutes('2026-01-01T08:00', '2026-01-01T10:30')).toBe(150)
  })

  it('round-trips CSV export and import', () => {
    const csv = flightsToCsv(sampleFlights)
    const preview = parseFlightsCsv(csv)
    expect(preview.errors).toEqual([])
    expect(preview.valid).toHaveLength(sampleFlights.length)
  })

  it('aggregates stats', () => {
    const stats = aggregateStats(sampleFlights)
    expect(stats.totalFlights).toBe(3)
    expect(stats.airportsVisited.map((airport) => airport.iata)).toContain('SFO')
    expect(stats.longestFlight?.flightNumber).toBe('SQ38')
  })

  it('builds the live status worker URL', () => {
    expect(buildFlightStatusUrl('https://worker.example/', 'SQ 38', '2026-06-02')).toBe('https://worker.example/flight-status?flightNumber=SQ38&date=2026-06-02&dateRole=Departure')
  })

  it('reads JSON worker errors', async () => {
    const response = new Response(JSON.stringify({ error: 'No flight found.' }), { status: 404 })
    await expect(readFlightStatusError(response)).resolves.toBe('No flight found.')
  })

  it('normalizes provider date-time strings for browser inputs', () => {
    const status = normalizeLiveStatus({
      status: 'landed',
      times: { scheduledDeparture: '2026-06-02 20:45+08:00' },
    })
    expect(status.scheduledDeparture).toBe('2026-06-02T20:45+08:00')
  })

  it('returns deterministic mock live status', () => {
    const status = mockLiveStatus('SQ38', '2026-06-02')
    expect(status.provider).toBe('mock')
    expect(status.departureAirport?.iata).toBe('SFO')
    expect(status.arrivalAirport?.iata).toBe('SIN')
  })

  it('loads and searches generated airports with exact IATA first', async () => {
    await loadGeneratedAirports(async () => new Response(JSON.stringify([
      { iata: 'PVA', name: 'Small Prefix Airport', city: 'Prefix', country: 'Testland', timezone: 'Pacific/Tahiti' },
      { iata: 'PVG', icao: 'ZSPD', name: 'Shanghai Pudong International Airport', city: 'Shanghai', country: 'China', lat: 31.1434, lon: 121.8052, timezone: 'Asia/Shanghai' },
    ])))
    expect(lookupAirport('PVG')?.name).toBe('Shanghai Pudong International Airport')
    expect(lookupAirport('PVG')?.timezone).toBe('Asia/Shanghai')
    expect(searchAirports('PVG')[0]?.iata).toBe('PVG')
  })

  it('keeps checked-in generated airport IANA timezones for common hubs', () => {
    const generatedAirports = JSON.parse(readFileSync('public/data/airports.generated.json', 'utf8')) as Array<{ iata: string; timezone?: string; timeZone?: string }>
    const byCode = new Map(generatedAirports.map((airport) => [airport.iata, airport]))
    expect(byCode.get('SIN')?.timezone).toBe('Asia/Singapore')
    expect(byCode.get('LAX')?.timezone).toBe('America/Los_Angeles')
    expect(byCode.get('SFO')?.timezone).toBe('America/Los_Angeles')
    expect(byCode.get('JFK')?.timezone).toBe('America/New_York')
    expect(byCode.get('LHR')?.timezone).toBe('Europe/London')
    expect(byCode.get('LHR')?.timeZone).toBe('Europe/London')
  })

  it('computes provider-derived airport fallback routes', () => {
    setProviderAirports([
      { iata: 'AAA', name: 'Alpha Airport', city: 'Alpha', country: 'United States', lat: 37, lon: -122 },
      { iata: 'BBB', name: 'Beta Airport', city: 'Beta', country: 'Canada', lat: 49, lon: -123 },
    ])
    const flight: FlightLogEntry = {
      id: 'provider-route',
      date: '2026-06-02',
      flightNumber: 'AB123',
      airline: 'Provider Air',
      origin: 'AAA',
      destination: 'BBB',
      purpose: 'personal',
      source: 'aerodatabox',
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z',
    }
    const computed = computeFlight(flight)
    expect(computed.hasRouteCoordinates).toBe(true)
    expect(computed.distanceKm).toBeGreaterThan(1000)
    expect(aggregateStats([flight]).countriesVisited).toContain('Canada')
  })

  it('formats SIN to LAX in airport local time independent of browser timezone', () => {
    const previousZone = Settings.defaultZone
    Settings.defaultZone = 'Pacific/Honolulu'
    try {
      const entry = flight({
        scheduledDepartureLocal: '2026-06-02T22:30',
        scheduledDepartureUtc: '2026-06-02T14:30:00Z',
        scheduledArrivalLocal: '2026-06-02T19:15',
        scheduledArrivalUtc: '2026-06-03T02:15:00Z',
        originTimeZone: 'Asia/Singapore',
        destinationTimeZone: 'America/Los_Angeles',
      })
      expect(formatDepartureLocalTime(entry, { kind: 'scheduled' }).label).toContain('22:30 · SIN local')
      expect(formatArrivalLocalTime(entry, { kind: 'scheduled' }).label).toContain('19:15 · LAX local')
    } finally {
      Settings.defaultZone = previousZone
    }
  })

  it('formats LAX to SIN in airport local time independent of browser timezone', () => {
    const previousZone = Settings.defaultZone
    Settings.defaultZone = 'Europe/London'
    try {
      const entry = flight({
        flightNumber: 'SQ37',
        origin: 'LAX',
        destination: 'SIN',
        scheduledDepartureLocal: '2026-06-03T23:40',
        scheduledDepartureUtc: '2026-06-04T06:40:00Z',
        scheduledArrivalLocal: '2026-06-05T07:30',
        scheduledArrivalUtc: '2026-06-04T23:30:00Z',
        originTimeZone: 'America/Los_Angeles',
        destinationTimeZone: 'Asia/Singapore',
      })
      expect(formatDepartureLocalTime(entry, { kind: 'scheduled' }).label).toContain('23:40 · LAX local')
      expect(formatArrivalLocalTime(entry, { kind: 'scheduled' }).label).toContain('07:30 · SIN local')
    } finally {
      Settings.defaultZone = previousZone
    }
  })

  it('warns instead of using browser timezone when airport timezone is missing', () => {
    const entry = flight({
      origin: 'AAA',
      destination: 'BBB',
      scheduledDepartureLocal: '2026-06-02T22:30',
      scheduledArrivalLocal: '2026-06-03T01:00',
    })
    const departure = formatDepartureLocalTime(entry, { kind: 'scheduled' })
    expect(departure.warning).toBe('Timezone unavailable; shown as provider local time.')
    expect(departure.isReliable).toBe(false)
    expect(getCalendarStartEnd(entry).available).toBe(false)
  })

  it('does not warn for offset-only provider times because absolute time is reliable', () => {
    const entry = flight({
      origin: 'AAA',
      destination: 'BBB',
      scheduledDepartureLocal: '2026-06-02T22:30+08:00',
      scheduledArrivalLocal: '2026-06-03T01:00-07:00',
    })
    const departure = formatDepartureLocalTime(entry, { kind: 'scheduled' })
    expect(departure.warning).toBeUndefined()
    expect(departure.isReliable).toBe(true)
    expect(departure.instantIso).toBe('2026-06-02T14:30:00.000Z')
    expect(getCalendarStartEnd(entry).available).toBe(true)
  })

  it('does not warn when UTC is available even if IANA timezone is missing', () => {
    const entry = flight({
      origin: 'AAA',
      destination: 'BBB',
      scheduledDepartureLocal: '2026-06-02T22:30',
      scheduledDepartureUtc: '2026-06-02T14:30:00Z',
      scheduledArrivalLocal: '2026-06-03T01:00',
      scheduledArrivalUtc: '2026-06-03T08:00:00Z',
    })
    const departure = formatDepartureLocalTime(entry, { kind: 'scheduled' })
    expect(departure.warning).toBeUndefined()
    expect(departure.isReliable).toBe(true)
    expect(getCalendarStartEnd(entry).available).toBe(true)
  })

  it('uses UTC metadata in standalone airport local formatting when timezone is missing', () => {
    const formatted = formatAirportLocalTime('2026-06-02T22:30', undefined, 'AAA local', '2026-06-02T14:30:00Z')
    expect(formatted.warning).toBeUndefined()
    expect(formatted.isReliable).toBe(true)
    expect(formatted.instantIso).toBe('2026-06-02T14:30:00.000Z')
  })

  it('generates stable UTC calendar links and ICS with external links', () => {
    const entry = flight({
      scheduledDepartureLocal: '2026-06-02T22:30',
      scheduledDepartureUtc: '2026-06-02T14:30:00Z',
      scheduledArrivalLocal: '2026-06-02T19:15',
      scheduledArrivalUtc: '2026-06-03T02:15:00Z',
      originTimeZone: 'Asia/Singapore',
      destinationTimeZone: 'America/Los_Angeles',
      notes: 'Bring passport, laptop; charger',
    })
    const details = buildCalendarEventDetails(entry, 'https://zheyuanlai.github.io/flightlog/#/flights/test-flight')
    expect(details.available).toBe(true)
    expect(details.googleUrl).toContain('dates=20260602T143000Z%2F20260603T021500Z')
    expect(details.outlookUrl).toContain('startdt=2026-06-02T14%3A30%3A00.000Z')
    expect(details.ics).toContain('DTSTART:20260602T143000Z')
    expect(details.ics).toContain('FlightAware')
    expect(details.description).toContain('Departure: Tue, Jun 2, 22:30 · SIN local')
    expect(details.description).toContain('Arrival: Tue, Jun 2, 19:15 · LAX local')
    expect(calendarDescription(entry)).toContain('Google flight status search')
  })

  it('escapes ICS fields', () => {
    expect(escapeIcsText('A, B; C\\D\nE')).toBe('A\\, B\\; C\\\\D\\nE')
  })

  it('builds external flight links for normalized and spaced flight numbers', () => {
    const sqLinks = externalFlightLinks(flight({ flightNumber: 'SQ38' }))
    expect(sqLinks.map((link) => link.url).join(' ')).toContain('SQ38')
    expect(sqLinks.map((link) => link.label)).toContain('Singapore Airlines official site')
    expect(externalFlightLinks(flight({ flightNumber: 'SQ 38' })).map((link) => link.url).join(' ')).toContain('sq38')
    const fallback = externalFlightLinks(flight({ flightNumber: '', airline: 'Unknown Carrier', airlineIata: undefined }))
    expect(fallback.map((link) => link.label)).toContain('Airline official site search')
    expect(fallback.map((link) => link.label)).toContain('Google flight status search')
  })

  it('creates full backups with v1.5 metadata and parses them', () => {
    const tripMetadata: TripMetadata[] = [{
      id: 'trip-a-b',
      name: 'Pacific run',
      notes: 'Client visit',
      type: 'work',
      isFavorite: true,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    }]
    const providerAirports: ProviderAirportSnapshot[] = [{ iata: 'SIN', name: 'Singapore Changi Airport', timezone: 'Asia/Singapore', source: 'aerodatabox' }]
    const backup = createFullBackup({
      flights: [flight({ id: 'backup-flight' })],
      tripMetadata,
      providerAirports,
      appMetadata: [{ key: 'lastBackupAt', value: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:00:00.000Z' }],
      exportedAt: '2026-06-03T12:00:00.000Z',
    })
    expect(backup.schemaVersion).toBe(4)
    expect(backup.tripMetadata[0].name).toBe('Pacific run')
    expect(backup.providerAirports[0].iata).toBe('SIN')
    expect(parseFullBackupJson(JSON.stringify(backup)).exportedAt).toBe('2026-06-03T12:00:00.000Z')
  })

  it('keeps tombstone metadata in full backup JSON', () => {
    const deleted = flight({
      id: 'deleted-flight',
      deletedAt: '2026-06-04T00:00:00.000Z',
      deletedByDeviceId: 'device-a',
      deleteReason: 'Test delete',
      lastOperation: 'delete',
    })
    const backup = createFullBackup({ flights: [flight({ id: 'active-flight' }), deleted], tripMetadata: [], providerAirports: [], appMetadata: [] })
    const parsed = parseFullBackupJson(JSON.stringify(backup))
    expect(deletedFlights(parsed.flights).map((item) => item.id)).toEqual(['deleted-flight'])
    expect(parsed.flights.find((item) => item.id === 'deleted-flight')?.deleteReason).toBe('Test delete')
  })

  it('previews backup imports and skips likely duplicates on merge', () => {
    const existing = flight({
      id: 'existing',
      flightNumber: 'SQ 38',
      origin: 'SIN',
      destination: 'LAX',
      scheduledDepartureUtc: '2026-06-02T14:30:00Z',
      scheduledDepartureLocal: '2026-06-02T22:30',
      originTimeZone: 'Asia/Singapore',
    })
    const duplicate = flight({
      id: 'duplicate',
      flightNumber: 'SQ38',
      scheduledDepartureUtc: '2026-06-02T14:30:00Z',
      scheduledDepartureLocal: '2026-06-02T22:30',
      originTimeZone: 'Asia/Singapore',
    })
    const newFlight = flight({
      id: 'new',
      flightNumber: 'UA1',
      airline: 'United Airlines',
      origin: 'LAX',
      destination: 'JFK',
      scheduledDepartureUtc: '2026-06-04T18:00:00Z',
      scheduledDepartureLocal: '2026-06-04T11:00',
      originTimeZone: 'America/Los_Angeles',
    })
    const backup = createFullBackup({ flights: [duplicate, newFlight], tripMetadata: [], providerAirports: [], appMetadata: [] })
    const preview = previewBackupImport(backup, [existing])
    expect(flightDuplicateKey(existing)).toBe(flightDuplicateKey(duplicate))
    expect(preview.duplicateFlights).toBe(1)
    expect(preview.flightsToAdd).toBe(1)
    expect(preview.mergeFlights[0].id).toBe('new')
  })

  // Migration guarantee (docs/DATA_FORMAT.md §5): a backup from any schema
  // version -- older or newer than this app build knows about -- must still
  // parse and import successfully. These lock that guarantee in so a future
  // change to parseFullBackupJson/previewBackupImport can't silently break it.
  it('imports a backup missing schemaVersion entirely, defaulting it to 1 rather than rejecting it', () => {
    const raw = { app: 'FlightLog', exportedAt: '2020-01-01T00:00:00.000Z', flights: [flight({ id: 'ancient' })], tripMetadata: [], providerAirports: [], appMetadata: [] }
    const backup = parseFullBackupJson(JSON.stringify(raw))
    expect(backup.schemaVersion).toBe(1)
    const preview = previewBackupImport(backup, [])
    expect(preview.flightsToAdd).toBe(1)
    expect(preview.warnings).toEqual([])
  })

  it('imports a backup with an explicit old schemaVersion (1) without any migration-related warning', () => {
    const raw = { app: 'FlightLog', schemaVersion: 1, exportedAt: '2020-01-01T00:00:00.000Z', flights: [flight({ id: 'old' })], tripMetadata: [], providerAirports: [], appMetadata: [] }
    const backup = parseFullBackupJson(JSON.stringify(raw))
    const preview = previewBackupImport(backup, [])
    expect(preview.flightsToAdd).toBe(1)
    expect(preview.warnings).toEqual([])
  })

  it('imports a backup from a newer, unrecognized schemaVersion, warning but not rejecting it', () => {
    const raw = { app: 'FlightLog', schemaVersion: FLIGHTLOG_BACKUP_SCHEMA_VERSION + 95, exportedAt: '2099-01-01T00:00:00.000Z', flights: [flight({ id: 'future' })], tripMetadata: [], providerAirports: [], appMetadata: [] }
    const backup = parseFullBackupJson(JSON.stringify(raw))
    const preview = previewBackupImport(backup, [])
    expect(preview.flightsToAdd).toBe(1)
    expect(preview.warnings.some((warning) => warning.includes('newer than this app schema'))).toBe(true)
  })

  it('ignores unknown top-level fields in a backup rather than failing to parse it', () => {
    const raw = { app: 'FlightLog', schemaVersion: FLIGHTLOG_BACKUP_SCHEMA_VERSION, exportedAt: '2026-01-01T00:00:00.000Z', flights: [flight({ id: 'a' })], tripMetadata: [], providerAirports: [], appMetadata: [], someFutureField: { nested: true } }
    const backup = parseFullBackupJson(JSON.stringify(raw))
    expect(backup.flights).toHaveLength(1)
    expect((backup as unknown as Record<string, unknown>).someFutureField).toBeUndefined()
  })

  it('uses local or cloud backup timestamps for backup warnings', () => {
    const now = DateTime.fromISO('2026-06-03T12:00:00Z', { zone: 'utc' })
    expect(backupAgeWarning([flight({ id: 'a' })], [], now)).toBe('You have saved flights but no local or cloud backup yet.')
    expect(backupAgeWarning([flight({ id: 'a' })], [{ key: 'lastCloudBackupAt', value: '2026-06-02T12:00:00.000Z', updatedAt: '2026-06-02T12:00:00.000Z' }], now)).toBeUndefined()
    expect(backupAgeWarning([flight({ id: 'a' })], [{ key: 'lastBackupAt', value: '2026-04-01T12:00:00.000Z', updatedAt: '2026-04-01T12:00:00.000Z' }], now)).toBe('Your last local or cloud backup is older than 30 days.')
  })

  it('decides when to show first-run cloud restore prompt', () => {
    expect(shouldShowFirstRunCloudRestorePrompt({ localFlightCount: 0, signedIn: true, cloudBackupCount: 1 })).toBe(true)
    expect(shouldShowFirstRunCloudRestorePrompt({ localFlightCount: 1, signedIn: true, cloudBackupCount: 1 })).toBe(false)
    expect(shouldShowFirstRunCloudRestorePrompt({ localFlightCount: 0, signedIn: false, cloudBackupCount: 1 })).toBe(false)
    expect(shouldShowFirstRunCloudRestorePrompt({ localFlightCount: 0, signedIn: true, cloudBackupCount: 1, dismissedAt: '2026-06-03T00:00:00.000Z' })).toBe(false)
  })

  it('reports data health and repairs safe airport snapshots', () => {
    const unhealthy = flight({
      id: 'unhealthy',
      origin: 'ZZZ',
      destination: 'YYY',
      scheduledDepartureLocal: undefined,
      scheduledArrivalLocal: undefined,
      providerWarnings: ['Provider timezone missing'],
    })
    const health = analyzeDataHealth([unhealthy])
    expect(health.missingTimezoneCount).toBe(1)
    expect(health.missingAirportCoordinateCount).toBe(1)
    expect(health.providerWarningCount).toBe(1)
    expect(health.missingTimeCount).toBe(1)

    const repairable = flight({ id: 'repairable', origin: 'LAX', destination: 'SIN', originTimeZone: undefined, destinationTimeZone: undefined })
    const repaired = repairFlightsFromAirportDataset([repairable])[0]
    expect(repaired.originAirportSnapshot?.iata).toBe('LAX')
    expect(repaired.destinationAirportSnapshot?.iata).toBe('SIN')
    expect(repaired.originTimeZone).toBe('America/Los_Angeles')
    expect(repaired.destinationTimeZone).toBe('Asia/Singapore')
  })

  it('reports tombstone health counts without including deleted flights in active health checks', () => {
    const active = flight({ id: 'active', origin: 'LAX', destination: 'SIN', originTimeZone: 'America/Los_Angeles', destinationTimeZone: 'Asia/Singapore' })
    const deleted = flight({ id: 'deleted', deletedAt: '2026-06-04T00:00:00.000Z', origin: 'ZZZ', destination: 'YYY' })
    const health = analyzeDataHealth([active], { allFlights: [active, deleted] })
    expect(health.activeFlightsCount).toBe(1)
    expect(health.deletedFlightsCount).toBe(1)
    expect(health.missingTimezoneCount).toBe(0)
  })

  it('maps sync status, creates redacted sync events, and persists device names', () => {
    const status = syncStatusSnapshot({
      configured: true,
      signedIn: true,
      syncMetadata: { localDeviceId: 'device-a' },
      comparison: {
        localOnly: [{}],
        remoteOnly: [],
        conflicts: [],
        tombstonesToPush: [],
        tombstonesToPull: [],
        deleteConflicts: [],
      },
    })
    expect(status.kind).toBe('local-changes')

    const event = createSyncEvent({
      eventType: 'error',
      deviceId: 'device-a',
      summary: { authorization: 'Bearer secret', pushed: 1 },
      error: 'Something failed',
      now: '2026-06-04T00:00:00.000Z',
    })
    expect(JSON.stringify(event.summary)).toContain('[redacted]')
    expect(JSON.stringify(event.summary)).not.toContain('Bearer secret')
    expect(event.safeError).toBe('Something failed')

    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
    }
    const id = getOrCreateDeviceId(storage)
    expect(getOrCreateDeviceId(storage)).toBe(id)
    expect(getDeviceName(storage, 'Mozilla/5.0 (Macintosh)')).toBe('Mac browser')
    expect(setDeviceName('Ryan MacBook', storage)).toBe('Ryan MacBook')
    expect(currentDeviceSnapshot({ deviceId: id, deviceName: getDeviceName(storage), now: '2026-06-04T00:00:00.000Z' })).toMatchObject({ deviceId: id, deviceName: 'Ryan MacBook', isCurrent: true })
  })

  it('diffs conflict fields for flight review', () => {
    const diffs = diffFlightFields(flight({ notes: 'Local note' }), flight({ notes: 'Cloud note', deletedAt: '2026-06-04T00:00:00.000Z' }))
    expect(diffs.find((diff) => diff.field === 'notes')?.changed).toBe(true)
    expect(diffs.find((diff) => diff.field === 'deletedAt')?.cloudValue).toBe('2026-06-04T00:00:00.000Z')
  })

  it('detects and labels upcoming flights using origin-local time', () => {
    const now = DateTime.fromISO('2026-06-03T12:00:00Z', { zone: 'utc' })
    const sameDay = flight({
      id: 'same-day',
      flightNumber: 'SQ37',
      airline: 'Singapore Airlines',
      origin: 'LAX',
      destination: 'SIN',
      scheduledDepartureLocal: '2026-06-03T08:30',
      scheduledDepartureUtc: '2026-06-03T15:30:00Z',
      scheduledArrivalLocal: '2026-06-05T07:30',
      scheduledArrivalUtc: '2026-06-04T23:30:00Z',
      originTimeZone: 'America/Los_Angeles',
      destinationTimeZone: 'Asia/Singapore',
      lastFetchedAt: '2026-06-03T09:00:00Z',
      liveStatus: { status: 'scheduled' },
    })
    const later = flight({
      id: 'later',
      flightNumber: 'UA1',
      airline: 'United Airlines',
      origin: 'SFO',
      destination: 'JFK',
      scheduledDepartureLocal: '2026-06-04T09:00',
      scheduledDepartureUtc: '2026-06-04T16:00:00Z',
      originTimeZone: 'America/Los_Angeles',
      destinationTimeZone: 'America/New_York',
      lastFetchedAt: '2026-06-03T00:00:00Z',
    })
    const upcoming = listUpcomingFlights([later, sameDay], now)
    expect(upcoming.map((item) => item.flight.id)).toEqual(['same-day', 'later'])
    expect(upcoming[0].isSameDay).toBe(true)
    expect(formatCountdown(sameDay, now)).toBe('Departs in 3h 30m')
    expect(flightStaleStatus(sameDay, now)).toMatchObject({ staleLabel: 'Refresh recommended', staleSeverity: 'strong', gateHint: 'Gate may not be assigned yet.' })
    expect(flightStaleStatus(later, now)).toMatchObject({ staleLabel: 'Status may be stale', staleSeverity: 'subtle' })
  })

  it('looks up airline metadata and falls back to safe search links', () => {
    expect(lookupAirline({ iata: 'SQ' })?.website).toBe('https://www.singaporeair.com/')
    expect(airlineDisplayName('UA')).toBe('United Airlines')
    expect(lookupAirline({ name: 'Not A Real Airline' })).toBeUndefined()
    expect(airlineSearchUrl('Unknown Carrier')).toContain('Unknown%20Carrier%20airline%20official%20website')
  })

  it('groups flights into trips within 3 days', () => {
    const flights = [
      flight({ id: 'a', date: '2026-06-02', scheduledDepartureUtc: '2026-06-02T14:30:00Z', scheduledArrivalUtc: '2026-06-03T02:15:00Z', originTimeZone: 'Asia/Singapore', destinationTimeZone: 'America/Los_Angeles' }),
      flight({ id: 'b', date: '2026-06-04', flightNumber: 'UA1', origin: 'LAX', destination: 'JFK', scheduledDepartureUtc: '2026-06-04T18:00:00Z', scheduledArrivalUtc: '2026-06-04T23:00:00Z', originTimeZone: 'America/Los_Angeles', destinationTimeZone: 'America/New_York' }),
      flight({ id: 'c', date: '2026-06-10', flightNumber: 'DL1', origin: 'JFK', destination: 'LAX', scheduledDepartureUtc: '2026-06-10T18:00:00Z', scheduledArrivalUtc: '2026-06-10T23:00:00Z', originTimeZone: 'America/New_York', destinationTimeZone: 'America/Los_Angeles' }),
    ]
    const trips = groupFlightsIntoTrips(flights)
    expect(trips).toHaveLength(2)
    expect(trips[0].flights).toHaveLength(2)
    expect(trips[0].routeSummary).toBe('SIN -> LAX -> JFK')
    const tripMetadata: TripMetadata[] = [{
      id: trips[0].id,
      name: 'Westbound work trip',
      notes: 'Two-leg client run',
      type: 'work',
      isFavorite: true,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    }]
    const tripsWithMetadata = groupFlightsIntoTrips(flights, tripMetadata)
    expect(tripsWithMetadata[0]).toMatchObject({ name: 'Westbound work trip', notes: 'Two-leg client run', type: 'work', isFavorite: true })
  })

  it('maps hash routes to mobile navigation groups', () => {
    expect(routeFromHashValue('#/flights/test-flight')).toEqual({ page: 'flight-detail', flightId: 'test-flight' })
    expect(routeFromHashValue('#/trips/westbound')).toEqual({ page: 'trip-detail', tripId: 'westbound' })
    expect(routeFromHashValue('#/import')).toEqual({ page: 'backup' })
    expect(mobileNavGroup(routeFromHashValue('#/dashboard'))).toBe('home')
    expect(mobileNavGroup(routeFromHashValue('#/flights/test-flight'))).toBe('flights')
    expect(mobileNavGroup(routeFromHashValue('#/passport'))).toBe('more')
  })

  it('routes to focus mode with or without a flight id, and to the embeddable card', () => {
    expect(routeFromHashValue('#/focus/test-flight')).toEqual({ page: 'focus', flightId: 'test-flight' })
    expect(routeFromHashValue('#/focus')).toEqual({ page: 'focus', flightId: undefined })
    expect(routeFromHashValue('#/card?title=X&route=SIN-LAX')).toEqual({ page: 'card' })
    expect(mobileNavGroup(routeFromHashValue('#/focus/test-flight'))).toBe('home')
  })

  it('falls back to the raw id instead of throwing on malformed percent-encoding', () => {
    expect(() => routeFromHashValue('#/focus/%zz')).not.toThrow()
    expect(routeFromHashValue('#/focus/%zz')).toEqual({ page: 'focus', flightId: '%zz' })
    expect(() => routeFromHashValue('#/flights/%zz')).not.toThrow()
  })

  it('builds safe share card data without notes by default', () => {
    const entry = flight({
      notes: 'Private note',
      scheduledDepartureLocal: '2026-06-02T22:30',
      scheduledDepartureUtc: '2026-06-02T14:30:00Z',
      scheduledArrivalLocal: '2026-06-02T19:15',
      scheduledArrivalUtc: '2026-06-03T02:15:00Z',
      originTimeZone: 'Asia/Singapore',
      destinationTimeZone: 'America/Los_Angeles',
      liveStatus: { status: 'scheduled' },
    })
    const card = flightShareCardData(entry, { distanceUnit: 'miles' })
    expect(card.brand).toBe('FlightLog')
    expect(card.route).toBe('SIN-LAX')
    expect(card.notes).toBeUndefined()
    expect(card.highlights.join(' ')).toContain('Status scheduled')
    expect(flightShareCardData(entry, { includeNotes: true }).notes).toBe('Private note')
  })

  it('builds trip and yearly passport share card data', () => {
    const trips = groupFlightsIntoTrips([
      flight({ id: 'a', date: '2026-06-02', scheduledDepartureUtc: '2026-06-02T14:30:00Z', originTimeZone: 'Asia/Singapore', destinationTimeZone: 'America/Los_Angeles' }),
      flight({ id: 'b', date: '2026-06-04', flightNumber: 'UA1', origin: 'LAX', destination: 'JFK', scheduledDepartureUtc: '2026-06-04T18:00:00Z', originTimeZone: 'America/Los_Angeles', destinationTimeZone: 'America/New_York' }),
    ])
    const tripCard = tripShareCardData(trips[0], { distanceUnit: 'kilometers' })
    expect(tripCard.kind).toBe('trip')
    expect(tripCard.route).toBe('SIN -> LAX -> JFK')
    const yearCard = yearlyPassportShareCardData(trips[0].flights, '2026')
    expect(yearCard.kind).toBe('year')
    expect(yearCard.highlights[0]).toContain('airports')
  })

  it('handles offline, PWA, and lookup error utility states', () => {
    expect(initialOnlineStatus({ onLine: false } as Navigator)).toBe(false)
    expect(offlineActionMessage('live lookup')).toContain('live lookup is unavailable')
    expect(installGuidance('Mozilla/5.0 iPhone Safari')).toContain('Add to Home Screen')
    expect(isStandaloneDisplay({ matchMedia: () => ({ matches: true }) } as unknown as Window)).toBe(true)
    expect(lookupErrorCopy('No flight found', true)).toMatchObject({ kind: 'not-found' })
    expect(lookupErrorCopy(new Error('quota exceeded'), true)).toMatchObject({ kind: 'quota' })
    expect(lookupErrorCopy(new Error('Failed to fetch'), false)).toMatchObject({ kind: 'offline' })
  })

  it('keeps deleted flights out of active utility views', () => {
    const active = flight({ id: 'active' })
    const deleted = flight({ id: 'deleted', deletedAt: '2026-06-04T00:00:00.000Z', lastOperation: 'delete' })
    expect(deletedFlights([active, deleted]).map((item) => item.id)).toEqual(['deleted'])
    expect(listUpcomingFlights([active, deleted].filter((item) => !item.deletedAt), DateTime.fromISO('2026-06-01T00:00:00Z')).map((item) => item.flight.id)).not.toContain('deleted')
  })

  it('reports refresh guard labels', () => {
    const now = Date.parse('2026-06-03T12:00:00Z')
    expect(refreshStatusLabel('2026-06-03T11:59:40Z', now)).toBe('Updated just now')
    expect(refreshStatusLabel('2026-06-03T11:57:00Z', now)).toBe('Refresh available in 2 minutes')
    expect(refreshStatusLabel('2026-06-03T11:48:00Z', now)).toBe('Last checked 12 minutes ago')
  })
})
