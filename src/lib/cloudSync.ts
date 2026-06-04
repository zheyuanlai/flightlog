import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppSettings, FlightLogEntry, ProviderAirportSnapshot, SyncEntityType, TripMetadata } from '../types'
import { normalizeAppSettings } from '../utils/settings'

type SupabaseLike = Pick<SupabaseClient, 'from'>

export interface SyncRecord {
  entityType: SyncEntityType
  localId: string
  record: unknown
  checksum: string
  recordUpdatedAt?: string
  deletedAt?: string
  deviceId?: string
}

export interface SyncState {
  records: SyncRecord[]
  byKey: Map<string, SyncRecord>
  counts: Record<SyncEntityType, number>
}

export type SyncComparisonStatus = 'local-only' | 'remote-only' | 'same' | 'conflict'
export type SyncConflictAction = 'keep-local' | 'use-cloud' | 'skip'

export interface SyncComparisonItem {
  key: string
  entityType: SyncEntityType
  localId: string
  status: SyncComparisonStatus
  local?: SyncRecord
  remote?: SyncRecord
  newerSide?: 'local' | 'remote' | 'unknown'
}

export interface SyncComparison {
  local: SyncState
  remote: SyncState
  items: SyncComparisonItem[]
  localOnly: SyncComparisonItem[]
  remoteOnly: SyncComparisonItem[]
  same: SyncComparisonItem[]
  conflicts: SyncComparisonItem[]
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

const entityTypes: SyncEntityType[] = ['flight', 'tripMetadata', 'providerAirport', 'appSettings']
const deletionLimitation = 'Cloud Sync Lite v1.7 does not automatically propagate deletions. Missing local records are treated as remote-only records until deletion sync is added.'

function syncKey(entityType: SyncEntityType, localId: string): string {
  return `${entityType}:${localId}`
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]))
  }
  return value
}

export function normalizeRecordForSync(record: unknown): unknown {
  return canonicalize(record)
}

export async function computeRecordChecksum(record: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(normalizeRecordForSync(record))))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function updatedAtFromRecord(record: unknown): string | undefined {
  if (record && typeof record === 'object' && 'updatedAt' in record && typeof record.updatedAt === 'string') return record.updatedAt
  return undefined
}

function recordCounts(records: SyncRecord[]): Record<SyncEntityType, number> {
  return Object.fromEntries(entityTypes.map((entityType) => [entityType, records.filter((record) => record.entityType === entityType).length])) as Record<SyncEntityType, number>
}

function stateFromRecords(records: SyncRecord[]): SyncState {
  return {
    records,
    byKey: new Map(records.map((record) => [syncKey(record.entityType, record.localId), record])),
    counts: recordCounts(records),
  }
}

async function toSyncRecord(entityType: SyncEntityType, localId: string, record: unknown, deviceId?: string, recordUpdatedAt = updatedAtFromRecord(record)): Promise<SyncRecord> {
  return {
    entityType,
    localId,
    record: normalizeRecordForSync(record),
    checksum: await computeRecordChecksum(record),
    recordUpdatedAt,
    deviceId,
  }
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

export async function getRemoteSyncState(client: SupabaseLike | null | undefined): Promise<SyncState> {
  const { data, error } = await assertClient(client)
    .from('synced_records')
    .select('entity_type,local_id,record_json,record_checksum,record_updated_at,deleted_at,device_id')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(cloudSyncErrorMessage(error, 'Unable to load cloud sync records. Run migration 002 if Sync Lite is not set up yet.'))
  const records = ((data ?? []) as SyncedRecordRow[]).map((row) => ({
    entityType: row.entity_type,
    localId: row.local_id,
    record: row.record_json,
    checksum: row.record_checksum,
    recordUpdatedAt: row.record_updated_at ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    deviceId: row.device_id ?? undefined,
  }))
  return stateFromRecords(records)
}

function newerSide(local?: SyncRecord, remote?: SyncRecord): 'local' | 'remote' | 'unknown' {
  const localTime = local?.recordUpdatedAt ? Date.parse(local.recordUpdatedAt) : Number.NaN
  const remoteTime = remote?.recordUpdatedAt ? Date.parse(remote.recordUpdatedAt) : Number.NaN
  if (Number.isNaN(localTime) || Number.isNaN(remoteTime) || localTime === remoteTime) return 'unknown'
  return localTime > remoteTime ? 'local' : 'remote'
}

export function compareLocalAndRemote(local: SyncState, remote: SyncState): SyncComparison {
  const keys = [...new Set([...local.byKey.keys(), ...remote.byKey.keys()])].sort()
  const items = keys.map((key) => {
    const localRecord = local.byKey.get(key)
    const remoteRecord = remote.byKey.get(key)
    const [entityType, ...idParts] = key.split(':')
    const localId = idParts.join(':')
    const status: SyncComparisonStatus = !localRecord
      ? 'remote-only'
      : !remoteRecord
      ? 'local-only'
      : localRecord.checksum === remoteRecord.checksum
      ? 'same'
      : 'conflict'
    return {
      key,
      entityType: entityType as SyncEntityType,
      localId,
      status,
      local: localRecord,
      remote: remoteRecord,
      newerSide: status === 'conflict' ? newerSide(localRecord, remoteRecord) : undefined,
    }
  })
  return {
    local,
    remote,
    items,
    localOnly: items.filter((item) => item.status === 'local-only'),
    remoteOnly: items.filter((item) => item.status === 'remote-only'),
    same: items.filter((item) => item.status === 'same'),
    conflicts: items.filter((item) => item.status === 'conflict'),
  }
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
  const { error } = await client
    .from('synced_records')
    .upsert(options.records.map((record) => ({
      user_id: userId,
      entity_type: record.entityType,
      local_id: record.localId,
      record_json: record.record,
      record_checksum: record.checksum,
      record_updated_at: record.recordUpdatedAt ?? null,
      deleted_at: record.deletedAt ?? null,
      device_id: options.deviceId ?? record.deviceId ?? null,
    })), { onConflict: 'user_id,entity_type,local_id' })
  if (error) throw new Error(cloudSyncErrorMessage(error, 'Unable to push local sync records.'))
  return options.records.length
}

export function pullRemoteChanges(comparison: SyncComparison): SyncRecord[] {
  return comparison.remoteOnly.map((item) => item.remote).filter((record): record is SyncRecord => Boolean(record))
}

export function resolveConflict(item: SyncComparisonItem, action: SyncConflictAction): SyncRecord | undefined {
  if (item.status !== 'conflict') return undefined
  if (action === 'keep-local') return item.local
  if (action === 'use-cloud') return item.remote
  return undefined
}

export function syncRecordLabel(record: SyncRecord | SyncComparisonItem): string {
  const entityType = record.entityType
  const localId = record.localId
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

export function deletionSyncLimitation(): string {
  return deletionLimitation
}
