import type { Airport, FlightLogEntry, FlightWithComputed } from '../types'
import { lookupAirport } from './airports'
import { computeFlight, routeKey } from './flights'

export interface FlightStats {
  totalFlights: number
  totalDistanceKm: number
  totalDurationMinutes: number
  airportsVisited: Airport[]
  countriesVisited: string[]
  airlines: string[]
  aircraftTypes: string[]
  longestFlight?: FlightWithComputed
  shortestFlight?: FlightWithComputed
  mostRecentFlight?: FlightWithComputed
  busiestYear?: string
  yearly: Array<{ year: string; flights: number; distanceKm: number }>
  topAirports: Array<{ code: string; label: string; count: number }>
  topAirlines: Array<{ airline: string; count: number }>
  topRoutes: Array<{ route: string; count: number; distanceKm: number }>
}

function sortedCounts(entries: Map<string, number>): Array<[string, number]> {
  return [...entries.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export function aggregateStats(flights: FlightLogEntry[]): FlightStats {
  const computed = flights.map(computeFlight).sort((a, b) => b.date.localeCompare(a.date))
  const airportCounts = new Map<string, number>()
  const airlineCounts = new Map<string, number>()
  const countrySet = new Set<string>()
  const aircraftSet = new Set<string>()
  const yearly = new Map<string, { flights: number; distanceKm: number }>()
  const routeCounts = new Map<string, { count: number; distanceKm: number }>()
  let totalDurationMinutes = 0

  for (const flight of computed) {
    const origin = lookupAirport(flight.origin)
    const destination = lookupAirport(flight.destination)
    for (const airport of [origin, destination]) {
      if (!airport) continue
      airportCounts.set(airport.iata, (airportCounts.get(airport.iata) ?? 0) + 1)
      countrySet.add(airport.country)
    }
    if (flight.airline) airlineCounts.set(flight.airline, (airlineCounts.get(flight.airline) ?? 0) + 1)
    if (flight.aircraftType) aircraftSet.add(flight.aircraftType)
    if (flight.durationMinutes) totalDurationMinutes += flight.durationMinutes
    const year = flight.date.slice(0, 4)
    const yearBucket = yearly.get(year) ?? { flights: 0, distanceKm: 0 }
    yearBucket.flights += 1
    yearBucket.distanceKm += flight.distanceKm
    yearly.set(year, yearBucket)
    const key = routeKey(flight)
    const route = routeCounts.get(key) ?? { count: 0, distanceKm: flight.distanceKm }
    route.count += 1
    route.distanceKm = flight.distanceKm
    routeCounts.set(key, route)
  }

  const byDistance = [...computed].filter((flight) => flight.distanceKm > 0).sort((a, b) => b.distanceKm - a.distanceKm)
  const yearlyRows = [...yearly.entries()]
    .map(([year, value]) => ({ year, ...value }))
    .sort((a, b) => b.year.localeCompare(a.year))
  const busiestYear = [...yearlyRows].sort((a, b) => b.flights - a.flights)[0]?.year

  return {
    totalFlights: computed.length,
    totalDistanceKm: computed.reduce((sum, flight) => sum + flight.distanceKm, 0),
    totalDurationMinutes,
    airportsVisited: sortedCounts(airportCounts)
      .map(([code]) => lookupAirport(code))
      .filter((airport): airport is Airport => Boolean(airport)),
    countriesVisited: [...countrySet].sort(),
    airlines: sortedCounts(airlineCounts).map(([airline]) => airline),
    aircraftTypes: [...aircraftSet].sort(),
    longestFlight: byDistance[0],
    shortestFlight: byDistance.at(-1),
    mostRecentFlight: computed[0],
    busiestYear,
    yearly: yearlyRows,
    topAirports: sortedCounts(airportCounts).map(([code, count]) => {
      const airport = lookupAirport(code)
      return { code, label: airport ? `${airport.city}, ${airport.country}` : code, count }
    }),
    topAirlines: sortedCounts(airlineCounts).map(([airline, count]) => ({ airline, count })),
    topRoutes: [...routeCounts.entries()]
      .map(([route, value]) => ({ route, ...value }))
      .sort((a, b) => b.count - a.count || b.distanceKm - a.distanceKm),
  }
}
