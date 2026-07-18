import type { FlightLogEntry } from '../types'

export interface ConflictFieldDiff {
  field: string
  label: string
  localValue: string
  cloudValue: string
  changed: boolean
}

export type MergeSide = 'local' | 'cloud'

const mergeableFields: Array<{ field: keyof FlightLogEntry; label: string }> = [
  { field: 'date', label: 'Date' },
  { field: 'flightNumber', label: 'Flight' },
  { field: 'airline', label: 'Airline' },
  { field: 'origin', label: 'Origin' },
  { field: 'destination', label: 'Destination' },
  { field: 'scheduledDepartureLocal', label: 'Departure local' },
  { field: 'scheduledArrivalLocal', label: 'Arrival local' },
  { field: 'actualDepartureLocal', label: 'Actual departure local' },
  { field: 'actualArrivalLocal', label: 'Actual arrival local' },
  { field: 'aircraftType', label: 'Aircraft type' },
  { field: 'aircraftRegistration', label: 'Registration' },
  { field: 'cabin', label: 'Cabin' },
  { field: 'seat', label: 'Seat' },
  { field: 'notes', label: 'Notes' },
  { field: 'purpose', label: 'Purpose' },
]

const systemFields: Array<{ field: keyof FlightLogEntry; label: string }> = [
  { field: 'updatedAt', label: 'Updated' },
  { field: 'deletedAt', label: 'Deleted' },
]

export const mergeableFlightFields = mergeableFields

// Fields that must travel together with a user-visible field when a side is
// chosen, so merged records stay internally consistent (e.g. picking the cloud
// destination also takes the cloud destination timezone and airport snapshot,
// and picking a cloud local time also takes its UTC twin and legacy field).
const mergeCompanions: Partial<Record<keyof FlightLogEntry, Array<keyof FlightLogEntry>>> = {
  origin: ['originTimeZone', 'originAirportSnapshot'],
  destination: ['destinationTimeZone', 'destinationAirportSnapshot'],
  airline: ['airlineIata', 'airlineIcao'],
  scheduledDepartureLocal: ['scheduledDeparture', 'scheduledDepartureUtc'],
  scheduledArrivalLocal: ['scheduledArrival', 'scheduledArrivalUtc'],
  actualDepartureLocal: ['actualDeparture', 'actualDepartureUtc'],
  actualArrivalLocal: ['actualArrival', 'actualArrivalUtc'],
}

function stringify(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not set'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function diffFlightFields(local: Partial<FlightLogEntry> | undefined, cloud: Partial<FlightLogEntry> | undefined): ConflictFieldDiff[] {
  return [...mergeableFields, ...systemFields].map(({ field, label }) => {
    const localValue = stringify(local?.[field])
    const cloudValue = stringify(cloud?.[field])
    return {
      field,
      label,
      localValue,
      cloudValue,
      changed: localValue !== cloudValue,
    }
  })
}

export function mergeableFlightFieldDiffs(local: Partial<FlightLogEntry> | undefined, cloud: Partial<FlightLogEntry> | undefined): ConflictFieldDiff[] {
  const mergeable = new Set(mergeableFields.map(({ field }) => field as string))
  return diffFlightFields(local, cloud).filter((diff) => diff.changed && mergeable.has(diff.field))
}

export function mergeFlightRecords(
  local: FlightLogEntry,
  cloud: FlightLogEntry,
  choices: Record<string, MergeSide>,
): FlightLogEntry {
  const merged: Record<string, unknown> = { ...local }
  for (const { field } of mergeableFields) {
    if (choices[field] !== 'cloud') continue
    merged[field] = cloud[field]
    for (const companion of mergeCompanions[field] ?? []) {
      merged[companion] = cloud[companion]
    }
  }
  merged.updatedAt = new Date().toISOString()
  merged.lastOperation = 'update'
  return merged as unknown as FlightLogEntry
}
