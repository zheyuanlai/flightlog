import { DateTime } from 'luxon'
import type { FlightLogEntry } from '../types'
import { flightLifecycle, type FlightLifecyclePhase } from './lifecycle'
import { resolveFlightTime } from './flightTime'

export type RefreshUrgency = 'none' | 'later' | 'soon' | 'now'

export interface RefreshRecommendation {
  urgency: RefreshUrgency
  label: string
  suggestedIntervalMinutes?: number
  reason?: string
}

// How often it's worth suggesting a live refresh while a flight is in a given
// phase. Absent phases (scheduled far out, completed, cancelled) get no active
// suggestion. This never polls in the background — it only shapes the hint the
// user sees while the app is open.
const PHASE_INTERVAL_MINUTES: Partial<Record<FlightLifecyclePhase, number>> = {
  'check-in': 60,
  'departing-soon': 10,
  'en-route': 10,
  diverted: 10,
  landed: 30,
}

export function refreshRecommendation(flight: FlightLogEntry, now: DateTime = DateTime.utc()): RefreshRecommendation {
  if (flight.deletedAt) return { urgency: 'none', label: 'No refresh needed' }
  const lifecycle = flightLifecycle(flight, now)
  const interval = PHASE_INTERVAL_MINUTES[lifecycle.phase]
  if (!interval) return { urgency: 'none', label: 'No refresh needed' }
  // Once a landed flight has a recorded actual arrival, stop nudging.
  if (lifecycle.phase === 'landed' && resolveFlightTime(flight, 'actual', 'arrival')) {
    return { urgency: 'none', label: 'Up to date' }
  }
  const lastFetched = flight.lastFetchedAt ? DateTime.fromISO(flight.lastFetchedAt, { setZone: true }) : undefined
  const ageMinutes = lastFetched?.isValid ? now.diff(lastFetched, 'minutes').minutes : Number.POSITIVE_INFINITY
  const urgency: RefreshUrgency = ageMinutes >= interval ? 'now' : ageMinutes >= interval / 2 ? 'soon' : 'later'
  const label = urgency === 'now' ? 'Refresh recommended' : urgency === 'soon' ? 'Refresh soon' : 'Status is current'
  return { urgency, label, suggestedIntervalMinutes: interval, reason: lifecycle.detail }
}
