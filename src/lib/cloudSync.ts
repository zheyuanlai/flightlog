import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppSettings, FlightLogEntry, ProviderAirportSnapshot, SyncDevice, SyncEntityType, SyncEventLog, SyncEventType, SyncOperation, TripMetadata } from '../types'
import { isEncryptedBackupEnvelope } from '../utils/encryptedBackup'
import { sealSyncRecord, SealedSyncPassphraseError, unsealSyncRecord } from '../utils/sealedSync'
import { normalizeAppSettings } from '../utils/settings'
import { redactedSummary } from '../utils/syncHistory'

type SupabaseLike = Pick<SupabaseClient, 'from'>

export interface SyncRecord {
  entityType: SyncEntityType
  localId: string
  record: unknown
  checksum: string
  contentChecksum: string
  recordUpdatedAt?: string
  deletedAt?: string
  deletedByDeviceId?: string
  deleteReason?: string
  tombstoneVersion?: number
  lastOperation?: SyncOperation
  deviceId?: string
  /** True when this remote record is end-to-end encrypted (Sealed Sync). */
  sealed?: boolean
  /** True when a sealed record could not be decrypted (no or wrong passphrase). `record` is undefined; the record cannot be pushed, pulled, or diffed until unlocked. */
  locked?: boolean
}

export interface SyncState {
  records: SyncRecord[]
  byKey: Map<string, SyncRecord>
  counts: Record<SyncEntityType, number>
  deletedCount: number
}

export type SyncComparisonStatus =
  | 'local-only'
  | 'remote-only'
  | 'same'
  | 'deleted-same'
  | 'conflict'
  | 'tombstone-to-push'
  | 'tombstone-to-pull'
  | 'delete-conflict'
  | 'locked'

export type SyncConflictAction = 'keep-local' | 'use-cloud' | 'keep-deleted' | 'restore-local' | 'restore-cloud' | 'skip'

export interface SyncComparisonItem {
  key: string
  entityType: SyncEntityType
  localId: string
  status: SyncComparisonStatus
  local?: SyncRecord
  remote?: SyncRecord
  newerSide?: 'local' | 'remote' | 'unknown'
  deletionSide?: 'local' | 'remote' | 'both' | 'none'
}

export interface SyncComparison {
  local: SyncState
  remote: SyncState
  items: SyncComparisonItem[]
  localOnly: SyncComparisonItem[]
  remoteOnly: SyncComparisonItem[]
  same: SyncComparisonItem[]
  deletedSame: SyncComparisonItem[]
  conflicts: SyncComparisonItem[]
  updateConflicts: SyncComparisonItem[]
  deleteConflicts: SyncComparisonItem[]
  tombstonesToPush: SyncComparisonItem[]
  tombstonesToPull: SyncComparisonItem[]
  /** Sealed remote records that could not be decrypted (no or wrong passphrase). */
  locked: SyncComparisonItem[]
}

interface SyncedRecordRow {
  entity_type: SyncEntityType
  local_id: string
  record_json: unknown
  record_checksum: string
  record_updated_at?: string | null
  deleted_at?: string | null
  device_id?: string | null
}

interface SyncEventRow {
  id: string
  event_type: SyncEventType
  device_id?: string | null
  summary?: Record<string, unknown> | null
  created_at: string
}

interface SyncDeviceRow {
  id: string
  device_id: string
  device_name?: string | null
  last_seen_at?: string | null
  last_sync_event_at?: string | null
  user_agent?: string | null
  created_at?: string | null
  updated_at?: string | null
}

const entityTypes: SyncEntityType[] = ['flight', 'tripMetadata', 'providerAirport', 'appSettings']
const tombstoneKeys = new Set(['deletedAt', 'deletedByDeviceId', 'deleteReason', 'restoredAt', 'tombstoneVersion', 'lastOperation'])
const volatileChecksumKeys = new Set(['updatedAt'])

function syncKey(entityType: SyncEntityType, localId: string): string {
  return `${entityType}:${localId}`
}

