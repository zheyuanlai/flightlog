import { describe, expect, it } from 'vitest'
import type { FlightLogEntry } from '../types'
import {
  airlinePunctuality,
  flightDelayMinutes,
  formatDelayLabel,
  greatCircleArc,
  overallPunctuality,
  routeDelayHistory,
  routePunctuality,
} from '../utils/insights'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'insight-flight',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    scheduledDepartureUtc: '2026-06-02T12:00:00Z',
    actualDepartureUtc: '2026-06-02T12:00:00Z',
    originTimeZone: 'Asia/Singapore',
    destinationTimeZone: 'America/Los_Angeles',
    purpose: 'personal',
    source: 'aerodatabox',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('flight delay measurement', () => {
  it('computes minutes late from scheduled and actual departure', () => {
    expect(flightDelayMinutes(flight({ actualDepartureUtc: '2026-06-02T12:35:00Z' }))).toBe(35)
    expect(flightDelayMinutes(flight({ actualDepartureUtc: '2026-06-02T11:50:00Z' }))).toBe(-10)
  })

  it('returns undefined without both reliable instants or for deleted flights', () => {
    expect(flightDelayMinutes(flight({ actualDepartureUtc: undefined }))).toBeUndefined()
    expect(flightDelayMinutes(flight({ deletedAt: '2026-06-03T00:00:00Z' }))).toBeUndefined()
  })

  it('labels delays', () => {
    expect(formatDelayLabel(0)).toBe('on time')
    expect(formatDelayLabel(20)).toBe('20m late')
    expect(formatDelayLabel(-12)).toBe('12m early')
  })
})

describe('punctuality aggregation', () => {
  const flights = [
    flight({ id: 'a', airline: 'Singapore Airlines', origin: 'SIN', destination: 'LAX', actualDepartureUtc: '2026-06-02T12:05:00Z' }), // 5m -> on time
    flight({ id: 'b', airline: 'Singapore Airlines', origin: 'SIN', destination: 'LAX', actualDepartureUtc: '2026-06-02T12:50:00Z' }), // 50m late
    flight({ id: 'c', airline: 'United Airlines', origin: 'SFO', destination: 'NRT', actualDepartureUtc: '2026-06-02T12:10:00Z' }), // 10m -> on time
    flight({ id: 'd', airline: 'United Airlines', origin: 'SFO', destination: 'NRT', actualDepartureUtc: undefined }), // unmeasurable
  ]

  it('aggregates airline on-time performance', () => {
    const stats = airlinePunctuality(flights)
    const sq = stats.find((row) => row.label === 'Singapore Airlines')
    expect(sq?.flights).toBe(2)
    expect(sq?.onTimeCount).toBe(1)
    expect(sq?.onTimePercent).toBe(50)
    expect(sq?.averageDelayMinutes).toBe(28)
    expect(sq?.worstDelayMinutes).toBe(50)
    const ua = stats.find((row) => row.label === 'United Airlines')
    expect(ua?.flights).toBe(1)
    expect(ua?.onTimePercent).toBe(100)
  })

  it('aggregates by route', () => {
    const stats = routePunctuality(flights)
    expect(stats.find((row) => row.label === 'SIN-LAX')?.flights).toBe(2)
    expect(stats.find((row) => row.label === 'SFO-NRT')?.flights).toBe(1)
  })

  it('computes median delay, averaging the two central values for even counts', () => {
    const even = routePunctuality([
      flight({ id: 'e1', origin: 'SIN', destination: 'LAX', actualDepartureUtc: '2026-06-02T12:05:00Z' }), // 5
      flight({ id: 'e2', origin: 'SIN', destination: 'LAX', actualDepartureUtc: '2026-06-02T12:50:00Z' }), // 50
    ])
    expect(even[0].medianDelayMinutes).toBe(28) // round((5 + 50) / 2)
    const odd = routePunctuality([
      flight({ id: 'o1', origin: 'SIN', destination: 'LAX', actualDepartureUtc: '2026-06-02T12:05:00Z' }), // 5
      flight({ id: 'o2', origin: 'SIN', destination: 'LAX', actualDepartureUtc: '2026-06-02T12:10:00Z' }), // 10
      flight({ id: 'o3', origin: 'SIN', destination: 'LAX', actualDepartureUtc: '2026-06-02T12:50:00Z' }), // 50
    ])
    expect(odd[0].medianDelayMinutes).toBe(10)
  })

  it('computes overall on-time percentage across measurable flights', () => {
    const overall = overallPunctuality(flights)
    expect(overall?.measuredFlights).toBe(3)
    expect(overall?.onTimePercent).toBe(67)
  })

  it('returns undefined overall when nothing is measurable', () => {
    expect(overallPunctuality([flight({ actualDepartureUtc: undefined })])).toBeUndefined()
  })

  it('summarizes route history for a flight', () => {
    const history = routeDelayHistory(flights, flights[0])
    expect(history?.route).toBe('SIN-LAX')
    expect(history?.measuredFlights).toBe(2)
    expect(history?.averageDelayMinutes).toBe(28)
  })
})

describe('great-circle arc', () => {
  it('returns segments + 1 points with matching endpoints', () => {
    const arc = greatCircleArc([37.62, -122.38], [51.47, -0.45], 32)
    expect(arc).toHaveLength(33)
    expect(arc[0][0]).toBeCloseTo(37.62, 4)
    expect(arc[0][1]).toBeCloseTo(-122.38, 4)
    expect(arc[32][0]).toBeCloseTo(51.47, 4)
  })

  it('bows toward the pole rather than following the rhumb line', () => {
    // SFO -> LHR great circle passes well north of the linear latitude midpoint (~44.5).
    const arc = greatCircleArc([37.62, -122.38], [51.47, -0.45], 64)
    const midLat = arc[32][0]
    expect(midLat).toBeGreaterThan(50)
  })

  it('keeps longitudes continuous across the antimeridian', () => {
    // NRT -> LAX crosses the Pacific / date line.
    const arc = greatCircleArc([35.76, 140.38], [33.94, -118.41], 48)
    for (let index = 1; index < arc.length; index += 1) {
      expect(Math.abs(arc[index][1] - arc[index - 1][1])).toBeLessThan(180)
    }
  })

  it('handles identical points without NaN', () => {
    const arc = greatCircleArc([10, 20], [10, 20], 16)
    expect(arc.every(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon))).toBe(true)
  })
})
