import { describe, expect, it } from 'vitest'
import { lookupAirport, normalizeIata } from '../utils/airports'
import { parseFlightsCsv, flightsToCsv } from '../utils/csv'
import { durationMinutes } from '../utils/dates'
import { haversineDistanceKm } from '../utils/distance'
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
})
