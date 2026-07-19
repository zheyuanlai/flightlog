import { describe, expect, it } from 'vitest'
import type { FlightLogEntry } from '../types'
import { findTailHistory } from '../utils/tailHistory'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'f1',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    purpose: 'personal',
    source: 'manual',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('findTailHistory', () => {
  it('returns an empty list when the flight has no aircraft registration', () => {
    const target = flight({ id: 'a', aircraftRegistration: undefined })
    expect(findTailHistory([target], target)).toEqual([])
  })

  it('finds other flights on the same tail, most recent first', () => {
    const target = flight({ id: 'a', date: '2026-06-02', aircraftRegistration: '9V-SGA' })
    const older = flight({ id: 'b', date: '2025-01-01', flightNumber: 'SQ25', origin: 'SIN', destination: 'NRT', aircraftRegistration: '9v-sga' })
    const newer = flight({ id: 'c', date: '2026-03-01', flightNumber: 'SQ12', origin: 'NRT', destination: 'SIN', aircraftRegistration: '9V-SGA' })
    const otherTail = flight({ id: 'd', date: '2026-05-01', aircraftRegistration: 'B-18317' })
    const result = findTailHistory([target, older, newer, otherTail], target)
    expect(result.map((entry) => entry.flightId)).toEqual(['c', 'b'])
  })

  it('excludes itself and deleted flights', () => {
    const target = flight({ id: 'a', aircraftRegistration: '9V-SGA' })
    const deleted = flight({ id: 'b', aircraftRegistration: '9V-SGA', deletedAt: '2026-01-01T00:00:00Z' })
    expect(findTailHistory([target, deleted], target)).toEqual([])
  })

  it('matches registrations case-insensitively and ignores surrounding whitespace', () => {
    const target = flight({ id: 'a', aircraftRegistration: ' 9v-sga ' })
    const match = flight({ id: 'b', date: '2025-01-01', aircraftRegistration: '9V-SGA' })
    expect(findTailHistory([target, match], target)).toHaveLength(1)
  })
})
