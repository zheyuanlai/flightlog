import type { FlightLogEntry } from '../types'
import { getFlightDepartureLocalDate } from './flightTime'
import { normalizeFlightNumber } from './liveStatus'

export interface ExternalFlightLink {
  label: string
  url: string
}

function flightSearchParts(flight: FlightLogEntry): string[] {
  return [
    normalizeFlightNumber(flight.flightNumber),
    getFlightDepartureLocalDate(flight),
    flight.origin,
    flight.destination,
    flight.airlineIata,
    flight.airlineIcao,
  ].filter((part): part is string => Boolean(part))
}

export function externalFlightLinks(flight: FlightLogEntry): ExternalFlightLink[] {
  const normalized = normalizeFlightNumber(flight.flightNumber)
  const lower = normalized.toLowerCase()
  const query = `${flightSearchParts(flight).join(' ')} flight status`.trim()
  const googleQuery = query || `${flight.flightNumber} flight status`

  return [
    {
      label: 'FlightAware',
      url: normalized
        ? `https://flightaware.com/live/flight/${encodeURIComponent(normalized)}`
        : `https://flightaware.com/search/?q=${encodeURIComponent(googleQuery)}`,
    },
    {
      label: 'Flightradar24',
      url: normalized
        ? `https://www.flightradar24.com/data/flights/${encodeURIComponent(lower)}`
        : `https://www.flightradar24.com/search/${encodeURIComponent(googleQuery)}`,
    },
    {
      label: 'Google flight status search',
      url: `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}`,
    },
  ]
}
