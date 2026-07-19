import type { FlightLogEntry } from '../types'
import { airlineDisplayName } from './airlines'
import { routeKey } from './flights'
import { normalizeFlightNumber } from './liveStatus'

export interface AlternativeRouteHint {
  flightNumber: string
  airline: string
  timesFlown: number
  mostRecentDate: string
}

/** True for a flight the provider reports as cancelled or diverted — the case a what-if hint is for. */
export function isDisrupted(flight: FlightLogEntry): boolean {
  return flight.liveStatus?.status === 'cancelled' || flight.liveStatus?.status === 'diverted'
}

/**
 * Surfaces the user's own historical flight-number/airline combinations on
 * the same route as a cancelled/diverted flight, most-flown first, as
 * informational "you've flown this route before via..." context. No booking
 * or live availability involved — purely a reflection of the user's own log.
 */
export function findAlternativeRoutes(flights: FlightLogEntry[], disruptedFlight: FlightLogEntry, limit = 3): AlternativeRouteHint[] {
  const route = routeKey(disruptedFlight)
  const disruptedFlightNumber = normalizeFlightNumber(disruptedFlight.flightNumber)
  const disruptedAirline = airlineDisplayName(disruptedFlight.airline) || disruptedFlight.airline
  const groups = new Map<string, { flightNumber: string; airline: string; count: number; mostRecentDate: string }>()
  for (const flight of flights) {
    if (flight.deletedAt) continue
    if (routeKey(flight) !== route) continue
    const flightNumber = normalizeFlightNumber(flight.flightNumber)
    const airline = airlineDisplayName(flight.airline) || flight.airline
    if (flight.id === disruptedFlight.id) continue
    // Also skip a same-route/airline/flight-number/date record with a different
    // id -- almost certainly the same real flight logged twice, not a genuine
    // alternative to itself.
    if (flightNumber === disruptedFlightNumber && airline === disruptedAirline && flight.date === disruptedFlight.date) continue
    const key = `${airline}|${flightNumber}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      if (flight.date > existing.mostRecentDate) existing.mostRecentDate = flight.date
    } else {
      groups.set(key, { flightNumber, airline, count: 1, mostRecentDate: flight.date })
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.mostRecentDate.localeCompare(a.mostRecentDate))
    .slice(0, limit)
    .map((group) => ({ flightNumber: group.flightNumber, airline: group.airline, timesFlown: group.count, mostRecentDate: group.mostRecentDate }))
}
