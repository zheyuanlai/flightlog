import type { FlightLogEntry, ProviderAirportSnapshot } from '../types'
import { resolveFlightAirport } from './airports'
import { getBestArrivalTime, getBestDepartureTime } from './flightTime'
import { computeFlight } from './flights'

export interface DataHealthReport {
  missingTimezoneCount: number
  missingAirportCoordinateCount: number
  providerWarningCount: number
  missingTimeCount: number
  repairableAirportSnapshotCount: number
}

function airportSnapshotFromFlight(flight: FlightLogEntry, role: 'origin' | 'destination'): ProviderAirportSnapshot | undefined {
  const airport = resolveFlightAirport(flight, role)
  if (!airport) return undefined
  return {
    iata: airport.iata,
    icao: airport.icao,
    name: airport.name,
    city: airport.city,
    country: airport.country,
    countryCode: airport.countryCode,
    countryName: airport.countryName ?? airport.country,
    lat: airport.lat,
    lon: airport.lon,
    timezone: airport.timezone ?? airport.timeZone,
    timeZone: airport.timeZone ?? airport.timezone,
    source: airport.source ?? 'generated',
    updatedAt: new Date().toISOString(),
  }
}

function hasTimezone(flight: FlightLogEntry, role: 'origin' | 'destination'): boolean {
  const explicit = role === 'origin' ? flight.originTimeZone : flight.destinationTimeZone
  const snapshot = role === 'origin' ? flight.originAirportSnapshot : flight.destinationAirportSnapshot
  const airport = resolveFlightAirport(flight, role)
  return Boolean(explicit ?? snapshot?.timezone ?? snapshot?.timeZone ?? airport?.timezone ?? airport?.timeZone)
}

export function analyzeDataHealth(flights: FlightLogEntry[]): DataHealthReport {
  let missingTimezoneCount = 0
  let missingAirportCoordinateCount = 0
  let providerWarningCount = 0
  let missingTimeCount = 0
  let repairableAirportSnapshotCount = 0

  for (const flight of flights) {
    if (!hasTimezone(flight, 'origin') || !hasTimezone(flight, 'destination')) missingTimezoneCount += 1
    if (!computeFlight(flight).hasRouteCoordinates) missingAirportCoordinateCount += 1
    if ((flight.providerWarnings?.length ?? 0) > 0 || (flight.liveStatus?.warnings?.length ?? 0) > 0 || flight.liveStatus?.warning) providerWarningCount += 1
    if (!getBestDepartureTime(flight) || !getBestArrivalTime(flight)) missingTimeCount += 1
    if (
      (!flight.originAirportSnapshot && airportSnapshotFromFlight(flight, 'origin')) ||
      (!flight.destinationAirportSnapshot && airportSnapshotFromFlight(flight, 'destination')) ||
      (!flight.originTimeZone && hasTimezone(flight, 'origin')) ||
      (!flight.destinationTimeZone && hasTimezone(flight, 'destination'))
    ) repairableAirportSnapshotCount += 1
  }

  return {
    missingTimezoneCount,
    missingAirportCoordinateCount,
    providerWarningCount,
    missingTimeCount,
    repairableAirportSnapshotCount,
  }
}

export function repairFlightsFromAirportDataset(flights: FlightLogEntry[]): FlightLogEntry[] {
  return flights.map((flight) => {
    const originSnapshot = flight.originAirportSnapshot ?? airportSnapshotFromFlight(flight, 'origin')
    const destinationSnapshot = flight.destinationAirportSnapshot ?? airportSnapshotFromFlight(flight, 'destination')
    return {
      ...flight,
      originAirportSnapshot: originSnapshot,
      destinationAirportSnapshot: destinationSnapshot,
      originTimeZone: flight.originTimeZone ?? originSnapshot?.timezone ?? originSnapshot?.timeZone,
      destinationTimeZone: flight.destinationTimeZone ?? destinationSnapshot?.timezone ?? destinationSnapshot?.timeZone,
      updatedAt: new Date().toISOString(),
    }
  })
}
