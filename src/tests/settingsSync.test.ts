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
  normalizeAppSettings,
  settingsMetadataEntry,
} from '../utils/settings'
import {
  compareLocalAndRemote,
  compareDeletionState,
  computeRecordContentChecksum,
  computeRecordChecksum,
  getLocalSyncState,
  getRemoteSyncState,
  listRecentlyDeleted,
  pullRemoteChanges,
  pullTombstones,
  pushLocalChanges,
  pushTombstones,
  resolveConflict,
  sealRecordsForUpload,
  SealedSyncPassphraseError,
  syncRecordLabel,
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
    deleted_at: record.deletedAt ?? null,
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

  it('does not create a phantom appSettings conflict against a record predating a new setting field', async () => {
    const settingsUpdatedAt = '2026-06-01T00:00:00.000Z'
    // Simulate a cloud record pushed by an older client: normalized settings WITHOUT a field this build adds.
    const olderSettings = { ...normalizeAppSettings(DEFAULT_APP_SETTINGS) } as Record<string, unknown>
    delete olderSettings.dayOfNotificationsEnabled
    const { client } = mockSyncClient([
      {
        entity_type: 'appSettings',
        local_id: 'settings',
        record_json: olderSettings,
        record_checksum: 'ignored-server-value',
        record_updated_at: settingsUpdatedAt,
        deleted_at: null,
        device_id: 'device-b',
      },
    ])
    const local = await getLocalSyncState({
      flights: [], tripMetadata: [], providerAirports: [],
      settings: DEFAULT_APP_SETTINGS, deviceId: 'device-a', settingsUpdatedAt,
    })
    const remote = await getRemoteSyncState(client)
    const comparison = compareLocalAndRemote(local, remote)
    const item = comparison.items.find((entry) => entry.entityType === 'appSettings')
    expect(item?.status).toBe('same')
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
      contentChecksum: await computeRecordContentChecksum({ ...(sameFlight!.record as FlightLogEntry), notes: 'Cloud note', updatedAt: '2026-06-04T00:00:00.000Z' }),
      recordUpdatedAt: '2026-06-04T00:00:00.000Z',
    }
    const remoteOnlyRecord = flight({ id: 'flight-remote', flightNumber: 'UA1' })
    const remoteOnly: SyncRecord = {
      entityType: 'flight',
      localId: 'flight-remote',
      record: remoteOnlyRecord,
      checksum: await computeRecordChecksum(remoteOnlyRecord),
      contentChecksum: await computeRecordContentChecksum(remoteOnlyRecord),
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

  it('ignores updatedAt noise in checksums but includes tombstone state', async () => {
    const first = flight({ updatedAt: '2026-06-01T00:00:00.000Z' })
    const second = flight({ updatedAt: '2026-06-04T00:00:00.000Z' })
    const deleted = flight({ updatedAt: '2026-06-04T00:00:00.000Z', deletedAt: '2026-06-04T01:00:00.000Z', lastOperation: 'delete' })
    expect(await computeRecordChecksum(first)).toBe(await computeRecordChecksum(second))
    expect(await computeRecordChecksum(second)).not.toBe(await computeRecordChecksum(deleted))
    expect(await computeRecordContentChecksum(second)).toBe(await computeRecordContentChecksum(deleted))
  })

  it('compares local and remote tombstone states safely', async () => {
    const active = flight()
    const deleted = flight({ deletedAt: '2026-06-04T00:00:00.000Z', deleteReason: 'Test delete', lastOperation: 'delete', updatedAt: '2026-06-04T00:00:00.000Z' })
    const [localActive] = (await getLocalSyncState({ flights: [active], tripMetadata: [], providerAirports: [], settings: DEFAULT_APP_SETTINGS })).records.filter((record) => record.entityType === 'flight')
    const [localDeleted] = (await getLocalSyncState({ flights: [deleted], tripMetadata: [], providerAirports: [], settings: DEFAULT_APP_SETTINGS })).records.filter((record) => record.entityType === 'flight')
    expect(compareDeletionState(localDeleted, localActive)).toBe('tombstone-to-push')
    expect(compareDeletionState(localActive, localDeleted)).toBe('tombstone-to-pull')

    const changedActiveState = await getLocalSyncState({ flights: [flight({ notes: 'Changed active record' })], tripMetadata: [], providerAirports: [], settings: DEFAULT_APP_SETTINGS })
    const changedActive = changedActiveState.records.find((record) => record.entityType === 'flight')!
    expect(compareDeletionState(localDeleted, changedActive)).toBe('delete-conflict')
    expect(compareDeletionState(changedActive, localDeleted)).toBe('delete-conflict')

    const comparison = compareLocalAndRemote(
      { records: [localDeleted], byKey: new Map([[`flight:${localDeleted.localId}`, localDeleted]]), counts: { flight: 1, tripMetadata: 0, providerAirport: 0, appSettings: 0 }, deletedCount: 1 },
      { records: [localActive], byKey: new Map([[`flight:${localActive.localId}`, localActive]]), counts: { flight: 1, tripMetadata: 0, providerAirport: 0, appSettings: 0 }, deletedCount: 0 },
    )
    expect(comparison.tombstonesToPush).toHaveLength(1)
    expect(listRecentlyDeleted(comparison.local)).toHaveLength(1)
    const { client, store } = mockSyncClient([])
    await pushTombstones({ client, userId: 'user-a', records: [localDeleted], deviceId: 'device-a' })
    expect(store.upserted[0]).toMatchObject({ deleted_at: '2026-06-04T00:00:00.000Z', last_operation: 'delete' })
  })

  it('pulls remote-only tombstones separately from active records', async () => {
    const deleted = flight({ id: 'flight-deleted', deletedAt: '2026-06-04T00:00:00.000Z', lastOperation: 'delete' })
    const remote = await getLocalSyncState({ flights: [deleted], tripMetadata: [], providerAirports: [], settings: DEFAULT_APP_SETTINGS })
    const local = await getLocalSyncState({ flights: [], tripMetadata: [], providerAirports: [], settings: DEFAULT_APP_SETTINGS })
    const comparison = compareLocalAndRemote(local, remote)
    expect(comparison.remoteOnly).toHaveLength(0)
    expect(comparison.tombstonesToPull).toHaveLength(1)
    expect(pullRemoteChanges(comparison)).toHaveLength(0)
    expect(pullTombstones(comparison).map((record) => record.localId)).toEqual(['flight-deleted'])
  })
})

describe('sealed sync (v3.1)', () => {
  const PASSPHRASE = 'correct horse battery staple'
  const FAST_ITERATIONS = 1000

  it('seals a record for upload so the server never sees plaintext, and unseals it back with the right passphrase', async () => {
    const local = await getLocalSyncState({ flights: [flight({ notes: 'very private note' })], tripMetadata: [], providerAirports: [], settings: DEFAULT_APP_SETTINGS })
    const flightRecord = local.records.find((record) => record.entityType === 'flight')!
    const [sealed] = await sealRecordsForUpload([flightRecord], PASSPHRASE, { iterations: FAST_ITERATIONS })
    expect(sealed.sealed).toBe(true)
    // The uploaded checksum must NOT be derived from plaintext — FlightLog's record
    // shapes have low enough entropy that a plaintext-keyed hash would let a database
    // reader recover content via offline dictionary attack, without the passphrase.
    expect(sealed.checksum).not.toBe(flightRecord.checksum)
    expect(sealed.contentChecksum).not.toBe(flightRecord.contentChecksum)
    expect(JSON.stringify(sealed.record)).not.toContain('very private note')
    expect(JSON.stringify(sealed.checksum)).not.toContain('very private note')

    const { client, store } = mockSyncClient([])
    await pushLocalChanges({ client, userId: 'user-a', records: [sealed], deviceId: 'device-a' })
    expect(JSON.stringify(store.upserted[0].record_json)).not.toContain('very private note')
    expect(store.upserted[0].record_checksum).not.toBe(flightRecord.checksum)

    const remoteRows = [remoteRow(sealed)]
    const { client: pullClient } = mockSyncClient(remoteRows)
    const remote = await getRemoteSyncState(pullClient, { passphrase: PASSPHRASE })
    const [unsealed] = remote.records.filter((record) => record.entityType === 'flight')
    expect(unsealed.locked).toBeUndefined()
    expect(unsealed.sealed).toBe(true)
    expect((unsealed.record as FlightLogEntry).notes).toBe('very private note')
    // After decrypting, the checksum is recomputed from the plaintext and matches
    // the original local record again — only the server-visible value is opaque.
    expect(unsealed.checksum).toBe(flightRecord.checksum)
  })

  it('does not let a database reader distinguish identical plaintext records by checksum (fresh IV every seal)', async () => {
    const local = await getLocalSyncState({ flights: [flight()], tripMetadata: [], providerAirports: [], settings: DEFAULT_APP_SETTINGS })
    const flightRecord = local.records.find((record) => record.entityType === 'flight')!
    const [sealedOnce] = await sealRecordsForUpload([flightRecord], PASSPHRASE, { iterations: FAST_ITERATIONS })
    const [sealedAgain] = await sealRecordsForUpload([flightRecord], PASSPHRASE, { iterations: FAST_ITERATIONS })
    // Identical plaintext, same passphrase -- if the checksum were plaintext-derived
    // these would match, letting a reader enumerate/dictionary-attack content or spot
    // unchanged records across pushes. A fresh random IV per seal must keep them apart.
    expect(sealedOnce.checksum).not.toBe(sealedAgain.checksum)
  })

  it('comes back locked (not decrypted) without a passphrase, and never surfaces as pullable', async () => {
    const local = await getLocalSyncState({ flights: [flight()], tripMetadata: [], providerAirports: [], settings: DEFAULT_APP_SETTINGS })
    const flightRecord = local.records.find((record) => record.entityType === 'flight')!
    const [sealed] = await sealRecordsForUpload([flightRecord], PASSPHRASE, { iterations: FAST_ITERATIONS })

    const { client } = mockSyncClient([remoteRow(sealed)])
    const remote = await getRemoteSyncState(client)
    const [locked] = remote.records.filter((record) => record.entityType === 'flight')
    expect(locked.locked).toBe(true)
    expect(locked.record).toBeUndefined()

    const emptyLocal = await getLocalSyncState({ flights: [], tripMetadata: [], providerAirports: [], settings: DEFAULT_APP_SETTINGS })
    const comparison = compareLocalAndRemote(emptyLocal, remote)
    const item = comparison.items.find((entry) => entry.entityType === 'flight')
    expect(item?.status).toBe('locked')
    expect(comparison.locked).toHaveLength(1)
    expect(comparison.remoteOnly).toHaveLength(0) // locked records are never mistaken for pullable content
    expect(pullRemoteChanges(comparison)).toHaveLength(0)
    expect(syncRecordLabel(item!)).toContain('locked')
  })

  it('throws SealedSyncPassphraseError on a wrong passphrase instead of silently locking', async () => {
    const local = await getLocalSyncState({ flights: [flight()], tripMetadata: [], providerAirports: [], settings: DEFAULT_APP_SETTINGS })
    const flightRecord = local.records.find((record) => record.entityType === 'flight')!
    const [sealed] = await sealRecordsForUpload([flightRecord], PASSPHRASE, { iterations: FAST_ITERATIONS })
    const { client } = mockSyncClient([remoteRow(sealed)])
    await expect(getRemoteSyncState(client, { passphrase: 'the wrong passphrase' })).rejects.toBeInstanceOf(SealedSyncPassphraseError)
  })

  it('mixes sealed and unsealed records in the same sync state without either interfering with the other', async () => {
    const local = await getLocalSyncState({ flights: [flight({ id: 'sealed-flight' }), flight({ id: 'plain-flight', flightNumber: 'UA1' })], tripMetadata: [], providerAirports: [], settings: DEFAULT_APP_SETTINGS })
    const [sealedSource, plainSource] = local.records.filter((record) => record.entityType === 'flight')
    const [sealed] = await sealRecordsForUpload([sealedSource], PASSPHRASE, { iterations: FAST_ITERATIONS })

    const { client } = mockSyncClient([remoteRow(sealed), remoteRow(plainSource)])
    const remote = await getRemoteSyncState(client, { passphrase: PASSPHRASE })
    const flights = remote.records.filter((record) => record.entityType === 'flight')
    expect(flights).toHaveLength(2)
    expect(flights.find((record) => record.localId === 'sealed-flight')?.sealed).toBe(true)
    expect(flights.find((record) => record.localId === 'plain-flight')?.sealed).toBeFalsy()
  })
})
