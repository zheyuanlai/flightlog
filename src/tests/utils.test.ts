import { describe, expect, it } from 'vitest'
import { Settings } from 'luxon'
import type { FlightLogEntry } from '../types'
import { loadGeneratedAirports, lookupAirport, normalizeIata, searchAirports, setProviderAirports } from '../utils/airports'
import { buildCalendarEventDetails, calendarDescription } from '../utils/calendarLinks'
import { parseFlightsCsv, flightsToCsv } from '../utils/csv'
import { durationMinutes } from '../utils/dates'
import { haversineDistanceKm } from '../utils/distance'
import { externalFlightLinks } from '../utils/externalFlightLinks'
import { formatArrivalLocalTime, formatDepartureLocalTime, getCalendarStartEnd } from '../utils/flightTime'
import { computeFlight } from '../utils/flights'
import { buildFlightStatusUrl, mockLiveStatus, normalizeLiveStatus, readFlightStatusError, refreshStatusLabel } from '../utils/liveStatus'
import { aggregateStats } from '../utils/stats'
import { groupFlightsIntoTrips } from '../utils/trips'
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
    expect(externalFlightLinks(flight({ flightNumber: 'SQ38' })).map((link) => link.url).join(' ')).toContain('SQ38')
    expect(externalFlightLinks(flight({ flightNumber: 'SQ 38' }))[1].url).toContain('sq38')
    expect(externalFlightLinks(flight({ flightNumber: '', airlineIata: undefined }))).toHaveLength(3)
  })

  it('groups flights into trips within 3 days', () => {
    const trips = groupFlightsIntoTrips([
      flight({ id: 'a', date: '2026-06-02', scheduledDepartureUtc: '2026-06-02T14:30:00Z', scheduledArrivalUtc: '2026-06-03T02:15:00Z', originTimeZone: 'Asia/Singapore', destinationTimeZone: 'America/Los_Angeles' }),
      flight({ id: 'b', date: '2026-06-04', flightNumber: 'UA1', origin: 'LAX', destination: 'JFK', scheduledDepartureUtc: '2026-06-04T18:00:00Z', scheduledArrivalUtc: '2026-06-04T23:00:00Z', originTimeZone: 'America/Los_Angeles', destinationTimeZone: 'America/New_York' }),
      flight({ id: 'c', date: '2026-06-10', flightNumber: 'DL1', origin: 'JFK', destination: 'LAX', scheduledDepartureUtc: '2026-06-10T18:00:00Z', scheduledArrivalUtc: '2026-06-10T23:00:00Z', originTimeZone: 'America/New_York', destinationTimeZone: 'America/Los_Angeles' }),
    ])
    expect(trips).toHaveLength(2)
    expect(trips[0].flights).toHaveLength(2)
    expect(trips[0].routeSummary).toBe('SIN -> LAX -> JFK')
  })

  it('reports refresh guard labels', () => {
    const now = Date.parse('2026-06-03T12:00:00Z')
    expect(refreshStatusLabel('2026-06-03T11:59:40Z', now)).toBe('Updated just now')
    expect(refreshStatusLabel('2026-06-03T11:57:00Z', now)).toBe('Refresh available in 2 minutes')
    expect(refreshStatusLabel('2026-06-03T11:48:00Z', now)).toBe('Last checked 12 minutes ago')
  })
})
