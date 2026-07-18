import { describe, expect, it, vi } from 'vitest'
import {
  buildAeroDataBoxFidsUrl,
  buildAeroDataBoxUrl,
  fetchAeroDataBoxAirportStatus,
  mapAeroDataBoxStatus,
  mockAirportStatus,
  normalizeAeroDataBoxFlight,
  normalizeAirportFids,
  normalizeFlightNumber,
  selectBestFlight,
  summarizeMovements,
  validateAirportStatusRequest,
  validateFlightStatusRequest,
} from './index.js'

describe('flight status worker utilities', () => {
  it('normalizes flight numbers and validates query params', () => {
    expect(normalizeFlightNumber(' sq 38 ')).toBe('SQ38')
    const input = validateFlightStatusRequest(new URL('https://worker.test/flight-status?flightNumber=SQ%2038&date=2026-06-02&dateRole=Arrival'))
    expect(input).toEqual({ flightNumber: 'SQ38', date: '2026-06-02', dateRole: 'Arrival' })
  })

  it('rejects invalid dates and date roles before calling the provider', () => {
    expect(validateFlightStatusRequest(new URL('https://worker.test/flight-status?flightNumber=SQ38&date=2026-02-31'))).toEqual({ error: 'date must be a valid calendar date' })
    expect(validateFlightStatusRequest(new URL('https://worker.test/flight-status?flightNumber=SQ38&date=2026-06-02&dateRole=Boarding'))).toEqual({ error: 'dateRole must be Departure or Arrival' })
  })

  it('builds the AeroDataBox specific-date endpoint without flight plan', () => {
    const url = buildAeroDataBoxUrl('SQ38', '2026-06-02', 'Departure')
    expect(url.toString()).toBe('https://aerodatabox.p.rapidapi.com/flights/number/SQ38/2026-06-02?dateLocalRole=Departure')
    expect(url.searchParams.has('withFlightPlan')).toBe(false)
  })

  it('maps AeroDataBox statuses into frontend statuses', () => {
    expect(mapAeroDataBoxStatus('Expected')).toBe('scheduled')
    expect(mapAeroDataBoxStatus('EnRoute')).toBe('active')
    expect(mapAeroDataBoxStatus('Arrived')).toBe('landed')
    expect(mapAeroDataBoxStatus('Canceled')).toBe('cancelled')
    expect(mapAeroDataBoxStatus('Diverted')).toBe('diverted')
  })

  it('selects an exact flight/date match and warns on ambiguity', () => {
    const flights = [
      { number: 'SQ38', departure: { scheduledTime: { local: '2026-06-01T20:00' } } },
      { number: 'SQ38', departure: { scheduledTime: { local: '2026-06-02T20:00' } } },
      { number: 'SQ38', departure: { scheduledTime: { local: '2026-06-02T21:00' } } },
    ]
    const selected = selectBestFlight(flights, 'SQ38', '2026-06-02', 'Departure')
    expect(selected.flight).toBe(flights[1])
    expect(selected.warnings[0]).toContain('2 matching flights')
  })

  it('normalizes AeroDataBox responses into nested and flat fields', () => {
    const normalized = normalizeAeroDataBoxFlight({
      number: 'SQ 38',
      status: 'Arrived',
      airline: { name: 'Singapore Airlines', iata: 'SQ', icao: 'SIA' },
      departure: {
        airport: { iata: 'SIN', icao: 'WSSS', name: 'Singapore Changi Airport', municipalityName: 'Singapore', countryCode: 'SG', countryName: 'Singapore', location: { lat: 1.3644, lon: 103.9915 }, timeZone: 'Asia/Singapore' },
        scheduledTime: { local: '2026-06-02T20:45', utc: '2026-06-02T12:45:00Z' },
        revisedTime: { local: '2026-06-02T20:55', utc: '2026-06-02T12:55:00Z' },
        terminal: '3',
        gate: 'A12',
      },
      arrival: {
        airport: { iata: 'LAX', icao: 'KLAX', name: 'Los Angeles International Airport', municipalityName: 'Los Angeles', countryCode: 'US', countryName: 'United States', location: { lat: 33.9425, lon: -118.4081 }, timeZone: 'America/Los_Angeles' },
        scheduledTime: { local: '2026-06-02T21:55', utc: '2026-06-03T04:55:00Z' },
        baggageBelt: '4',
      },
      aircraft: { model: 'Airbus A350-900', reg: '9V-SGA' },
    }, ['provider warning'])

    expect(mapAeroDataBoxStatus('Arrived')).toBe('landed')
    expect(normalized.flightNumber).toBe('SQ38')
    expect(normalized.status).toBe('landed')
    expect(normalized.airline.name).toBe('Singapore Airlines')
    expect(normalized.origin.city).toBe('Singapore')
    expect(normalized.origin.timeZone).toBe('Asia/Singapore')
    expect(normalized.destination.country).toBe('United States')
    expect(normalized.destinationTimeZone).toBe('America/Los_Angeles')
    expect(normalized.departureAirport.iata).toBe('SIN')
    expect(normalized.scheduledDepartureLocal).toBe('2026-06-02T20:45')
    expect(normalized.scheduledDepartureUtc).toBe('2026-06-02T12:45:00Z')
    expect(normalized.estimatedDepartureUtc).toBe('2026-06-02T12:55:00Z')
    expect(normalized.scheduledArrivalUtc).toBe('2026-06-03T04:55:00Z')
    expect(normalized.aircraftType).toBe('Airbus A350-900')
    expect(normalized.warnings).toEqual(['provider warning'])
  })
})

