import type { FlightLogEntry } from '../types'

export interface ConflictFieldDiff {
  field: string
  label: string
  localValue: string
  cloudValue: string
  changed: boolean
}

const flightFields: Array<{ field: keyof FlightLogEntry; label: string }> = [
  { field: 'flightNumber', label: 'Flight' },
  { field: 'airline', label: 'Airline' },
  { field: 'origin', label: 'Origin' },
  { field: 'destination', label: 'Destination' },
  { field: 'scheduledDepartureLocal', label: 'Departure local' },
  { field: 'scheduledArrivalLocal', label: 'Arrival local' },
  { field: 'notes', label: 'Notes' },
  { field: 'purpose', label: 'Purpose' },
  { field: 'updatedAt', label: 'Updated' },
  { field: 'deletedAt', label: 'Deleted' },
]

function stringify(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not set'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function diffFlightFields(local: Partial<FlightLogEntry> | undefined, cloud: Partial<FlightLogEntry> | undefined): ConflictFieldDiff[] {
  return flightFields.map(({ field, label }) => {
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
