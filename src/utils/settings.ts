import type { AppMetadata, AppSettings, FlightPurpose, LanguageSetting, LiveDataMode, SyncMetadata } from '../types'

export const SETTINGS_METADATA_KEY = 'settings'
export const SYNC_METADATA_KEY = 'syncMetadata'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  distanceUnit: 'kilometers',
  timeFormat: 'system',
  dateFormat: 'medium',
  theme: 'system',
  language: 'system',
  defaultCabin: '',
  defaultPurpose: 'personal',
  backupReminderEnabled: true,
  backupAgeThresholdDays: 30,
  syncReminderEnabled: true,
  upcomingFlightRefreshReminderEnabled: true,
  dayOfNotificationsEnabled: false,
  liveDataMode: 'real',
}

const distanceUnits = new Set<AppSettings['distanceUnit']>(['miles', 'kilometers'])
const timeFormats = new Set<AppSettings['timeFormat']>(['system', '12h', '24h'])
const dateFormats = new Set<AppSettings['dateFormat']>(['compact', 'medium', 'iso'])
const themes = new Set<AppSettings['theme']>(['system', 'light', 'dark'])
const languages = new Set<LanguageSetting>(['system', 'en', 'zh-CN', 'zh-TW', 'ja'])
const cabins = new Set<AppSettings['defaultCabin']>(['', 'Economy', 'Premium Economy', 'Business', 'First'])
const purposes = new Set<'' | FlightPurpose>(['', 'personal', 'work', 'school', 'other'])
const liveDataModes = new Set<LiveDataMode>(['real', 'mock', 'disabled'])

function parseObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<AppSettings> : {}
  return {
    distanceUnit: distanceUnits.has(input.distanceUnit as AppSettings['distanceUnit']) ? input.distanceUnit as AppSettings['distanceUnit'] : DEFAULT_APP_SETTINGS.distanceUnit,
    timeFormat: timeFormats.has(input.timeFormat as AppSettings['timeFormat']) ? input.timeFormat as AppSettings['timeFormat'] : DEFAULT_APP_SETTINGS.timeFormat,
    dateFormat: dateFormats.has(input.dateFormat as AppSettings['dateFormat']) ? input.dateFormat as AppSettings['dateFormat'] : DEFAULT_APP_SETTINGS.dateFormat,
    theme: themes.has(input.theme as AppSettings['theme']) ? input.theme as AppSettings['theme'] : DEFAULT_APP_SETTINGS.theme,
    language: languages.has(input.language as LanguageSetting) ? input.language as LanguageSetting : DEFAULT_APP_SETTINGS.language,
    defaultCabin: cabins.has(input.defaultCabin as AppSettings['defaultCabin']) ? input.defaultCabin as AppSettings['defaultCabin'] : DEFAULT_APP_SETTINGS.defaultCabin,
    defaultPurpose: purposes.has(input.defaultPurpose as AppSettings['defaultPurpose']) ? input.defaultPurpose as AppSettings['defaultPurpose'] : DEFAULT_APP_SETTINGS.defaultPurpose,
    backupReminderEnabled: booleanSetting(input.backupReminderEnabled, DEFAULT_APP_SETTINGS.backupReminderEnabled),
    backupAgeThresholdDays: numberSetting(input.backupAgeThresholdDays, DEFAULT_APP_SETTINGS.backupAgeThresholdDays, 1, 365),
    syncReminderEnabled: booleanSetting(input.syncReminderEnabled, DEFAULT_APP_SETTINGS.syncReminderEnabled),
    upcomingFlightRefreshReminderEnabled: booleanSetting(input.upcomingFlightRefreshReminderEnabled, DEFAULT_APP_SETTINGS.upcomingFlightRefreshReminderEnabled),
    dayOfNotificationsEnabled: booleanSetting(input.dayOfNotificationsEnabled, DEFAULT_APP_SETTINGS.dayOfNotificationsEnabled),
    liveDataMode: liveDataModes.has(input.liveDataMode as LiveDataMode) ? input.liveDataMode as LiveDataMode : DEFAULT_APP_SETTINGS.liveDataMode,
  }
}

export function appSettingsFromMetadata(metadata: AppMetadata[]): AppSettings {
  return normalizeAppSettings(parseObject(metadata.find((item) => item.key === SETTINGS_METADATA_KEY)?.value))
}

