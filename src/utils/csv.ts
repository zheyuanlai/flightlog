import * as Papa from 'papaparse'
import type { FlightLiveStatus, FlightLogEntry, FlightPurpose, FlightSource, ImportPreview, LookupDateRole, ProviderAirportSnapshot } from '../types'
import { isValidIata, normalizeIata } from './airports'

export const csvColumns = [
  'date',
  'flightNumber',
  'airline',
  'origin',
  'destination',
  'scheduledDeparture',
  'scheduledArrival',
  'actualDeparture',
  'actualArrival',
  'aircraftType',
  'aircraftRegistration',
  'cabin',
  'seat',
  'purpose',
  'notes',
  'source',
] as const

const csvExportColumns = [
  ...csvColumns,
  'scheduledDepartureLocal',
  'estimatedDepartureLocal',
  'actualDepartureLocal',
  'scheduledArrivalLocal',
  'estimatedArrivalLocal',
  'actualArrivalLocal',
  'scheduledDepartureUtc',
  'estimatedDepartureUtc',
  'actualDepartureUtc',
  'scheduledArrivalUtc',
  'estimatedArrivalUtc',
  'actualArrivalUtc',
  'originTimeZone',
  'destinationTimeZone',
  'airlineIata',
  'airlineIcao',
  'provider',
  'providerFetchedAt',
  'lookupDateRole',
  'originName',
  'destinationName',
] as const

type CsvColumn = (typeof csvColumns)[number]
type CsvExportColumn = (typeof csvExportColumns)[number]
type CsvRow = Record<CsvColumn, string> & Partial<Record<CsvExportColumn, string>>