function canonicalize(value: unknown, options: { omitTombstone?: boolean; omitVolatile?: boolean } = {}): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, options))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !(options.omitTombstone && tombstoneKeys.has(key)))
      .filter(([key]) => !(options.omitVolatile && volatileChecksumKeys.has(key)))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item, options)]))
  }
  return value
}

function recordString(value: unknown, key: string): string | undefined {
  if (value && typeof value === 'object' && key in value && typeof (value as Record<string, unknown>)[key] === 'string') return (value as Record<string, string>)[key]
  return undefined
}

function recordNumber(value: unknown, key: string): number | undefined {
  if (value && typeof value === 'object' && key in value && typeof (value as Record<string, unknown>)[key] === 'number') return (value as Record<string, number>)[key]
  return undefined
}

function updatedAtFromRecord(record: unknown): string | undefined {
  return recordString(record, 'updatedAt')
}

export function isSyncRecordDeleted(record: Pick<SyncRecord, 'deletedAt'> | undefined): boolean {
  return Boolean(record?.deletedAt)
}

export function normalizeRecordForSync(record: unknown): unknown {
  return canonicalize(record, { omitVolatile: true })
}

export function normalizeRecordContentForSync(record: unknown): unknown {
  return canonicalize(record, { omitTombstone: true, omitVolatile: true })
}

