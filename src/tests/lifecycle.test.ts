import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import type { FlightLogEntry } from '../types'
import {
  flightCompletionState,
  flightLifecycle,
  formatDurationShort,
  formatTimeAgo,
  isDayOfTravelPhase,
  listFlightsNeedingCompletion,
  pickDayOfTravelFlight,
} from '../utils/lifecycle'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'lifecycle-flight',
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

describe('flight lifecycle', () => {
  it('reports scheduled more than a day before departure', () => {
    const info = flightLifecycle(flight(), DateTime.fromISO('2026-05-28T12:00:00Z'))
    expect(info.phase).toBe('scheduled')
    expect(info.detail).toContain('Departs in 5 days')
  })

  it('opens the check-in window inside 24 hours', () => {
    const info = flightLifecycle(flight(), DateTime.fromISO('2026-06-01T20:00:00Z'))
    expect(info.phase).toBe('check-in')
    expect(info.label).toBe('Check-in open')
    expect(info.hint).toContain('check-in')
  })

  it('reports departing soon inside three hours', () => {
    const info = flightLifecycle(flight(), DateTime.fromISO('2026-06-02T10:30:00Z'))
    expect(info.phase).toBe('departing-soon')
    expect(info.detail).toBe('Departs in 1h 30m')
  })

  it('reports en route with progress between departure and arrival', () => {
    const info = flightLifecycle(flight(), DateTime.fromISO('2026-06-02T19:15:00Z'))
    expect(info.phase).toBe('en-route')
    expect(info.progressPercent).toBe(50)
    expect(info.detail).toContain('remaining')
  })

  it('reports landed within a day of arrival and completed afterwards', () => {
    const landed = flightLifecycle(flight(), DateTime.fromISO('2026-06-03T04:00:00Z'))
    expect(landed.phase).toBe('landed')
    expect(landed.detail).toContain('Landed 1h 30m ago')
    const completed = flightLifecycle(flight(), DateTime.fromISO('2026-06-05T04:00:00Z'))
    expect(completed.phase).toBe('completed')
  })

  it('lets provider cancelled and diverted statuses win', () => {
    expect(flightLifecycle(flight({ liveStatus: { status: 'cancelled' } }), DateTime.fromISO('2026-06-02T10:30:00Z')).phase).toBe('cancelled')
    expect(flightLifecycle(flight({ liveStatus: { status: 'diverted' } }), DateTime.fromISO('2026-06-02T13:00:00Z')).phase).toBe('diverted')
  })

  it('trusts a provider active status before the scheduled departure', () => {
    const info = flightLifecycle(flight({ liveStatus: { status: 'active' } }), DateTime.fromISO('2026-06-02T11:30:00Z'))
    expect(info.phase).toBe('en-route')
  })

  it('uses an estimated two hour duration when arrival is unknown', () => {
    const info = flightLifecycle(
      flight({ scheduledArrivalUtc: undefined }),
      DateTime.fromISO('2026-06-02T13:00:00Z'),
    )
    expect(info.phase).toBe('en-route')
    expect(info.detail).toContain('(estimated)')
  })

  it('falls back to departure local date when no instants exist', () => {
    const bare = flight({
      scheduledDepartureUtc: undefined,
      scheduledArrivalUtc: undefined,
      originTimeZone: undefined,
      destinationTimeZone: undefined,
    })
    expect(flightLifecycle(bare, DateTime.fromISO('2026-05-20T12:00:00Z')).phase).toBe('scheduled')
    expect(flightLifecycle(bare, DateTime.fromISO('2026-06-02T12:00:00Z')).phase).toBe('departing-soon')
    expect(flightLifecycle(bare, DateTime.fromISO('2026-06-10T12:00:00Z')).phase).toBe('completed')
  })

  it('identifies day-of-travel phases', () => {
    expect(isDayOfTravelPhase('en-route')).toBe(true)
    expect(isDayOfTravelPhase('check-in')).toBe(true)
    expect(isDayOfTravelPhase('scheduled')).toBe(false)
    expect(isDayOfTravelPhase('completed')).toBe(false)
  })

  it('picks the most pressing day-of-travel flight', () => {
    const enRoute = flight({ id: 'en-route', flightNumber: 'SQ12' })
    const checkIn = flight({
      id: 'check-in',
      flightNumber: 'UA60',
      scheduledDepartureUtc: '2026-06-03T06:00:00Z',
      scheduledArrivalUtc: '2026-06-03T12:00:00Z',
    })
    const picked = pickDayOfTravelFlight([checkIn, enRoute], DateTime.fromISO('2026-06-02T14:00:00Z'))
    expect(picked?.flight.id).toBe('en-route')
    expect(picked?.lifecycle.phase).toBe('en-route')
  })

  it('ignores deleted flights when picking day-of travel', () => {
    const deleted = flight({ id: 'gone', deletedAt: '2026-06-01T00:00:00Z' })
    expect(pickDayOfTravelFlight([deleted], DateTime.fromISO('2026-06-02T14:00:00Z'))).toBeUndefined()
  })

  it('formats short durations and time-ago labels', () => {
    expect(formatDurationShort(95)).toBe('1h 35m')
    expect(formatDurationShort(20)).toBe('20m')
    expect(formatTimeAgo(30 * 1000)).toBe('moments ago')
    expect(formatTimeAgo(45 * 60 * 1000)).toBe('45m ago')
    expect(formatTimeAgo(3 * 24 * 60 * 60 * 1000)).toBe('3 days ago')
  })
})