export function settingsMetadataEntry(settings: AppSettings, updatedAt = new Date().toISOString()): AppMetadata {
  return {
    key: SETTINGS_METADATA_KEY,
    value: JSON.stringify(normalizeAppSettings(settings)),
    updatedAt,
  }
}

export function normalizeSyncMetadata(value: unknown, localDeviceId: string): SyncMetadata {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<SyncMetadata> : {}
  return {
    lastCloudBackupAt: typeof input.lastCloudBackupAt === 'string' ? input.lastCloudBackupAt : undefined,
    lastCloudRestoreAt: typeof input.lastCloudRestoreAt === 'string' ? input.lastCloudRestoreAt : undefined,
    lastCloudPushAt: typeof input.lastCloudPushAt === 'string' ? input.lastCloudPushAt : undefined,
    lastCloudPullAt: typeof input.lastCloudPullAt === 'string' ? input.lastCloudPullAt : undefined,
    lastCloudCompareAt: typeof input.lastCloudCompareAt === 'string' ? input.lastCloudCompareAt : undefined,
    lastTombstonePushAt: typeof input.lastTombstonePushAt === 'string' ? input.lastTombstonePushAt : undefined,
    lastTombstonePullAt: typeof input.lastTombstonePullAt === 'string' ? input.lastTombstonePullAt : undefined,
    lastLocalChangeAt: typeof input.lastLocalChangeAt === 'string' ? input.lastLocalChangeAt : undefined,
    localDeviceId,
    localDeviceName: typeof input.localDeviceName === 'string' ? input.localDeviceName : undefined,
    lastKnownCloudChecksum: typeof input.lastKnownCloudChecksum === 'string' ? input.lastKnownCloudChecksum : undefined,
    lastConflictResolutionAt: typeof input.lastConflictResolutionAt === 'string' ? input.lastConflictResolutionAt : undefined,
    lastConflictResolutionSummary: typeof input.lastConflictResolutionSummary === 'string' ? input.lastConflictResolutionSummary : undefined,
    lastSyncError: typeof input.lastSyncError === 'string' ? input.lastSyncError : undefined,
    lastSyncEventAt: typeof input.lastSyncEventAt === 'string' ? input.lastSyncEventAt : undefined,
    lastSyncSummary: typeof input.lastSyncSummary === 'string' ? input.lastSyncSummary : undefined,
    lastConflictCount: typeof input.lastConflictCount === 'number' ? input.lastConflictCount : undefined,
    lastTombstoneCount: typeof input.lastTombstoneCount === 'number' ? input.lastTombstoneCount : undefined,
  }
}

export function syncMetadataFromMetadata(metadata: AppMetadata[], localDeviceId: string): SyncMetadata {
  return normalizeSyncMetadata(parseObject(metadata.find((item) => item.key === SYNC_METADATA_KEY)?.value), localDeviceId)
}

export function syncMetadataEntry(syncMetadata: SyncMetadata, updatedAt = new Date().toISOString()): AppMetadata {
  return {
    key: SYNC_METADATA_KEY,
    value: JSON.stringify(syncMetadata),
    updatedAt,
  }
}

export function patchSyncMetadata(metadata: AppMetadata[], localDeviceId: string, patch: Partial<SyncMetadata>, updatedAt = new Date().toISOString()): AppMetadata {
  return syncMetadataEntry({ ...syncMetadataFromMetadata(metadata, localDeviceId), ...patch, localDeviceId }, updatedAt)
}

export function migrateAppMetadataDefaults(metadata: AppMetadata[], localDeviceId: string, updatedAt = new Date().toISOString()): { metadata: AppMetadata[]; changed: boolean } {
  const byKey = new Map(metadata.map((item) => [item.key, item]))
  const settings = settingsMetadataEntry(appSettingsFromMetadata(metadata), byKey.get(SETTINGS_METADATA_KEY)?.updatedAt ?? updatedAt)
  const sync = syncMetadataEntry(syncMetadataFromMetadata(metadata, localDeviceId), byKey.get(SYNC_METADATA_KEY)?.updatedAt ?? updatedAt)
  const next = [...metadata.filter((item) => item.key !== SETTINGS_METADATA_KEY && item.key !== SYNC_METADATA_KEY), settings, sync]
  const changed =
    !byKey.has(SETTINGS_METADATA_KEY) ||
    !byKey.has(SYNC_METADATA_KEY) ||
    byKey.get(SETTINGS_METADATA_KEY)?.value !== settings.value ||
    byKey.get(SYNC_METADATA_KEY)?.value !== sync.value
  return { metadata: next, changed }
}
