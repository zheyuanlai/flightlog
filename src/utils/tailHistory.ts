import type { FlightLogEntry } from '../types'

export interface TailHistoryEntry {
  flightId: string
  date: string
  flightNumber: string
  origin: string
  destination: string
}

function normalizeRegistration(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

/** Other logged flights on the same aircraft registration, most recent first -- purely a reflection of the user's own log, no external data. */
export function findTailHistory(flights: FlightLogEntry[], flight: FlightLogEntry): TailHistoryEntry[] {
  const registration = normalizeRegistration(flight.aircraftRegistration)
  if (!registration) return []
  return flights
    .filter((item) => item.id !== flight.id && !item.deletedAt)
    .filter((item) => normalizeRegistration(item.aircraftRegistration) === registration)
    .map((item) => ({ flightId: item.id, date: item.date, flightNumber: item.flightNumber, origin: item.origin, destination: item.destination }))
    .sort((a, b) => b.date.localeCompare(a.date))
}
