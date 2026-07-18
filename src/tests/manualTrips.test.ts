import { describe, expect, it } from 'vitest'
import type { FlightLogEntry, TripMetadata } from '../types'
import { groupFlightsIntoTrips } from '../utils/trips'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'flight-1',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    scheduledDepartureUtc: '2026-06-02T12:00:00Z',
    purpose: 'personal',
    source: 'aerodatabox',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

function tripMeta(overrides: Partial<TripMetadata> & Pick<TripMetadata, 'id'>): TripMetadata {
  return {
    type: 'personal',
    isFavorite: false,
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
    ...overrides,
  }
}

const outbound = flight({ id: 'outbound', flightNumber: 'SQ38', scheduledDepartureUtc: '2026-06-02T12:00:00Z' })
const inbound = flight({ id: 'inbound', flightNumber: 'SQ37', scheduledDepartureUtc: '2026-06-09T12:00:00Z', origin: 'LAX', destination: 'SIN' })
const later = flight({ id: 'later', flightNumber: 'UA60', scheduledDepartureUtc: '2026-07-20T12:00:00Z', origin: 'SFO', destination: 'NRT' })

describe('manual trips', () => {
  it('keeps automatic grouping for unclaimed flights', () => {
    const trips = groupFlightsIntoTrips([outbound, inbound, later])
    expect(trips).toHaveLength(3)
    expect(trips.every((trip) => !trip.isManual)).toBe(true)
  })

  it('builds a manual trip from its metadata roster and removes members from automatic groups', () => {
    const manual = tripMeta({ id: 'manual-1', name: 'Singapore round trip', isManual: true, flightIds: ['outbound', 'inbound'] })
    const trips = groupFlightsIntoTrips([outbound, inbound, later], [manual])
    expect(trips).toHaveLength(2)
    const manualTrip = trips.find((trip) => trip.isManual)
    expect(manualTrip?.id).toBe('manual-1')
    expect(manualTrip?.name).toBe('Singapore round trip')
    expect(manualTrip?.flights.map((item) => item.id)).toEqual(['outbound', 'inbound'])
    expect(manualTrip?.startDate).toBe('2026-06-02')
    expect(manualTrip?.endDate).toBe('2026-06-09')
    const autoTrip = trips.find((trip) => !trip.isManual)
    expect(autoTrip?.flights.map((item) => item.id)).toEqual(['later'])
  })

  it('lets the first manual trip win when two claim the same flight', () => {
    const first = tripMeta({ id: 'manual-a', name: 'First', isManual: true, flightIds: ['outbound'], createdAt: '2026-05-10T00:00:00.000Z' })
    const second = tripMeta({ id: 'manual-b', name: 'Second', isManual: true, flightIds: ['outbound'], createdAt: '2026-05-20T00:00:00.000Z' })
    const trips = groupFlightsIntoTrips([outbound], [first, second])
    expect(trips.find((trip) => trip.id === 'manual-a')?.flights).toHaveLength(1)
    expect(trips.find((trip) => trip.id === 'manual-b')?.flights).toHaveLength(0)
  })

  it('keeps an empty manual trip visible with dates from its creation time', () => {
    const manual = tripMeta({ id: 'manual-empty', name: 'Planning: Japan', isManual: true, flightIds: [] })
    const trips = groupFlightsIntoTrips([], [manual])
    expect(trips).toHaveLength(1)
    expect(trips[0].name).toBe('Planning: Japan')
    expect(trips[0].flights).toHaveLength(0)
    expect(trips[0].startDate).toBe('2026-05-15')
    expect(trips[0].routeSummary).toBe('')
  })

  it('ignores deleted manual metadata so flights return to automatic grouping', () => {
    const manual = tripMeta({ id: 'manual-1', isManual: true, flightIds: ['outbound'], deletedAt: '2026-05-20T00:00:00.000Z' })
    const trips = groupFlightsIntoTrips([outbound], [manual])
    expect(trips).toHaveLength(1)
    expect(trips[0].isManual).toBe(false)
    expect(trips[0].flights.map((item) => item.id)).toEqual(['outbound'])
  })

  it('skips roster flight ids that no longer exist', () => {
    const manual = tripMeta({ id: 'manual-1', isManual: true, flightIds: ['outbound', 'missing'] })
    const trips = groupFlightsIntoTrips([outbound], [manual])
    expect(trips[0].flights.map((item) => item.id)).toEqual(['outbound'])
  })

  it('orders manual and automatic trips together by departure', () => {
    const manual = tripMeta({ id: 'manual-later', name: 'Tokyo', isManual: true, flightIds: ['later'] })
    const trips = groupFlightsIntoTrips([outbound, inbound, later], [manual])
    expect(trips.map((trip) => trip.id)).toEqual([
      trips.find((trip) => !trip.isManual && trip.flights.some((item) => item.id === 'outbound'))?.id,
      trips.find((trip) => !trip.isManual && trip.flights.some((item) => item.id === 'inbound'))?.id,
      'manual-later',
    ])
  })

  it('still attaches metadata to automatic trips by their stable id', () => {
    const autoOnly = groupFlightsIntoTrips([outbound])
    const named = tripMeta({ id: autoOnly[0].id, name: 'Named auto trip' })
    const trips = groupFlightsIntoTrips([outbound], [named])
    expect(trips[0].name).toBe('Named auto trip')
    expect(trips[0].isManual).toBe(false)
  })
})
