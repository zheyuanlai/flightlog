import { describe, expect, it } from 'vitest'
import type { FlightLogEntry } from '../types'
import { diffFlightFields, mergeFlightRecords, mergeableFlightFieldDiffs, mergeableFlightFields } from '../utils/conflicts'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'merge-flight',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    purpose: 'personal',
    source: 'aerodatabox',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('field-level conflict merge', () => {
  const local = flight({ seat: '11A', notes: 'Window seat', updatedAt: '2026-06-01T00:00:00.000Z' })
  const cloud = flight({ seat: '32K', aircraftType: 'Airbus A350-900', notes: 'Window seat', updatedAt: '2026-06-02T00:00:00.000Z' })

  it('keeps local values by default and applies chosen cloud fields', () => {
    const merged = mergeFlightRecords(local, cloud, { seat: 'cloud' })
    expect(merged.seat).toBe('32K')
    expect(merged.notes).toBe('Window seat')
    expect(merged.aircraftType).toBeUndefined()
    expect(merged.id).toBe(local.id)
  })

  it('can pull multiple cloud fields at once', () => {
    const merged = mergeFlightRecords(local, cloud, { seat: 'cloud', aircraftType: 'cloud' })
    expect(merged.seat).toBe('32K')
    expect(merged.aircraftType).toBe('Airbus A350-900')
  })

  it('stamps the merge as a fresh update', () => {
    const merged = mergeFlightRecords(local, cloud, { seat: 'cloud' })
    expect(merged.lastOperation).toBe('update')
    expect(merged.updatedAt > '2026-06-02T00:00:00.000Z').toBe(true)
  })

  it('never merges system fields even if asked', () => {
    const deletedCloud = flight({ deletedAt: '2026-06-03T00:00:00.000Z' })
    const merged = mergeFlightRecords(local, deletedCloud, { deletedAt: 'cloud', updatedAt: 'cloud' })
    expect(merged.deletedAt).toBeUndefined()
  })

  it('excludes system fields from the mergeable list', () => {
    const fields = mergeableFlightFields.map((item) => item.field)
    expect(fields).not.toContain('updatedAt')
    expect(fields).not.toContain('deletedAt')
    expect(fields).toContain('seat')
    expect(fields).toContain('aircraftType')
  })

  it('lists only changed mergeable fields for the merge editor', () => {
    const diffs = mergeableFlightFieldDiffs(local, cloud)
    const fields = diffs.map((diff) => diff.field)
    expect(fields).toContain('seat')
    expect(fields).toContain('aircraftType')
    expect(fields).not.toContain('notes')
    expect(fields).not.toContain('updatedAt')
  })

  it('still diffs system fields for display', () => {
    const diffs = diffFlightFields(local, cloud)
    expect(diffs.some((diff) => diff.field === 'updatedAt' && diff.changed)).toBe(true)
  })
})
