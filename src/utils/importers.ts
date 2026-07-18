import * as Papa from 'papaparse'
import { DateTime } from 'luxon'
import type { FlightLogEntry, ImportPreview } from '../types'
import { flightFromInput, validateFlightInput } from './csv'

export type ImportPreset = 'generic' | 'flighty' | 'flightradar24'

export interface ImportField {
  field: string
  label: string
  required: boolean
  aliases: string[]
}

// Internal fields an importer can populate, with the source-column header
// aliases that map onto them (case/space/punctuation-insensitive).
export const importFields: ImportField[] = [
  { field: 'date', label: 'Date', required: true, aliases: ['date', 'flight date', 'departure date', 'dep date'] },
  { field: 'flightNumber', label: 'Flight number', required: true, aliases: ['flight number', 'flight', 'flight no', 'flightnumber', 'number', 'flight #'] },
  { field: 'airline', label: 'Airline', required: true, aliases: ['airline', 'carrier', 'operator', 'airline name'] },
  { field: 'origin', label: 'Origin', required: true, aliases: ['from', 'origin', 'departure', 'dep', 'departure airport', 'origin airport', 'from airport'] },
  { field: 'destination', label: 'Destination', required: true, aliases: ['to', 'destination', 'arrival', 'arr', 'arrival airport', 'destination airport', 'to airport'] },
  { field: 'scheduledDeparture', label: 'Scheduled departure', required: false, aliases: ['scheduled departure', 'std', 'departure scheduled', 'gate departure (scheduled)', 'dep scheduled', 'dep time', 'departure time'] },
  { field: 'actualDeparture', label: 'Actual departure', required: false, aliases: ['actual departure', 'atd', 'gate departure (actual)', 'take off (actual)', 'departure actual'] },
  { field: 'scheduledArrival', label: 'Scheduled arrival', required: false, aliases: ['scheduled arrival', 'sta', 'gate arrival (scheduled)', 'arr scheduled', 'arr time', 'arrival time'] },
  { field: 'actualArrival', label: 'Actual arrival', required: false, aliases: ['actual arrival', 'ata', 'gate arrival (actual)', 'landing (actual)', 'arrival actual'] },
  { field: 'aircraftType', label: 'Aircraft type', required: false, aliases: ['aircraft', 'aircraft type', 'equipment', 'aircraft type name', 'type', 'plane'] },
  { field: 'aircraftRegistration', label: 'Registration', required: false, aliases: ['registration', 'tail', 'tail number', 'reg', 'aircraft registration'] },
  { field: 'seat', label: 'Seat', required: false, aliases: ['seat', 'seat number', 'seat no'] },
  { field: 'cabin', label: 'Cabin', required: false, aliases: ['cabin', 'cabin class', 'class', 'seat type', 'flight class', 'travel class'] },
  { field: 'notes', label: 'Notes', required: false, aliases: ['notes', 'note', 'comment', 'comments', 'remark'] },
]

const requiredFields = importFields.filter((entry) => entry.required).map((entry) => entry.field)

