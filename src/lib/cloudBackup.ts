import type { SupabaseClient } from '@supabase/supabase-js'
import type { FlightLogEntry } from '../types'
import { parseFullBackupJson, previewBackupImport, type BackupImportPreview, type FlightLogBackup } from '../utils/backup'
import { decryptBackupEnvelope, encryptBackupJson, isEncryptedBackupEnvelope, type EncryptedBackupEnvelope } from '../utils/encryptedBackup'

const CLOUD_BACKUP_SUMMARY_COLUMNS = 'id,label,schema_version,backup_checksum,flight_count,trip_metadata_count,provider_airport_count,exported_at,created_at,updated_at,device_id,app_version,is_auto'
const VOLATILE_METADATA_KEYS = new Set([
  'lastBackupAt',
  'lastImportAt',
  'lastCloudBackupAt',
  'lastCloudBackupChecksum',
  'lastCloudBackupId',
  'lastCloudRestoreAt',
  'syncMetadata',
  'cloudRestorePromptDismissedAt',
])

type SupabaseLike = Pick<SupabaseClient, 'from'>

interface CloudBackupDatabaseRow {
  id: string
  user_id?: string
  label?: string | null
  schema_version: number
  backup_json?: FlightLogBackup | EncryptedBackupEnvelope
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

export interface CloudBackupSummary {
  id: string
  label?: string
  schemaVersion: number
  checksum?: string
  flightCount: number
  tripMetadataCount: number
  providerAirportCount: number
  exportedAt?: string
  createdAt: string
  updatedAt?: string
  deviceId?: string
  appVersion?: string
  isAuto: boolean
}

export interface CloudBackupSnapshot extends CloudBackupSummary {
  backup?: FlightLogBackup
  encryptedEnvelope?: EncryptedBackupEnvelope
}

export class EncryptedCloudBackupError extends Error {
  constructor() {
    super('This cloud backup is encrypted end-to-end. Enter its passphrase to continue.')
    this.name = 'EncryptedCloudBackupError'
  }
}

export interface CloudRestorePreview {
  snapshot: CloudBackupSnapshot
  preview: BackupImportPreview
  mode: 'merge' | 'replace'
}

export interface CloudBackupVerification {
  verified: boolean
  expectedChecksum: string
  fetchedChecksum?: string
  warning?: string
}

export function cloudBackupErrorMessage(error: unknown, fallback = 'Cloud backup request failed.'): string {
  if (!error) return fallback
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

function assertClient(client: SupabaseLike | null | undefined): SupabaseLike {
  if (!client) throw new Error('Cloud backup is not configured. Local backups still work.')
  return client
}

function assertSignedIn(userId?: string): string {
  if (!userId) throw new Error('Sign in to use cloud backup.')
  return userId
}

function rowToSummary(row: CloudBackupDatabaseRow): CloudBackupSummary {
  return {
    id: row.id,
    label: row.label ?? undefined,
    schemaVersion: row.schema_version,
    checksum: row.backup_checksum ?? undefined,
    flightCount: row.flight_count ?? 0,
    tripMetadataCount: row.trip_metadata_count ?? 0,
    providerAirportCount: row.provider_airport_count ?? 0,
    exportedAt: row.exported_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    deviceId: row.device_id ?? undefined,
    appVersion: row.app_version ?? undefined,
    isAuto: Boolean(row.is_auto),
  }
}

function rowToSnapshot(row: CloudBackupDatabaseRow): CloudBackupSnapshot {
  if (!row.backup_json) throw new Error('Cloud backup row does not include backup JSON.')
  if (isEncryptedBackupEnvelope(row.backup_json)) {
    return { ...rowToSummary(row), encryptedEnvelope: row.backup_json }
  }
  return { ...rowToSummary(row), backup: row.backup_json }
}

export async function resolveSnapshotBackup(snapshot: CloudBackupSnapshot, passphrase?: string): Promise<FlightLogBackup> {
  if (snapshot.backup) return snapshot.backup
  if (!snapshot.encryptedEnvelope) throw new Error('Cloud backup row does not include backup JSON.')
  if (!passphrase) throw new EncryptedCloudBackupError()
  const decrypted = await decryptBackupEnvelope(snapshot.encryptedEnvelope, passphrase)
  return parseFullBackupJson(decrypted)
}

export function summarizeBackup(backup: FlightLogBackup) {
  return {
    schemaVersion: backup.schemaVersion,
    exportedAt: backup.exportedAt,
    flightCount: backup.flights.length,
    tripMetadataCount: backup.tripMetadata.length,
    providerAirportCount: backup.providerAirports.length,
  }
}

function comparableBackup(backup: FlightLogBackup): FlightLogBackup {
  return {
    ...backup,
    exportedAt: '',
    flights: backup.flights.slice().sort((a, b) => a.id.localeCompare(b.id)),
    tripMetadata: backup.tripMetadata.slice().sort((a, b) => a.id.localeCompare(b.id)),
    providerAirports: backup.providerAirports.slice().sort((a, b) => a.iata.localeCompare(b.iata)),
    appMetadata: backup.appMetadata
      .filter((item) => !VOLATILE_METADATA_KEYS.has(item.key))
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key)),
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]))
  }
  return value
}

export function canonicalBackupJson(backup: FlightLogBackup): string {
  return JSON.stringify(canonicalize(comparableBackup(backup)))
}

export async function computeBackupChecksum(backup: FlightLogBackup): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalBackupJson(backup)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function hasLocalDataChangedSinceCloudBackup(currentChecksum: string | undefined, lastCloudBackupChecksum: string | undefined): boolean {
  return Boolean(currentChecksum && lastCloudBackupChecksum && currentChecksum !== lastCloudBackupChecksum)
}