describe('airport status endpoint', () => {
  it('validates the iata code and clamps the window', () => {
    expect(validateAirportStatusRequest(new URL('https://worker.test/airport-status?iata=sin'))).toEqual({ iata: 'SIN', hours: 6 })
    expect(validateAirportStatusRequest(new URL('https://worker.test/airport-status?iata=SIN&hours=99'))).toEqual({ iata: 'SIN', hours: 12 })
    expect(validateAirportStatusRequest(new URL('https://worker.test/airport-status?iata=ZZZZ'))).toEqual({ error: 'iata must be a 3-letter IATA airport code' })
  })

  it('builds the AeroDataBox FIDS endpoint', () => {
    const url = buildAeroDataBoxFidsUrl('SIN', '2026-06-02T00:00', '2026-06-02T06:00')
    expect(url.pathname).toBe('/flights/airports/iata/SIN/2026-06-02T00%3A00/2026-06-02T06%3A00')
    expect(url.searchParams.get('direction')).toBe('Both')
    expect(url.searchParams.get('withCancelled')).toBe('true')
  })

  it('summarizes movements into on-time / delayed / cancelled with average delay', () => {
    const departures = [
      { number: 'SQ38', status: 'Departed', departure: { scheduledTime: { utc: '2026-06-02T12:00:00Z' }, revisedTime: { utc: '2026-06-02T12:05:00Z' } }, arrival: { airport: { iata: 'LAX' } } },
      { number: 'UA60', status: 'Expected', departure: { scheduledTime: { utc: '2026-06-02T13:00:00Z' }, revisedTime: { utc: '2026-06-02T13:35:00Z' } }, arrival: { airport: { iata: 'NRT' } } },
      { number: 'BA11', status: 'Canceled', departure: { scheduledTime: { utc: '2026-06-02T14:00:00Z' } }, arrival: { airport: { iata: 'LHR' } } },
    ]
    const summary = summarizeMovements(departures, 'departure')
    expect(summary.total).toBe(3)
    expect(summary.onTime).toBe(1)
    expect(summary.delayed).toBe(1)
    expect(summary.cancelled).toBe(1)
    expect(summary.avgDelayMinutes).toBe(20) // mean of on-time 5m and delayed 35m; cancelled excluded
    expect(summary.onTimePercent).toBe(33)
    expect(summary.sample[0]).toMatchObject({ flightNumber: 'SQ38', direction: 'departure', status: 'on-time', otherAirport: 'LAX' })
  })

  it('normalizes a FIDS payload and warns on an unexpected shape', () => {
    const status = normalizeAirportFids('SIN', {
      departures: [{ number: 'SQ38', status: 'Departed', departure: { scheduledTime: { utc: '2026-06-02T12:00:00Z' }, revisedTime: { utc: '2026-06-02T12:40:00Z' } }, arrival: { airport: { iata: 'LAX' } } }],
      arrivals: [{ number: 'BA11', status: 'Arrived', arrival: { scheduledTime: { utc: '2026-06-02T09:00:00Z' }, revisedTime: { utc: '2026-06-02T09:02:00Z' } }, departure: { airport: { iata: 'LHR' } } }],
    })
    expect(status.airport).toBe('SIN')
    expect(status.departures.delayed).toBe(1)
    expect(status.arrivals.onTime).toBe(1)
    expect(status.provider).toBe('AeroDataBox')
    expect(status.warnings).toEqual([])
    const bad = normalizeAirportFids('SIN', { unexpected: true }, ['Provider returned an unexpected airport payload shape; counts may be incomplete.'])
    expect(bad.departures.total).toBe(0)
    expect(bad.warnings[0]).toContain('unexpected')
  })

  it('returns a deterministic mock airport status', () => {
    const mock = mockAirportStatus('SIN')
    expect(mock.airport).toBe('SIN')
    expect(mock.provider).toBe('mock-worker')
    expect(mock.departures.onTimePercent).toBe(75)
  })

  it('degrades a provider 204 (no movements) to an empty board instead of a 502', async () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 }))
    try {
      const status = await fetchAeroDataBoxAirportStatus('SIN', 6, { AERODATABOX_API_KEY: 'k', AERODATABOX_API_HOST: 'h' })
      expect(status.airport).toBe('SIN')
      expect(status.departures.total).toBe(0)
      expect(status.arrivals.total).toBe(0)
      expect(status.sample).toEqual([])
    } finally {
      globalThis.fetch = original
    }
  })
})
