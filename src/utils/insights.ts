import { DateTime } from 'luxon'
import type { FlightLogEntry } from '../types'
import { resolveFlightTime } from './flightTime'
import { routeKey } from './flights'
import { airlineDisplayName } from './airlines'

export const ON_TIME_THRESHOLD_MINUTES = 15

export interface PunctualityStat {
  key: string
  label: string
  flights: number
  onTimeCount: number
  onTimePercent: number
  averageDelayMinutes: number
  medianDelayMinutes: number
  worstDelayMinutes: number
}

export interface RouteDelaySummary {
  route: string
  measuredFlights: number
  onTimePercent: number
  averageDelayMinutes: number
}

export interface OverallPunctuality {
  measuredFlights: number
  onTimePercent: number
  averageDelayMinutes: number
}

type FlightDirection = 'departure' | 'arrival'

function instantMs(flight: FlightLogEntry, kind: 'scheduled' | 'actual', direction: FlightDirection): number | undefined {
  const time = resolveFlightTime(flight, kind, direction)
  if (!time?.instantIso || !time.isReliable) return undefined
  const dateTime = DateTime.fromISO(time.instantIso, { setZone: true })
  return dateTime.isValid ? dateTime.toUTC().toMillis() : undefined
}

/** Minutes late (positive) or early (negative), or undefined without reliable scheduled+actual instants. */
export function flightDelayMinutes(flight: FlightLogEntry, direction: FlightDirection = 'departure'): number | undefined {
  if (flight.deletedAt) return undefined
  const scheduled = instantMs(flight, 'scheduled', direction)
  const actual = instantMs(flight, 'actual', direction)
  if (scheduled === undefined || actual === undefined) return undefined
  return Math.round((actual - scheduled) / 60000)
}

function buildPunctuality(entries: Array<{ key: string; label: string; delay: number }>): PunctualityStat[] {
  const groups = new Map<string, { label: string; delays: number[] }>()
  for (const entry of entries) {
    const group = groups.get(entry.key) ?? { label: entry.label, delays: [] }
    group.delays.push(entry.delay)
    groups.set(entry.key, group)
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const delays = group.delays.slice().sort((a, b) => a - b)
      const flights = delays.length
      const onTimeCount = delays.filter((delay) => delay <= ON_TIME_THRESHOLD_MINUTES).length
      const sum = delays.reduce((total, delay) => total + delay, 0)
      return {
        key,
        label: group.label,
        flights,
        onTimeCount,
        onTimePercent: Math.round((onTimeCount / flights) * 100),
        averageDelayMinutes: Math.round(sum / flights),
        medianDelayMinutes: flights % 2 ? delays[(flights - 1) / 2] : Math.round((delays[flights / 2 - 1] + delays[flights / 2]) / 2),
        worstDelayMinutes: delays[flights - 1],
      }
    })
    .sort((a, b) => b.flights - a.flights || b.onTimePercent - a.onTimePercent || a.label.localeCompare(b.label))
}

function delayEntries(flights: FlightLogEntry[], direction: FlightDirection, keyOf: (flight: FlightLogEntry) => { key: string; label: string }): Array<{ key: string; label: string; delay: number }> {
  const entries: Array<{ key: string; label: string; delay: number }> = []
  for (const flight of flights) {
    const delay = flightDelayMinutes(flight, direction)
    if (delay === undefined) continue
    const { key, label } = keyOf(flight)
    entries.push({ key, label, delay })
  }
  return entries
}

export function airlinePunctuality(flights: FlightLogEntry[], direction: FlightDirection = 'departure'): PunctualityStat[] {
  return buildPunctuality(delayEntries(flights, direction, (flight) => {
    const label = airlineDisplayName(flight.airline) || flight.airline || 'Unknown airline'
    return { key: label, label }
  }))
}

export function routePunctuality(flights: FlightLogEntry[], direction: FlightDirection = 'departure'): PunctualityStat[] {
  return buildPunctuality(delayEntries(flights, direction, (flight) => {
    const route = routeKey(flight)
    return { key: route, label: route }
  }))
}