const purposes = new Set<FlightPurpose>(['personal', 'work', 'school', 'other'])
const sources = new Set<FlightSource>(['manual', 'live-import', 'mock-live', 'aerodatabox'])
const dateRoles = new Set<LookupDateRole>(['Departure', 'Arrival'])

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanString(value: unknown): string | undefined {
  const cleaned = clean(value)
  return cleaned || undefined
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

function asLiveStatus(value: unknown): FlightLiveStatus | undefined {
  const object = asObject(value)
  return object && typeof object.status === 'string' ? object as unknown as FlightLiveStatus : undefined
}

function asAirportSnapshot(value: unknown): ProviderAirportSnapshot | undefined {
  const object = asObject(value)
  const iata = clean(object?.iata)
  return /^[A-Z]{3}$/i.test(iata) ? object as unknown as ProviderAirportSnapshot : undefined
}

export function validateFlightInput(row: Partial<Record<CsvColumn, unknown>>, rowLabel = 'Flight'): string[] {
  const errors: string[] = []
  const date = clean(row.date)
  const origin = normalizeIata(clean(row.origin))
  const destination = normalizeIata(clean(row.destination))
  const purpose = clean(row.purpose) || 'personal'
  const source = clean(row.source) || 'manual'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(`${rowLabel}: date must be YYYY-MM-DD`)
  if (!clean(row.flightNumber)) errors.push(`${rowLabel}: flightNumber is required`)
  if (!clean(row.airline)) errors.push(`${rowLabel}: airline is required`)
  if (!isValidIata(origin)) errors.push(`${rowLabel}: origin must be a valid IATA code`)
  if (!isValidIata(destination)) errors.push(`${rowLabel}: destination must be a valid IATA code`)
  if (origin && destination && origin === destination) errors.push(`${rowLabel}: origin and destination must differ`)
  if (!purposes.has(purpose as FlightPurpose)) errors.push(`${rowLabel}: purpose must be personal, work, school, or other`)
  if (!sources.has(source as FlightSource)) errors.push(`${rowLabel}: source must be manual, live-import, mock-live, or aerodatabox`)
  return errors
}

export function flightFromInput(
  row: Partial<Record<CsvExportColumn, unknown>>,
  existing?: Partial<FlightLogEntry>,
): FlightLogEntry {
  const now = new Date().toISOString()
  return {
    id: existing?.id ?? crypto.randomUUID(),
    date: clean(row.date),
    flightNumber: clean(row.flightNumber).toUpperCase().replace(/\s+/g, ''),
    airline: clean(row.airline),
    origin: normalizeIata(clean(row.origin)),
    destination: normalizeIata(clean(row.destination)),
    scheduledDeparture: clean(row.scheduledDeparture) || undefined,
    scheduledArrival: clean(row.scheduledArrival) || undefined,
    actualDeparture: clean(row.actualDeparture) || undefined,
    actualArrival: clean(row.actualArrival) || undefined,
    scheduledDepartureLocal: clean(row.scheduledDepartureLocal) || existing?.scheduledDepartureLocal,
    estimatedDepartureLocal: clean(row.estimatedDepartureLocal) || existing?.estimatedDepartureLocal,
    actualDepartureLocal: clean(row.actualDepartureLocal) || existing?.actualDepartureLocal,
    scheduledArrivalLocal: clean(row.scheduledArrivalLocal) || existing?.scheduledArrivalLocal,
    estimatedArrivalLocal: clean(row.estimatedArrivalLocal) || existing?.estimatedArrivalLocal,
    actualArrivalLocal: clean(row.actualArrivalLocal) || existing?.actualArrivalLocal,
    scheduledDepartureUtc: clean(row.scheduledDepartureUtc) || existing?.scheduledDepartureUtc,
    estimatedDepartureUtc: clean(row.estimatedDepartureUtc) || existing?.estimatedDepartureUtc,
    actualDepartureUtc: clean(row.actualDepartureUtc) || existing?.actualDepartureUtc,
    scheduledArrivalUtc: clean(row.scheduledArrivalUtc) || existing?.scheduledArrivalUtc,
    estimatedArrivalUtc: clean(row.estimatedArrivalUtc) || existing?.estimatedArrivalUtc,
    actualArrivalUtc: clean(row.actualArrivalUtc) || existing?.actualArrivalUtc,
    originTimeZone: clean(row.originTimeZone) || existing?.originTimeZone,
    destinationTimeZone: clean(row.destinationTimeZone) || existing?.destinationTimeZone,
    aircraftType: clean(row.aircraftType) || undefined,
    aircraftRegistration: clean(row.aircraftRegistration).toUpperCase() || undefined,
    cabin: clean(row.cabin) || undefined,
    seat: clean(row.seat).toUpperCase() || undefined,
    purpose: (clean(row.purpose) || 'personal') as FlightPurpose,
    notes: clean(row.notes) || undefined,
    source: (clean(row.source) || 'manual') as FlightSource,
    liveStatus: existing?.liveStatus,
    lastFetchedAt: existing?.lastFetchedAt,
    providerFlightId: existing?.providerFlightId,
    providerFetchedAt: existing?.providerFetchedAt,
    airlineIata: existing?.airlineIata,
    airlineIcao: existing?.airlineIcao,
    originAirportSnapshot: existing?.originAirportSnapshot,
    destinationAirportSnapshot: existing?.destinationAirportSnapshot,
    providerWarnings: existing?.providerWarnings,
    lookupDateRole: existing?.lookupDateRole,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

function csvValue(flight: FlightLogEntry, column: CsvExportColumn): string {
  if (column === 'provider') return flight.liveStatus?.provider ?? ''
  if (column === 'originName') return flight.originAirportSnapshot?.name ?? flight.liveStatus?.origin?.name ?? flight.liveStatus?.departureAirport?.name ?? ''
  if (column === 'destinationName') return flight.destinationAirportSnapshot?.name ?? flight.liveStatus?.destination?.name ?? flight.liveStatus?.arrivalAirport?.name ?? ''
  const value = flight[column as keyof FlightLogEntry]
  return typeof value === 'string' ? value : ''
}

export function flightsToCsv(flights: FlightLogEntry[]): string {
  return Papa.unparse(
    flights.map((flight) => Object.fromEntries(csvExportColumns.map((column) => [column, csvValue(flight, column)]))),
    { columns: [...csvExportColumns] },
  )
}

export function parseFlightsCsv(csv: string): ImportPreview {
  const parsed = Papa.parse<CsvRow>(csv, { header: true, skipEmptyLines: true })
  const valid: FlightLogEntry[] = []
  const errors: string[] = parsed.errors.map((error) => `CSV: ${error.message}`)
  parsed.data.forEach((row, index) => {
    const rowErrors = validateFlightInput(row, `Row ${index + 2}`)
    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      return
    }
    valid.push({
      ...flightFromInput(row),
      scheduledDepartureLocal: cleanString(row.scheduledDepartureLocal),
      estimatedDepartureLocal: cleanString(row.estimatedDepartureLocal),
      actualDepartureLocal: cleanString(row.actualDepartureLocal),
      scheduledArrivalLocal: cleanString(row.scheduledArrivalLocal),
      estimatedArrivalLocal: cleanString(row.estimatedArrivalLocal),
      actualArrivalLocal: cleanString(row.actualArrivalLocal),
      scheduledDepartureUtc: cleanString(row.scheduledDepartureUtc),
      estimatedDepartureUtc: cleanString(row.estimatedDepartureUtc),
      actualDepartureUtc: cleanString(row.actualDepartureUtc),
      scheduledArrivalUtc: cleanString(row.scheduledArrivalUtc),
      estimatedArrivalUtc: cleanString(row.estimatedArrivalUtc),
      actualArrivalUtc: cleanString(row.actualArrivalUtc),
      originTimeZone: cleanString(row.originTimeZone),
      destinationTimeZone: cleanString(row.destinationTimeZone),
      airlineIata: cleanString(row.airlineIata),
      airlineIcao: cleanString(row.airlineIcao),
      providerFetchedAt: cleanString(row.providerFetchedAt),
      lookupDateRole: dateRoles.has(row.lookupDateRole as LookupDateRole) ? row.lookupDateRole as LookupDateRole : undefined,
    })
  })
  return { valid, errors }
}

export function parseFlightsJson(json: string): ImportPreview {
  try {
    const parsed = JSON.parse(json) as unknown
    const rows = Array.isArray(parsed) ? parsed : (parsed as { flights?: unknown }).flights
    if (!Array.isArray(rows)) return { valid: [], errors: ['JSON must be an array or an object with a flights array'] }
    const valid: FlightLogEntry[] = []
    const errors: string[] = []
    rows.forEach((row, index) => {
      if (!row || typeof row !== 'object') {
        errors.push(`Item ${index + 1}: must be an object`)
        return
      }
      const input = row as Partial<Record<CsvColumn, unknown>> & Partial<FlightLogEntry>
      const rowErrors = validateFlightInput(input, `Item ${index + 1}`)
      if (rowErrors.length > 0) {
        errors.push(...rowErrors)
        return
      }
      const base = flightFromInput(input, {
        id: cleanString(input.id) ?? crypto.randomUUID(),
        createdAt: cleanString(input.createdAt) ?? new Date().toISOString(),
      })
      valid.push({
        ...base,
        updatedAt: cleanString(input.updatedAt) ?? base.updatedAt,
        scheduledDepartureLocal: cleanString(input.scheduledDepartureLocal) ?? base.scheduledDepartureLocal,
        estimatedDepartureLocal: cleanString(input.estimatedDepartureLocal) ?? base.estimatedDepartureLocal,
        actualDepartureLocal: cleanString(input.actualDepartureLocal) ?? base.actualDepartureLocal,
        scheduledArrivalLocal: cleanString(input.scheduledArrivalLocal) ?? base.scheduledArrivalLocal,
        estimatedArrivalLocal: cleanString(input.estimatedArrivalLocal) ?? base.estimatedArrivalLocal,
        actualArrivalLocal: cleanString(input.actualArrivalLocal) ?? base.actualArrivalLocal,
        scheduledDepartureUtc: cleanString(input.scheduledDepartureUtc) ?? base.scheduledDepartureUtc,
        estimatedDepartureUtc: cleanString(input.estimatedDepartureUtc) ?? base.estimatedDepartureUtc,
        actualDepartureUtc: cleanString(input.actualDepartureUtc) ?? base.actualDepartureUtc,
        scheduledArrivalUtc: cleanString(input.scheduledArrivalUtc) ?? base.scheduledArrivalUtc,
        estimatedArrivalUtc: cleanString(input.estimatedArrivalUtc) ?? base.estimatedArrivalUtc,
        actualArrivalUtc: cleanString(input.actualArrivalUtc) ?? base.actualArrivalUtc,
        originTimeZone: cleanString(input.originTimeZone) ?? base.originTimeZone,
        destinationTimeZone: cleanString(input.destinationTimeZone) ?? base.destinationTimeZone,
        liveStatus: asLiveStatus(input.liveStatus),
        lastFetchedAt: cleanString(input.lastFetchedAt),
        providerFlightId: cleanString(input.providerFlightId),
        providerFetchedAt: cleanString(input.providerFetchedAt),
        airlineIata: cleanString(input.airlineIata),
        airlineIcao: cleanString(input.airlineIcao),
        originAirportSnapshot: asAirportSnapshot(input.originAirportSnapshot),
        destinationAirportSnapshot: asAirportSnapshot(input.destinationAirportSnapshot),
        providerWarnings: asStringArray(input.providerWarnings),
        lookupDateRole: dateRoles.has(input.lookupDateRole as LookupDateRole) ? input.lookupDateRole : undefined,
        deletedAt: cleanString(input.deletedAt),
        deletedByDeviceId: cleanString(input.deletedByDeviceId),
        deleteReason: cleanString(input.deleteReason),
        restoredAt: cleanString(input.restoredAt),
        tombstoneVersion: typeof input.tombstoneVersion === 'number' ? input.tombstoneVersion : undefined,
        lastOperation: input.lastOperation === 'create' || input.lastOperation === 'update' || input.lastOperation === 'delete' || input.lastOperation === 'restore' ? input.lastOperation : undefined,
      })
    })
    return { valid, errors }
  } catch (error) {
    return { valid: [], errors: [error instanceof Error ? error.message : 'Invalid JSON'] }
  }
}
