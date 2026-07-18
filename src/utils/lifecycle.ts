import { DateTime } from 'luxon'
import type { FlightLogEntry } from '../types'
import { getBestArrivalTime, getBestDepartureTime, resolveFlightTime, getFlightDepartureLocalDate, type FormattedAirportTime } from './flightTime'
import { formatCountdown } from './upcomingFlights'

export type FlightLifecyclePhase =
  | 'scheduled'
  | 'check-in'
  | 'departing-soon'
  | 'en-route'
  | 'landed'
  | 'completed'
  | 'cancelled'
  | 'diverted'
  | 'unknown'

export interface FlightLifecycleInfo {
  phase: FlightLifecyclePhase
  label: string
  detail?: string
  hint?: string
  progressPercent?: number
}

export interface FlightCompletionState {
  needsCompletion: boolean
  arrivalMs?: number
  missing: string[]
}

export interface FlightCompletionPrompt {
  flight: FlightLogEntry
  arrivalMs: number
  arrivedAgoLabel: string
  missing: string[]
}

const HOUR_MS = 60 * 60 * 1000
const CHECK_IN_WINDOW_MS = 24 * HOUR_MS
const DEPARTING_SOON_WINDOW_MS = 3 * HOUR_MS
const LANDED_RECENT_WINDOW_MS = 24 * HOUR_MS
const DEFAULT_FLIGHT_DURATION_MS = 2 * HOUR_MS

const PHASE_LABELS: Record<FlightLifecyclePhase, string> = {
  scheduled: 'Scheduled',
  'check-in': 'Check-in open',
  'departing-soon': 'Departing soon',
  'en-route': 'En route',
  landed: 'Landed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  diverted: 'Diverted',
  unknown: 'Status unknown',
}

const CHECK_IN_HINT = 'Most airlines open online check-in 24 to 48 hours before departure.'
const DEPARTING_SOON_HINT = 'Leave time for the trip to the airport and security.'

function timeInstantMs(time?: FormattedAirportTime): number | undefined {
  if (!time?.instantIso) return undefined
  const instant = DateTime.fromISO(time.instantIso, { setZone: true })
  return instant.isValid ? instant.toUTC().toMillis() : undefined
}

export function formatDurationShort(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const remainder = total % 60
  if (hours >= 48) return `${Math.round(hours / 24)} days`
  if (hours > 0) return `${hours}h ${remainder.toString().padStart(2, '0')}m`
  return `${remainder}m`
}

export function formatTimeAgo(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'moments ago'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 48 * 60) {
    const hours = Math.floor(minutes / 60)
    const remainder = minutes % 60
    return remainder > 0 ? `${hours}h ${remainder.toString().padStart(2, '0')}m ago` : `${hours}h ago`
  }
  return `${Math.round(minutes / (24 * 60))} days ago`
}

function landedInfo(arrivalMs: number | undefined, nowMs: number): FlightLifecycleInfo {
  if (arrivalMs === undefined) return { phase: 'landed', label: PHASE_LABELS.landed }
  if (nowMs - arrivalMs > LANDED_RECENT_WINDOW_MS) {
    return { phase: 'completed', label: PHASE_LABELS.completed, detail: `Arrived ${formatTimeAgo(nowMs - arrivalMs)}` }
  }
  return { phase: 'landed', label: PHASE_LABELS.landed, detail: `Landed ${formatTimeAgo(Math.max(0, nowMs - arrivalMs))}` }
}

export function flightLifecycle(flight: FlightLogEntry, now: DateTime = DateTime.utc()): FlightLifecycleInfo {
  const nowMs = now.toUTC().toMillis()
  const providerStatus = flight.liveStatus?.status

  if (providerStatus === 'cancelled') {
    return { phase: 'cancelled', label: PHASE_LABELS.cancelled, detail: 'The provider reports this flight as cancelled.' }
  }
  if (providerStatus === 'diverted') {
    return { phase: 'diverted', label: PHASE_LABELS.diverted, detail: 'The provider reports this flight as diverted. Check with the airline for the new arrival airport.' }
  }

  const departureMs = timeInstantMs(getBestDepartureTime(flight))
  const arrivalMs = timeInstantMs(getBestArrivalTime(flight))

  if (providerStatus === 'landed') {
    return landedInfo(arrivalMs, nowMs)
  }

  if (departureMs === undefined) {
    const localDate = getFlightDepartureLocalDate(flight)
    const today = now.toISODate() ?? ''
    if (!localDate) return { phase: 'unknown', label: PHASE_LABELS.unknown }
    if (localDate > today) return { phase: 'scheduled', label: PHASE_LABELS.scheduled, detail: `Departs ${localDate}` }
    if (localDate === today) {
      return { phase: 'departing-soon', label: PHASE_LABELS['departing-soon'], detail: 'Departs today; exact times unavailable', hint: DEPARTING_SOON_HINT }
    }
    return { phase: 'completed', label: PHASE_LABELS.completed, detail: `Flew ${localDate}` }
  }

  const arrivalEstimated = arrivalMs === undefined || arrivalMs <= departureMs
  const effectiveArrivalMs = arrivalEstimated ? departureMs + DEFAULT_FLIGHT_DURATION_MS : arrivalMs

  if (nowMs < departureMs) {
    if (providerStatus === 'active') {
      return { phase: 'en-route', label: PHASE_LABELS['en-route'], detail: 'The provider reports this flight in the air.' }
    }
    const countdown = formatCountdown(flight, now)
    if (departureMs - nowMs > CHECK_IN_WINDOW_MS) {
      return { phase: 'scheduled', label: PHASE_LABELS.scheduled, detail: countdown }
    }
    if (departureMs - nowMs > DEPARTING_SOON_WINDOW_MS) {
      return { phase: 'check-in', label: PHASE_LABELS['check-in'], detail: countdown, hint: CHECK_IN_HINT }
    }
    return { phase: 'departing-soon', label: PHASE_LABELS['departing-soon'], detail: countdown, hint: DEPARTING_SOON_HINT }
  }

  if (nowMs < effectiveArrivalMs) {
    const progress = Math.round(((nowMs - departureMs) / (effectiveArrivalMs - departureMs)) * 100)
    const remainingMinutes = (effectiveArrivalMs - nowMs) / 60000
    return {
      phase: 'en-route',
      label: PHASE_LABELS['en-route'],
      detail: `About ${formatDurationShort(remainingMinutes)} remaining${arrivalEstimated ? ' (estimated)' : ''}`,
      progressPercent: Math.min(98, Math.max(2, progress)),
    }
  }

  return landedInfo(arrivalEstimated ? undefined : effectiveArrivalMs, nowMs)
}

