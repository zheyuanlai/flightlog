import { describe, expect, it } from 'vitest'
import type { FlightLogEntry } from '../types'
import { computeFlight } from '../utils/flights'
import { assessConnection, tripConnectionRisks } from '../utils/connectionRisk'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'connection-flight',
    date: '2026-06-02',
    flightNumber: 'TA100',
    airline: 'Test Air',
    origin: 'NRT',
    destination: 'SIN',
    scheduledDepartureUtc: '2026-06-02T02:00:00Z',
    scheduledArrivalUtc: '2026-06-02T10:00:00Z',
    originTimeZone: 'Asia/Tokyo',
    destinationTimeZone: 'Asia/Singapore',
    purpose: 'personal',
    source: 'aerodatabox',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('assessConnection', () => {
  it('rates a comfortable connection as low risk with no delay history', () => {
    const from = computeFlight(flight({ id: 'a', destination: 'SIN', scheduledArrivalUtc: '2026-06-02T10:00:00Z' }))
    const to = computeFlight(flight({ id: 'b', origin: 'SIN', destination: 'LAX', scheduledDepartureUtc: '2026-06-02T12:00:00Z' })) // 120m gap
    const risk = assessConnection(from, to, [])
    expect(risk).toBeDefined()
    expect(risk?.connectionMinutes).toBe(120)
    expect(risk?.riskAdjustedMinutes).toBe(120)
    expect(risk?.level).toBe('low')
  })

  it('rates a tight connection as high risk regardless of history', () => {
    const from = computeFlight(flight({ id: 'a', destination: 'SIN', scheduledArrivalUtc: '2026-06-02T10:00:00Z' }))
    const to = computeFlight(flight({ id: 'b', origin: 'SIN', destination: 'LAX', scheduledDepartureUtc: '2026-06-02T10:30:00Z' })) // 30m gap
    const risk = assessConnection(from, to, [])
    expect(risk?.connectionMinutes).toBe(30)
    expect(risk?.level).toBe('high')
  })

  it('downgrades a medium connection using the incoming leg\'s own delay history', () => {
    const from = computeFlight(flight({ id: 'a', destination: 'SIN', scheduledArrivalUtc: '2026-06-02T10:00:00Z' }))
    const to = computeFlight(flight({ id: 'b', origin: 'SIN', destination: 'LAX', scheduledDepartureUtc: '2026-06-02T11:40:00Z' })) // 100m gap
    // Two prior NRT-SIN, Test Air flights both delayed exactly 30m -> predictDelay's
    // route+airline+airport signals all agree on expectedDelayMinutes=30 regardless
    // of their relative weights (weighted average of equal values).
    const history: FlightLogEntry[] = [
      flight({ id: 'h1', scheduledDepartureUtc: '2026-01-01T02:00:00Z', actualDepartureUtc: '2026-01-01T02:30:00Z' }),
      flight({ id: 'h2', scheduledDepartureUtc: '2026-01-08T02:00:00Z', actualDepartureUtc: '2026-01-08T02:30:00Z' }),
    ]
    const risk = assessConnection(from, to, history)
    expect(risk?.connectionMinutes).toBe(100)
    expect(risk?.riskAdjustedMinutes).toBe(70)
    expect(risk?.level).toBe('medium')
    expect(risk?.explanation).toContain('TA100 has historically departed 30m late')
  })

  it('does not apply the delay buffer once the incoming leg has actually landed', () => {
    const from = computeFlight(flight({ id: 'a', destination: 'SIN', scheduledArrivalUtc: '2026-06-02T10:00:00Z', actualArrivalUtc: '2026-06-02T10:00:00Z' })) // landed exactly on time
    const to = computeFlight(flight({ id: 'b', origin: 'SIN', destination: 'LAX', scheduledDepartureUtc: '2026-06-02T11:10:00Z' })) // 70m gap
    // History says this route/airline runs 30m late on departure -- irrelevant
    // now that fromFlight's own arrival is a known, already-happened fact.
    const history: FlightLogEntry[] = [
      flight({ id: 'h1', scheduledDepartureUtc: '2026-01-01T02:00:00Z', actualDepartureUtc: '2026-01-01T02:30:00Z' }),
      flight({ id: 'h2', scheduledDepartureUtc: '2026-01-08T02:00:00Z', actualDepartureUtc: '2026-01-08T02:30:00Z' }),
    ]
    const risk = assessConnection(from, to, history)
    expect(risk?.connectionMinutes).toBe(70)
    expect(risk?.riskAdjustedMinutes).toBe(70) // unadjusted -- the delay buffer is not applied once arrival is a known fact
    expect(risk?.level).toBe('medium') // vs. 'high' if the buffer had been wrongly subtracted (70 - 30 = 40)
    expect(risk?.explanation).toBe('70m scheduled at SIN.')
  })

  it('returns undefined when the two flights are not a same-airport connection', () => {
    const from = computeFlight(flight({ id: 'a', destination: 'SIN' }))
    const to = computeFlight(flight({ id: 'b', origin: 'HKG', destination: 'LAX', scheduledDepartureUtc: '2026-06-02T12:00:00Z' }))
    expect(assessConnection(from, to, [])).toBeUndefined()
  })

  it('returns undefined for a same-day round trip back to the origin (not a through-connection)', () => {
    const from = computeFlight(flight({ id: 'a', origin: 'SFO', destination: 'SEA', scheduledArrivalUtc: '2026-06-02T11:00:00Z' }))
    const to = computeFlight(flight({ id: 'b', origin: 'SEA', destination: 'SFO', scheduledDepartureUtc: '2026-06-02T20:00:00Z' }))
    expect(assessConnection(from, to, [])).toBeUndefined()
  })

  it('returns undefined when the gap is too long to be a real connection', () => {
    const from = computeFlight(flight({ id: 'a', destination: 'SIN', scheduledArrivalUtc: '2026-06-02T10:00:00Z' }))
    const to = computeFlight(flight({ id: 'b', origin: 'SIN', destination: 'LAX', scheduledDepartureUtc: '2026-06-05T10:00:00Z' })) // 3 days later
    expect(assessConnection(from, to, [])).toBeUndefined()
  })

  it('returns undefined for an overlapping/negative gap', () => {
    const from = computeFlight(flight({ id: 'a', destination: 'SIN', scheduledArrivalUtc: '2026-06-02T10:00:00Z' }))
    const to = computeFlight(flight({ id: 'b', origin: 'SIN', destination: 'LAX', scheduledDepartureUtc: '2026-06-02T09:00:00Z' })) // departs before arrival
    expect(assessConnection(from, to, [])).toBeUndefined()
  })

  it('returns undefined when timing cannot be resolved', () => {
    const from = computeFlight(flight({ id: 'a', destination: 'SIN', scheduledArrivalUtc: undefined, originTimeZone: undefined, destinationTimeZone: undefined }))
    const to = computeFlight(flight({ id: 'b', origin: 'SIN', destination: 'LAX' }))
    expect(assessConnection(from, to, [])).toBeUndefined()
  })
})

