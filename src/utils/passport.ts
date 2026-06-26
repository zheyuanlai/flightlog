import type { Airport, FlightLogEntry, FlightWithComputed } from '../types'
import type { TripGroup } from './trips'
import { getFlightDepartureLocalDate } from './flightTime'
import { computeFlight, routeKey } from './flights'
import { aggregateStats } from './stats'

export type PassportAchievementId = 'explorer-score' | 'countries-25' | 'airports-50' | 'airlines-10' | 'trips-5'

export interface PassportAchievement {
  id: PassportAchievementId
  label: string
  description: string
  current: number
  target: number
  unit: string
  unlocked: boolean
  firstUnlockedAt?: string
}

export interface PassportTimelineYear {
  year: string
  flights: number
  firstAirports: string[]
  firstCountries: string[]
  longestFlight?: FlightWithComputed
  busiestMonth?: { month: string; flights: number }
  favoriteRoute?: { route: string; flights: number }
  notableTrips: TripGroup[]
}

export interface PassportCollectionAirport {
  airport: Airport
  code: string
  firstVisitDate: string
  visitCount: number
  routes: string[]
}

export interface PassportCollectionCountry {
  country: string
  firstVisitDate: string
  visitCount: number
  airports: string[]
  routes: string[]
}

export interface PassportCollections {
  airports: PassportCollectionAirport[]
  countries: PassportCollectionCountry[]
}

export interface PassportRouteSuperlatives {
  northernmostAirport?: Airport
  southernmostAirport?: Airport
  easternmostAirport?: Airport
  westernmostAirport?: Airport
  shortestFlight?: FlightWithComputed
  longestFlight?: FlightWithComputed
  mostRepeatedRoute?: { route: string; flights: number; distanceKm: number }
  redEyeFlights: number
  aircraftFamilies: string[]
}

interface PassportTimelineAccumulator extends PassportTimelineYear {
  monthCounts: Map<string, number>
  routeCounts: Map<string, number>
}

export interface FlightLogPassportExportV1 {
  schema: 'flightlog.passport.v1'
  exportedAt: string
  achievements: PassportAchievement[]
  timeline: PassportTimelineYear[]
  collections: PassportCollections
  superlatives: PassportRouteSuperlatives
}

function sortedFlights(flights: FlightLogEntry[]): FlightWithComputed[] {
  return flights.map(computeFlight).sort((a, b) => getFlightDepartureLocalDate(a).localeCompare(getFlightDepartureLocalDate(b)) || a.flightNumber.localeCompare(b.flightNumber))
}

function passportScore(flights: FlightLogEntry[], trips: TripGroup[]): number {
  const stats = aggregateStats(flights)
  return Math.min(100, Math.round(
    stats.totalFlights * 1.5 +
    stats.airportsVisited.length * 2 +
    stats.countriesVisited.length * 3 +
    stats.airlines.length * 1.5 +
    trips.length * 2,
  ))
}

function firstUnlockDate(flights: FlightLogEntry[], target: number, metric: (flights: FlightLogEntry[]) => number): string | undefined {
  const ordered = sortedFlights(flights)
  for (let index = 0; index < ordered.length; index += 1) {
    const slice = ordered.slice(0, index + 1)
    if (metric(slice) >= target) return getFlightDepartureLocalDate(ordered[index])
  }
  return undefined
}

