import { DateTime } from 'luxon'
import type { FlightLogEntry } from '../types'
import { flightBestInstantMs, flightLifecycle, isDayOfTravelPhase, type FlightLifecyclePhase } from './lifecycle'

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

export interface FlightWatchSnapshot {
  phase: FlightLifecyclePhase
  maxPhaseRank: number
  gate?: string
  departureMs?: number
  disrupted: boolean
}

export interface DayOfNotification {
  flightId: string
  kind: 'phase' | 'gate' | 'delay'
  tag: string
  title: string
  body: string
}

// Linear progression rank; cancelled/diverted/unknown sit off the scale at -1.
const PHASE_RANK: Record<FlightLifecyclePhase, number> = {
  scheduled: 0,
  'check-in': 1,
  'departing-soon': 2,
  'en-route': 3,
  landed: 4,
  completed: 5,
  cancelled: -1,
  diverted: -1,
  unknown: -1,
}

const LINEAR_NOTIFIED = new Set<FlightLifecyclePhase>(['check-in', 'departing-soon', 'en-route', 'landed'])
const DELAY_THRESHOLD_MS = 15 * 60 * 1000

function routeLabel(flight: FlightLogEntry): string {
  return `${flight.flightNumber} ${flight.origin} -> ${flight.destination}`
}

function gateOf(flight: FlightLogEntry): string | undefined {
  // Match the reader the rest of the app uses (flat field, then nested shape)
  // and compare on the gate value alone so a terminal appearing/disappearing
  // between provider responses does not flap.
  return flight.liveStatus?.departureGate ?? flight.liveStatus?.terminalGate?.departureGate ?? undefined
}

function phaseNotification(flight: FlightLogEntry, phase: FlightLifecyclePhase, detail?: string, estimatedArrival = false): DayOfNotification | undefined {
  const route = routeLabel(flight)
  const tag = `flightlog-${flight.id}-phase-${phase}`
  switch (phase) {
    case 'check-in':
      return { flightId: flight.id, kind: 'phase', tag, title: `Check-in open · ${flight.flightNumber}`, body: `${route}. Most airlines open online check-in 24 to 48 hours before departure.` }
    case 'departing-soon':
      return { flightId: flight.id, kind: 'phase', tag, title: `Departing soon · ${flight.flightNumber}`, body: `${route}${detail ? `. ${detail}` : ''}. Leave time for the airport and security.` }
    case 'en-route':
      return { flightId: flight.id, kind: 'phase', tag, title: `Departed · ${flight.flightNumber}`, body: `${route} is on its way${detail ? `. ${detail}` : ''}.` }
    case 'landed':
      return estimatedArrival
        ? { flightId: flight.id, kind: 'phase', tag, title: `May have landed · ${flight.flightNumber}`, body: `${route} may have landed (no arrival time on record). Confirm details to complete your log.` }
        : { flightId: flight.id, kind: 'phase', tag, title: `Landed · ${flight.flightNumber}`, body: `${route} has landed. Confirm details to complete your flight log.` }
    case 'cancelled':
      return { flightId: flight.id, kind: 'phase', tag, title: `Cancelled · ${flight.flightNumber}`, body: `${route} is reported cancelled. Check with the airline.` }
    case 'diverted':
      return { flightId: flight.id, kind: 'phase', tag, title: `Diverted · ${flight.flightNumber}`, body: `${route} is reported diverted. Check with the airline for the new arrival airport.` }
    default:
      return undefined
  }
}

export function flightWatchSnapshot(flight: FlightLogEntry, now: DateTime = DateTime.utc()): FlightWatchSnapshot {
  const phase = flightLifecycle(flight, now).phase
  return {
    phase,
    maxPhaseRank: PHASE_RANK[phase],
    gate: gateOf(flight),
    departureMs: flightBestInstantMs(flight, 'departure'),
    disrupted: phase === 'cancelled' || phase === 'diverted',
  }
}