async function sha256(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function computeRecordChecksum(record: unknown): Promise<string> {
  return sha256(normalizeRecordForSync(record))
}

export async function computeRecordContentChecksum(record: unknown): Promise<string> {
  return sha256(normalizeRecordContentForSync(record))
}

function recordCounts(records: SyncRecord[]): Record<SyncEntityType, number> {
  return Object.fromEntries(entityTypes.map((entityType) => [entityType, records.filter((record) => record.entityType === entityType).length])) as Record<SyncEntityType, number>
}

function stateFromRecords(records: SyncRecord[]): SyncState {
  return {
    records,
    byKey: new Map(records.map((record) => [syncKey(record.entityType, record.localId), record])),
    counts: recordCounts(records),
    deletedCount: records.filter(isSyncRecordDeleted).length,
  }
}

async function toSyncRecord(entityType: SyncEntityType, localId: string, record: unknown, deviceId?: string, recordUpdatedAt = updatedAtFromRecord(record)): Promise<SyncRecord> {
  const deletedAt = recordString(record, 'deletedAt')
  const restoredAt = recordString(record, 'restoredAt')
  return {
    entityType,
    localId,
    record: normalizeRecordForSync(record),
    checksum: await computeRecordChecksum(record),
    contentChecksum: await computeRecordContentChecksum(record),
    recordUpdatedAt,
    deletedAt,
    deletedByDeviceId: recordString(record, 'deletedByDeviceId'),
    deleteReason: recordString(record, 'deleteReason'),
    tombstoneVersion: recordNumber(record, 'tombstoneVersion') ?? (deletedAt ? 1 : undefined),
    lastOperation: (recordString(record, 'lastOperation') as SyncOperation | undefined) ?? (deletedAt ? 'delete' : restoredAt ? 'restore' : undefined),
    deviceId,
  }
}

export async function buildSyncRecord(entityType: SyncEntityType, localId: string, record: unknown, deviceId?: string): Promise<SyncRecord> {
  return toSyncRecord(entityType, localId, record, deviceId)
}

export async function getLocalSyncState(input: {
  flights: FlightLogEntry[]
  tripMetadata: TripMetadata[]
  providerAirports: ProviderAirportSnapshot[]
  settings: AppSettings
  deviceId?: string
  settingsUpdatedAt?: string
}): Promise<SyncState> {
  const records = await Promise.all([
    ...input.flights.map((flight) => toSyncRecord('flight', flight.id, flight, input.deviceId)),
    ...input.tripMetadata.map((metadata) => toSyncRecord('tripMetadata', metadata.id, metadata, input.deviceId)),
    ...input.providerAirports.map((airport) => toSyncRecord('providerAirport', airport.iata, airport, input.deviceId, airport.updatedAt)),
    toSyncRecord('appSettings', 'settings', normalizeAppSettings(input.settings), input.deviceId, input.settingsUpdatedAt),
  ])
  return stateFromRecords(records)
}

export function cloudSyncErrorMessage(error: unknown, fallback = 'Cloud sync request failed.'): string {
  if (!error) return fallback
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

function assertClient(client: SupabaseLike | null | undefined): SupabaseLike {
  if (!client) throw new Error('Cloud Sync Lite is not configured. Local data still works.')
  return client
}

function assertSignedIn(userId?: string): string {
  if (!userId) throw new Error('Sign in to use Cloud Sync Lite.')
  return userId
}

/**
 * Fetches and decodes remote sync records. When a row's `record_json` is a Sealed
 * Sync envelope (see src/utils/sealedSync.ts), a `passphrase` is required to read
 * its content: with the right passphrase the record decrypts transparently and
 * behaves exactly like a plaintext record for comparison and merge; without one
 * (or with a wrong one further down) it comes back `locked` — visible (its
 * cleartext routing columns: entity type, id, timestamps, deletion state) but
 * with `record: undefined`, so it can never be pulled, pushed over, or diffed
 * without first being unlocked. A wrong passphrase throws SealedSyncPassphraseError
 * so the caller can re-prompt, rather than silently treating every sealed record
 * on this fetch as locked.
 */
export async function getRemoteSyncState(client: SupabaseLike | null | undefined, options: { passphrase?: string } = {}): Promise<SyncState> {
  const { data, error } = await assertClient(client)
    .from('synced_records')
    .select('entity_type,local_id,record_json,record_checksum,record_updated_at,deleted_at,device_id')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(cloudSyncErrorMessage(error, 'Unable to load cloud sync records. Run migration 002 and 003 if Sync Lite is not set up yet.'))
  const records = await Promise.all(((data ?? []) as SyncedRecordRow[]).map(async (row) => {
    const envelope = row.record_json
    const sealed = isEncryptedBackupEnvelope(envelope)
    let payload: unknown = row.record_json
    if (isEncryptedBackupEnvelope(envelope)) {
      if (!options.passphrase) {
        return {
          entityType: row.entity_type,
          localId: row.local_id,
          record: undefined,
          checksum: `locked:${row.record_checksum ?? row.local_id}`,
          contentChecksum: `locked:${row.record_checksum ?? row.local_id}`,
          recordUpdatedAt: row.record_updated_at ?? undefined,
          deletedAt: row.deleted_at ?? undefined,
          deviceId: row.device_id ?? undefined,
          sealed: true,
          locked: true,
        } satisfies SyncRecord
      }
      // A wrong passphrase throws SealedSyncPassphraseError, which propagates out of
      // this Promise.all so the caller can catch it and re-prompt rather than every
      // sealed row on this fetch silently coming back locked with a stale passphrase.
      payload = await unsealSyncRecord(envelope, options.passphrase)
    }
    const deletedAt = row.deleted_at ?? recordString(payload, 'deletedAt')
    const rawRecord = payload && typeof payload === 'object' && deletedAt
      ? { ...payload as Record<string, unknown>, deletedAt }
      : payload
    // Normalize the remote appSettings record to the same canonical shape the
    // local side uses (line ~204), so a device that predates a newly added
    // setting field does not produce a phantom, sticky conflict after upgrade.
    const record = row.entity_type === 'appSettings' ? normalizeAppSettings(rawRecord) : rawRecord
    return {
      entityType: row.entity_type,
      localId: row.local_id,
      record,
      checksum: await computeRecordChecksum(record),
      contentChecksum: await computeRecordContentChecksum(record),
      recordUpdatedAt: row.record_updated_at ?? updatedAtFromRecord(record),
      deletedAt: deletedAt ?? undefined,
      deletedByDeviceId: recordString(record, 'deletedByDeviceId'),
      deleteReason: recordString(record, 'deleteReason'),
      tombstoneVersion: recordNumber(record, 'tombstoneVersion') ?? (deletedAt ? 1 : undefined),
      lastOperation: (recordString(record, 'lastOperation') as SyncOperation | undefined) ?? (deletedAt ? 'delete' : undefined),
      deviceId: row.device_id ?? undefined,
      sealed,
    } satisfies SyncRecord
  }))
  return stateFromRecords(records)
}

export { SealedSyncPassphraseError }

/**
 * Encrypts each record's content for upload (Sealed Sync). Checksums are left as
 * already computed from the plaintext, so the next fetch — after decrypting with
 * the same passphrase — recomputes the identical checksum; the server only ever
 * sees a one-way content hash alongside the ciphertext, never the passphrase or key.
 */
export async function sealRecordsForUpload(records: SyncRecord[], passphrase: string, options: { iterations?: number } = {}): Promise<SyncRecord[]> {
  return Promise.all(records.map(async (record) => ({
    ...record,
    record: await sealSyncRecord(record.record, passphrase, options),
    sealed: true,
  })))
}

function newerSide(local?: SyncRecord, remote?: SyncRecord): 'local' | 'remote' | 'unknown' {
  const localTime = local?.recordUpdatedAt ? Date.parse(local.recordUpdatedAt) : Number.NaN
  const remoteTime = remote?.recordUpdatedAt ? Date.parse(remote.recordUpdatedAt) : Number.NaN
  if (Number.isNaN(localTime) || Number.isNaN(remoteTime) || localTime === remoteTime) return 'unknown'
  return localTime > remoteTime ? 'local' : 'remote'
}

export function compareDeletionState(local?: SyncRecord, remote?: SyncRecord): SyncComparisonStatus | undefined {
  const localDeleted = isSyncRecordDeleted(local)
  const remoteDeleted = isSyncRecordDeleted(remote)
  if (local && !remote) return localDeleted ? 'tombstone-to-push' : 'local-only'
  if (!local && remote) return remoteDeleted ? 'tombstone-to-pull' : 'remote-only'
  if (!local || !remote) return undefined
  if (localDeleted && remoteDeleted) return 'deleted-same'
  if (localDeleted && !remoteDeleted) return local.contentChecksum === remote.contentChecksum ? 'tombstone-to-push' : 'delete-conflict'
  if (!localDeleted && remoteDeleted) return local.contentChecksum === remote.contentChecksum ? 'tombstone-to-pull' : 'delete-conflict'
  return undefined
}

export function compareLocalAndRemote(local: SyncState, remote: SyncState): SyncComparison {
  const keys = [...new Set([...local.byKey.keys(), ...remote.byKey.keys()])].sort()
  const items = keys.map((key) => {
    const localRecord = local.byKey.get(key)
    const remoteRecord = remote.byKey.get(key)
    const [entityType, ...idParts] = key.split(':')
    const localId = idParts.join(':')
    const deletionStatus = compareDeletionState(localRecord, remoteRecord)
    const status: SyncComparisonStatus = remoteRecord?.locked
      ? 'locked'
      : deletionStatus ?? (!localRecord
        ? 'remote-only'
        : !remoteRecord
          ? 'local-only'
          : localRecord.checksum === remoteRecord.checksum
            ? 'same'
            : 'conflict')
    const localDeleted = isSyncRecordDeleted(localRecord)
    const remoteDeleted = isSyncRecordDeleted(remoteRecord)
    return {
      key,
      entityType: entityType as SyncEntityType,
      localId,
      status,
      local: localRecord,
      remote: remoteRecord,
      newerSide: status === 'conflict' || status === 'delete-conflict' ? newerSide(localRecord, remoteRecord) : undefined,
      deletionSide: localDeleted && remoteDeleted ? 'both' : localDeleted ? 'local' : remoteDeleted ? 'remote' : 'none',
    } satisfies SyncComparisonItem
  })
  const updateConflicts = items.filter((item) => item.status === 'conflict')
  const deleteConflicts = items.filter((item) => item.status === 'delete-conflict')
  const deletedSame = items.filter((item) => item.status === 'deleted-same')
  return {
    local,
    remote,
    items,
    localOnly: items.filter((item) => item.status === 'local-only'),
    remoteOnly: items.filter((item) => item.status === 'remote-only'),
    same: items.filter((item) => item.status === 'same' || item.status === 'deleted-same'),
    deletedSame,
    conflicts: [...updateConflicts, ...deleteConflicts],
    updateConflicts,
    deleteConflicts,
    tombstonesToPush: items.filter((item) => item.status === 'tombstone-to-push'),
    tombstonesToPull: items.filter((item) => item.status === 'tombstone-to-pull'),
    locked: items.filter((item) => item.status === 'locked'),
  }
}

function extendedPayload(record: SyncRecord, userId: string, deviceId?: string): Record<string, unknown> {
  return {
    user_id: userId,
    entity_type: record.entityType,
    local_id: record.localId,
    record_json: record.record,
    record_checksum: record.checksum,
    record_updated_at: record.recordUpdatedAt ?? null,
    deleted_at: record.deletedAt ?? null,
    deleted_by_device_id: record.deletedByDeviceId ?? null,
    delete_reason: record.deleteReason ?? null,
    tombstone_version: record.tombstoneVersion ?? 1,
    last_operation: record.lastOperation ?? (record.deletedAt ? 'delete' : 'update'),
    device_id: deviceId ?? record.deviceId ?? null,
  }
}

function legacyPayload(record: SyncRecord, userId: string, deviceId?: string): Record<string, unknown> {
  return {
    user_id: userId,
    entity_type: record.entityType,
    local_id: record.localId,
    record_json: record.record,
    record_checksum: record.checksum,
    record_updated_at: record.recordUpdatedAt ?? null,
    deleted_at: record.deletedAt ?? null,
    device_id: deviceId ?? record.deviceId ?? null,
  }
}

function canRetryLegacy(error: unknown): boolean {
  const message = cloudSyncErrorMessage(error, '').toLowerCase()
  return message.includes('deleted_by_device_id') || message.includes('delete_reason') || message.includes('tombstone_version') || message.includes('last_operation') || message.includes('column')
}

export async function pushLocalChanges(options: {
  client: SupabaseLike | null | undefined
  userId?: string
  records: SyncRecord[]
  deviceId?: string
}): Promise<number> {
  const client = assertClient(options.client)
  const userId = assertSignedIn(options.userId)
  if (options.records.length === 0) return 0
  const rows = options.records.map((record) => extendedPayload(record, userId, options.deviceId))
  const result = await client
    .from('synced_records')
    .upsert(rows, { onConflict: 'user_id,entity_type,local_id' })
  if (result.error) {
    if (!canRetryLegacy(result.error)) throw new Error(cloudSyncErrorMessage(result.error, 'Unable to push local sync records.'))
    const retry = await client
      .from('synced_records')
      .upsert(options.records.map((record) => legacyPayload(record, userId, options.deviceId)), { onConflict: 'user_id,entity_type,local_id' })
    if (retry.error) throw new Error(cloudSyncErrorMessage(retry.error, 'Unable to push local sync records.'))
  }
  return options.records.length
}

export async function pushTombstones(options: {
  client: SupabaseLike | null | undefined
  userId?: string
  records: SyncRecord[]
  deviceId?: string
}): Promise<number> {
  return pushLocalChanges({ ...options, records: options.records.filter(isSyncRecordDeleted) })
}

export function pullRemoteChanges(comparison: SyncComparison): SyncRecord[] {
  return comparison.remoteOnly.map((item) => item.remote).filter((record): record is SyncRecord => Boolean(record && !record.deletedAt && !record.locked))
}

export function pullTombstones(comparison: SyncComparison): SyncRecord[] {
  return comparison.tombstonesToPull.map((item) => item.remote).filter((record): record is SyncRecord => Boolean(record?.deletedAt && !record.locked))
}

export function restoreRecordFromTombstone<T extends Record<string, unknown>>(record: T, now = new Date().toISOString()): T {
  return {
    ...record,
    deletedAt: undefined,
    deletedByDeviceId: undefined,
    deleteReason: undefined,
    restoredAt: now,
    lastOperation: 'restore',
    updatedAt: now,
  }
}

export function resolveConflict(item: SyncComparisonItem, action: SyncConflictAction): SyncRecord | undefined {
  if (item.status !== 'conflict' && item.status !== 'delete-conflict') return undefined
  if (action === 'keep-local') return item.local
  if (action === 'use-cloud') return item.remote
  if (action === 'keep-deleted') return item.local?.deletedAt ? item.local : item.remote?.deletedAt ? item.remote : undefined
  if (action === 'restore-local') return item.local && !item.local.deletedAt ? item.local : undefined
  if (action === 'restore-cloud') return item.remote && !item.remote.deletedAt ? item.remote : undefined
  return undefined
}

export function listRecentlyDeleted(state: SyncState): SyncRecord[] {
  return state.records.filter(isSyncRecordDeleted).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''))
}