export function buildPassportAchievements(flights: FlightLogEntry[], trips: TripGroup[] = []): PassportAchievement[] {
  const stats = aggregateStats(flights)
  const score = passportScore(flights, trips)
  const definitions: Array<Omit<PassportAchievement, 'current' | 'unlocked' | 'firstUnlockedAt'> & { current: number; metric: (flights: FlightLogEntry[]) => number }> = [
    { id: 'explorer-score', label: 'Explorer score', description: 'Local-only progress from flights, airports, countries, airlines, and trips.', target: 100, unit: 'score', current: score, metric: (items) => passportScore(items, []) },
    { id: 'countries-25', label: '25 countries', description: 'Unlock by logging flights that touch 25 unique countries.', target: 25, unit: 'countries', current: stats.countriesVisited.length, metric: (items) => aggregateStats(items).countriesVisited.length },
    { id: 'airports-50', label: '50 airports', description: 'Unlock by visiting 50 unique origin or destination airports.', target: 50, unit: 'airports', current: stats.airportsVisited.length, metric: (items) => aggregateStats(items).airportsVisited.length },
    { id: 'airlines-10', label: '10 airlines', description: 'Unlock by flying 10 unique airlines.', target: 10, unit: 'airlines', current: stats.airlines.length, metric: (items) => aggregateStats(items).airlines.length },
    { id: 'trips-5', label: '5 trips', description: 'Unlock by building five trip groups in your passport.', target: 5, unit: 'trips', current: trips.length, metric: () => trips.length },
  ]
  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    description: definition.description,
    target: definition.target,
    unit: definition.unit,
    current: definition.current,
    unlocked: definition.current >= definition.target,
    firstUnlockedAt: definition.current >= definition.target ? firstUnlockDate(flights, definition.target, definition.metric) : undefined,
  }))
}