export function isDayOfTravelPhase(phase: FlightLifecyclePhase): boolean {
  return phase === 'check-in' || phase === 'departing-soon' || phase === 'en-route' || phase === 'diverted'
}

const DAY_OF_PHASE_RANK: Partial<Record<FlightLifecyclePhase, number>> = {
  diverted: 0,
  'en-route': 1,
  'departing-soon': 2,
  'check-in': 3,
}

export interface DayOfTravelFlight {
  flight: FlightLogEntry
  lifecycle: FlightLifecycleInfo
}

export function pickDayOfTravelFlight(flights: FlightLogEntry[], now: DateTime = DateTime.utc()): DayOfTravelFlight | undefined {
  const candidates = flights
    .filter((flight) => !flight.deletedAt)
    .map((flight) => ({ flight, lifecycle: flightLifecycle(flight, now) }))
    .filter((item) => isDayOfTravelPhase(item.lifecycle.phase))
  if (candidates.length === 0) return undefined
  const departureSortMs = (flight: FlightLogEntry) => timeInstantMs(getBestDepartureTime(flight)) ?? Number.MAX_SAFE_INTEGER
  candidates.sort((a, b) =>
    (DAY_OF_PHASE_RANK[a.lifecycle.phase] ?? 9) - (DAY_OF_PHASE_RANK[b.lifecycle.phase] ?? 9)
    || departureSortMs(a.flight) - departureSortMs(b.flight)
    || a.flight.flightNumber.localeCompare(b.flight.flightNumber))
  return candidates[0]
}

export function flightCompletionState(
  flight: FlightLogEntry,
  now: DateTime = DateTime.utc(),
  options: { withinDays?: number } = {},
): FlightCompletionState {
  const withinDays = options.withinDays ?? 14
  const empty: FlightCompletionState = { needsCompletion: false, missing: [] }
  if (flight.deletedAt || flight.completionDismissedAt) return empty
  const providerStatus = flight.liveStatus?.status
  if (providerStatus === 'cancelled') return empty

  const nowMs = now.toUTC().toMillis()
  const departureMs = timeInstantMs(getBestDepartureTime(flight))
  const bestArrivalMs = timeInstantMs(getBestArrivalTime(flight))
  const arrivalMs = bestArrivalMs ?? (departureMs !== undefined ? departureMs + DEFAULT_FLIGHT_DURATION_MS : undefined)
  if (arrivalMs === undefined) return empty

  const hasLanded = providerStatus === 'landed' || arrivalMs <= nowMs
  if (!hasLanded) return empty
  if (nowMs - arrivalMs > withinDays * 24 * HOUR_MS) return empty

  const missing: string[] = []
  if (!resolveFlightTime(flight, 'actual', 'departure')) missing.push('actual departure time')
  if (!resolveFlightTime(flight, 'actual', 'arrival')) missing.push('actual arrival time')
  if (!flight.aircraftType) missing.push('aircraft type')
  if (!flight.seat) missing.push('seat')

  const missingActualTimes = missing.includes('actual departure time') || missing.includes('actual arrival time')
  return { needsCompletion: missingActualTimes, arrivalMs, missing }
}

export function listFlightsNeedingCompletion(
  flights: FlightLogEntry[],
  now: DateTime = DateTime.utc(),
  options: { withinDays?: number } = {},
): FlightCompletionPrompt[] {
  const nowMs = now.toUTC().toMillis()
  return flights
    .map((flight) => ({ flight, state: flightCompletionState(flight, now, options) }))
    .filter((item) => item.state.needsCompletion && item.state.arrivalMs !== undefined)
    .map((item) => ({
      flight: item.flight,
      arrivalMs: item.state.arrivalMs ?? nowMs,
      arrivedAgoLabel: formatTimeAgo(Math.max(0, nowMs - (item.state.arrivalMs ?? nowMs))),
      missing: item.state.missing,
    }))
    .sort((a, b) => b.arrivalMs - a.arrivalMs || a.flight.flightNumber.localeCompare(b.flight.flightNumber))
}
