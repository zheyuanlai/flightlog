import { DateTime } from 'luxon'
import type { FlightLogEntry } from '../types'
import { getBestDepartureTime, getFlightDepartureLocalDate } from './flightTime'
import { computeFlight } from './flights'

export interface UpcomingFlightInfo {
  flight: ReturnType<typeof computeFlight>
  departureSortMs: number
  countdownLabel: string
  isSameDay: boolean
  staleLabel?: string
  staleSeverity?: 'subtle' | 'strong'
  gateHint?: string
}

function departureInstant(flight: FlightLogEntry): DateTime | undefined {
  const departure = getBestDepartureTime(flight)
  if (!departure?.instantIso) return undefined
  const instant = DateTime.fromISO(departure.instantIso, { setZone: true }).toUTC()
  return instant.isValid ? instant : undefined
}

function originLocalNow(flight: FlightLogEntry, now: DateTime): DateTime {
  const departure = getBestDepartureTime(flight)
  return departure?.timeZone ? now.setZone(departure.timeZone) : now
}

function localDepartureDate(flight: FlightLogEntry): string {
  return getFlightDepartureLocalDate(flight)
}

export function isUpcomingOrSameDay(flight: FlightLogEntry, now: DateTime = DateTime.utc()): boolean {
  const instant = departureInstant(flight)
  const localDate = localDepartureDate(flight)
  const localToday = originLocalNow(flight, now).toISODate()
  if (instant?.isValid && instant >= now) return true
  return Boolean(localToday && localDate === localToday)
}

export function isSameDayFlight(flight: FlightLogEntry, now: DateTime = DateTime.utc()): boolean {
  const localToday = originLocalNow(flight, now).toISODate()
  return Boolean(localToday && localDepartureDate(flight) === localToday)
}

export function formatCountdown(flight: FlightLogEntry, now: DateTime = DateTime.utc()): string {
  const instant = departureInstant(flight)
  if (!instant?.isValid) return isSameDayFlight(flight, now) ? 'Departs today' : `Departs ${localDepartureDate(flight)}`
  const diff = instant.diff(now, ['days', 'hours', 'minutes'])
  if (diff.toMillis() <= 0) return isSameDayFlight(flight, now) ? 'Departs today' : 'Departure time passed'
  const days = Math.floor(diff.days)
  const hours = Math.floor(diff.hours)
  const minutes = Math.max(0, Math.round(diff.minutes))
  if (days >= 2) return `Departs in ${days} days`
  if (days === 1) return 'Departs tomorrow'
  if (hours > 0) return `Departs in ${hours}h ${minutes.toString().padStart(2, '0')}m`
  return `Departs in ${minutes}m`
}

export function flightStaleStatus(flight: FlightLogEntry, now: DateTime = DateTime.utc()): Pick<UpcomingFlightInfo, 'staleLabel' | 'staleSeverity' | 'gateHint'> {
  const sameDay = isSameDayFlight(flight, now)
  const lastFetched = flight.lastFetchedAt ? DateTime.fromISO(flight.lastFetchedAt, { setZone: true }).toUTC() : undefined
  const ageHours = lastFetched?.isValid ? now.diff(lastFetched, 'hours').hours : Number.POSITIVE_INFINITY
  const hasGate = Boolean(flight.liveStatus?.departureGate ?? flight.liveStatus?.terminalGate?.departureGate)
  return {
    staleLabel: sameDay && ageHours >= 2
      ? 'Refresh recommended'
      : ageHours >= 12
        ? 'Status may be stale'
        : undefined,
    staleSeverity: sameDay && ageHours >= 2 ? 'strong' : ageHours >= 12 ? 'subtle' : undefined,
    gateHint: sameDay && !hasGate ? 'Gate may not be assigned yet.' : undefined,
  }
}

function departureSortMs(flight: FlightLogEntry): number {
  const instant = departureInstant(flight)
  if (instant?.isValid) return instant.toMillis()
  const fallback = DateTime.fromISO(`${localDepartureDate(flight)}T00:00:00`, { zone: 'UTC' })
  return fallback.isValid ? fallback.toMillis() : Number.MAX_SAFE_INTEGER
}

export function upcomingFlightInfo(flight: FlightLogEntry, now: DateTime = DateTime.utc()): UpcomingFlightInfo | undefined {
  if (!isUpcomingOrSameDay(flight, now)) return undefined
  return {
    flight: computeFlight(flight),
    departureSortMs: departureSortMs(flight),
    countdownLabel: formatCountdown(flight, now),
    isSameDay: isSameDayFlight(flight, now),
    ...flightStaleStatus(flight, now),
  }
}

export function listUpcomingFlights(flights: FlightLogEntry[], now: DateTime = DateTime.utc()): UpcomingFlightInfo[] {
  return flights
    .map((flight) => upcomingFlightInfo(flight, now))
    .filter((flight): flight is UpcomingFlightInfo => Boolean(flight))
    .sort((a, b) => a.departureSortMs - b.departureSortMs || a.flight.flightNumber.localeCompare(b.flight.flightNumber))
}