export function syncRecordLabel(record: SyncRecord | SyncComparisonItem): string {
  const entityType = record.entityType
  const localId = record.localId
  const locked = 'record' in record ? record.locked : record.remote?.locked
  if (locked) return `${localId} (locked)`
  const source = 'record' in record ? record.record : record.local?.record ?? record.remote?.record
  if (entityType === 'flight' && source && typeof source === 'object') {
    const flight = source as Partial<FlightLogEntry>
    return [flight.flightNumber, flight.origin && flight.destination ? `${flight.origin}-${flight.destination}` : undefined].filter(Boolean).join(' · ') || localId
  }
  if (entityType === 'tripMetadata' && source && typeof source === 'object') return (source as Partial<TripMetadata>).name || localId
  if (entityType === 'providerAirport') return localId
  if (entityType === 'appSettings') return 'App settings'
  return localId
}

export async function logRemoteSyncEvent(options: {
  client: SupabaseLike | null | undefined
  userId?: string
  event: SyncEventLog
}): Promise<boolean> {
  const client = assertClient(options.client)
  const userId = assertSignedIn(options.userId)
  const { error } = await client
    .from('sync_events')
    .insert({
      id: options.event.id,
      user_id: userId,
      event_type: options.event.eventType,
      device_id: options.event.deviceId ?? null,
      summary: redactedSummary({ ...(options.event.summary ?? {}), safeError: options.event.safeError }) ?? null,
      created_at: options.event.createdAt,
    })
  return !error
}