describe('tripConnectionRisks', () => {
  it('assesses every consecutive leg pair in order', () => {
    const leg1 = computeFlight(flight({ id: 'a', origin: 'NRT', destination: 'SIN', scheduledArrivalUtc: '2026-06-02T10:00:00Z' }))
    const leg2 = computeFlight(flight({ id: 'b', origin: 'SIN', destination: 'LAX', scheduledDepartureUtc: '2026-06-02T12:00:00Z', scheduledArrivalUtc: '2026-06-03T02:00:00Z' }))
    const leg3 = computeFlight(flight({ id: 'c', origin: 'LAX', destination: 'JFK', scheduledDepartureUtc: '2026-06-03T04:00:00Z' }))
    const risks = tripConnectionRisks([leg1, leg2, leg3], [])
    expect(risks).toHaveLength(2)
    expect(risks[0].airport).toBe('SIN')
    expect(risks[1].airport).toBe('LAX')
  })

  it('skips pairs that are not real connections without breaking the rest', () => {
    const leg1 = computeFlight(flight({ id: 'a', origin: 'NRT', destination: 'SIN', scheduledArrivalUtc: '2026-06-02T10:00:00Z' }))
    const leg2 = computeFlight(flight({ id: 'b', origin: 'HKG', destination: 'LAX', scheduledDepartureUtc: '2026-06-02T12:00:00Z', scheduledArrivalUtc: '2026-06-03T02:00:00Z' })) // not connected to leg1
    const leg3 = computeFlight(flight({ id: 'c', origin: 'LAX', destination: 'JFK', scheduledDepartureUtc: '2026-06-03T04:00:00Z' }))
    const risks = tripConnectionRisks([leg1, leg2, leg3], [])
    expect(risks).toHaveLength(1)
    expect(risks[0].airport).toBe('LAX')
  })
})
