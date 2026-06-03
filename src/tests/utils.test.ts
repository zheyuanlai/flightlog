import { describe, expect, it } from 'vitest'
import { lookupAirport, normalizeIata } from '../utils/airports'
import { parseFlightsCsv, flightsToCsv } from '../utils/csv'
import { durationMinutes } from '../utils/dates'
import { haversineDistanceKm } from '../utils/distance'
import { buildFlightStatusUrl, mockLiveStatus, readFlightStatusError } from '../utils/liveStatus'
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
    expect(buildFlightStatusUrl('https://worker.example/', 'SQ 38', '2026-06-02')).toBe('https://worker.example/flight-status?flightNumber=SQ+38&date=2026-06-02')
  })

  it('reads JSON worker errors', async () => {
    const response = new Response(JSON.stringify({ error: 'No flight found.' }), { status: 404 })
    await expect(readFlightStatusError(response)).resolves.toBe('No flight found.')
  })

  it('returns deterministic mock live status', () => {
    const status = mockLiveStatus('SQ38', '2026-06-02')
    expect(status.provider).toBe('mock')
    expect(status.departureAirport?.iata).toBe('SFO')
    expect(status.arrivalAirport?.iata).toBe('SIN')
  })

})
