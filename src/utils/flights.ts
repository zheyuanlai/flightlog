import type { FlightLogEntry, FlightWithComputed } from '../types'
import { lookupAirport, normalizeIata } from './airports'
import { durationMinutes } from './dates'
import { haversineDistanceKm } from './distance'

export function computeFlight(flight: FlightLogEntry): FlightWithComputed {
  const origin = lookupAirport(flight.origin)
  const destination = lookupAirport(flight.destination)
  const distanceKm = origin && destination ? haversineDistanceKm(origin, destination) : 0
  const duration =
    durationMinutes(flight.actualDeparture, flight.actualArrival) ??
    durationMinutes(flight.scheduledDeparture, flight.scheduledArrival)
  return { ...flight, origin: normalizeIata(flight.origin), destination: normalizeIata(flight.destination), distanceKm, durationMinutes: duration }
}

export function routeKey(flight: FlightLogEntry): string {
  return `${normalizeIata(flight.origin)}-${normalizeIata(flight.destination)}`
}

export function makeFlightId(): string {
  return crypto.randomUUID()
}
