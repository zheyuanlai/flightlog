import { DateTime } from 'luxon'
import type { DateFormat, FlightLogEntry, FlightLiveStatus, FlightLiveTimes, TimeFormat } from '../types'
import { resolveFlightAirport } from './airports'

type FlightDirection = 'departure' | 'arrival'
type FlightTimeKind = 'scheduled' | 'estimated' | 'actual'

export interface FormattedAirportTime {
  label: string
  localLabel: string
  airportCode?: string
  timeZone?: string
  kind?: FlightTimeKind
  local?: string
  utc?: string
  instantIso?: string
  warning?: string
  isReliable: boolean
}

export interface CalendarTimeRange {
  available: boolean
  startUtc?: string
  endUtc?: string
  start?: FormattedAirportTime
  end?: FormattedAirportTime
  warning?: string
  reason?: string
  usedDefaultDuration?: boolean
}

export interface FlightTimeDisplayOptions {
  dateFormat?: DateFormat
  timeFormat?: TimeFormat
}

const timezoneWarning = 'Timezone unavailable; shown as provider local time.'

function normalizeDateTimeInput(value?: string): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.replace(' ', 'T')
}

function hasExplicitOffset(value: string): boolean {
  return /(Z|[+-]\d{2}:?\d{2})$/i.test(value)
}

function isValidTimeZone(timeZone?: string): boolean {
  if (!timeZone) return false
  return DateTime.local().setZone(timeZone).isValid
}

function displayDateTime(dateTime: DateTime, options: FlightTimeDisplayOptions = {}): string {
  const datePart = options.dateFormat === 'compact'
    ? dateTime.toFormat('M/d/yy')
    : options.dateFormat === 'iso'
    ? dateTime.toFormat('yyyy-MM-dd')
    : dateTime.toFormat('ccc, LLL d')
  const timePart = options.timeFormat === '12h'
    ? dateTime.toFormat('h:mm a')
    : dateTime.toFormat('HH:mm')
  return `${datePart}, ${timePart}`
}

