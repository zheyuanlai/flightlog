import type { FlightLogEntry, FlightWithComputed } from '../types'
import { durationMinutes } from './dates'
import { haversineDistanceKm } from './distance'
import { hasCoordinates, normalizeIata, resolveFlightAirport } from './airports'
import { getFlightDurationMinutes } from './flightTime'

export function computeFlight(flight: FlightLogEntry): FlightWithComputed {
  const originAirport = resolveFlightAirport(flight, 'origin')
  const destinationAirport = resolveFlightAirport(flight, 'destination')
  const hasRouteCoordinates = hasCoordinates(originAirport) && hasCoordinates(destinationAirport)
  const distanceKm = hasRouteCoordinates ? haversineDistanceKm(originAirport, destinationAirport) : 0
  const duration =
    getFlightDurationMinutes(flight) ??
    durationMinutes(flight.actualDeparture, flight.actualArrival) ??
    durationMinutes(flight.scheduledDeparture, flight.scheduledArrival)
  return {
    ...flight,
    origin: normalizeIata(flight.origin),
    destination: normalizeIata(flight.destination),
    distanceKm,
    durationMinutes: duration,
    originAirport,
    destinationAirport,
    hasRouteCoordinates,
  }
}

export function routeKey(flight: FlightLogEntry): string {
  return `${normalizeIata(flight.origin)}-${normalizeIata(flight.destination)}`
}

export function makeFlightId(): string {
  return crypto.randomUUID()
}
