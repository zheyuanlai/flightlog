import * as Papa from 'papaparse'
import type { FlightLogEntry, FlightPurpose, FlightSource, ImportPreview } from '../types'
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

type CsvColumn = (typeof csvColumns)[number]
type CsvRow = Record<CsvColumn, string>

const purposes = new Set<FlightPurpose>(['personal', 'work', 'school', 'other'])
const sources = new Set<FlightSource>(['manual', 'live-import'])

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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
  if (!isValidIata(origin)) errors.push(`${rowLabel}: origin must be a valid bundled IATA code`)
  if (!isValidIata(destination)) errors.push(`${rowLabel}: destination must be a valid bundled IATA code`)
  if (origin && destination && origin === destination) errors.push(`${rowLabel}: origin and destination must differ`)
  if (!purposes.has(purpose as FlightPurpose)) errors.push(`${rowLabel}: purpose must be personal, work, school, or other`)
  if (!sources.has(source as FlightSource)) errors.push(`${rowLabel}: source must be manual or live-import`)
  return errors
}

export function flightFromInput(
  row: Partial<Record<CsvColumn, unknown>>,
  existing?: Pick<FlightLogEntry, 'id' | 'createdAt'>,
): FlightLogEntry {
  const now = new Date().toISOString()
  return {
    id: existing?.id ?? crypto.randomUUID(),
    date: clean(row.date),
    flightNumber: clean(row.flightNumber).toUpperCase(),
    airline: clean(row.airline),
    origin: normalizeIata(clean(row.origin)),
    destination: normalizeIata(clean(row.destination)),
    scheduledDeparture: clean(row.scheduledDeparture) || undefined,
    scheduledArrival: clean(row.scheduledArrival) || undefined,
    actualDeparture: clean(row.actualDeparture) || undefined,
    actualArrival: clean(row.actualArrival) || undefined,
    aircraftType: clean(row.aircraftType) || undefined,
    aircraftRegistration: clean(row.aircraftRegistration).toUpperCase() || undefined,
    cabin: clean(row.cabin) || undefined,
    seat: clean(row.seat).toUpperCase() || undefined,
    purpose: (clean(row.purpose) || 'personal') as FlightPurpose,
    notes: clean(row.notes) || undefined,
    source: (clean(row.source) || 'manual') as FlightSource,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

export function flightsToCsv(flights: FlightLogEntry[]): string {
  return Papa.unparse(
    flights.map((flight) =>
      Object.fromEntries(csvColumns.map((column) => [column, flight[column] ?? ''])),
    ),
    { columns: [...csvColumns] },
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
    valid.push(flightFromInput(row))
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
      const input = row as Partial<Record<CsvColumn, unknown>>
      const rowErrors = validateFlightInput(input, `Item ${index + 1}`)
      if (rowErrors.length > 0) {
        errors.push(...rowErrors)
        return
      }
      valid.push(flightFromInput(input))
    })
    return { valid, errors }
  } catch (error) {
    return { valid: [], errors: [error instanceof Error ? error.message : 'Invalid JSON'] }
  }
}
