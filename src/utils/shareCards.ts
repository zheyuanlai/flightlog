import type { FlightLogEntry } from '../types'
import type { TripGroup } from './trips'
import type { FlightTimeDisplayOptions } from './flightTime'
import { formatArrivalLocalTime, formatDepartureLocalTime, getFlightDepartureLocalDate } from './flightTime'
import { computeFlight, routeKey } from './flights'
import { aggregateStats } from './stats'
import { formatDistance } from './dates'
import type { DistanceUnit } from '../types'

export interface ShareCardData {
  brand: 'FlightLog'
  kind: 'flight' | 'trip' | 'year'
  title: string
  subtitle: string
  route: string
  date: string
  distance: string
  airports: string[]
  countries: string[]
  highlights: string[]
  notes?: string
}

export function flightShareCardData(
  flight: FlightLogEntry,
  options: FlightTimeDisplayOptions & { distanceUnit?: DistanceUnit; includeNotes?: boolean } = {},
): ShareCardData {
  const computed = computeFlight(flight)
  const departure = formatDepartureLocalTime(flight, options)
  const arrival = formatArrivalLocalTime(flight, options)
  const airline = flight.airline || flight.liveStatus?.airline?.name || 'Flight'
  return {
    brand: 'FlightLog',
    kind: 'flight',
    title: `${flight.flightNumber} · ${airline}`,
    subtitle: `${flight.origin} to ${flight.destination}`,
    route: routeKey(flight),
    date: getFlightDepartureLocalDate(flight),
    distance: computed.hasRouteCoordinates ? formatDistance(computed.distanceKm, options.distanceUnit ?? 'kilometers') : 'Distance unavailable',
    airports: [flight.origin, flight.destination],
    countries: [computed.originAirport?.country, computed.destinationAirport?.country].filter((country): country is string => Boolean(country)),
    highlights: [
      `Depart ${departure.label}`,
      `Arrive ${arrival.label}`,
      flight.liveStatus?.status ? `Status ${flight.liveStatus.status}` : 'Manually logged',
    ],
    notes: options.includeNotes ? flight.notes : undefined,
  }
}

export function tripShareCardData(
  trip: TripGroup,
  options: { distanceUnit?: DistanceUnit; includeNotes?: boolean } = {},
): ShareCardData {
  return {
    brand: 'FlightLog',
    kind: 'trip',
    title: trip.name,
    subtitle: `${trip.flights.length} flight${trip.flights.length === 1 ? '' : 's'} · ${trip.type}`,
    route: trip.routeSummary,
    date: `${trip.startDate} to ${trip.endDate}`,
    distance: formatDistance(trip.distanceKm, options.distanceUnit ?? 'kilometers'),
    airports: trip.airports,
    countries: trip.countries,
    highlights: [
      `${trip.airports.length} airport${trip.airports.length === 1 ? '' : 's'}`,
      `${trip.countries.length} countr${trip.countries.length === 1 ? 'y' : 'ies'}`,
      trip.isFavorite ? 'Pinned trip' : 'Trip summary',
    ],
    notes: options.includeNotes ? trip.notes : undefined,
  }
}

export function yearlyPassportShareCardData(
  flights: FlightLogEntry[],
  year: string,
  options: { distanceUnit?: DistanceUnit } = {},
): ShareCardData {
  // Bucket by local departure date, matching aggregateStats/FlightStats.yearly's
  // convention -- using the raw, possibly-stale flight.date field here would let
  // this card's flight set silently disagree with a "N flights this year" count
  // computed the other way for the same year (e.g. overnight flights near a
  // year boundary, or a manually edited date/time combination).
  const yearFlights = flights.filter((flight) => getFlightDepartureLocalDate(flight).startsWith(year))
  const stats = aggregateStats(yearFlights)
  return {
    brand: 'FlightLog',
    kind: 'year',
    title: `${year} travel summary`,
    subtitle: `${stats.totalFlights} flight${stats.totalFlights === 1 ? '' : 's'}`,
    route: stats.topRoutes[0]?.route ?? 'No routes yet',
    date: year,
    distance: formatDistance(stats.totalDistanceKm, options.distanceUnit ?? 'kilometers'),
    airports: stats.airportsVisited.map((airport) => airport.iata),
    countries: stats.countriesVisited,
    highlights: [
      `${stats.airportsVisited.length} airports`,
      `${stats.countriesVisited.length} countries`,
      stats.longestFlight ? `Longest ${routeKey(stats.longestFlight)}` : 'No longest flight yet',
    ],
  }
}