export async function listRemoteSyncEvents(client: SupabaseLike | null | undefined): Promise<SyncEventLog[]> {
  const { data, error } = await assertClient(client)
    .from('sync_events')
    .select('id,event_type,device_id,summary,created_at')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return []
  return ((data ?? []) as SyncEventRow[]).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    deviceId: row.device_id ?? undefined,
    summary: row.summary ?? undefined,
    createdAt: row.created_at,
  }))
}

export async function registerSyncDevice(options: {
  client: SupabaseLike | null | undefined
  userId?: string
  device: SyncDevice
}): Promise<boolean> {
  const client = assertClient(options.client)
  const userId = assertSignedIn(options.userId)
  const { error } = await client
    .from('sync_devices')
    .upsert({
      user_id: userId,
      device_id: options.device.deviceId,
      device_name: options.device.deviceName ?? null,
      last_seen_at: options.device.lastSeenAt ?? new Date().toISOString(),
      last_sync_event_at: options.device.lastSyncEventAt ?? null,
      user_agent: options.device.userAgent ?? null,
    }, { onConflict: 'user_id,device_id' })
  return !error
}

export async function listSyncDevices(client: SupabaseLike | null | undefined, currentDeviceId?: string): Promise<SyncDevice[]> {
  const { data, error } = await assertClient(client)
    .from('sync_devices')
    .select('id,device_id,device_name,last_seen_at,last_sync_event_at,user_agent,created_at,updated_at')
    .order('last_seen_at', { ascending: false })
  if (error) return []
  return ((data ?? []) as SyncDeviceRow[]).map((row) => ({
    id: row.id,
    deviceId: row.device_id,
    deviceName: row.device_name ?? undefined,
    lastSeenAt: row.last_seen_at ?? undefined,
    lastSyncEventAt: row.last_sync_event_at ?? undefined,
    userAgent: row.user_agent ?? undefined,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
    isCurrent: row.device_id === currentDeviceId,
  }))
}