function displayRawLocal(value: string): string {
  const normalized = normalizeDateTimeInput(value) ?? value
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/)
  if (!match) return value
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}`
}

function directionTitle(direction: FlightDirection): 'Departure' | 'Arrival' {
  return direction === 'departure' ? 'Departure' : 'Arrival'
}

function fieldName(kind: FlightTimeKind, direction: FlightDirection, suffix = ''): keyof FlightLogEntry {
  return `${kind}${directionTitle(direction)}${suffix}` as keyof FlightLogEntry
}

function flightTimeZone(flight: FlightLogEntry, direction: FlightDirection): string | undefined {
  const explicit = direction === 'departure' ? flight.originTimeZone : flight.destinationTimeZone
  if (explicit) return explicit
  const snapshot = direction === 'departure' ? flight.originAirportSnapshot : flight.destinationAirportSnapshot
  const liveAirport = direction === 'departure'
    ? flight.liveStatus?.origin ?? flight.liveStatus?.departureAirport
    : flight.liveStatus?.destination ?? flight.liveStatus?.arrivalAirport
  return snapshot?.timezone
    ?? snapshot?.timeZone
    ?? liveAirport?.timezone
    ?? liveAirport?.timeZone
    ?? resolveFlightAirport(flight, direction === 'departure' ? 'origin' : 'destination')?.timezone
    ?? resolveFlightAirport(flight, direction === 'departure' ? 'origin' : 'destination')?.timeZone
}

function airportCode(flight: FlightLogEntry, direction: FlightDirection): string {
  return direction === 'departure' ? flight.origin : flight.destination
}

function liveFlatTime(liveStatus: FlightLiveStatus | undefined, kind: FlightTimeKind, direction: FlightDirection, suffix: 'Local' | 'Utc' | ''): string | undefined {
  if (!liveStatus) return undefined
  return liveStatus[fieldName(kind, direction, suffix) as keyof FlightLiveStatus] as string | undefined
}

function liveNestedTime(times: FlightLiveTimes | undefined, kind: FlightTimeKind, direction: FlightDirection, suffix: 'Local' | 'Utc' | ''): string | undefined {
  if (!times) return undefined
  return times[fieldName(kind, direction, suffix) as keyof FlightLiveTimes] as string | undefined
}

function readTimeValue(flight: FlightLogEntry, kind: FlightTimeKind, direction: FlightDirection, suffix: 'Local' | 'Utc' | ''): string | undefined {
  const flightValue = flight[fieldName(kind, direction, suffix)] as string | undefined
  const liveValue = liveFlatTime(flight.liveStatus, kind, direction, suffix)
  const nestedValue = liveNestedTime(flight.liveStatus?.times, kind, direction, suffix)
  if (suffix === 'Local') {
    return flightValue
      ?? liveValue
      ?? nestedValue
      ?? (flight[fieldName(kind, direction)] as string | undefined)
      ?? liveFlatTime(flight.liveStatus, kind, direction, '')
      ?? liveNestedTime(flight.liveStatus?.times, kind, direction, '')
  }
  return flightValue ?? liveValue ?? nestedValue
}

export function resolveFlightTime(flight: FlightLogEntry, kind: FlightTimeKind, direction: FlightDirection, options: FlightTimeDisplayOptions = {}): FormattedAirportTime | undefined {
  const local = normalizeDateTimeInput(readTimeValue(flight, kind, direction, 'Local'))
  const utc = normalizeDateTimeInput(readTimeValue(flight, kind, direction, 'Utc'))
  const code = airportCode(flight, direction)
  const timeZone = flightTimeZone(flight, direction)
  const validZone = isValidTimeZone(timeZone) ? timeZone : undefined

  if (!local && !utc) return undefined

  if (utc) {
    const utcDateTime = DateTime.fromISO(utc, { setZone: true })
    if (utcDateTime.isValid) {
      if (validZone) {
        const airportTime = utcDateTime.toUTC().setZone(validZone)
        return {
          label: `${displayDateTime(airportTime, options)} · ${code} local`,
          localLabel: `${displayDateTime(airportTime, options)} · ${code} local`,
          airportCode: code,
          timeZone: validZone,
          kind,
          local,
          utc: utcDateTime.toUTC().toISO() ?? utc,
          instantIso: utcDateTime.toUTC().toISO() ?? utc,
          isReliable: true,
        }
      }
      if (local) {
        const localWithOffset = DateTime.fromISO(local, { setZone: true })
        const label = localWithOffset.isValid && hasExplicitOffset(local)
          ? `${displayDateTime(localWithOffset, options)} · ${code} provider local`
          : `${displayRawLocal(local)} · ${code} provider local`
        return {
          label,
          localLabel: label,
          airportCode: code,
          kind,
          local,
          utc: utcDateTime.toUTC().toISO() ?? utc,
          instantIso: utcDateTime.toUTC().toISO() ?? utc,
          isReliable: true,
        }
      }
      const label = `${displayDateTime(utcDateTime.toUTC(), options)} · UTC`
      return {
        label,
        localLabel: label,
        airportCode: code,
        kind,
        utc: utcDateTime.toUTC().toISO() ?? utc,
        instantIso: utcDateTime.toUTC().toISO() ?? utc,
        isReliable: true,
      }
    }
  }

  if (!local) return undefined

  if (validZone) {
    const localDateTime = hasExplicitOffset(local)
      ? DateTime.fromISO(local, { setZone: true }).setZone(validZone)
      : DateTime.fromISO(local, { zone: validZone })
    if (localDateTime.isValid) {
      return {
        label: `${displayDateTime(localDateTime, options)} · ${code} local`,
        localLabel: `${displayDateTime(localDateTime, options)} · ${code} local`,
        airportCode: code,
        timeZone: validZone,
        kind,
        local,
        utc: localDateTime.toUTC().toISO() ?? undefined,
        instantIso: localDateTime.toUTC().toISO() ?? undefined,
        isReliable: true,
      }
    }
  }

  if (hasExplicitOffset(local)) {
    const offsetDateTime = DateTime.fromISO(local, { setZone: true })
    if (offsetDateTime.isValid) {
      return {
        label: `${displayDateTime(offsetDateTime, options)} · ${code} provider local`,
        localLabel: `${displayDateTime(offsetDateTime, options)} · ${code} provider local`,
        airportCode: code,
        kind,
        local,
        utc: offsetDateTime.toUTC().toISO() ?? undefined,
        instantIso: offsetDateTime.toUTC().toISO() ?? undefined,
        isReliable: true,
      }
    }
  }

  const label = `${displayRawLocal(local)} · ${code} provider local`
  return {
    label,
    localLabel: label,
    airportCode: code,
    kind,
    local,
    warning: timezoneWarning,
    isReliable: false,
  }
}

function bestTime(flight: FlightLogEntry, direction: FlightDirection, options: FlightTimeDisplayOptions = {}): FormattedAirportTime | undefined {
  return resolveFlightTime(flight, 'actual', direction, options)
    ?? resolveFlightTime(flight, 'estimated', direction, options)
    ?? resolveFlightTime(flight, 'scheduled', direction, options)
}

export function getBestDepartureTime(flight: FlightLogEntry, options: FlightTimeDisplayOptions = {}): FormattedAirportTime | undefined {
  return bestTime(flight, 'departure', options)
}

export function getBestArrivalTime(flight: FlightLogEntry, options: FlightTimeDisplayOptions = {}): FormattedAirportTime | undefined {
  return bestTime(flight, 'arrival', options)
}

export function formatAirportLocalTime(isoOrLocalTime: string | undefined, airportTimeZone: string | undefined, fallbackLabel = 'Airport local', utcTime?: string, options: FlightTimeDisplayOptions = {}): FormattedAirportTime {
  const local = normalizeDateTimeInput(isoOrLocalTime)
  const utc = normalizeDateTimeInput(utcTime)
  const utcDateTime = utc ? DateTime.fromISO(utc, { setZone: true }) : undefined
  if (!local) {
    if (utcDateTime?.isValid) {
      const label = `${displayDateTime(utcDateTime.toUTC(), options)} · UTC`
      return { label, localLabel: label, utc: utcDateTime.toUTC().toISO() ?? utc, instantIso: utcDateTime.toUTC().toISO() ?? utc, isReliable: true }
    }
    return { label: 'Not set', localLabel: 'Not set', warning: timezoneWarning, isReliable: false }
  }
  const validZone = isValidTimeZone(airportTimeZone) ? airportTimeZone : undefined
  if (validZone) {
    const dateTime = utcDateTime?.isValid
      ? utcDateTime.toUTC().setZone(validZone)
      : hasExplicitOffset(local)
      ? DateTime.fromISO(local, { setZone: true }).setZone(validZone)
      : DateTime.fromISO(local, { zone: validZone })
    if (dateTime.isValid) {
      return {
        label: `${displayDateTime(dateTime, options)} · ${fallbackLabel}`,
        localLabel: `${displayDateTime(dateTime, options)} · ${fallbackLabel}`,
        timeZone: validZone,
        local,
        utc: dateTime.toUTC().toISO() ?? undefined,
        instantIso: dateTime.toUTC().toISO() ?? undefined,
        isReliable: true,
      }
    }
  }
  if (utcDateTime?.isValid) {
    const localWithOffset = DateTime.fromISO(local, { setZone: true })
    const label = localWithOffset.isValid && hasExplicitOffset(local)
      ? `${displayDateTime(localWithOffset, options)} · provider local`
      : `${displayRawLocal(local)} · provider local`
    return {
      label,
      localLabel: label,
      local,
      utc: utcDateTime.toUTC().toISO() ?? utc,
      instantIso: utcDateTime.toUTC().toISO() ?? utc,
      isReliable: true,
    }
  }
  if (hasExplicitOffset(local)) {
    const dateTime = DateTime.fromISO(local, { setZone: true })
    if (dateTime.isValid) {
      return {
        label: `${displayDateTime(dateTime, options)} · provider local`,
        localLabel: `${displayDateTime(dateTime, options)} · provider local`,
        local,
        utc: dateTime.toUTC().toISO() ?? undefined,
        instantIso: dateTime.toUTC().toISO() ?? undefined,
        isReliable: true,
      }
    }
  }
  return {
    label: `${displayRawLocal(local)} · provider local`,
    localLabel: `${displayRawLocal(local)} · provider local`,
    local,
    warning: timezoneWarning,
    isReliable: false,
  }
}

export function formatDepartureLocalTime(flight: FlightLogEntry, options: { kind?: FlightTimeKind } & FlightTimeDisplayOptions = {}): FormattedAirportTime {
  return (options.kind ? resolveFlightTime(flight, options.kind, 'departure', options) : getBestDepartureTime(flight, options))
    ?? { label: 'Not set', localLabel: 'Not set', airportCode: flight.origin, isReliable: false }
}

export function formatArrivalLocalTime(flight: FlightLogEntry, options: { kind?: FlightTimeKind } & FlightTimeDisplayOptions = {}): FormattedAirportTime {
  return (options.kind ? resolveFlightTime(flight, options.kind, 'arrival', options) : getBestArrivalTime(flight, options))
    ?? { label: 'Not set', localLabel: 'Not set', airportCode: flight.destination, isReliable: false }
}

function calendarStart(flight: FlightLogEntry): FormattedAirportTime | undefined {
  return resolveFlightTime(flight, 'scheduled', 'departure')
    ?? resolveFlightTime(flight, 'estimated', 'departure')
    ?? (flight.liveStatus?.status === 'landed' ? resolveFlightTime(flight, 'actual', 'departure') : undefined)
}

function calendarEnd(flight: FlightLogEntry): FormattedAirportTime | undefined {
  return resolveFlightTime(flight, 'scheduled', 'arrival')
    ?? resolveFlightTime(flight, 'estimated', 'arrival')
    ?? (flight.liveStatus?.status === 'landed' ? resolveFlightTime(flight, 'actual', 'arrival') : undefined)
}

export function getCalendarStartEnd(flight: FlightLogEntry): CalendarTimeRange {
  const start = calendarStart(flight)
  const end = calendarEnd(flight)
  if (!start?.instantIso || !start.isReliable) {
    return { available: false, start, end, reason: 'Calendar export needs departure and arrival times.' }
  }
  const startDateTime = DateTime.fromISO(start.instantIso, { setZone: true }).toUTC()
  if (!startDateTime.isValid) return { available: false, start, end, reason: 'Calendar export needs reliable departure time.' }

  if (!end?.instantIso || !end.isReliable) {
    return {
      available: true,
      startUtc: startDateTime.toISO() ?? undefined,
      endUtc: startDateTime.plus({ hours: 2 }).toISO() ?? undefined,
      start,
      end,
      warning: 'Arrival time unavailable; calendar export uses a 2 hour default duration.',
      usedDefaultDuration: true,
    }
  }

  const endDateTime = DateTime.fromISO(end.instantIso, { setZone: true }).toUTC()
  if (!endDateTime.isValid || endDateTime <= startDateTime) {
    return { available: false, start, end, reason: 'Calendar export needs departure and arrival times.' }
  }

  return {
    available: true,
    startUtc: startDateTime.toISO() ?? undefined,
    endUtc: endDateTime.toISO() ?? undefined,
    start,
    end,
    warning: start.warning ?? end.warning,
  }
}

export function getFlightDurationMinutes(flight: FlightLogEntry): number | undefined {
  const range = getCalendarStartEnd(flight)
  if (!range.startUtc || !range.endUtc || range.usedDefaultDuration) return undefined
  const start = DateTime.fromISO(range.startUtc, { setZone: true })
  const end = DateTime.fromISO(range.endUtc, { setZone: true })
  if (!start.isValid || !end.isValid || end <= start) return undefined
  return Math.round(end.diff(start, 'minutes').minutes)
}

export function getFlightDepartureLocalDate(flight: FlightLogEntry): string {
  const departure = resolveFlightTime(flight, 'scheduled', 'departure')
    ?? resolveFlightTime(flight, 'estimated', 'departure')
    ?? resolveFlightTime(flight, 'actual', 'departure')
  if (departure?.instantIso && departure.timeZone) {
    const dateTime = DateTime.fromISO(departure.instantIso, { setZone: true }).setZone(departure.timeZone)
    if (dateTime.isValid) return dateTime.toISODate() ?? flight.date
  }
  if (departure?.local) return departure.local.slice(0, 10)
  return flight.date
}

export function getFlightTimeZone(flight: FlightLogEntry, direction: FlightDirection): string | undefined {
  const zone = flightTimeZone(flight, direction)
  return isValidTimeZone(zone) ? zone : undefined
}

export function isFutureOrSameDayFlight(flight: FlightLogEntry, now: DateTime = DateTime.utc()): boolean {
  const departure = getBestDepartureTime(flight)
  if (departure?.instantIso) {
    const instant = DateTime.fromISO(departure.instantIso, { setZone: true })
    return instant.isValid ? instant >= now.minus({ hours: 12 }) : false
  }
  const localDate = getFlightDepartureLocalDate(flight)
  return localDate >= (now.toISODate() ?? localDate)
}
