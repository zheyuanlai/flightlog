import { describe, expect, it } from 'vitest'
import type { FlightLogEntry } from '../types'
import { parseQuickAddParams } from '../utils/navigation'
import { buildFlightsIcsFeed } from '../utils/calendarLinks'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'feed-flight',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    scheduledDepartureUtc: '2026-06-02T12:00:00Z',
    scheduledArrivalUtc: '2026-06-03T02:30:00Z',
    originTimeZone: 'Asia/Singapore',
    destinationTimeZone: 'America/Los_Angeles',
    purpose: 'personal',
    source: 'aerodatabox',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('quick add deep link', () => {
  it('parses flight and date from an add deep link', () => {
    const params = parseQuickAddParams('#/add?flight=sq%2038&date=2026-06-02')
    expect(params?.flightNumber).toBe('SQ38')
    expect(params?.date).toBe('2026-06-02')
  })

  it('accepts the flightNumber alias and dateRole', () => {
    const params = parseQuickAddParams('#/add?flightNumber=UA60&date=2026-07-01&dateRole=Arrival')
    expect(params?.flightNumber).toBe('UA60')
    expect(params?.dateRole).toBe('Arrival')
  })

  it('ignores malformed dates but still returns the flight', () => {
    const params = parseQuickAddParams('#/add?flight=BA20&date=07/01/2026')
    expect(params?.flightNumber).toBe('BA20')
    expect(params?.date).toBeUndefined()
  })

  it('returns undefined for non-add hashes', () => {
    expect(parseQuickAddParams('#/flights')).toBeUndefined()
    expect(parseQuickAddParams('#/trips/abc')).toBeUndefined()
  })
})

describe('all-flights ics feed', () => {
  it('builds one calendar with a VEVENT per exportable flight', () => {
    const feed = buildFlightsIcsFeed([
      flight({ id: 'a', flightNumber: 'SQ38' }),
      flight({ id: 'b', flightNumber: 'UA60', origin: 'SFO', destination: 'NRT' }),
    ], 'https://example.com/flightlog/')
    expect(feed.count).toBe(2)
    expect((feed.ics?.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2)
    expect((feed.ics?.match(/BEGIN:VCALENDAR/g) ?? []).length).toBe(1)
    expect(feed.ics).toContain('SQ38')
    expect(feed.ics).toContain('UA60')
  })

  it('skips flights without a reliable calendar range and reports zero when none qualify', () => {
    const noTimes = flight({ id: 'x', scheduledDepartureUtc: undefined, scheduledArrivalUtc: undefined, originTimeZone: undefined, destinationTimeZone: undefined })
    const mixed = buildFlightsIcsFeed([flight({ id: 'ok' }), noTimes])
    expect(mixed.count).toBe(1)
    const empty = buildFlightsIcsFeed([noTimes])
    expect(empty.count).toBe(0)
    expect(empty.ics).toBeUndefined()
  })
})
