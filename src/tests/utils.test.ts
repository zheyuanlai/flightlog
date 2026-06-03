import { describe, expect, it } from 'vitest'
import { DateTime, Settings } from 'luxon'
import type { FlightLogEntry, ProviderAirportSnapshot, TripMetadata } from '../types'
import { loadGeneratedAirports, lookupAirport, normalizeIata, searchAirports, setProviderAirports } from '../utils/airports'
import { airlineDisplayName, airlineSearchUrl, lookupAirline } from '../utils/airlines'
import { createFullBackup, flightDuplicateKey, parseFullBackupJson, previewBackupImport } from '../utils/backup'
import { buildCalendarEventDetails, calendarDescription } from '../utils/calendarLinks'
import { parseFlightsCsv, flightsToCsv } from '../utils/csv'
import { analyzeDataHealth, repairFlightsFromAirportDataset } from '../utils/dataHealth'
import { durationMinutes } from '../utils/dates'
import { haversineDistanceKm } from '../utils/distance'
import { externalFlightLinks } from '../utils/externalFlightLinks'
import { formatArrivalLocalTime, formatDepartureLocalTime, getCalendarStartEnd } from '../utils/flightTime'
import { computeFlight } from '../utils/flights'
import { buildFlightStatusUrl, mockLiveStatus, normalizeLiveStatus, readFlightStatusError, refreshStatusLabel } from '../utils/liveStatus'
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
      { iata: 'PVA', name: 'Small Prefix Airport', city: 'Prefix', country: 'Testland' },
      { iata: 'PVG', icao: 'ZSPD', name: 'Shanghai Pudong International Airport', city: 'Shanghai', country: 'China', lat: 31.1434, lon: 121.8052 },
    ])))
    expect(lookupAirport('PVG')?.name).toBe('Shanghai Pudong International Airport')
    expect(searchAirports('PVG')[0]?.iata).toBe('PVG')
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
    expect(backup.schemaVersion).toBe(3)
    expect(backup.tripMetadata[0].name).toBe('Pacific run')
    expect(backup.providerAirports[0].iata).toBe('SIN')
    expect(parseFullBackupJson(JSON.stringify(backup)).exportedAt).toBe('2026-06-03T12:00:00.000Z')
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

  it('reports refresh guard labels', () => {
    const now = Date.parse('2026-06-03T12:00:00Z')
    expect(refreshStatusLabel('2026-06-03T11:59:40Z', now)).toBe('Updated just now')
    expect(refreshStatusLabel('2026-06-03T11:57:00Z', now)).toBe('Refresh available in 2 minutes')
    expect(refreshStatusLabel('2026-06-03T11:48:00Z', now)).toBe('Last checked 12 minutes ago')
  })
})