export interface DelimitedImportResult extends ImportPreview {
  headers: string[]
  mapping: Record<string, string>
  unmappedRequired: string[]
  warnings: string[]
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function detectColumnMapping(headers: string[], preset: ImportPreset = 'generic'): Record<string, string> {
  const normalized = headers.map((header) => ({ header, normal: normalizeHeader(header) }))
  const mapping: Record<string, string> = {}
  const used = new Set<string>()
  const claim = (field: string, matcher: (normal: string) => boolean) => {
    if (mapping[field]) return
    const hit = normalized.find((entry) => !used.has(entry.header) && matcher(entry.normal))
    if (hit) {
      mapping[field] = hit.header
      used.add(hit.header)
    }
  }
  // Exact alias matches first, then a looser contains match, so specific headers win.
  for (const entry of importFields) {
    claim(entry.field, (normal) => entry.aliases.includes(normal))
  }
  for (const entry of importFields) {
    claim(entry.field, (normal) => entry.aliases.some((alias) => normal === alias || normal.includes(alias)))
  }
  void preset
  return mapping
}

interface DateCoercion {
  date?: string
  ambiguous?: boolean
}

const DATE_FORMATS = [
  'LLL d, yyyy', 'LLL d yyyy', 'LLLL d, yyyy', 'LLLL d yyyy',
  'd LLL yyyy', 'dd LLL yyyy', 'd-LLL-yyyy', 'dd-LLL-yyyy',
  'MM/dd/yyyy', 'M/d/yyyy', 'dd/MM/yyyy', 'yyyy/MM/dd',
  'MM/dd/yy', 'M/d/yy', 'LLL d yy',
]

function coerceDate(value: string): DateCoercion {
  const trimmed = value.trim()
  if (!trimmed) return {}
  // ISO-shaped: validate through Luxon so impossible dates (2026-13-45) are rejected.
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (isoMatch) {
    const parsed = DateTime.fromObject({ year: Number(isoMatch[1]), month: Number(isoMatch[2]), day: Number(isoMatch[3]) })
    return parsed.isValid ? { date: parsed.toISODate() ?? undefined } : {}
  }
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/)
  const ambiguous = Boolean(slash && Number(slash[1]) <= 12 && Number(slash[2]) <= 12)
  for (const format of DATE_FORMATS) {
    const parsed = DateTime.fromFormat(trimmed, format)
    if (parsed.isValid) return { date: parsed.toISODate() ?? undefined, ambiguous }
  }
  const iso = DateTime.fromISO(trimmed)
  return iso.isValid ? { date: iso.toISODate() ?? undefined } : {}
}

/** Combine the row date with a time cell so a bare HH:MM becomes a resolvable local datetime. */
function combineDateTime(date: string, value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmed)) return trimmed.replace(' ', 'T')
  const bareTime = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  if (bareTime) return `${date}T${bareTime[1].padStart(2, '0')}:${bareTime[2]}`
  const parsed = DateTime.fromISO(trimmed)
  return parsed.isValid ? parsed.toISO() ?? undefined : undefined
}

export function importDelimitedFlights(
  text: string,
  options: { preset?: ImportPreset; mapping?: Record<string, string>; source?: FlightLogEntry['source'] } = {},
): DelimitedImportResult {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
  const headers = parsed.meta.fields ?? []
  const mapping = options.mapping ?? detectColumnMapping(headers, options.preset ?? 'generic')
  const unmappedRequired = requiredFields.filter((field) => !mapping[field])
  const errors: string[] = parsed.errors.map((error) => `CSV: ${error.message}`)
  const warnings: string[] = []
  if (unmappedRequired.length > 0) {
    const labels = unmappedRequired.map((field) => importFields.find((entry) => entry.field === field)?.label ?? field)
    errors.push(`Could not detect a column for: ${labels.join(', ')}. Map them manually to import.`)
    return { valid: [], errors, headers, mapping, unmappedRequired, warnings }
  }
  const valid: FlightLogEntry[] = []
  let sawAmbiguousDate = false
  parsed.data.forEach((row, index) => {
    const rowLabel = `Row ${index + 2}`
    const input: Record<string, string | undefined> = { source: options.source ?? 'manual' }
    for (const [field, header] of Object.entries(mapping)) {
      input[field] = row[header]
    }
    const coercion = coerceDate(input.date ?? '')
    if (!coercion.date) {
      errors.push(`${rowLabel}: could not parse date "${input.date ?? ''}"`)
      return
    }
    input.date = coercion.date
    if (coercion.ambiguous) sawAmbiguousDate = true
    input.scheduledDeparture = combineDateTime(coercion.date, input.scheduledDeparture)
    input.actualDeparture = combineDateTime(coercion.date, input.actualDeparture)
    input.scheduledArrival = combineDateTime(coercion.date, input.scheduledArrival)
    input.actualArrival = combineDateTime(coercion.date, input.actualArrival)
    const rowErrors = validateFlightInput(input, rowLabel)
    if (rowErrors.length > 0) {
      errors.push(...rowErrors)
      return
    }
    valid.push(flightFromInput(input))
  })
  if (sawAmbiguousDate) warnings.push('Some dates were ambiguous (M/D vs D/M) and were read as US month/day order. Double-check imported dates if your export uses day/month order.')
  return { valid, errors, headers, mapping, unmappedRequired: [], warnings }
}
