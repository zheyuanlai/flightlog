import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppMetadata, FlightLogEntry } from '../types'
import { createFullBackup, type FlightLogBackup } from '../utils/backup'
import {
  computeBackupChecksum,
  createCloudBackupSnapshot,
  deleteAllCloudBackups,
  deleteCloudBackup,
  deleteOlderCloudBackups,
  getCloudBackup,
  hasLocalDataChangedSinceCloudBackup,
  listCloudBackups,
  restoreCloudBackup,
  summarizeBackup,
  verifyCloudBackupSnapshot,
} from '../lib/cloudBackup'
import { createFlightLogSupabaseClient, hasSupabaseConfig } from '../lib/supabase'

interface MockCloudRow {
  id: string
  label?: string | null
  schema_version: number
  backup_json?: FlightLogBackup
  backup_checksum?: string | null
  flight_count?: number | null
  trip_metadata_count?: number | null
  provider_airport_count?: number | null
  exported_at?: string | null
  created_at: string
  updated_at?: string | null
  device_id?: string | null
  app_version?: string | null
  is_auto?: boolean | null
}

function testFlight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'flight-a',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    scheduledDepartureUtc: '2026-06-02T14:30:00Z',
    scheduledDepartureLocal: '2026-06-02T22:30',
    scheduledArrivalUtc: '2026-06-03T02:15:00Z',
    scheduledArrivalLocal: '2026-06-02T19:15',
    originTimeZone: 'Asia/Singapore',
    destinationTimeZone: 'America/Los_Angeles',
    purpose: 'personal',
    source: 'aerodatabox',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function backup(metadata: AppMetadata[] = []): FlightLogBackup {
  return createFullBackup({
    flights: [testFlight()],
    tripMetadata: [{
      id: 'trip-a',
      name: 'Pacific trip',
      type: 'work',
      isFavorite: true,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    }],
    providerAirports: [{ iata: 'SIN', timezone: 'Asia/Singapore', source: 'aerodatabox' }],
    appMetadata: metadata,
    exportedAt: '2026-06-03T12:00:00.000Z',
  })
}

function rowFromBackup(id: string, item: FlightLogBackup, label = 'Cloud backup'): MockCloudRow {
  const summary = summarizeBackup(item)
  return {
    id,
    label,
    schema_version: summary.schemaVersion,
    backup_json: item,
    backup_checksum: `checksum-${id}`,
    flight_count: summary.flightCount,
    trip_metadata_count: summary.tripMetadataCount,
    provider_airport_count: summary.providerAirportCount,
    exported_at: summary.exportedAt,
    created_at: '2026-06-03T12:00:00.000Z',
    updated_at: '2026-06-03T12:00:00.000Z',
    device_id: 'test-device',
    app_version: 'v1.6',
    is_auto: false,
  }
}

function mockClient(rows: MockCloudRow[]) {
  const store = { inserted: undefined as Record<string, unknown> | undefined, deletedIds: [] as string[] }
  const client = {
    from(table: string) {
      expect(table).toBe('cloud_backups')
      return {
        insert(payload: Record<string, unknown>) {
          store.inserted = payload
          const insertedBackup = payload.backup_json as FlightLogBackup
          return {
            select() {
              return {
                single: async () => ({
                  data: rowFromBackup('inserted', insertedBackup, payload.label as string | undefined),
                  error: null,
                }),
              }
            },
          }
        },
        select() {
          return {
            order: async () => ({ data: rows, error: null }),
            eq: (_column: string, id: string) => ({
              single: async () => ({ data: rows.find((row) => row.id === id) ?? null, error: null }),
            }),
          }
        },
        delete() {
          return {
            eq: async (_column: string, id: string) => {
              store.deletedIds = [id]
              return { error: null }
            },
            in: async (_column: string, ids: string[]) => {
              store.deletedIds = ids
              return { error: null }
            },
          }
        },
      }
    },
  } as unknown as SupabaseClient
  return { client, store }
}

