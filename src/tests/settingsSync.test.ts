import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppMetadata, FlightLogEntry, ProviderAirportSnapshot, TripMetadata } from '../types'
import { createFullBackup } from '../utils/backup'
import { diagnosticsText } from '../utils/diagnostics'
import { formatDistance } from '../utils/dates'
import { formatDepartureLocalTime } from '../utils/flightTime'
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_METADATA_KEY,
  SYNC_METADATA_KEY,
  appSettingsFromMetadata,
  migrateAppMetadataDefaults,
  settingsMetadataEntry,
} from '../utils/settings'
import {
  compareLocalAndRemote,
  computeRecordChecksum,
  deletionSyncLimitation,
  getLocalSyncState,
  getRemoteSyncState,
  pullRemoteChanges,
  pushLocalChanges,
  resolveConflict,
  type SyncRecord,
} from '../lib/cloudSync'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'flight-a',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    scheduledDepartureLocal: '2026-06-02T22:30',
    scheduledDepartureUtc: '2026-06-02T14:30:00Z',
    originTimeZone: 'Asia/Singapore',
    destinationTimeZone: 'America/Los_Angeles',
    purpose: 'personal',
    source: 'aerodatabox',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function trip(overrides: Partial<TripMetadata> = {}): TripMetadata {
  return {
    id: 'trip-a',
    name: 'Pacific trip',
    type: 'personal',
    isFavorite: false,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function airport(overrides: Partial<ProviderAirportSnapshot> = {}): ProviderAirportSnapshot {
  return {
    iata: 'SIN',
    timezone: 'Asia/Singapore',
    source: 'aerodatabox',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function remoteRow(record: SyncRecord) {
  return {
    entity_type: record.entityType,
    local_id: record.localId,
    record_json: record.record,
    record_checksum: record.checksum,
    record_updated_at: record.recordUpdatedAt,
    deleted_at: null,
    device_id: record.deviceId,
  }
}

function mockSyncClient(rows: ReturnType<typeof remoteRow>[]) {
  const store = { upserted: [] as Record<string, unknown>[] }
  const client = {
    from(table: string) {
      expect(table).toBe('synced_records')
      return {
        select() {
          return {
            order: async () => ({ data: rows, error: null }),
          }
        },
        upsert(payload: Record<string, unknown>[]) {
          store.upserted = payload
          return { error: null }
        },
      }
    },
  } as unknown as SupabaseClient
  return { client, store }
}

describe('settings and sync foundation', () => {
  it('initializes default settings and sync metadata in app metadata', () => {
    const migrated = migrateAppMetadataDefaults([], 'device-a', '2026-06-03T00:00:00.000Z')
    expect(migrated.changed).toBe(true)
    expect(migrated.metadata.map((item) => item.key).sort()).toEqual([SETTINGS_METADATA_KEY, SYNC_METADATA_KEY])
    expect(appSettingsFromMetadata(migrated.metadata)).toMatchObject({ distanceUnit: 'kilometers', timeFormat: 'system', theme: 'system' })
  })

  it('keeps settings in full backup exports', () => {
    const metadata: AppMetadata[] = [settingsMetadataEntry({ ...DEFAULT_APP_SETTINGS, distanceUnit: 'miles' }, '2026-06-03T00:00:00.000Z')]
    const backup = createFullBackup({ flights: [flight()], tripMetadata: [trip()], providerAirports: [airport()], appMetadata: metadata })
    expect(backup.appMetadata.find((item) => item.key === SETTINGS_METADATA_KEY)?.value).toContain('miles')
  })

  it('formats distance and airport-local time using preferences', () => {
    expect(formatDistance(1000, 'miles')).toBe('621 mi')
    const entry = flight()
    expect(formatDepartureLocalTime(entry, { timeFormat: '12h' }).label).toContain('10:30 PM · SIN local')
    expect(formatDepartureLocalTime(entry, { dateFormat: 'iso', timeFormat: '24h' }).label).toContain('2026-06-02, 22:30 · SIN local')
  })

  it('redacts diagnostics secrets and tokens', () => {
    const text = diagnosticsText({
      supabaseAnonKey: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
      nested: { authorization: 'Bearer secret', workerUrl: 'https://example.test' },
      checksum: 'abcdef123456',
    })
    expect(text).toContain('[redacted]')
    expect(text).not.toContain('Bearer secret')
    expect(text).not.toContain('eyJhbGci')
    expect(text).toContain('https://example.test')
  })

  it('generates local sync state, compares remote state, and detects conflicts', async () => {
    const local = await getLocalSyncState({ flights: [flight()], tripMetadata: [trip()], providerAirports: [airport()], settings: DEFAULT_APP_SETTINGS, deviceId: 'device-a' })
    const sameFlight = local.records.find((record) => record.entityType === 'flight')
    expect(sameFlight?.checksum).toHaveLength(64)
    const remoteChangedFlight: SyncRecord = {
      ...sameFlight!,
      record: { ...(sameFlight!.record as FlightLogEntry), notes: 'Cloud note', updatedAt: '2026-06-04T00:00:00.000Z' },
      checksum: await computeRecordChecksum({ ...(sameFlight!.record as FlightLogEntry), notes: 'Cloud note', updatedAt: '2026-06-04T00:00:00.000Z' }),
      recordUpdatedAt: '2026-06-04T00:00:00.000Z',
    }
    const remoteOnly: SyncRecord = {
      entityType: 'flight',
      localId: 'flight-remote',
      record: flight({ id: 'flight-remote', flightNumber: 'UA1' }),
      checksum: await computeRecordChecksum(flight({ id: 'flight-remote', flightNumber: 'UA1' })),
      recordUpdatedAt: '2026-06-02T00:00:00.000Z',
    }
    const { client, store } = mockSyncClient([remoteRow(remoteChangedFlight), remoteRow(remoteOnly)])
    const remote = await getRemoteSyncState(client)
    const comparison = compareLocalAndRemote(local, remote)
    expect(comparison.conflicts).toHaveLength(1)
    expect(comparison.remoteOnly).toHaveLength(1)
    expect(comparison.localOnly.length).toBeGreaterThan(0)
    expect(resolveConflict(comparison.conflicts[0], 'use-cloud')?.localId).toBe('flight-a')
    expect(pullRemoteChanges(comparison).map((record) => record.localId)).toEqual(['flight-remote'])
    const pushed = await pushLocalChanges({ client, userId: 'user-a', records: comparison.localOnly.map((item) => item.local!).slice(0, 1), deviceId: 'device-a' })
    expect(pushed).toBe(1)
    expect(store.upserted[0]).toMatchObject({ user_id: 'user-a', entity_type: comparison.localOnly[0].entityType })
  })

  it('documents deletion sync as deferred in v1.7', () => {
    expect(deletionSyncLimitation()).toContain('does not automatically propagate deletions')
  })
})
