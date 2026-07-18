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
  it('captures the current phase and gate in a snapshot', () => {
    const snapshot = flightWatchSnapshot(
      flight({ liveStatus: { status: 'scheduled', departureTerminal: '3', departureGate: 'B4' } }),
      DateTime.fromISO('2026-06-02T10:30:00Z'),
    )
    expect(snapshot.phase).toBe('departing-soon')
    expect(snapshot.gate).toBe('3 / B4')
  })

  it('notifies when the check-in window opens', () => {
    const f = flight()
    const before = snapshots([[f.id, { phase: 'scheduled' }]])
    const { notifications } = detectDayOfNotifications([f], before, DateTime.fromISO('2026-06-01T20:00:00Z'))
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toContain('Check-in window open')
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