export function airportDeparturePunctuality(flights: FlightLogEntry[]): PunctualityStat[] {
  return buildPunctuality(delayEntries(flights, 'departure', (flight) => ({ key: flight.origin, label: flight.origin })))
}

export function overallPunctuality(flights: FlightLogEntry[], direction: FlightDirection = 'departure'): OverallPunctuality | undefined {
  const delays = flights.map((flight) => flightDelayMinutes(flight, direction)).filter((delay): delay is number => delay !== undefined)
  if (delays.length === 0) return undefined
  const onTime = delays.filter((delay) => delay <= ON_TIME_THRESHOLD_MINUTES).length
  return {
    measuredFlights: delays.length,
    onTimePercent: Math.round((onTime / delays.length) * 100),
    averageDelayMinutes: Math.round(delays.reduce((total, delay) => total + delay, 0) / delays.length),
  }
}

/** Departure-delay history for the route of `flight`, across all flights (including it). */
export function routeDelayHistory(flights: FlightLogEntry[], flight: FlightLogEntry): RouteDelaySummary | undefined {
  const route = routeKey(flight)
  const delays = flights
    .filter((candidate) => routeKey(candidate) === route)
    .map((candidate) => flightDelayMinutes(candidate, 'departure'))
    .filter((delay): delay is number => delay !== undefined)
  if (delays.length === 0) return undefined
  const onTime = delays.filter((delay) => delay <= ON_TIME_THRESHOLD_MINUTES).length
  return {
    route,
    measuredFlights: delays.length,
    onTimePercent: Math.round((onTime / delays.length) * 100),
    averageDelayMinutes: Math.round(delays.reduce((total, delay) => total + delay, 0) / delays.length),
  }
}

export function formatDelayLabel(minutes: number): string {
  if (minutes <= 0) return minutes === 0 ? 'on time' : `${Math.abs(minutes)}m early`
  return `${minutes}m late`
}

type LatLon = [number, number]

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180
const toDegrees = (radians: number): number => (radians * 180) / Math.PI

/**
 * Points along the great-circle (shortest-path) arc between two coordinates,
 * with longitudes unwrapped so the polyline stays continuous across the
 * antimeridian instead of drawing a straight line across the whole map.
 */
export function greatCircleArc(start: LatLon, end: LatLon, segments = 64): LatLon[] {
  const phi1 = toRadians(start[0])
  const lambda1 = toRadians(start[1])
  const phi2 = toRadians(end[0])
  const lambda2 = toRadians(end[1])
  const v0: [number, number, number] = [Math.cos(phi1) * Math.cos(lambda1), Math.cos(phi1) * Math.sin(lambda1), Math.sin(phi1)]
  const v1: [number, number, number] = [Math.cos(phi2) * Math.cos(lambda2), Math.cos(phi2) * Math.sin(lambda2), Math.sin(phi2)]
  const dot = Math.max(-1, Math.min(1, v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2]))
  const omega = Math.acos(dot)
  if (omega < 1e-9) return [start, end]
  const sinOmega = Math.sin(omega)
  const steps = Math.max(2, Math.floor(segments))
  const points: LatLon[] = []
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    const a = Math.sin((1 - t) * omega) / sinOmega
    const b = Math.sin(t * omega) / sinOmega
    const x = a * v0[0] + b * v1[0]
    const y = a * v0[1] + b * v1[1]
    const z = a * v0[2] + b * v1[2]
    const lat = toDegrees(Math.atan2(z, Math.sqrt(x * x + y * y)))
    const lon = toDegrees(Math.atan2(y, x))
    points.push([lat, lon])
  }
  for (let index = 1; index < points.length; index += 1) {
    const delta = points[index][1] - points[index - 1][1]
    if (delta > 180) points[index][1] -= 360
    else if (delta < -180) points[index][1] += 360
  }
  return points
}
