import { airports } from '../data/airports'
import type { Airport } from '../types'

const airportByIata = new Map(airports.map((airport) => [airport.iata, airport]))

export function normalizeIata(value: string): string {
  return value.trim().toUpperCase()
}

export function lookupAirport(value: string): Airport | undefined {
  return airportByIata.get(normalizeIata(value))
}

export function isValidIata(value: string): boolean {
  return /^[A-Z]{3}$/.test(normalizeIata(value)) && Boolean(lookupAirport(value))
}

export function searchAirports(query: string, limit = 8): Airport[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return airports.slice(0, limit)
  return airports
    .filter((airport) =>
      [airport.iata, airport.icao, airport.name, airport.city, airport.country]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    )
    .slice(0, limit)
}