export function detectDayOfNotifications(
  flights: FlightLogEntry[],
  previous: Map<string, FlightWatchSnapshot>,
  now: DateTime = DateTime.utc(),
): { notifications: DayOfNotification[]; snapshots: Map<string, FlightWatchSnapshot> } {
  const nowMs = now.toUTC().toMillis()
  const snapshots = new Map<string, FlightWatchSnapshot>()
  const notifications: DayOfNotification[] = []
  for (const flight of flights) {
    if (flight.deletedAt) continue
    const lifecycle = flightLifecycle(flight, now)
    const phase = lifecycle.phase
    const gate = gateOf(flight)
    const departureMs = flightBestInstantMs(flight, 'departure')
    const before = previous.get(flight.id)
    const beforeMaxRank = before ? before.maxPhaseRank ?? PHASE_RANK[before.phase] : PHASE_RANK[phase]
    const disrupted = (before?.disrupted ?? false) || phase === 'cancelled' || phase === 'diverted'
    snapshots.set(flight.id, {
      phase,
      maxPhaseRank: Math.max(PHASE_RANK[phase], beforeMaxRank),
      gate,
      departureMs,
      disrupted,
    })
    if (!before) continue

    // Cancelled/diverted: once, and only from a non-terminal prior phase.
    const priorRank = PHASE_RANK[before.phase]
    if ((phase === 'cancelled' || phase === 'diverted') && !before.disrupted && priorRank >= 0 && priorRank <= 3) {
      const notification = phaseNotification(flight, phase)
      if (notification) notifications.push(notification)
    }

    // Linear phases: forward-only, so a delay-driven regression never re-fires.
    if (LINEAR_NOTIFIED.has(phase) && PHASE_RANK[phase] > beforeMaxRank) {
      const noInstant = phase === 'departing-soon' && departureMs === undefined
      if (!noInstant) {
        const estimatedArrival = phase === 'landed' && flightBestInstantMs(flight, 'arrival') === undefined
        const notification = phaseNotification(flight, phase, lifecycle.detail, estimatedArrival)
        if (notification) notifications.push(notification)
      }
    }

    // Delay: departure pushed meaningfully later while still upcoming.
    if (
      departureMs !== undefined && before.departureMs !== undefined
      && departureMs - before.departureMs >= DELAY_THRESHOLD_MS
      && nowMs < departureMs
      && phase !== 'cancelled' && phase !== 'diverted'
    ) {
      const delayMinutes = Math.round((departureMs - before.departureMs) / 60000)
      notifications.push({
        flightId: flight.id,
        kind: 'delay',
        tag: `flightlog-${flight.id}-delay-${departureMs}`,
        title: `Delayed · ${flight.flightNumber}`,
        body: `${routeLabel(flight)} is now scheduled about ${delayMinutes}m later than before.`,
      })
    }

    // Gate: real assignment/change during day-of phases (compare gate alone).
    if (gate && gate !== before.gate && (isDayOfTravelPhase(phase) || phase === 'scheduled')) {
      notifications.push({
        flightId: flight.id,
        kind: 'gate',
        tag: `flightlog-${flight.id}-gate-${gate}`,
        title: `Gate update · ${flight.flightNumber}`,
        body: `${routeLabel(flight)}: departure gate is now ${gate}.`,
      })
    }
  }
  return { notifications, snapshots }
}

export function notificationPermissionState(
  notificationApi: { permission: NotificationPermission } | undefined = typeof Notification !== 'undefined' ? Notification : undefined,
): NotificationPermissionState {
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

export async function showSystemNotification(notification: DayOfNotification): Promise<boolean> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
  const options: NotificationOptions & { renotify?: boolean } = {
    body: notification.body,
    tag: notification.tag,
    // Each transition uses a distinct tag; renotify makes repeated tags still alert.
    renotify: true,
    icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
  }
  // Android Chromium throws on the page-context Notification constructor and
  // requires the service worker registration, so prefer it when present.
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        await registration.showNotification(notification.title, options)
        return true
      }
    }
  } catch {
    // fall through to the page constructor
  }
  try {
    new Notification(notification.title, options)
    return true
  } catch {
    return false
  }
}
