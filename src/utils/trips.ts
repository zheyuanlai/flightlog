import { DateTime } from 'luxon'
import type { FlightLogEntry, FlightWithComputed, TripMetadata } from '../types'
import { getBestDepartureTime, getFlightDepartureLocalDate } from './flightTime'
import { computeFlight } from './flights'

export interface TripGroup {
  id: string
  name: string
  flights: FlightWithComputed[]
  startDate: string
  endDate: string
  routeSummary: string
  distanceKm: number
  airports: string[]
  countries: string[]
  metadata?: TripMetadata
  notes?: string
  type: TripMetadata['type']
  isFavorite: boolean
  isManual: boolean
  warning?: string
}

interface SortableFlight {
  flight: FlightWithComputed
  departure: { instantMs: number; warning?: string }
}

function sortableDeparture(flight: FlightLogEntry): { instantMs: number; warning?: string } {
  const departure = getBestDepartureTime(flight)
  if (departure?.instantIso) {
    const instant = DateTime.fromISO(departure.instantIso, { setZone: true }).toUTC()
    if (instant.isValid) return { instantMs: instant.toMillis(), warning: departure.warning }
  }
  const fallback = DateTime.fromISO(`${getFlightDepartureLocalDate(flight)}T00:00:00`, { zone: 'UTC' })
  return {
    instantMs: fallback.isValid ? fallback.toMillis() : 0,
    warning: 'Some trip ordering used local date fallback because absolute departure time was unavailable.',
  }
}

function stableTripId(flights: FlightLogEntry[]): string {
  return flights.map((flight) => flight.id).sort().join('-').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 80)
}

function routeSummary(flights: FlightWithComputed[]): string {
  if (flights.length === 0) return ''
  return [flights[0].origin, ...flights.map((flight) => flight.destination)].join(' -> ')
}

function compareSortable(a: SortableFlight, b: SortableFlight): number {
  return a.departure.instantMs - b.departure.instantMs || a.flight.flightNumber.localeCompare(b.flight.flightNumber)
}

function metadataCreatedMs(metadata: TripMetadata): number {
  const created = DateTime.fromISO(metadata.createdAt, { setZone: true })
  return created.isValid ? created.toUTC().toMillis() : 0
}

function buildTripGroup(items: SortableFlight[], id: string, metadata: TripMetadata | undefined, fallbackName: string, isManual: boolean): { group: TripGroup; sortMs: number } {
  const tripFlights = items.map((item) => item.flight)
  const createdDate = metadata ? metadata.createdAt.slice(0, 10) : ''
  const startDate = tripFlights.length > 0 ? getFlightDepartureLocalDate(tripFlights[0]) : createdDate
  const endDate = tripFlights.length > 0 ? getFlightDepartureLocalDate(tripFlights.at(-1) ?? tripFlights[0]) : createdDate
  const airports = [...new Set(tripFlights.flatMap((flight) => [flight.origin, flight.destination]))]
  const countries = [...new Set(tripFlights.flatMap((flight) => [flight.originAirport?.country, flight.destinationAirport?.country]).filter((country): country is string => Boolean(country)))].sort()
  const warning = items.map((item) => item.departure.warning).find(Boolean)
  const sortMs = items[0]?.departure.instantMs ?? (metadata ? metadataCreatedMs(metadata) : 0)
  return {
    sortMs,
    group: {
      id,
      name: metadata?.name ?? fallbackName,
      flights: tripFlights,
      startDate,
      endDate,
      routeSummary: routeSummary(tripFlights),
      distanceKm: tripFlights.reduce((sum, flight) => sum + flight.distanceKm, 0),
      airports,
      countries,
      metadata,
      notes: metadata?.notes,
      type: metadata?.type ?? 'personal',
      isFavorite: metadata?.isFavorite ?? false,
      isManual,
      warning,
    },
  }
}

export function groupFlightsIntoTrips(flights: FlightLogEntry[], metadata: TripMetadata[] = []): TripGroup[] {
  const activeMetadata = metadata.filter((item) => !item.deletedAt)
  const metadataById = new Map(activeMetadata.map((item) => [item.id, item]))
  const manualTrips = activeMetadata
    .filter((item) => item.isManual)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))

  const claimedBy = new Map<string, string>()
  for (const manual of manualTrips) {
    for (const flightId of manual.flightIds ?? []) {
      if (!claimedBy.has(flightId)) claimedBy.set(flightId, manual.id)
    }
  }

  const sortableById = new Map<string, SortableFlight>(
    flights.map((flight) => [flight.id, { flight: computeFlight(flight), departure: sortableDeparture(flight) }]),
  )

  const manualGroups = manualTrips.map((manual) => {
    const members = (manual.flightIds ?? [])
      .filter((flightId) => claimedBy.get(flightId) === manual.id)
      .map((flightId) => sortableById.get(flightId))
      .filter((item): item is SortableFlight => Boolean(item))
      .sort(compareSortable)
    return buildTripGroup(members, manual.id, manual, 'Untitled trip', true)
  })

  const autoSorted = flights
    .filter((flight) => !claimedBy.has(flight.id))
    .map((flight) => sortableById.get(flight.id))
    .filter((item): item is SortableFlight => Boolean(item))
    .sort(compareSortable)

  const autoBuckets: SortableFlight[][] = []
  for (const item of autoSorted) {
    const current = autoBuckets.at(-1)
    const previous = current?.at(-1)
    if (!current || !previous || item.departure.instantMs - previous.departure.instantMs > 3 * 24 * 60 * 60 * 1000) {
      autoBuckets.push([item])
    } else {
      current.push(item)
    }
  }

  const autoGroups = autoBuckets.map((items, index) => {
    const id = stableTripId(items.map((item) => item.flight)) || `trip-${index + 1}`
    return buildTripGroup(items, id, metadataById.get(id), `Trip ${index + 1}`, false)
  })

  return [...manualGroups, ...autoGroups]
    .sort((a, b) => a.sortMs - b.sortMs || a.group.id.localeCompare(b.group.id))
    .map((item) => item.group)
}