export async function createCloudBackupSnapshot(options: {
  client: SupabaseLike | null | undefined
  userId?: string
  backup: FlightLogBackup
  label?: string
  deviceId?: string
  appVersion?: string
  isAuto?: boolean
  encryptPassphrase?: string
}): Promise<CloudBackupSummary> {
  const client = assertClient(options.client)
  const userId = assertSignedIn(options.userId)
  const summary = summarizeBackup(options.backup)
  const checksum = await computeBackupChecksum(options.backup)
  const payload: FlightLogBackup | EncryptedBackupEnvelope = options.encryptPassphrase
    ? await encryptBackupJson(JSON.stringify(options.backup), options.encryptPassphrase)
    : options.backup
  const { data, error } = await client
    .from('cloud_backups')
    .insert({
      user_id: userId,
      label: options.label?.trim() || null,
      schema_version: summary.schemaVersion,
      backup_json: payload,
      // For encrypted snapshots the plaintext checksum would act as an
      // equality/change oracle for anyone with database read access, so it is
      // intentionally not stored; verification decrypts and recomputes instead.
      backup_checksum: options.encryptPassphrase ? null : checksum,
      flight_count: summary.flightCount,
      trip_metadata_count: summary.tripMetadataCount,
      provider_airport_count: summary.providerAirportCount,
      exported_at: summary.exportedAt,
      device_id: options.deviceId ?? null,
      app_version: options.appVersion ?? null,
      is_auto: Boolean(options.isAuto),
    })
    .select(CLOUD_BACKUP_SUMMARY_COLUMNS)
    .single()
  if (error) throw new Error(cloudBackupErrorMessage(error, 'Unable to upload cloud backup.'))
  return rowToSummary(data as CloudBackupDatabaseRow)
}

export async function verifyCloudBackupSnapshot(options: {
  client: SupabaseLike | null | undefined
  id: string
  expectedChecksum: string
  passphrase?: string
}): Promise<CloudBackupVerification> {
  const snapshot = await getCloudBackup(options.client, options.id)
  const fetchedChecksum = snapshot.encryptedEnvelope
    ? (options.passphrase ? await computeBackupChecksum(await resolveSnapshotBackup(snapshot, options.passphrase)) : undefined)
    : snapshot.backup
      ? await computeBackupChecksum(snapshot.backup)
      : snapshot.checksum
  const verified = fetchedChecksum === options.expectedChecksum
  return {
    verified,
    expectedChecksum: options.expectedChecksum,
    fetchedChecksum,
    warning: verified
      ? undefined
      : snapshot.encryptedEnvelope && !options.passphrase
        ? 'Encrypted backup stored; content verification was skipped without the passphrase.'
        : 'Uploaded backup was saved, but verification checksum did not match.',
  }
}

export async function listCloudBackups(client: SupabaseLike | null | undefined): Promise<CloudBackupSummary[]> {
  const { data, error } = await assertClient(client)
    .from('cloud_backups')
    .select(CLOUD_BACKUP_SUMMARY_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw new Error(cloudBackupErrorMessage(error, 'Unable to list cloud backups.'))
  return ((data ?? []) as CloudBackupDatabaseRow[]).map(rowToSummary)
}

export async function getCloudBackup(client: SupabaseLike | null | undefined, id: string): Promise<CloudBackupSnapshot> {
  const { data, error } = await assertClient(client)
    .from('cloud_backups')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw new Error(cloudBackupErrorMessage(error, 'Cloud backup not found.'))
  return rowToSnapshot(data as CloudBackupDatabaseRow)
}

export async function deleteCloudBackup(client: SupabaseLike | null | undefined, id: string): Promise<void> {
  const { error } = await assertClient(client)
    .from('cloud_backups')
    .delete()
    .eq('id', id)
  if (error) throw new Error(cloudBackupErrorMessage(error, 'Unable to delete cloud backup.'))
}

export async function deleteAllCloudBackups(client: SupabaseLike | null | undefined): Promise<number> {
  const backups = await listCloudBackups(client)
  if (backups.length === 0) return 0
  const { error } = await assertClient(client)
    .from('cloud_backups')
    .delete()
    .in('id', backups.map((backup) => backup.id))
  if (error) throw new Error(cloudBackupErrorMessage(error, 'Unable to delete cloud backups.'))
  return backups.length
}

export async function deleteOlderCloudBackups(client: SupabaseLike | null | undefined, keepLatest = 10): Promise<number> {
  const backups = await listCloudBackups(client)
  const oldBackups = backups.slice(Math.max(0, keepLatest))
  if (oldBackups.length === 0) return 0
  const { error } = await assertClient(client)
    .from('cloud_backups')
    .delete()
    .in('id', oldBackups.map((backup) => backup.id))
  if (error) throw new Error(cloudBackupErrorMessage(error, 'Unable to delete older cloud backups.'))
  return oldBackups.length
}

export async function restoreCloudBackup(options: {
  client: SupabaseLike | null | undefined
  id: string
  existingFlights: FlightLogEntry[]
  mode: 'merge' | 'replace'
  passphrase?: string
}): Promise<CloudRestorePreview> {
  const snapshot = await getCloudBackup(options.client, options.id)
  const backup = await resolveSnapshotBackup(snapshot, options.passphrase)
  return {
    snapshot,
    preview: previewBackupImport(backup, options.existingFlights),
    mode: options.mode,
  }
}
