import { describe, expect, it } from 'vitest'
import type { FlightLogEntry } from '../types'
import { loadGeneratedAirports, lookupAirport, normalizeIata, searchAirports, setProviderAirports } from '../utils/airports'
import { parseFlightsCsv, flightsToCsv } from '../utils/csv'
import { durationMinutes } from '../utils/dates'
import { haversineDistanceKm } from '../utils/distance'
import { computeFlight } from '../utils/flights'
import { buildFlightStatusUrl, mockLiveStatus, normalizeLiveStatus, readFlightStatusError } from '../utils/liveStatus'
import { aggregateStats } from '../utils/stats'
import { sampleFlights } from '../sampleData'

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
    expect(status.scheduledDeparture).toBe('2026-06-02T20:45')
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
})