export function buildPassportTimeline(flights: FlightLogEntry[], trips: TripGroup[] = []): PassportTimelineYear[] {
  const seenAirports = new Set<string>()
  const seenCountries = new Set<string>()
  const byYear = new Map<string, PassportTimelineAccumulator>()
  for (const flight of sortedFlights(flights)) {
    const date = getFlightDepartureLocalDate(flight)
    const year = date.slice(0, 4)
    const month = date.slice(0, 7)
    const row: PassportTimelineAccumulator = byYear.get(year) ?? { year, flights: 0, firstAirports: [], firstCountries: [], notableTrips: [], monthCounts: new Map<string, number>(), routeCounts: new Map<string, number>() }
    row.flights += 1
    row.monthCounts.set(month, (row.monthCounts.get(month) ?? 0) + 1)
    const route = routeKey(flight)
    row.routeCounts.set(route, (row.routeCounts.get(route) ?? 0) + 1)
    if (!row.longestFlight || flight.distanceKm > row.longestFlight.distanceKm) row.longestFlight = flight
    for (const airport of [flight.originAirport, flight.destinationAirport]) {
      if (!airport) continue
      if (!seenAirports.has(airport.iata)) {
        seenAirports.add(airport.iata)
        row.firstAirports.push(airport.iata)
      }
      if (airport.country && !seenCountries.has(airport.country)) {
        seenCountries.add(airport.country)
        row.firstCountries.push(airport.country)
      }
    }
    byYear.set(year, row)
  }
  for (const trip of trips) {
    const year = trip.startDate.slice(0, 4)
    const row = byYear.get(year)
    if (row) row.notableTrips.push(trip)
  }
  return [...byYear.values()].map((row) => {
    const busiestMonth = [...row.monthCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    const favoriteRoute = [...row.routeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    return {
      year: row.year,
      flights: row.flights,
      firstAirports: row.firstAirports,
      firstCountries: row.firstCountries,
      longestFlight: row.longestFlight,
      busiestMonth: busiestMonth ? { month: busiestMonth[0], flights: busiestMonth[1] } : undefined,
      favoriteRoute: favoriteRoute ? { route: favoriteRoute[0], flights: favoriteRoute[1] } : undefined,
      notableTrips: row.notableTrips.sort((a, b) => b.distanceKm - a.distanceKm).slice(0, 3),
    }
  }).sort((a, b) => b.year.localeCompare(a.year))
}

export function buildPassportCollections(flights: FlightLogEntry[]): PassportCollections {
  const airportMap = new Map<string, PassportCollectionAirport>()
  const countryMap = new Map<string, PassportCollectionCountry>()
  for (const flight of sortedFlights(flights)) {
    const date = getFlightDepartureLocalDate(flight)
    const route = routeKey(flight)
    for (const airport of [flight.originAirport, flight.destinationAirport]) {
      if (!airport) continue
      const airportRow = airportMap.get(airport.iata) ?? { airport, code: airport.iata, firstVisitDate: date, visitCount: 0, routes: [] }
      airportRow.visitCount += 1
      if (!airportRow.routes.includes(route)) airportRow.routes.push(route)
      airportMap.set(airport.iata, airportRow)
      if (airport.country) {
        const countryRow = countryMap.get(airport.country) ?? { country: airport.country, firstVisitDate: date, visitCount: 0, airports: [], routes: [] }
        countryRow.visitCount += 1
        if (!countryRow.airports.includes(airport.iata)) countryRow.airports.push(airport.iata)
        if (!countryRow.routes.includes(route)) countryRow.routes.push(route)
        countryMap.set(airport.country, countryRow)
      }
    }
  }
  return {
    airports: [...airportMap.values()].sort((a, b) => a.firstVisitDate.localeCompare(b.firstVisitDate) || a.code.localeCompare(b.code)),
    countries: [...countryMap.values()].sort((a, b) => a.firstVisitDate.localeCompare(b.firstVisitDate) || a.country.localeCompare(b.country)),
  }
}

function isRedEye(flight: FlightLogEntry): boolean {
  const departure = (flight.actualDepartureLocal ?? flight.scheduledDepartureLocal ?? flight.actualDeparture ?? flight.scheduledDeparture ?? '').slice(11, 13)
  const hour = Number(departure)
  return Number.isFinite(hour) && (hour >= 21 || hour < 5)
}

export function buildPassportRouteSuperlatives(flights: FlightLogEntry[]): PassportRouteSuperlatives {
  const computed = flights.map(computeFlight)
  const airports = new Map<string, Airport>()
  for (const flight of computed) for (const airport of [flight.originAirport, flight.destinationAirport]) if (airport) airports.set(airport.iata, airport)
  const airportList = [...airports.values()].filter((airport) => airport.lat !== undefined && airport.lon !== undefined)
  const byDistance = computed.filter((flight) => flight.distanceKm > 0).sort((a, b) => b.distanceKm - a.distanceKm)
  const stats = aggregateStats(flights)
  return {
    northernmostAirport: [...airportList].sort((a, b) => (b.lat ?? 0) - (a.lat ?? 0))[0],
    southernmostAirport: [...airportList].sort((a, b) => (a.lat ?? 0) - (b.lat ?? 0))[0],
    easternmostAirport: [...airportList].sort((a, b) => (b.lon ?? 0) - (a.lon ?? 0))[0],
    westernmostAirport: [...airportList].sort((a, b) => (a.lon ?? 0) - (b.lon ?? 0))[0],
    shortestFlight: byDistance.at(-1),
    longestFlight: byDistance[0],
    mostRepeatedRoute: stats.topRoutes[0] ? { route: stats.topRoutes[0].route, flights: stats.topRoutes[0].count, distanceKm: stats.topRoutes[0].distanceKm } : undefined,
    redEyeFlights: flights.filter(isRedEye).length,
    aircraftFamilies: [...new Set(computed.map((flight) => flight.aircraftType?.split(/[\s-]/)[0]).filter((family): family is string => Boolean(family)))].sort(),
  }
}

export function createPassportExportV1(flights: FlightLogEntry[], trips: TripGroup[] = [], now = new Date().toISOString()): FlightLogPassportExportV1 {
  return {
    schema: 'flightlog.passport.v1',
    exportedAt: now,
    achievements: buildPassportAchievements(flights, trips),
    timeline: buildPassportTimeline(flights, trips),
    collections: buildPassportCollections(flights),
    superlatives: buildPassportRouteSuperlatives(flights),
  }
}
