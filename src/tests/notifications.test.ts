import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import type { FlightLogEntry } from '../types'
import { detectDayOfNotifications, flightWatchSnapshot, notificationPermissionState, type FlightWatchSnapshot } from '../utils/notifications'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'watch-flight',
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

function snapshots(entries: Array<[string, FlightWatchSnapshot]>): Map<string, FlightWatchSnapshot> {
  return new Map(entries)
}

describe('day-of notifications', () => {
  it('captures the current phase and gate (value alone) in a snapshot', () => {
    const snapshot = flightWatchSnapshot(
      flight({ liveStatus: { status: 'scheduled', departureTerminal: '3', departureGate: 'B4' } }),
      DateTime.fromISO('2026-06-02T10:30:00Z'),
    )
    expect(snapshot.phase).toBe('departing-soon')
    expect(snapshot.gate).toBe('B4')
    expect(snapshot.maxPhaseRank).toBeGreaterThan(0)
  })

  it('reads the nested terminalGate shape for the gate value', () => {
    const snapshot = flightWatchSnapshot(
      flight({ liveStatus: { status: 'scheduled', terminalGate: { departureTerminal: '3', departureGate: 'A12' } } }),
      DateTime.fromISO('2026-06-02T10:30:00Z'),
    )
    expect(snapshot.gate).toBe('A12')
  })

  it('notifies when the check-in window opens', () => {
    const f = flight()
    const before = snapshots([[f.id, { phase: 'scheduled' }]])
    const { notifications } = detectDayOfNotifications([f], before, DateTime.fromISO('2026-06-01T20:00:00Z'))
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toContain('Check-in open')
  })

  it('notifies on departure and landing transitions', () => {
    const f = flight()
    const departed = detectDayOfNotifications([f], snapshots([[f.id, { phase: 'departing-soon' }]]), DateTime.fromISO('2026-06-02T13:00:00Z'))
    expect(departed.notifications[0]?.title).toContain('Departed')
    const landed = detectDayOfNotifications([f], snapshots([[f.id, { phase: 'en-route' }]]), DateTime.fromISO('2026-06-03T03:00:00Z'))
    expect(landed.notifications[0]?.title).toContain('Landed')
  })

  it('does not notify without a previous snapshot or when the phase is unchanged', () => {
    const f = flight()
    const first = detectDayOfNotifications([f], new Map(), DateTime.fromISO('2026-06-02T13:00:00Z'))
    expect(first.notifications).toHaveLength(0)
    expect(first.snapshots.get(f.id)?.phase).toBe('en-route')
    const second = detectDayOfNotifications([f], first.snapshots, DateTime.fromISO('2026-06-02T13:05:00Z'))
    expect(second.notifications).toHaveLength(0)
  })

  it('does not fire lifecycle chatter for historical transitions like completed', () => {
    const f = flight()
    const { notifications } = detectDayOfNotifications([f], snapshots([[f.id, { phase: 'landed' }]]), DateTime.fromISO('2026-06-10T03:00:00Z'))
    expect(notifications).toHaveLength(0)
  })

  it('notifies on cancellations only from an active or scheduled phase', () => {
    const cancelled = flight({ liveStatus: { status: 'cancelled' } })
    const fromScheduled = detectDayOfNotifications([cancelled], snapshots([[cancelled.id, { phase: 'scheduled' }]]), DateTime.fromISO('2026-06-01T10:00:00Z'))
    expect(fromScheduled.notifications[0]?.title).toContain('Cancelled')
    const fromCompleted = detectDayOfNotifications([cancelled], snapshots([[cancelled.id, { phase: 'completed' }]]), DateTime.fromISO('2026-06-01T10:00:00Z'))
    expect(fromCompleted.notifications).toHaveLength(0)
  })

  it('notifies when the gate changes during day-of phases', () => {
    const f = flight({ liveStatus: { status: 'scheduled', departureGate: 'C7' } })
    const { notifications } = detectDayOfNotifications([f], snapshots([[f.id, { phase: 'departing-soon', gate: 'B4' }]]), DateTime.fromISO('2026-06-02T10:30:00Z'))
    const gateNotification = notifications.find((item) => item.kind === 'gate')
    expect(gateNotification?.body).toContain('C7')
    expect(gateNotification?.tag).toContain('C7')
  })

  it('does not re-announce a phase when a delay regresses the lifecycle', () => {
    // Was en-route (rank 3); a provider refresh pushes departure out so the phase regresses.
    const delayed = flight({ scheduledDepartureUtc: '2026-06-02T18:00:00Z', scheduledArrivalUtc: '2026-06-03T08:00:00Z' })
    const before = snapshots([[delayed.id, { phase: 'en-route', maxPhaseRank: 3, departureMs: Date.parse('2026-06-02T12:00:00Z') }]])
    const { notifications } = detectDayOfNotifications([delayed], before, DateTime.fromISO('2026-06-02T13:00:00Z'))
    expect(notifications.some((item) => item.kind === 'phase')).toBe(false)
  })

  it('emits a delay notification when departure is pushed meaningfully later', () => {
    const delayed = flight({ scheduledDepartureUtc: '2026-06-02T13:00:00Z' })
    const before = snapshots([[delayed.id, { phase: 'check-in', maxPhaseRank: 1, departureMs: Date.parse('2026-06-02T12:00:00Z') }]])
    const { notifications } = detectDayOfNotifications([delayed], before, DateTime.fromISO('2026-06-02T09:00:00Z'))
    const delay = notifications.find((item) => item.kind === 'delay')
    expect(delay?.title).toContain('Delayed')
    expect(delay?.body).toContain('60m')
  })

  it('does not fire a phase notification twice across the same rank', () => {
    const f = flight()
    const before = snapshots([[f.id, { phase: 'en-route', maxPhaseRank: 3 }]])
    // Provider glitch: status regressed to scheduled then back; phase is en-route again.
    const { notifications } = detectDayOfNotifications([f], before, DateTime.fromISO('2026-06-02T13:00:00Z'))
    expect(notifications.some((item) => item.kind === 'phase')).toBe(false)
  })

  it('softens the landed message when there is no arrival time on record', () => {
    const noArrival = flight({ scheduledArrivalUtc: undefined })
    const before = snapshots([[noArrival.id, { phase: 'en-route', maxPhaseRank: 3 }]])
    // Departure 12:00 + 2h estimated arrival; at 14:30 it reads as landed with an estimated arrival.
    const { notifications } = detectDayOfNotifications([noArrival], before, DateTime.fromISO('2026-06-02T14:30:00Z'))
    const landed = notifications.find((item) => item.kind === 'phase')
    expect(landed?.body).toContain('may have landed')
  })

  it('suppresses departing-soon for flights with no resolvable departure instant', () => {
    const dateOnly = flight({
      origin: 'LAX',
      date: '2026-07-18',
      scheduledDepartureUtc: undefined,
      scheduledArrivalUtc: undefined,
      originTimeZone: undefined,
      destinationTimeZone: undefined,
    })
    const before = snapshots([[dateOnly.id, { phase: 'scheduled', maxPhaseRank: 0 }]])
    const { notifications } = detectDayOfNotifications([dateOnly], before, DateTime.fromISO('2026-07-18T20:00:00Z'))
    expect(notifications.some((item) => item.kind === 'phase')).toBe(false)
  })

  it('stays quiet for gate assignments on long-past flights', () => {
    const f = flight({ liveStatus: { status: 'landed', departureGate: 'C7' } })
    const { notifications } = detectDayOfNotifications([f], snapshots([[f.id, { phase: 'completed', gate: 'B4' }]]), DateTime.fromISO('2026-07-01T10:00:00Z'))
    expect(notifications).toHaveLength(0)
  })

  it('skips deleted flights', () => {
    const f = flight({ deletedAt: '2026-06-01T00:00:00Z' })
    const { notifications, snapshots: next } = detectDayOfNotifications([f], snapshots([[f.id, { phase: 'departing-soon' }]]), DateTime.fromISO('2026-06-02T13:00:00Z'))
    expect(notifications).toHaveLength(0)
    expect(next.has(f.id)).toBe(false)
  })

  it('reports unsupported when the Notification API is missing', () => {
    expect(notificationPermissionState(undefined)).toBe('unsupported')
    expect(notificationPermissionState({ permission: 'granted' })).toBe('granted')
  })
})
