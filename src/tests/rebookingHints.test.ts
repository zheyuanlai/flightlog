import { describe, expect, it } from 'vitest'
import type { FlightLogEntry } from '../types'
import { findAlternativeRoutes, isDisrupted } from '../utils/rebookingHints'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'hint-flight',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    purpose: 'personal',
    source: 'aerodatabox',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('isDisrupted', () => {
  it('is true only for cancelled or diverted live status', () => {
    expect(isDisrupted(flight({ liveStatus: { status: 'cancelled' } }))).toBe(true)
    expect(isDisrupted(flight({ liveStatus: { status: 'diverted' } }))).toBe(true)
    expect(isDisrupted(flight({ liveStatus: { status: 'scheduled' } }))).toBe(false)
    expect(isDisrupted(flight({}))).toBe(false)
  })
})

describe('findAlternativeRoutes', () => {
  it('surfaces the most-flown alternatives on the same route, excluding the disrupted flight itself', () => {
    const disrupted = flight({ id: 'x', date: '2026-06-02' })
    const history: FlightLogEntry[] = [
      flight({ id: 'a', date: '2026-01-01', flightNumber: 'SQ38', airline: 'Singapore Airlines' }),
      flight({ id: 'b', date: '2026-02-01', flightNumber: 'SQ38', airline: 'Singapore Airlines' }),
      flight({ id: 'c', date: '2026-03-01', flightNumber: 'UA100', airline: 'United Airlines' }),
    ]
    const hints = findAlternativeRoutes([disrupted, ...history], disrupted)
    expect(hints).toEqual([
      { flightNumber: 'SQ38', airline: 'Singapore Airlines', timesFlown: 2, mostRecentDate: '2026-02-01' },
      { flightNumber: 'UA100', airline: 'United Airlines', timesFlown: 1, mostRecentDate: '2026-03-01' },
    ])
  })

  it('ignores flights on a different route and soft-deleted flights', () => {
    const disrupted = flight({ id: 'x' })
    const history: FlightLogEntry[] = [
      flight({ id: 'a', origin: 'JFK', destination: 'LHR', flightNumber: 'BA1' }),
      flight({ id: 'b', flightNumber: 'SQ38', deletedAt: '2026-01-01T00:00:00Z' }),
    ]
    expect(findAlternativeRoutes([disrupted, ...history], disrupted)).toEqual([])
  })

  it('caps results at the given limit', () => {
    const disrupted = flight({ id: 'x' })
    const history: FlightLogEntry[] = Array.from({ length: 5 }, (_unused, index) =>
      flight({ id: `f${index}`, flightNumber: `SQ${index}`, date: `2026-0${index + 1}-01` }))
    expect(findAlternativeRoutes([disrupted, ...history], disrupted, 3)).toHaveLength(3)
  })

  it('normalizes whitespace variance in flight numbers so the same real flight is not double-counted', () => {
    const disrupted = flight({ id: 'x' })
    const history: FlightLogEntry[] = [
      flight({ id: 'a', date: '2026-01-01', flightNumber: 'SQ38' }),
      flight({ id: 'b', date: '2026-02-01', flightNumber: 'SQ 38' }),
      flight({ id: 'c', date: '2026-03-01', flightNumber: 'UA100', airline: 'United Airlines' }),
    ]
    const hints = findAlternativeRoutes([disrupted, ...history], disrupted)
    expect(hints[0]).toEqual({ flightNumber: 'SQ38', airline: 'Singapore Airlines', timesFlown: 2, mostRecentDate: '2026-02-01' })
  })

  it('excludes a same-route/airline/flight-number/date record even if it has a different id (a re-logged duplicate of the disrupted flight itself)', () => {
    const disrupted = flight({ id: 'x', date: '2026-06-02' })
    const duplicateOfDisrupted = flight({ id: 'x-dup', date: '2026-06-02' })
    const genuineAlternative = flight({ id: 'a', date: '2026-01-01' })
    const hints = findAlternativeRoutes([disrupted, duplicateOfDisrupted, genuineAlternative], disrupted)
    expect(hints).toEqual([{ flightNumber: 'SQ38', airline: 'Singapore Airlines', timesFlown: 1, mostRecentDate: '2026-01-01' }])
  })
})
