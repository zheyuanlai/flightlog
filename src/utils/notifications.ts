import { DateTime } from 'luxon'
import type { FlightLogEntry } from '../types'
import { flightLifecycle, isDayOfTravelPhase, type FlightLifecyclePhase } from './lifecycle'

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

export interface FlightWatchSnapshot {
  phase: FlightLifecyclePhase
  gate?: string
}

export interface DayOfNotification {
  flightId: string
  kind: 'phase' | 'gate'
  title: string
  body: string
}

const NOTIFIED_PHASES: FlightLifecyclePhase[] = ['check-in', 'departing-soon', 'en-route', 'landed', 'cancelled', 'diverted']

function routeLabel(flight: FlightLogEntry): string {
  return `${flight.flightNumber} ${flight.origin} -> ${flight.destination}`
}

function phaseNotification(flight: FlightLogEntry, phase: FlightLifecyclePhase, detail?: string): DayOfNotification | undefined {
  const route = routeLabel(flight)
  switch (phase) {
    case 'check-in':
      return { flightId: flight.id, kind: 'phase', title: `Check-in window open · ${flight.flightNumber}`, body: `${route}. Most airlines open online check-in 24 to 48 hours before departure.` }
    case 'departing-soon':
      return { flightId: flight.id, kind: 'phase', title: `Departing soon · ${flight.flightNumber}`, body: `${route}${detail ? `. ${detail}` : ''}. Leave time for the airport and security.` }
    case 'en-route':
      return { flightId: flight.id, kind: 'phase', title: `Departed · ${flight.flightNumber}`, body: `${route} is on its way${detail ? `. ${detail}` : ''}.` }
    case 'landed':
      return { flightId: flight.id, kind: 'phase', title: `Landed · ${flight.flightNumber}`, body: `${route} has landed. Confirm details to complete your flight log.` }
    case 'cancelled':
      return { flightId: flight.id, kind: 'phase', title: `Cancelled · ${flight.flightNumber}`, body: `${route} is reported cancelled. Check with the airline.` }
    case 'diverted':
      return { flightId: flight.id, kind: 'phase', title: `Diverted · ${flight.flightNumber}`, body: `${route} is reported diverted. Check with the airline for the new arrival airport.` }
    default:
      return undefined
  }
}

export function flightWatchSnapshot(flight: FlightLogEntry, now: DateTime = DateTime.utc()): FlightWatchSnapshot {
  const lifecycle = flightLifecycle(flight, now)
  const gate = [flight.liveStatus?.departureTerminal, flight.liveStatus?.departureGate].filter(Boolean).join(' / ') || undefined
  return { phase: lifecycle.phase, gate }
}

export function detectDayOfNotifications(
  flights: FlightLogEntry[],
  previous: Map<string, FlightWatchSnapshot>,
  now: DateTime = DateTime.utc(),
): { notifications: DayOfNotification[]; snapshots: Map<string, FlightWatchSnapshot> } {
  const snapshots = new Map<string, FlightWatchSnapshot>()
  const notifications: DayOfNotification[] = []
  for (const flight of flights) {
    if (flight.deletedAt) continue
    const lifecycle = flightLifecycle(flight, now)
    const gate = [flight.liveStatus?.departureTerminal, flight.liveStatus?.departureGate].filter(Boolean).join(' / ') || undefined
    snapshots.set(flight.id, { phase: lifecycle.phase, gate })
    const before = previous.get(flight.id)
    if (!before) continue
    if (before.phase !== lifecycle.phase && NOTIFIED_PHASES.includes(lifecycle.phase)) {
      const relevant = lifecycle.phase === 'cancelled' || lifecycle.phase === 'diverted'
        ? isDayOfTravelPhase(before.phase) || before.phase === 'scheduled'
        : true
      if (relevant) {
        const notification = phaseNotification(flight, lifecycle.phase, lifecycle.detail)
        if (notification) notifications.push(notification)
      }
    }
    if (gate && gate !== before.gate && (isDayOfTravelPhase(lifecycle.phase) || lifecycle.phase === 'scheduled')) {
      notifications.push({
        flightId: flight.id,
        kind: 'gate',
        title: `Gate update · ${flight.flightNumber}`,
        body: `${routeLabel(flight)}: terminal/gate is now ${gate}.`,
      })
    }
  }
  return { notifications, snapshots }
}

export function notificationPermissionState(notificationApi: { permission: NotificationPermission } | undefined = typeof Notification !== 'undefined' ? Notification : undefined): NotificationPermissionState {
  if (!notificationApi) return 'unsupported'
  return notificationApi.permission
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return 'denied'
  }
}

export function showSystemNotification(notification: DayOfNotification): boolean {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
  try {
    new Notification(notification.title, { body: notification.body, tag: `flightlog-${notification.flightId}-${notification.kind}`, icon: `${import.meta.env.BASE_URL}icons/icon-192.png` })
    return true
  } catch {
    return false
  }
}
