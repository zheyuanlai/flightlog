import { DateTime } from 'luxon'
import type { FlightLogEntry, FlightWithComputed } from '../types'
import { getBestDepartureTime, getFlightDepartureLocalDate } from './flightTime'
import { computeFlight } from './flights'

export interface TripGroup {
  id: string
  name: string
  flights: FlightWithComputed[]
  startDate: string
  endDate: string
  routeSummary: string
  distanceKm: number
  airports: string[]
  countries: string[]
  warning?: string
}

function sortableDeparture(flight: FlightLogEntry): { instantMs: number; warning?: string } {
  const departure = getBestDepartureTime(flight)
  if (departure?.instantIso) {
    const instant = DateTime.fromISO(departure.instantIso, { setZone: true }).toUTC()
    if (instant.isValid) return { instantMs: instant.toMillis(), warning: departure.warning }
  }
  const fallback = DateTime.fromISO(`${getFlightDepartureLocalDate(flight)}T00:00:00`, { zone: 'UTC' })
  return {
    instantMs: fallback.isValid ? fallback.toMillis() : 0,
    warning: 'Some trip ordering used local date fallback because absolute departure time was unavailable.',
  }
}

function stableTripId(flights: FlightLogEntry[]): string {
  return flights.map((flight) => flight.id).sort().join('-').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 80)
}

function routeSummary(flights: FlightWithComputed[]): string {
  if (flights.length === 0) return ''
  return [flights[0].origin, ...flights.map((flight) => flight.destination)].join(' -> ')
}

export function groupFlightsIntoTrips(flights: FlightLogEntry[], names: Record<string, string> = {}): TripGroup[] {
  const sorted = flights
    .map((flight) => ({ flight: computeFlight(flight), departure: sortableDeparture(flight) }))
    .sort((a, b) => a.departure.instantMs - b.departure.instantMs || a.flight.flightNumber.localeCompare(b.flight.flightNumber))

  const groups: Array<typeof sorted> = []
  for (const item of sorted) {
    const current = groups.at(-1)
    const previous = current?.at(-1)
    if (!current || !previous || item.departure.instantMs - previous.departure.instantMs > 3 * 24 * 60 * 60 * 1000) {
      groups.push([item])
    } else {
      current.push(item)
    }
  }

  return groups.map((items, index) => {
    const tripFlights = items.map((item) => item.flight)
    const id = stableTripId(tripFlights) || `trip-${index + 1}`
    const startDate = getFlightDepartureLocalDate(tripFlights[0])
    const endDate = getFlightDepartureLocalDate(tripFlights.at(-1) ?? tripFlights[0])
    const airports = [...new Set(tripFlights.flatMap((flight) => [flight.origin, flight.destination]))]
    const countries = [...new Set(tripFlights.flatMap((flight) => [flight.originAirport?.country, flight.destinationAirport?.country]).filter((country): country is string => Boolean(country)))].sort()
    const warning = items.map((item) => item.departure.warning).find(Boolean)
    return {
      id,
      name: names[id] ?? `Trip ${index + 1}`,
      flights: tripFlights,
      startDate,
      endDate,
      routeSummary: routeSummary(tripFlights),
      distanceKm: tripFlights.reduce((sum, flight) => sum + flight.distanceKm, 0),
      airports,
      countries,
      warning,
    }
  })
}
