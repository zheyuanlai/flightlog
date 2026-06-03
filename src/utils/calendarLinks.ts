import { DateTime } from 'luxon'
import type { FlightLogEntry } from '../types'
import { externalFlightLinks } from './externalFlightLinks'
import { formatArrivalLocalTime, formatDepartureLocalTime, getCalendarStartEnd, type CalendarTimeRange } from './flightTime'
import { buildIcsEvent } from './ics'

export interface CalendarEventDetails {
  available: boolean
  reason?: string
  warning?: string
  title: string
  location: string
  description: string
  startUtc?: string
  endUtc?: string
  googleUrl?: string
  outlookUrl?: string
  ics?: string
}

function airportName(flight: FlightLogEntry, role: 'origin' | 'destination'): string {
  const code = role === 'origin' ? flight.origin : flight.destination
  const snapshot = role === 'origin' ? flight.originAirportSnapshot : flight.destinationAirportSnapshot
  const airport = role === 'origin'
    ? flight.liveStatus?.origin ?? flight.liveStatus?.departureAirport
    : flight.liveStatus?.destination ?? flight.liveStatus?.arrivalAirport
  return snapshot?.name ?? airport?.name ?? code
}

function utcForCalendarUrl(value: string): string {
  return DateTime.fromISO(value, { setZone: true }).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")
}

function encodeParams(baseUrl: string, params: Record<string, string | undefined>): string {
  const url = new URL(baseUrl)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url.toString()
}

export function calendarTitle(flight: FlightLogEntry): string {
  return `Flight ${flight.flightNumber}: ${flight.origin} -> ${flight.destination}`
}

export function calendarLocation(flight: FlightLogEntry): string {
  return `${airportName(flight, 'origin')} (${flight.origin}) -> ${airportName(flight, 'destination')} (${flight.destination})`
}

export function calendarDescription(flight: FlightLogEntry, appUrl?: string): string {
  const departure = formatDepartureLocalTime(flight)
  const arrival = formatArrivalLocalTime(flight)
  const links = externalFlightLinks(flight)
  return [
    `Flight: ${flight.flightNumber}`,
    `Airline: ${flight.airline}`,
    `Route: ${calendarLocation(flight)}`,
    `Departure: ${departure.label}`,
    departure.warning ? `Departure warning: ${departure.warning}` : undefined,
    `Arrival: ${arrival.label}`,
    arrival.warning ? `Arrival warning: ${arrival.warning}` : undefined,
    flight.liveStatus?.departureTerminal || flight.liveStatus?.departureGate
      ? `Departure terminal/gate: ${[flight.liveStatus.departureTerminal, flight.liveStatus.departureGate].filter(Boolean).join(' / ')}`
      : undefined,
    flight.liveStatus?.arrivalTerminal || flight.liveStatus?.arrivalGate || flight.liveStatus?.baggageClaim
      ? `Arrival terminal/gate/baggage: ${[flight.liveStatus.arrivalTerminal, flight.liveStatus.arrivalGate, flight.liveStatus.baggageClaim].filter(Boolean).join(' / ')}`
      : undefined,
    flight.aircraftType || flight.aircraftRegistration ? `Aircraft: ${[flight.aircraftType, flight.aircraftRegistration].filter(Boolean).join(' / ')}` : undefined,
    flight.notes ? `FlightLog note: ${flight.notes}` : undefined,
    flight.liveStatus?.provider || flight.providerFetchedAt || flight.lastFetchedAt
      ? `Provider: ${[flight.liveStatus?.provider, flight.providerFetchedAt ?? flight.lastFetchedAt].filter(Boolean).join(' / ')}`
      : undefined,
    ...links.map((link) => `${link.label}: ${link.url}`),
    appUrl ? `FlightLog: ${appUrl}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n')
}

function googleCalendarUrl(details: { title: string; location: string; description: string; startUtc: string; endUtc: string }): string {
  return encodeParams('https://calendar.google.com/calendar/render', {
    action: 'TEMPLATE',
    text: details.title,
    location: details.location,
    details: details.description,
    dates: `${utcForCalendarUrl(details.startUtc)}/${utcForCalendarUrl(details.endUtc)}`,
  })
}

function outlookCalendarUrl(details: { title: string; location: string; description: string; startUtc: string; endUtc: string }): string {
  return encodeParams('https://outlook.live.com/calendar/0/deeplink/compose', {
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: details.title,
    location: details.location,
    body: details.description,
    startdt: DateTime.fromISO(details.startUtc, { setZone: true }).toUTC().toISO() ?? details.startUtc,
    enddt: DateTime.fromISO(details.endUtc, { setZone: true }).toUTC().toISO() ?? details.endUtc,
  })
}

function unavailableDetails(flight: FlightLogEntry, range: CalendarTimeRange): CalendarEventDetails {
  return {
    available: false,
    reason: range.reason ?? 'Calendar export needs departure and arrival times.',
    title: calendarTitle(flight),
    location: calendarLocation(flight),
    description: calendarDescription(flight),
  }
}

export function buildCalendarEventDetails(flight: FlightLogEntry, appUrl?: string): CalendarEventDetails {
  const range = getCalendarStartEnd(flight)
  if (!range.available || !range.startUtc || !range.endUtc) return unavailableDetails(flight, range)
  const title = calendarTitle(flight)
  const location = calendarLocation(flight)
  const description = calendarDescription(flight, appUrl)
  const details = { title, location, description, startUtc: range.startUtc, endUtc: range.endUtc }
  return {
    available: true,
    warning: range.warning,
    ...details,
    googleUrl: googleCalendarUrl(details),
    outlookUrl: outlookCalendarUrl(details),
    ics: buildIcsEvent({
      uid: `flightlog-${flight.id}@flightlog`,
      dtstamp: DateTime.utc().toISO() ?? range.startUtc,
      dtstart: range.startUtc,
      dtend: range.endUtc,
      summary: title,
      location,
      description,
      url: appUrl,
    }),
  }
}