describe('post-flight completion', () => {
  const afterLanding = DateTime.fromISO('2026-06-04T02:30:00Z')

  it('asks for completion when a recent flight has no actual times', () => {
    const state = flightCompletionState(flight(), afterLanding)
    expect(state.needsCompletion).toBe(true)
    expect(state.missing).toContain('actual departure time')
    expect(state.missing).toContain('actual arrival time')
  })

  it('does not prompt when actual times are recorded', () => {
    const state = flightCompletionState(
      flight({ actualDepartureUtc: '2026-06-02T12:10:00Z', actualArrivalUtc: '2026-06-03T02:20:00Z' }),
      afterLanding,
    )
    expect(state.needsCompletion).toBe(false)
    expect(state.missing).toContain('seat')
  })

  it('does not prompt before arrival, after dismissal, for deleted or cancelled flights', () => {
    expect(flightCompletionState(flight(), DateTime.fromISO('2026-06-02T13:00:00Z')).needsCompletion).toBe(false)
    expect(flightCompletionState(flight({ completionDismissedAt: '2026-06-03T05:00:00Z' }), afterLanding).needsCompletion).toBe(false)
    expect(flightCompletionState(flight({ deletedAt: '2026-06-03T05:00:00Z' }), afterLanding).needsCompletion).toBe(false)
    expect(flightCompletionState(flight({ liveStatus: { status: 'cancelled' } }), afterLanding).needsCompletion).toBe(false)
  })

  it('stops prompting outside the recency window', () => {
    const state = flightCompletionState(flight(), DateTime.fromISO('2026-07-04T02:30:00Z'))
    expect(state.needsCompletion).toBe(false)
    expect(flightCompletionState(flight(), DateTime.fromISO('2026-06-10T02:30:00Z'), { withinDays: 30 }).needsCompletion).toBe(true)
  })

  it('skips flights that never had reliable instants', () => {
    const bare = flight({
      scheduledDepartureUtc: undefined,
      scheduledArrivalUtc: undefined,
      originTimeZone: undefined,
      destinationTimeZone: undefined,
    })
    expect(flightCompletionState(bare, afterLanding).needsCompletion).toBe(false)
  })

  it('lists prompts most recent first', () => {
    const older = flight({ id: 'older', flightNumber: 'AA10', scheduledDepartureUtc: '2026-05-30T12:00:00Z', scheduledArrivalUtc: '2026-05-30T20:00:00Z' })
    const newer = flight({ id: 'newer', flightNumber: 'BA20' })
    const prompts = listFlightsNeedingCompletion([older, newer], afterLanding)
    expect(prompts.map((prompt) => prompt.flight.id)).toEqual(['newer', 'older'])
    expect(prompts[0].arrivedAgoLabel).toContain('ago')
  })
})
