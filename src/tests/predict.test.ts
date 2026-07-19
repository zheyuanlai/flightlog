import { describe, expect, it } from 'vitest'
import type { FlightLogEntry } from '../types'
import { predictDelay } from '../utils/predict'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'predict-flight',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    scheduledDepartureUtc: '2026-06-02T12:00:00Z',
    originTimeZone: 'Asia/Singapore',
    destinationTimeZone: 'America/Los_Angeles',
    purpose: 'personal',
    source: 'aerodatabox',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

function nrtSydFlight(id: string, dateIso: string, delayMinutes: number): FlightLogEntry {
  const scheduled = new Date(dateIso)
  const actual = new Date(scheduled.getTime() + delayMinutes * 60000)
  return flight({
    id,
    origin: 'NRT',
    destination: 'SYD',
    originTimeZone: 'Asia/Tokyo',
    destinationTimeZone: 'Australia/Sydney',
    scheduledDepartureUtc: scheduled.toISOString(),
    actualDepartureUtc: actual.toISOString(),
  })
}

describe('predictDelay', () => {
  it('returns no signal without history or an inbound signal', () => {
    const target = flight({ id: 'upcoming' })
    const result = predictDelay([target], target)
    expect(result.hasSignal).toBe(false)
    expect(result.signals).toEqual([])
    expect(result.delayProbability).toBe(0)
    expect(result.confidence).toBe('low')
    expect(result.summary).toBe('Not enough history yet to predict this flight.')
  })

  it('builds route and origin-airport signals from same-route history (different airline)', () => {
    const target = flight({ id: 'upcoming' })
    const history = [
      flight({ id: 'h1', airline: 'Cathay Pacific', scheduledDepartureUtc: '2026-01-01T12:00:00Z', actualDepartureUtc: '2026-01-01T12:05:00Z' }), // 5m
      flight({ id: 'h2', airline: 'Cathay Pacific', scheduledDepartureUtc: '2026-01-08T12:00:00Z', actualDepartureUtc: '2026-01-08T12:10:00Z' }), // 10m
    ]
    const result = predictDelay([target, ...history], target)
    expect(result.hasSignal).toBe(true)
    const route = result.signals.find((signal) => signal.key === 'route')
    const airport = result.signals.find((signal) => signal.key === 'originAirport')
    const airline = result.signals.find((signal) => signal.key === 'airline')
    expect(route).toMatchObject({ sampleSize: 2, averageDelayMinutes: 8, delayProbability: 0 })
    expect(airport).toMatchObject({ sampleSize: 2, averageDelayMinutes: 8, delayProbability: 0 })
    expect(airline).toBeUndefined()
    expect(result.expectedDelayMinutes).toBe(8)
    expect(result.confidence).toBe('medium')
    expect(result.band).toEqual({ lowMinutes: -17, highMinutes: 33 })
  })

  it('isolates an airline-only signal when route and origin differ', () => {
    const target = flight({ id: 'upcoming' })
    const history = [nrtSydFlight('h1', '2026-01-01T03:00:00Z', 20), nrtSydFlight('h2', '2026-01-08T03:00:00Z', 5)]
    const result = predictDelay([target, ...history], target)
    const airline = result.signals.find((signal) => signal.key === 'airline')
    expect(result.signals.find((signal) => signal.key === 'route')).toBeUndefined()
    expect(result.signals.find((signal) => signal.key === 'originAirport')).toBeUndefined()
    expect(airline).toMatchObject({ sampleSize: 2, averageDelayMinutes: 13, delayProbability: 0.5 })
    expect(result.confidence).toBe('low')
    expect(result.band).toEqual({ lowMinutes: -27, highMinutes: 53 })
  })

  it('isolates an origin-airport-only signal when route and airline differ', () => {
    const target = flight({ id: 'upcoming' })
    const history = [
      flight({ id: 'h1', destination: 'HKG', airline: 'Cathay Pacific', destinationTimeZone: 'Asia/Hong_Kong', scheduledDepartureUtc: '2026-01-01T08:00:00Z', actualDepartureUtc: '2026-01-01T08:30:00Z' }), // 30m
      flight({ id: 'h2', destination: 'HKG', airline: 'Cathay Pacific', destinationTimeZone: 'Asia/Hong_Kong', scheduledDepartureUtc: '2026-01-08T08:00:00Z', actualDepartureUtc: '2026-01-08T08:10:00Z' }), // 10m
    ]
    const result = predictDelay([target, ...history], target)
    expect(result.signals.find((signal) => signal.key === 'route')).toBeUndefined()
    expect(result.signals.find((signal) => signal.key === 'airline')).toBeUndefined()
    const airport = result.signals.find((signal) => signal.key === 'originAirport')
    expect(airport).toMatchObject({ sampleSize: 2, averageDelayMinutes: 20, delayProbability: 0.5 })
  })

  it('excludes the flight itself from its own history even if it has an actual departure time', () => {
    const target = flight({ id: 't1', actualDepartureUtc: '2026-06-02T12:50:00Z' }) // 50m, would corrupt the stat if self-counted
    const other = flight({ id: 'h1', airline: 'Cathay Pacific', scheduledDepartureUtc: '2026-01-01T12:00:00Z', actualDepartureUtc: '2026-01-01T12:05:00Z' }) // 5m
    const result = predictDelay([target, other], target)
    const route = result.signals.find((signal) => signal.key === 'route')
    expect(route).toMatchObject({ sampleSize: 1, averageDelayMinutes: 5 })
  })

  it('excludes soft-deleted flights from history', () => {
    const target = flight({ id: 't2' })
    const history = [
      flight({ id: 'h1', airline: 'Cathay Pacific', scheduledDepartureUtc: '2026-01-01T12:00:00Z', actualDepartureUtc: '2026-01-01T12:05:00Z' }), // 5m, kept
      flight({ id: 'h2', airline: 'Cathay Pacific', scheduledDepartureUtc: '2026-01-08T12:00:00Z', actualDepartureUtc: '2026-01-08T14:00:00Z', deletedAt: '2026-01-09T00:00:00Z' }), // 120m, deleted
    ]
    const result = predictDelay([target, ...history], target)
    const route = result.signals.find((signal) => signal.key === 'route')
    expect(route).toMatchObject({ sampleSize: 1, averageDelayMinutes: 5 })
  })

  it('produces an inbound-only signal and bumps confidence when no history exists', () => {
    const target = flight({ id: 'upcoming-inbound', origin: 'ZZZ', destination: 'YYY', airline: 'Nowhere Air' })
    const result = predictDelay([target], target, { inboundDelayMinutes: 30 })
    expect(result.hasSignal).toBe(true)
    expect(result.signals).toEqual([expect.objectContaining({ key: 'inboundAircraft', averageDelayMinutes: 30 })])
    expect(result.delayProbability).toBeCloseTo(0.5, 5)
    expect(result.expectedDelayMinutes).toBe(30)
    expect(result.confidence).toBe('medium')
    expect(result.band).toEqual({ lowMinutes: 5, highMinutes: 55 })
  })

  it('keeps the band ordered and centered on the point estimate even for a large early-arrival signal', () => {
    const target = flight({ id: 'upcoming-early', origin: 'ZZZ', destination: 'YYY', airline: 'Nowhere Air' })
    const result = predictDelay([target], target, { inboundDelayMinutes: -60 })
    expect(result.expectedDelayMinutes).toBe(-60)
    expect(result.band.lowMinutes).toBeLessThanOrEqual(result.band.highMinutes)
    expect(result.expectedDelayMinutes).toBeGreaterThanOrEqual(result.band.lowMinutes)
    expect(result.expectedDelayMinutes).toBeLessThanOrEqual(result.band.highMinutes)
  })

  it('ignores a non-finite inbound signal instead of poisoning the prediction with NaN/Infinity', () => {
    const target = flight({ id: 'upcoming' })
    const history = [
      flight({ id: 'h1', airline: 'Cathay Pacific', scheduledDepartureUtc: '2026-01-01T12:00:00Z', actualDepartureUtc: '2026-01-01T12:05:00Z' }), // 5m
      flight({ id: 'h2', airline: 'Cathay Pacific', scheduledDepartureUtc: '2026-01-08T12:00:00Z', actualDepartureUtc: '2026-01-08T12:10:00Z' }), // 10m
    ]
    for (const bad of [NaN, Infinity, -Infinity]) {
      const result = predictDelay([target, ...history], target, { inboundDelayMinutes: bad })
      expect(result.signals.find((signal) => signal.key === 'inboundAircraft')).toBeUndefined()
      expect(Number.isFinite(result.delayProbability)).toBe(true)
      expect(Number.isFinite(result.expectedDelayMinutes)).toBe(true)
      expect(Number.isFinite(result.band.lowMinutes)).toBe(true)
      expect(Number.isFinite(result.band.highMinutes)).toBe(true)
    }
  })

  it('scales inbound-aircraft delay probability linearly up to a 60-minute saturation point', () => {
    const target = flight({ id: 'upcoming-inbound-2', origin: 'ZZZ', destination: 'YYY', airline: 'Nowhere Air' })
    const probabilities = [0, 30, 60, 90].map((minutes) => predictDelay([target], target, { inboundDelayMinutes: minutes }).delayProbability)
    expect(probabilities[0]).toBeCloseTo(0, 5)
    expect(probabilities[1]).toBeCloseTo(0.5, 5)
    expect(probabilities[2]).toBeCloseTo(1, 5)
    expect(probabilities[3]).toBeCloseTo(1, 5) // clamped at saturation
  })

  it('combines route, origin-airport, and airline signals via a weighted average', () => {
    const target = flight({ id: 'upcoming' })
    const routeHistory = Array.from({ length: 8 }, (_unused, index) =>
      flight({ id: `route-${index}`, airline: 'Cathay Pacific', scheduledDepartureUtc: `2026-01-${String(index + 1).padStart(2, '0')}T12:00:00Z`, actualDepartureUtc: `2026-01-${String(index + 1).padStart(2, '0')}T12:00:00Z` })) // 0m each
    const airlineHistory = Array.from({ length: 4 }, (_unused, index) => nrtSydFlight(`airline-${index}`, `2026-02-${String(index + 1).padStart(2, '0')}T03:00:00Z`, 60))
    const result = predictDelay([target, ...routeHistory, ...airlineHistory], target)
    expect(result.signals.find((signal) => signal.key === 'route')).toMatchObject({ sampleSize: 8, averageDelayMinutes: 0, delayProbability: 0 })
    expect(result.signals.find((signal) => signal.key === 'originAirport')).toMatchObject({ sampleSize: 8, averageDelayMinutes: 0, delayProbability: 0 })
    expect(result.signals.find((signal) => signal.key === 'airline')).toMatchObject({ sampleSize: 4, averageDelayMinutes: 60, delayProbability: 1 })
    expect(result.delayProbability).toBeCloseTo(0.15789, 4)
    expect(result.expectedDelayMinutes).toBe(9)
    expect(result.confidence).toBe('high')
    expect(result.band).toEqual({ lowMinutes: -6, highMinutes: 24 })
    expect(result.summary).toBe('16% chance of a delay beyond 15 minutes, typically around 9m late.')
  })

  it('reaches medium and high confidence as an isolated signal accumulates more samples', () => {
    const target = flight({ id: 'upcoming' })
    const twoFlights = [nrtSydFlight('a', '2026-01-01T03:00:00Z', 5), nrtSydFlight('b', '2026-01-08T03:00:00Z', 5)]
    const threeFlights = [...twoFlights, nrtSydFlight('c', '2026-01-15T03:00:00Z', 5)]
    const tenFlights = Array.from({ length: 10 }, (_unused, index) => nrtSydFlight(`x${index}`, `2026-03-${String(index + 1).padStart(2, '0')}T03:00:00Z`, 5))
    expect(predictDelay([target, ...twoFlights], target).confidence).toBe('low')
    expect(predictDelay([target, ...threeFlights], target).confidence).toBe('medium')
    expect(predictDelay([target, ...tenFlights], target).confidence).toBe('high')
  })
})
