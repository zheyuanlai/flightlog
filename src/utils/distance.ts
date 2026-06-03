import type { Airport } from '../types'

const EARTH_RADIUS_KM = 6371
type AirportWithCoordinates = Airport & { lat: number; lon: number }

function toRadians(value: number): number {
  return (value * Math.PI) / 180
}

export function haversineDistanceKm(origin: AirportWithCoordinates, destination: AirportWithCoordinates): number {
  const dLat = toRadians(destination.lat - origin.lat)
  const dLon = toRadians(destination.lon - origin.lon)
  const lat1 = toRadians(origin.lat)
  const lat2 = toRadians(destination.lat)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return Math.round(EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}