describe('cloud backup utilities', () => {
  it('handles configured and unconfigured Supabase clients', () => {
    expect(hasSupabaseConfig({})).toBe(false)
    expect(createFlightLogSupabaseClient({})).toBeNull()
    expect(hasSupabaseConfig({ url: 'https://example.supabase.co', anonKey: 'anon-key' })).toBe(true)
  })

  it('summarizes backups and computes stable checksums', async () => {
    const first = backup([{ key: 'lastCloudBackupAt', value: '2026-06-03T12:00:00.000Z', updatedAt: '2026-06-03T12:00:00.000Z' }])
    const second = { ...backup([{ key: 'lastCloudBackupAt', value: '2026-06-04T12:00:00.000Z', updatedAt: '2026-06-04T12:00:00.000Z' }]), exportedAt: '2026-06-04T12:00:00.000Z' }
    expect(summarizeBackup(first)).toMatchObject({ schemaVersion: 4, flightCount: 1, tripMetadataCount: 1, providerAirportCount: 1 })
    expect(await computeBackupChecksum(first)).toBe(await computeBackupChecksum(second))
    const changed = { ...second, flights: [testFlight({ notes: 'Changed local note' })] }
    expect(hasLocalDataChangedSinceCloudBackup(await computeBackupChecksum(changed), await computeBackupChecksum(first))).toBe(true)
  })

  it('creates and lists cloud backup snapshots with mocked Supabase', async () => {
    const sourceBackup = backup()
    const { client, store } = mockClient([rowFromBackup('backup-1', sourceBackup)])
    const created = await createCloudBackupSnapshot({
      client,
      userId: 'user-1',
      backup: sourceBackup,
      label: 'Before Tokyo',
      deviceId: 'device-1',
      appVersion: 'v1.6',
    })
    expect(created.label).toBe('Before Tokyo')
    expect(store.inserted).toMatchObject({ user_id: 'user-1', label: 'Before Tokyo', flight_count: 1, trip_metadata_count: 1, provider_airport_count: 1 })
    expect((store.inserted?.backup_checksum as string).length).toBe(64)
    const listed = await listCloudBackups(client)
    expect(listed[0]).toMatchObject({ id: 'backup-1', flightCount: 1, schemaVersion: 4 })
  })

  it('gets, previews, and deletes cloud backups with mocked Supabase', async () => {
    const sourceBackup = backup()
    const { client, store } = mockClient([rowFromBackup('backup-1', sourceBackup), rowFromBackup('backup-2', sourceBackup)])
    const fetched = await getCloudBackup(client, 'backup-1')
    expect(fetched.backup.flights[0].flightNumber).toBe('SQ38')
    const verified = await verifyCloudBackupSnapshot({ client, id: 'backup-1', expectedChecksum: 'checksum-backup-1' })
    expect(verified.verified).toBe(true)
    const restore = await restoreCloudBackup({ client, id: 'backup-1', existingFlights: [testFlight()], mode: 'merge' })
    expect(restore.preview.duplicateFlights).toBe(1)
    await deleteCloudBackup(client, 'backup-1')
    expect(store.deletedIds).toEqual(['backup-1'])
    await deleteAllCloudBackups(client)
    expect(store.deletedIds).toEqual(['backup-1', 'backup-2'])
  })

  it('deletes only backups older than the retention limit', async () => {
    const rows = Array.from({ length: 12 }, (_, index) => rowFromBackup(`backup-${index}`, backup()))
    const { client, store } = mockClient(rows)
    const deleted = await deleteOlderCloudBackups(client, 10)
    expect(deleted).toBe(2)
    expect(store.deletedIds).toEqual(['backup-10', 'backup-11'])
  })

  it('rejects cloud uploads when the user is not signed in', async () => {
    const { client } = mockClient([])
    await expect(createCloudBackupSnapshot({ client, backup: backup() })).rejects.toThrow('Sign in to use cloud backup.')
  })
})
