import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowRight,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Cloud,
  Copy,
  Database,
  Download,
  Gauge,
  Globe2,
  Home,
  Import,
  Image as ImageIcon,
  LogIn,
  LogOut,
  Map,
  MoreHorizontal,
  Mail,
  Plane,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  Upload,
  WifiOff,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import {
  bulkSaveFlights,
  bulkSaveTripMetadata,
  bulkPutProviderAirportsRaw,
  bulkPutTripMetadataRaw,
  bulkSetAppMetadata,
  bulkPermanentlyDeleteFlights,
  bulkRestoreFlights,
  deleteFlight,
  getAllFlights,
  getAllAppMetadata,
  getAllTripMetadata,
  getDeletedFlights,
  getFlights,
  getProviderAirports,
  getTripMetadata,
  mutateTripFlightIds,
  LOCAL_SCHEMA_VERSION,
  listLocalSyncEvents,
  migrateLegacyTripNames,
  permanentlyDeleteFlight,
  providerAirportSnapshotsFromLiveStatus,
  replaceAppMetadata,
  replaceFlights,
  replaceProviderAirports,
  replaceTripMetadata,
  restoreFlight,
  saveFlight,
  saveProviderAirports,
  saveTripMetadata,
  addSyncEvent,
  setAppMetadata,
} from './db'
import { sampleFlights } from './sampleData'
import type { AppMetadata, AppSettings, FlightLiveAirport, FlightLiveStatus, FlightLogEntry, FlightPurpose, FlightSource, FlightWithComputed, LookupDateRole, ProviderAirportSnapshot, SyncDevice, SyncEventLog, SyncMetadata, TripMetadata, TripType } from './types'
import { authRedirectUrl, isSupabaseConfigured, supabase } from './lib/supabase'
import {
  cloudBackupErrorMessage,
  computeBackupChecksum,
  createCloudBackupSnapshot,
  deleteAllCloudBackups,
  deleteCloudBackup,
  deleteOlderCloudBackups,
  getCloudBackup,
  hasLocalDataChangedSinceCloudBackup,
  listCloudBackups,
  resolveSnapshotBackup,
  verifyCloudBackupSnapshot,
  EncryptedCloudBackupError,
  type CloudBackupSummary,
  type CloudBackupSnapshot,
} from './lib/cloudBackup'
import {
  decryptBackupEnvelope,
  encryptBackupJson,
  parseEncryptedBackupJson,
  validateBackupPassphrase,
  type EncryptedBackupEnvelope,
} from './utils/encryptedBackup'
import {
  buildSyncRecord,
  cloudSyncErrorMessage,
  compareLocalAndRemote,
  getLocalSyncState,
  getRemoteSyncState,
  listRemoteSyncEvents,
  listSyncDevices,
  logRemoteSyncEvent,
  pullRemoteChanges,
  pullTombstones,
  pushLocalChanges,
  pushTombstones,
  registerSyncDevice,
  syncRecordLabel,
  type SyncComparison,
  type SyncComparisonItem,
  type SyncConflictAction,
  type SyncRecord,
} from './lib/cloudSync'
import { airportCount, formatAirportOption, hasKnownAirport, loadGeneratedAirports, normalizeIata, searchAirports, setProviderAirports } from './utils/airports'
import { airlineDisplayName, airlineForFlight, airlineForLiveStatus } from './utils/airlines'
import { appMetadataValue, backupAgeWarning, createFullBackup, parseFullBackupJson, previewBackupImport, shouldShowFirstRunCloudRestorePrompt, type BackupImportPreview } from './utils/backup'
import { csvColumns, flightFromInput, flightsToCsv, parseFlightsCsv, parseFlightsJson, validateFlightInput } from './utils/csv'
import { analyzeDataHealth, repairFlightsFromAirportDataset } from './utils/dataHealth'
import { deletedFlights as sortDeletedFlights, deletedTripMetadata } from './utils/deletedRecords'
import { diffFlightFields, mergeFlightRecords, mergeableFlightFieldDiffs, type MergeSide } from './utils/conflicts'
import { diagnosticsText } from './utils/diagnostics'
import { formatDate, formatDateTime, formatDistance, formatDuration } from './utils/dates'
import { currentDeviceSnapshot, getDeviceName, getOrCreateDeviceId, setDeviceName } from './utils/device'
import { computeFlight, routeKey } from './utils/flights'
import { canRefreshLiveStatus, fetchLiveStatus, normalizeFlightNumber, refreshStatusLabel } from './utils/liveStatus'
import { DEFAULT_APP_SETTINGS, appSettingsFromMetadata, migrateAppMetadataDefaults, normalizeAppSettings, patchSyncMetadata, settingsMetadataEntry, syncMetadataFromMetadata } from './utils/settings'
import { localStorageSummary } from './utils/storage'
import { createSyncEvent, syncHistorySummaryLabel } from './utils/syncHistory'
import { syncStatusSnapshot, type SyncStatusSnapshot } from './utils/syncStatus'
import { aggregateStats } from './utils/stats'
import { buildCalendarEventDetails } from './utils/calendarLinks'
import { externalFlightLinks } from './utils/externalFlightLinks'
import { lookupErrorCopy } from './utils/lookupErrors'
import { initialOnlineStatus, offlineActionMessage } from './utils/offline'
import { installGuidance, isStandaloneDisplay } from './utils/pwa'
import { desktopNavItems, mobileNavGroup, moreNavItems, navPage, routeFromHashValue, type AppRoute, type Page } from './utils/navigation'
import { flightShareCardData, tripShareCardData, yearlyPassportShareCardData, type ShareCardData } from './utils/shareCards'
import { downloadShareCardPng } from './utils/shareImage'
import {
  formatAirportLocalTime,
  formatArrivalLocalTime,
  formatDepartureLocalTime,
  getFlightDepartureLocalDate,
  isFutureOrSameDayFlight,
  resolveFlightTime,
} from './utils/flightTime'
import { groupFlightsIntoTrips, type TripGroup } from './utils/trips'
import { listUpcomingFlights, type UpcomingFlightInfo } from './utils/upcomingFlights'
import {
  flightCompletionState,
  flightLifecycle,
  listFlightsNeedingCompletion,
  pickDayOfTravelFlight,
  type DayOfTravelFlight,
  type FlightCompletionPrompt,
  type FlightLifecycleInfo,
} from './utils/lifecycle'
import './App.css'

type FlightFormState = Record<(typeof csvColumns)[number], string>

const emptyForm: FlightFormState = {
  date: new Date().toISOString().slice(0, 10),
  flightNumber: '',
  airline: '',
  origin: '',
  destination: '',
  scheduledDeparture: '',
  scheduledArrival: '',
  actualDeparture: '',
  actualArrival: '',
  aircraftType: '',
  aircraftRegistration: '',
  cabin: '',
  seat: '',
  purpose: 'personal',
  notes: '',
  source: 'manual',
}

const AppSettingsContext = createContext<AppSettings>(DEFAULT_APP_SETTINGS)

function useAppSettings(): AppSettings {
  return useContext(AppSettingsContext)
}

function flightTimeDisplayOptions(settings: AppSettings) {
  return { dateFormat: settings.dateFormat, timeFormat: settings.timeFormat }
}

function routeFromHash(): AppRoute {
  return routeFromHashValue(window.location.hash)
}

function emptyFormForSettings(settings: AppSettings): FlightFormState {
  return {
    ...emptyForm,
    cabin: settings.defaultCabin,
    purpose: settings.defaultPurpose || 'personal',
  }
}

function formFromFlight(flight?: FlightLogEntry, settings: AppSettings = DEFAULT_APP_SETTINGS): FlightFormState {
  if (!flight) return emptyFormForSettings(settings)
  return Object.fromEntries(csvColumns.map((column) => [column, String(flight[column] ?? '')])) as FlightFormState
}

function downloadFile(filename: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function legacyTripNamesFromLocalStorage(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem('flightlog-trip-names') ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

const nonImportableMetadataKeys = new Set([
  'lastBackupAt',
  'lastImportAt',
  'lastCloudBackupAt',
  'lastCloudBackupChecksum',
  'lastCloudBackupId',
  'lastCloudRestoreAt',
  'cloudRestorePromptDismissedAt',
])

function importableAppMetadata(metadata: AppMetadata[]): AppMetadata[] {
  return metadata.filter((item) => !nonImportableMetadataKeys.has(item.key))
}

function localDeviceId(): string {
  return getOrCreateDeviceId()
}

function shortChecksum(checksum?: string): string {
  return checksum ? checksum.slice(0, 12) : 'not set'
}

function requireTypedConfirmation(message: string, phrase: string): boolean {
  return window.prompt(`${message}\n\nType ${phrase} to continue.`) === phrase
}

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : typeof error === 'object' && error && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const lower = message.toLowerCase()
  if (!navigator.onLine || lower.includes('failed to fetch') || lower.includes('network')) return 'Network unavailable. Local data is still available; try signing in again when you are online.'
  if (lower.includes('expired') || lower.includes('invalid refresh token') || lower.includes('session')) return 'Your session expired. Sign in again; local data was not changed.'
  if (lower.includes('redirect') || lower.includes('callback')) return 'Provider redirect mismatch. Check the Supabase redirect URLs for this app.'
  if (lower.includes('rate') || lower.includes('too many')) return 'Too many magic link attempts. Wait a bit before requesting another email.'
  return message || 'Authentication failed. Local data was not changed.'
}

function liveAirport(liveStatus: FlightLiveStatus, role: 'origin' | 'destination'): FlightLiveAirport | undefined {
  return role === 'origin'
    ? liveStatus.origin ?? liveStatus.departureAirport
    : liveStatus.destination ?? liveStatus.arrivalAirport
}

function airportSnapshot(airport: FlightLiveAirport | undefined, source: string | undefined): ProviderAirportSnapshot | undefined {
  const iata = normalizeIata(airport?.iata ?? '')
  if (!/^[A-Z]{3}$/.test(iata)) return undefined
  return {
    iata,
    icao: airport?.icao,
    name: airport?.name,
    city: airport?.city,
    country: airport?.country,
    countryCode: airport?.countryCode,
    countryName: airport?.country,
    lat: airport?.lat,
    lon: airport?.lon,
    timezone: airport?.timezone ?? airport?.timeZone,
    timeZone: airport?.timeZone ?? airport?.timezone,
    source,
    updatedAt: new Date().toISOString(),
  }
}

function sourceFromLiveStatus(liveStatus: FlightLiveStatus): FlightSource {
  if (liveStatus.provider?.toLowerCase().includes('mock')) return 'mock-live'
  if (liveStatus.provider?.toLowerCase().includes('aerodatabox')) return 'aerodatabox'
  return 'live-import'
}

function liveStatusWarnings(liveStatus: FlightLiveStatus): string[] {
  const warnings = [...(liveStatus.warnings ?? (liveStatus.warning ? [liveStatus.warning] : []))]
  for (const [label, airport] of [['Departure', liveAirport(liveStatus, 'origin')], ['Arrival', liveAirport(liveStatus, 'destination')]] as const) {
    const iata = normalizeIata(airport?.iata ?? '')
    if (iata && !hasKnownAirport(iata)) warnings.push(`${label} airport ${iata} is not in the local airport dataset yet; provider data will be saved.`)
  }
  return [...new Set(warnings)]
}

function liveStatusMessage(liveStatus: FlightLiveStatus): string {
  const details = liveStatusWarnings(liveStatus)
  return [`Live status loaded: ${liveStatus.status}`, ...details].join(' ')
}

function formWithLiveStatus(form: FlightFormState, liveStatus: FlightLiveStatus): FlightFormState {
  const origin = normalizeIata(liveAirport(liveStatus, 'origin')?.iata ?? '')
  const destination = normalizeIata(liveAirport(liveStatus, 'destination')?.iata ?? '')
  return {
    ...form,
    flightNumber: form.flightNumber || liveStatus.flightNumber || '',
    airline: form.airline || liveStatus.airlineName || liveStatus.airline?.name || liveStatus.airlineIata || liveStatus.airline?.iata || 'Unknown airline',
    origin: form.origin || origin,
    destination: form.destination || destination,
    aircraftType: form.aircraftType || liveStatus.aircraftType || liveStatus.aircraft?.type || '',
    aircraftRegistration: form.aircraftRegistration || liveStatus.aircraftRegistration || liveStatus.aircraft?.registration || '',
    scheduledDeparture: form.scheduledDeparture || liveStatus.scheduledDepartureLocal || liveStatus.times?.scheduledDepartureLocal || liveStatus.scheduledDeparture || liveStatus.times?.scheduledDeparture || '',
    scheduledArrival: form.scheduledArrival || liveStatus.scheduledArrivalLocal || liveStatus.times?.scheduledArrivalLocal || liveStatus.scheduledArrival || liveStatus.times?.scheduledArrival || '',
    actualDeparture: form.actualDeparture || liveStatus.actualDepartureLocal || liveStatus.times?.actualDepartureLocal || liveStatus.actualDeparture || liveStatus.times?.actualDeparture || '',
    actualArrival: form.actualArrival || liveStatus.actualArrivalLocal || liveStatus.times?.actualArrivalLocal || liveStatus.actualArrival || liveStatus.times?.actualArrival || '',
    source: sourceFromLiveStatus(liveStatus),
  }
}

function liveTime(liveStatus: FlightLiveStatus, field: keyof FlightLiveStatus, timesField: keyof NonNullable<FlightLiveStatus['times']>): string | undefined {
  return liveStatus[field] as string | undefined ?? liveStatus.times?.[timesField]
}

function enrichFlightWithLiveStatus(flight: FlightLogEntry, liveStatus: FlightLiveStatus, fetchedAt: string, lookupDateRole: LookupDateRole): FlightLogEntry {
  const source = sourceFromLiveStatus(liveStatus)
  const originSnapshot = airportSnapshot(liveAirport(liveStatus, 'origin'), liveStatus.provider)
  const destinationSnapshot = airportSnapshot(liveAirport(liveStatus, 'destination'), liveStatus.provider)
  return {
    ...flight,
    airline: flight.airline || liveStatus.airlineName || liveStatus.airline?.name || liveStatus.airlineIata || liveStatus.airline?.iata || 'Unknown airline',
    origin: flight.origin || originSnapshot?.iata || '',
    destination: flight.destination || destinationSnapshot?.iata || '',
    scheduledDeparture: liveTime(liveStatus, 'scheduledDepartureLocal', 'scheduledDepartureLocal') ?? liveTime(liveStatus, 'scheduledDeparture', 'scheduledDeparture') ?? flight.scheduledDeparture,
    scheduledArrival: liveTime(liveStatus, 'scheduledArrivalLocal', 'scheduledArrivalLocal') ?? liveTime(liveStatus, 'scheduledArrival', 'scheduledArrival') ?? flight.scheduledArrival,
    actualDeparture: liveTime(liveStatus, 'actualDepartureLocal', 'actualDepartureLocal') ?? liveTime(liveStatus, 'actualDeparture', 'actualDeparture') ?? flight.actualDeparture,
    actualArrival: liveTime(liveStatus, 'actualArrivalLocal', 'actualArrivalLocal') ?? liveTime(liveStatus, 'actualArrival', 'actualArrival') ?? flight.actualArrival,
    scheduledDepartureLocal: liveTime(liveStatus, 'scheduledDepartureLocal', 'scheduledDepartureLocal') ?? liveTime(liveStatus, 'scheduledDeparture', 'scheduledDeparture') ?? flight.scheduledDepartureLocal,
    estimatedDepartureLocal: liveTime(liveStatus, 'estimatedDepartureLocal', 'estimatedDepartureLocal') ?? liveTime(liveStatus, 'estimatedDeparture', 'estimatedDeparture') ?? flight.estimatedDepartureLocal,
    actualDepartureLocal: liveTime(liveStatus, 'actualDepartureLocal', 'actualDepartureLocal') ?? liveTime(liveStatus, 'actualDeparture', 'actualDeparture') ?? flight.actualDepartureLocal,
    scheduledArrivalLocal: liveTime(liveStatus, 'scheduledArrivalLocal', 'scheduledArrivalLocal') ?? liveTime(liveStatus, 'scheduledArrival', 'scheduledArrival') ?? flight.scheduledArrivalLocal,
    estimatedArrivalLocal: liveTime(liveStatus, 'estimatedArrivalLocal', 'estimatedArrivalLocal') ?? liveTime(liveStatus, 'estimatedArrival', 'estimatedArrival') ?? flight.estimatedArrivalLocal,
    actualArrivalLocal: liveTime(liveStatus, 'actualArrivalLocal', 'actualArrivalLocal') ?? liveTime(liveStatus, 'actualArrival', 'actualArrival') ?? flight.actualArrivalLocal,
    scheduledDepartureUtc: liveTime(liveStatus, 'scheduledDepartureUtc', 'scheduledDepartureUtc') ?? flight.scheduledDepartureUtc,
    estimatedDepartureUtc: liveTime(liveStatus, 'estimatedDepartureUtc', 'estimatedDepartureUtc') ?? flight.estimatedDepartureUtc,
    actualDepartureUtc: liveTime(liveStatus, 'actualDepartureUtc', 'actualDepartureUtc') ?? flight.actualDepartureUtc,
    scheduledArrivalUtc: liveTime(liveStatus, 'scheduledArrivalUtc', 'scheduledArrivalUtc') ?? flight.scheduledArrivalUtc,
    estimatedArrivalUtc: liveTime(liveStatus, 'estimatedArrivalUtc', 'estimatedArrivalUtc') ?? flight.estimatedArrivalUtc,
    actualArrivalUtc: liveTime(liveStatus, 'actualArrivalUtc', 'actualArrivalUtc') ?? flight.actualArrivalUtc,
    originTimeZone: liveStatus.originTimeZone ?? originSnapshot?.timezone ?? flight.originTimeZone,
    destinationTimeZone: liveStatus.destinationTimeZone ?? destinationSnapshot?.timezone ?? flight.destinationTimeZone,
    aircraftType: liveStatus.aircraftType || liveStatus.aircraft?.type || flight.aircraftType,
    aircraftRegistration: liveStatus.aircraftRegistration || liveStatus.aircraft?.registration || flight.aircraftRegistration,
    source,
    liveStatus,
    lastFetchedAt: fetchedAt,
    providerFetchedAt: liveStatus.providerFetchedAt ?? liveStatus.providerUpdatedAt ?? fetchedAt,
    providerFlightId: liveStatus.providerFlightId,
    airlineIata: liveStatus.airlineIata || liveStatus.airline?.iata,
    airlineIcao: liveStatus.airlineIcao || liveStatus.airline?.icao,
    originAirportSnapshot: originSnapshot,
    destinationAirportSnapshot: destinationSnapshot,
    providerWarnings: liveStatusWarnings(liveStatus),
    lookupDateRole,
  }
}

function flightFromLookup(liveStatus: FlightLiveStatus, date: string, fetchedAt: string, lookupDateRole: LookupDateRole): FlightLogEntry {
  const origin = normalizeIata(liveAirport(liveStatus, 'origin')?.iata ?? '')
  const destination = normalizeIata(liveAirport(liveStatus, 'destination')?.iata ?? '')
  if (!origin || !destination) throw new Error('Live lookup did not include origin and destination IATA codes. You can still add the flight manually.')
  const base = flightFromInput({
    ...emptyForm,
    date,
    flightNumber: liveStatus.flightNumber ?? '',
    airline: liveStatus.airlineName || liveStatus.airline?.name || liveStatus.airlineIata || liveStatus.airline?.iata || 'Unknown airline',
    origin,
    destination,
    scheduledDeparture: liveStatus.scheduledDeparture || liveStatus.times?.scheduledDeparture || '',
    scheduledArrival: liveStatus.scheduledArrival || liveStatus.times?.scheduledArrival || '',
    actualDeparture: liveStatus.actualDeparture || liveStatus.times?.actualDeparture || '',
    actualArrival: liveStatus.actualArrival || liveStatus.times?.actualArrival || '',
    aircraftType: liveStatus.aircraftType || liveStatus.aircraft?.type || '',
    aircraftRegistration: liveStatus.aircraftRegistration || liveStatus.aircraft?.registration || '',
    source: sourceFromLiveStatus(liveStatus),
  })
  return enrichFlightWithLiveStatus(base, liveStatus, fetchedAt, lookupDateRole)
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => initialOnlineStatus())
  useEffect(() => {
    const update = () => setOnline(initialOnlineStatus())
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

function useStandaloneMode(): boolean {
  const [standalone, setStandalone] = useState(() => isStandaloneDisplay())
  useEffect(() => {
    const media = window.matchMedia?.('(display-mode: standalone)')
    const update = () => setStandalone(isStandaloneDisplay())
    media?.addEventListener?.('change', update)
    return () => media?.removeEventListener?.('change', update)
  }, [])
  return standalone
}

function usePwaInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setPromptEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [])

  async function promptInstall() {
    if (!promptEvent) return
    await promptEvent.prompt()
    await promptEvent.userChoice.catch(() => undefined)
    setPromptEvent(null)
  }

  return { canPrompt: Boolean(promptEvent), promptInstall }
}

function LoadingSkeleton({ label = 'Loading' }: { label?: string }) {
  return <div className="skeleton-block" role="status" aria-label={label} />
}

function OfflineBanner() {
  return (
    <div className="offline-banner" role="status">
      <WifiOff aria-hidden="true" />
      <span>Offline mode: local data is available; live lookup and cloud sync are unavailable.</span>
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon: LucideIcon
  title: string
  body: string
  children?: ReactNode
}) {
  return (
    <section className="empty-state">
      <Icon aria-hidden="true" />
      <h2>{title}</h2>
      <p>{body}</p>
      {children}
    </section>
  )
}

function PwaInstallPanel({ standalone, canPrompt, onInstall }: { standalone: boolean; canPrompt: boolean; onInstall: () => Promise<void> }) {
  return (
    <section className="panel install-panel">
      <div className="flight-main">
        <div>
          <p className="eyebrow">PWA</p>
          <h3>{standalone ? 'Running as a home-screen app' : 'Add FlightLog to your home screen'}</h3>
        </div>
        <Smartphone aria-hidden="true" />
      </div>
      <p className="muted">{standalone ? 'Standalone mode is active. FlightLog uses safe-area spacing for mobile navigation.' : installGuidance()}</p>
      {!standalone && canPrompt && <div className="actions"><button type="button" onClick={() => void onInstall()}><Download aria-hidden="true" /> Install FlightLog</button></div>}
    </section>
  )
}

function ShareCardPreview({
  data,
  includeNotes,
  onIncludeNotesChange,
}: {
  data: ShareCardData
  includeNotes?: boolean
  onIncludeNotesChange?: (includeNotes: boolean) => void
}) {
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState('')
  async function handleExport() {
    setExporting(true)
    setExportMessage('')
    try {
      await downloadShareCardPng(data)
      setExportMessage('PNG downloaded.')
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'PNG export failed in this browser.')
    } finally {
      setExporting(false)
    }
  }
  return (
    <section className="panel share-panel">
      <div className="section-heading compact-heading">
        <div><p className="eyebrow">Share card</p><h3>Preview</h3></div>
        <span className="status scheduled">v2.1</span>
      </div>
      <article className={`share-card share-card-${data.kind}`} aria-label={`${data.title} share card`}>
        <div className="share-card-brand"><Plane aria-hidden="true" /><span>{data.brand}</span></div>
        <p className="eyebrow">{data.kind}</p>
        <h3>{data.title}</h3>
        <p className="share-card-route">{data.route}</p>
        <dl>
          <div><dt>Date</dt><dd>{data.date}</dd></div>
          <div><dt>Distance</dt><dd>{data.distance}</dd></div>
          <div><dt>Airports</dt><dd>{data.airports.slice(0, 6).join(' · ') || 'Not set'}</dd></div>
          <div><dt>Countries</dt><dd>{data.countries.slice(0, 5).join(' · ') || 'Not set'}</dd></div>
        </dl>
        <ul>{data.highlights.slice(0, 4).map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
        {data.notes && <p className="share-card-notes">{data.notes}</p>}
      </article>
      <div className="actions">
        {onIncludeNotesChange && (
          <label className="checkbox-row inline-checkbox"><input type="checkbox" checked={Boolean(includeNotes)} onChange={(event) => onIncludeNotesChange(event.target.checked)} /> Include notes</label>
        )}
        <button type="button" className="secondary" disabled={exporting} onClick={() => void handleExport()}><ImageIcon aria-hidden="true" /> {exporting ? 'Exporting…' : 'Export PNG'}</button>
      </div>
      {exportMessage && <p className="muted" role="status">{exportMessage}</p>}
      <p className="muted">PNG export renders the card locally in your browser; nothing is uploaded.</p>
    </section>
  )
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <article className="stat-card">
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function SyncStatusBadge({ status, onCompare }: { status: SyncStatusSnapshot; onCompare?: () => Promise<void> }) {
  const settings = useAppSettings()
  const displayOptions = flightTimeDisplayOptions(settings)
  return (
    <article className={`sync-status-badge ${status.kind}`}>
      <div>
        <p className="eyebrow">Sync status</p>
        <h3>{status.label}</h3>
        <p className="muted">{status.detail}</p>
      </div>
      <dl className="meta-grid">
        <div><dt>Last compared</dt><dd>{status.lastCompared ? formatDateTime(status.lastCompared, displayOptions) : 'Never'}</dd></div>
        <div><dt>Conflicts</dt><dd>{status.conflictCount}</dd></div>
        <div><dt>Tombstones</dt><dd>{status.tombstoneCount}</dd></div>
      </dl>
      {onCompare && <div className="actions"><button type="button" className="secondary" onClick={() => void onCompare()}><Search aria-hidden="true" /> Compare now</button></div>}
    </article>
  )
}

function AirportInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const suggestions = searchAirports(value)
  return (
    <label>
      {label}
      <input
        value={value}
        list={`${label}-airports`}
        maxLength={3}
        onChange={(event) => onChange(normalizeIata(event.target.value))}
        placeholder="SFO"
      />
      <datalist id={`${label}-airports`}>
        {suggestions.map((airport) => (
          <option key={airport.iata} value={airport.iata} label={formatAirportOption(airport)} />
        ))}
      </datalist>
    </label>
  )
}

function LiveStatusPreview({ liveStatus, fetchedAt }: { liveStatus: FlightLiveStatus; fetchedAt: string }) {
  const settings = useAppSettings()
  const displayOptions = flightTimeDisplayOptions(settings)
  const origin = liveAirport(liveStatus, 'origin')
  const destination = liveAirport(liveStatus, 'destination')
  const airline = airlineForLiveStatus(liveStatus)
  const departureTime = formatAirportLocalTime(
    liveStatus.scheduledDepartureLocal ?? liveStatus.times?.scheduledDepartureLocal ?? liveStatus.scheduledDeparture ?? liveStatus.times?.scheduledDeparture,
    liveStatus.originTimeZone ?? origin?.timezone ?? origin?.timeZone,
    `${origin?.iata ?? 'Origin'} local`,
    liveStatus.scheduledDepartureUtc ?? liveStatus.times?.scheduledDepartureUtc,
    displayOptions,
  )
  const arrivalTime = formatAirportLocalTime(
    liveStatus.scheduledArrivalLocal ?? liveStatus.times?.scheduledArrivalLocal ?? liveStatus.scheduledArrival ?? liveStatus.times?.scheduledArrival,
    liveStatus.destinationTimeZone ?? destination?.timezone ?? destination?.timeZone,
    `${destination?.iata ?? 'Destination'} local`,
    liveStatus.scheduledArrivalUtc ?? liveStatus.times?.scheduledArrivalUtc,
    displayOptions,
  )
  const estimatedDeparture = formatAirportLocalTime(
    liveStatus.estimatedDepartureLocal ?? liveStatus.times?.estimatedDepartureLocal ?? liveStatus.estimatedDeparture ?? liveStatus.times?.estimatedDeparture,
    liveStatus.originTimeZone ?? origin?.timezone ?? origin?.timeZone,
    `${origin?.iata ?? 'Origin'} local`,
    liveStatus.estimatedDepartureUtc ?? liveStatus.times?.estimatedDepartureUtc,
    displayOptions,
  )
  const estimatedArrival = formatAirportLocalTime(
    liveStatus.estimatedArrivalLocal ?? liveStatus.times?.estimatedArrivalLocal ?? liveStatus.estimatedArrival ?? liveStatus.times?.estimatedArrival,
    liveStatus.destinationTimeZone ?? destination?.timezone ?? destination?.timeZone,
    `${destination?.iata ?? 'Destination'} local`,
    liveStatus.estimatedArrivalUtc ?? liveStatus.times?.estimatedArrivalUtc,
    displayOptions,
  )
  const warnings = liveStatusWarnings(liveStatus)
  return (
    <article className="lookup-preview">
      <div className="flight-main">
        <div>
          <p className="eyebrow">{liveStatus.provider ?? 'Live lookup'}</p>
          <h3>{liveStatus.flightNumber} - {airline?.name || liveStatus.airlineName || liveStatus.airline?.name || 'Unknown airline'}</h3>
        </div>
        <span className={`status ${liveStatus.status}`}>{liveStatus.status}</span>
      </div>
      <div className="route-line">
        <strong>{origin?.iata ?? '---'}</strong>
        <span>{origin?.city || origin?.name}</span>
        <ArrowRight aria-hidden="true" />
        <strong>{destination?.iata ?? '---'}</strong>
        <span>{destination?.city || destination?.name}</span>
      </div>
      <dl className="meta-grid">
        <div><dt>Scheduled departure</dt><dd>{departureTime.label}</dd></div>
        <div><dt>Scheduled arrival</dt><dd>{arrivalTime.label}</dd></div>
        <div><dt>Estimated departure</dt><dd>{estimatedDeparture.local ? estimatedDeparture.label : 'Not set'}</dd></div>
        <div><dt>Estimated arrival</dt><dd>{estimatedArrival.local ? estimatedArrival.label : 'Not set'}</dd></div>
        <div><dt>Departure</dt><dd>{[liveStatus.departureTerminal || liveStatus.terminalGate?.departureTerminal, liveStatus.departureGate || liveStatus.terminalGate?.departureGate].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
        <div><dt>Arrival</dt><dd>{[liveStatus.arrivalTerminal || liveStatus.terminalGate?.arrivalTerminal, liveStatus.arrivalGate || liveStatus.terminalGate?.arrivalGate, liveStatus.baggageClaim || liveStatus.terminalGate?.baggageClaim].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
        <div><dt>Aircraft</dt><dd>{[liveStatus.aircraftType || liveStatus.aircraft?.type, liveStatus.aircraftRegistration || liveStatus.aircraft?.registration].filter(Boolean).join(' - ') || 'Not set'}</dd></div>
        <div><dt>Airline</dt><dd>{airline ? [airline.iata, airline.country].filter(Boolean).join(' / ') : 'Metadata unavailable'}</dd></div>
        <div><dt>Fetched</dt><dd>{formatDateTime(fetchedAt, displayOptions)}</dd></div>
      </dl>
      {[departureTime.warning, arrivalTime.warning, estimatedDeparture.local ? estimatedDeparture.warning : undefined, estimatedArrival.local ? estimatedArrival.warning : undefined].filter((warning): warning is string => Boolean(warning)).map((warning, index) => <p className="notice warning" key={`time-${index}-${warning}`}>{warning}</p>)}
      {warnings.map((warning, index) => <p className="notice warning" key={`provider-${index}-${warning}`}>{warning}</p>)}
    </article>
  )
}

function FlightForm({
  editing,
  isOnline,
  onCancel,
  onSaved,
  onProviderAirportsSaved,
}: {
  editing?: FlightLogEntry
  isOnline: boolean
  onCancel: () => void
  onSaved: (savedFlightId?: string) => Promise<void>
  onProviderAirportsSaved: (liveStatus: FlightLiveStatus) => Promise<void>
}) {
  const settings = useAppSettings()
  const [mode, setMode] = useState<'lookup' | 'manual'>(editing ? 'manual' : 'lookup')
  const [lookup, setLookup] = useState({ flightNumber: '', date: new Date().toISOString().slice(0, 10), dateRole: 'Departure' as LookupDateRole, useMock: false })
  const [lookupStatus, setLookupStatus] = useState<FlightLiveStatus | undefined>()
  const [lookupFetchedAt, setLookupFetchedAt] = useState('')
  const [form, setForm] = useState<FlightFormState>(() => formFromFlight(editing, settings))
  const [fetchedLiveStatus, setFetchedLiveStatus] = useState<FlightLiveStatus | undefined>(() => editing?.liveStatus)
  const [fetchedAt, setFetchedAt] = useState(editing?.lastFetchedAt ?? '')
  const [message, setMessage] = useState('')
  const [lookupError, setLookupError] = useState<ReturnType<typeof lookupErrorCopy> | undefined>()
  const [busy, setBusy] = useState(false)
  const errors = validateFlightInput(form)
  const computedPreview = errors.length === 0 ? computeFlight(flightFromInput(form, editing)) : undefined

  async function handleLookup(event: FormEvent) {
    event.preventDefault()
    if (!isOnline) {
      setLookupError(lookupErrorCopy(offlineActionMessage('live lookup'), false))
      setMessage('')
      setLookupStatus(undefined)
      return
    }
    setBusy(true)
    setMessage('')
    setLookupError(undefined)
    setLookupStatus(undefined)
    try {
      const liveStatus = await fetchLiveStatus(lookup.flightNumber, lookup.date, { dateRole: lookup.dateRole, useMock: lookup.useMock, liveDataMode: settings.liveDataMode })
      const nextFetchedAt = new Date().toISOString()
      setLookupStatus(liveStatus)
      setLookupFetchedAt(nextFetchedAt)
      await onProviderAirportsSaved(liveStatus)
      setMessage(liveStatusMessage(liveStatus))
    } catch (error) {
      setLookupError(lookupErrorCopy(error, isOnline))
    } finally {
      setBusy(false)
    }
  }

  async function handleAddLookup() {
    if (!lookupStatus) return
    setBusy(true)
    setMessage('')
    try {
      const savedFlight = flightFromLookup(lookupStatus, lookup.date, lookupFetchedAt || new Date().toISOString(), lookup.dateRole)
      const id = await saveFlight(savedFlight)
      await onProviderAirportsSaved(lookupStatus)
      await onSaved(id)
      onCancel()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to add this flight')
    } finally {
      setBusy(false)
    }
  }

  function handleEditBeforeSaving() {
    if (!lookupStatus) return
    const seededForm = formWithLiveStatus({ ...emptyFormForSettings(settings), date: lookup.date, flightNumber: normalizeFlightNumber(lookup.flightNumber) }, lookupStatus)
    setForm(seededForm)
    setFetchedLiveStatus(lookupStatus)
    setFetchedAt(lookupFetchedAt || new Date().toISOString())
    setMode('manual')
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (errors.length > 0) {
      setMessage(errors.join('. '))
      return
    }
    const flight = flightFromInput(form, editing)
    const flightToSave = fetchedLiveStatus
      ? enrichFlightWithLiveStatus(flight, fetchedLiveStatus, fetchedAt || new Date().toISOString(), 'Departure')
      : flight
    const id = await saveFlight(flightToSave)
    if (fetchedLiveStatus) await onProviderAirportsSaved(fetchedLiveStatus)
    await onSaved(id)
    onCancel()
  }

  async function handleFetchLive() {
    if (!isOnline) {
      setMessage(offlineActionMessage('live status refresh'))
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const liveStatus = await fetchLiveStatus(form.flightNumber, form.date, { dateRole: 'Departure', liveDataMode: settings.liveDataMode })
      const nextFetchedAt = new Date().toISOString()
      const nextForm = formWithLiveStatus(form, liveStatus)
      setForm(nextForm)
      setFetchedLiveStatus(liveStatus)
      setFetchedAt(nextFetchedAt)
      await onProviderAirportsSaved(liveStatus)
      if (editing) {
        const id = await saveFlight(enrichFlightWithLiveStatus(flightFromInput(nextForm, editing), liveStatus, nextFetchedAt, 'Departure'))
        await onSaved(id)
      }
      setMessage(liveStatusMessage(liveStatus))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to fetch live status')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel form-panel quick-add-panel" aria-label={editing ? 'Edit flight' : 'Add flight'}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">{editing ? 'Edit entry' : 'New entry'}</p>
          <h2>{editing ? editing.flightNumber : 'Log a flight'}</h2>
        </div>
        <button type="button" className="ghost" onClick={onCancel}>Close</button>
      </div>

      {!editing && (
        <div className="segmented" role="tablist" aria-label="Add flight mode">
          <button type="button" className={mode === 'lookup' ? 'active' : ''} onClick={() => setMode('lookup')}><Search aria-hidden="true" /> Lookup flight</button>
          <button type="button" className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}><Plane aria-hidden="true" /> Manual entry</button>
        </div>
      )}

      {mode === 'lookup' ? (
        <form onSubmit={handleLookup} className="lookup-form">
          {!isOnline && <p className="notice warning">{offlineActionMessage('live lookup')}</p>}
          <div className="form-grid compact">
            <label>Flight number<input value={lookup.flightNumber} onChange={(event) => setLookup({ ...lookup, flightNumber: event.target.value.toUpperCase() })} placeholder="SQ38" inputMode="text" autoCapitalize="characters" autoComplete="off" required /></label>
            <label>Date<input type="date" value={lookup.date} onChange={(event) => setLookup({ ...lookup, date: event.target.value })} required /></label>
            <label>Date role<select value={lookup.dateRole} onChange={(event) => setLookup({ ...lookup, dateRole: event.target.value as LookupDateRole })}><option value="Departure">Departure date</option><option value="Arrival">Arrival date</option></select></label>
            <label className="checkbox-row"><input type="checkbox" checked={lookup.useMock} onChange={(event) => setLookup({ ...lookup, useMock: event.target.checked })} /> Use demo lookup</label>
          </div>
          <div className="actions">
            <button type="submit" disabled={busy || !isOnline || !lookup.flightNumber || !lookup.date}><Search aria-hidden="true" /> {busy ? 'Looking up...' : 'Look up flight'}</button>
            <button type="button" className="secondary" onClick={() => setMode('manual')}><Plane aria-hidden="true" /> Add manually</button>
          </div>
          {busy && <LoadingSkeleton label="Loading flight lookup preview" />}
          {lookupStatus && <LiveStatusPreview liveStatus={lookupStatus} fetchedAt={lookupFetchedAt} />}
          {lookupError && <div className={`notice warning lookup-error ${lookupError.kind}`}><strong>{lookupError.title}.</strong> {lookupError.detail}</div>}
          {message && <p className="notice">{message}</p>}
          {lookupStatus && (
            <div className="actions">
              <button type="button" onClick={handleAddLookup} disabled={busy}><CheckCircle2 aria-hidden="true" /> Add this flight</button>
              <button type="button" className="secondary" onClick={handleEditBeforeSaving}><Plane aria-hidden="true" /> Edit before saving</button>
              <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
            </div>
          )}
        </form>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>Date<input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required /></label>
            <label>Flight number<input value={form.flightNumber} onChange={(event) => setForm({ ...form, flightNumber: event.target.value.toUpperCase() })} placeholder="SQ38" inputMode="text" autoCapitalize="characters" autoComplete="off" required /></label>
            <label>Airline<input value={form.airline} onChange={(event) => setForm({ ...form, airline: event.target.value })} placeholder="Singapore Airlines" required /></label>
            <AirportInput label="Origin" value={form.origin} onChange={(origin) => setForm({ ...form, origin })} />
            <AirportInput label="Destination" value={form.destination} onChange={(destination) => setForm({ ...form, destination })} />
            <label>Scheduled departure<input type="datetime-local" value={form.scheduledDeparture} onChange={(event) => setForm({ ...form, scheduledDeparture: event.target.value })} /></label>
            <label>Scheduled arrival<input type="datetime-local" value={form.scheduledArrival} onChange={(event) => setForm({ ...form, scheduledArrival: event.target.value })} /></label>
            <label>Actual departure<input type="datetime-local" value={form.actualDeparture} onChange={(event) => setForm({ ...form, actualDeparture: event.target.value })} /></label>
            <label>Actual arrival<input type="datetime-local" value={form.actualArrival} onChange={(event) => setForm({ ...form, actualArrival: event.target.value })} /></label>
            <label>Aircraft type<input value={form.aircraftType} onChange={(event) => setForm({ ...form, aircraftType: event.target.value })} placeholder="Airbus A350" /></label>
            <label>Registration<input value={form.aircraftRegistration} onChange={(event) => setForm({ ...form, aircraftRegistration: event.target.value.toUpperCase() })} placeholder="9V-SGA" /></label>
            <label>Cabin<input value={form.cabin} onChange={(event) => setForm({ ...form, cabin: event.target.value })} placeholder="Economy" /></label>
            <label>Seat<input value={form.seat} onChange={(event) => setForm({ ...form, seat: event.target.value.toUpperCase() })} placeholder="24F" /></label>
            <label>Purpose<select value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value as FlightPurpose })}><option value="personal">Personal</option><option value="work">Work</option><option value="school">School</option><option value="other">Other</option></select></label>
            <label>Source<select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value as FlightSource })}><option value="manual">Manual</option><option value="live-import">Live import</option><option value="mock-live">Mock live</option><option value="aerodatabox">AeroDataBox</option></select></label>
            <label className="wide">Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} /></label>
          </div>
          <div className="form-summary">
            <span>{computedPreview ? `${form.origin} to ${form.destination}` : 'Route preview'}</span>
            <strong>{computedPreview ? (computedPreview.hasRouteCoordinates ? formatDistance(computedPreview.distanceKm, settings.distanceUnit) : 'Distance unavailable') : 'Enter route to calculate distance'}</strong>
            <span>{computedPreview ? formatDuration(computedPreview.durationMinutes) : 'Duration appears when times are set'}</span>
          </div>
          {message && <p className="notice">{message}</p>}
          <div className="actions">
            <button type="button" className="secondary" onClick={handleFetchLive} disabled={busy || !isOnline || !form.flightNumber || !form.date}><RefreshCw aria-hidden="true" /> Fetch flight data</button>
            <button type="submit"><Plane aria-hidden="true" /> Save flight</button>
          </div>
        </form>
      )}
    </section>
  )
}

function UpcomingFlightCard({ info, isOnline, onOpen, onRefresh }: { info: UpcomingFlightInfo; isOnline: boolean; onOpen: (flight: FlightLogEntry) => void; onRefresh: (flight: FlightLogEntry) => Promise<void> }) {
  const settings = useAppSettings()
  const displayOptions = flightTimeDisplayOptions(settings)
  const { flight } = info
  const departure = formatDepartureLocalTime(flight, displayOptions)
  const arrival = formatArrivalLocalTime(flight, displayOptions)
  const airline = airlineForFlight(flight)
  const detailsUrl = `${window.location.href.split('#')[0]}#/flights/${encodeURIComponent(flight.id)}`
  const calendar = buildCalendarEventDetails(flight, detailsUrl)
  const links = externalFlightLinks(flight)
  const lifecycle = flightLifecycle(flight)
  return (
    <article className={`flight-card upcoming-card ${info.isSameDay ? 'same-day' : ''}`}>
      <div className="flight-main">
        <div><p className="eyebrow">{info.countdownLabel}</p><h3>{flight.flightNumber} - {airline?.name ?? flight.airline}</h3></div>
        <div className="status-stack">
          <span className={`status ${flight.liveStatus?.status ?? 'unknown'}`}>{flight.liveStatus?.status ?? 'manual'}</span>
          <LifecycleChip lifecycle={lifecycle} />
        </div>
      </div>
      <div className="route-line"><strong>{flight.origin}</strong><span>{flight.originAirport?.city || flight.originAirport?.name}</span><ArrowRight aria-hidden="true" /><strong>{flight.destination}</strong><span>{flight.destinationAirport?.city || flight.destinationAirport?.name}</span></div>
      <dl className="meta-grid">
        <div><dt>Departure</dt><dd>{departure.label}</dd></div>
        <div><dt>Arrival</dt><dd>{arrival.label}</dd></div>
        <div><dt>Terminal / gate</dt><dd>{[flight.liveStatus?.departureTerminal, flight.liveStatus?.departureGate].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
        <div><dt>Aircraft</dt><dd>{[flight.aircraftType, flight.aircraftRegistration].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
        <div><dt>Last checked</dt><dd>{refreshStatusLabel(flight.lastFetchedAt)}</dd></div>
      </dl>
      {settings.upcomingFlightRefreshReminderEnabled && info.staleLabel && <p className={`notice ${info.staleSeverity === 'strong' ? 'warning' : ''}`}>{info.staleLabel}</p>}
      {settings.upcomingFlightRefreshReminderEnabled && info.gateHint && <p className="notice">{info.gateHint}</p>}
      <div className="actions">
        <button type="button" onClick={() => onOpen(flight)}>View details</button>
        <button type="button" className="secondary" disabled={!isOnline || !canRefreshLiveStatus(flight.lastFetchedAt)} onClick={() => onRefresh(flight)}><RefreshCw aria-hidden="true" /> Refresh status</button>
        {calendar.googleUrl && <a className="button-link secondary-link" href={calendar.googleUrl} target="_blank" rel="noopener noreferrer"><CalendarDays aria-hidden="true" /> Add to calendar</a>}
        {links[0] && <a className="button-link secondary-link" href={links[0].url} target="_blank" rel="noopener noreferrer">External links</a>}
      </div>
    </article>
  )
}

function LifecycleChip({ lifecycle }: { lifecycle: FlightLifecycleInfo }) {
  return <span className={`lifecycle-chip phase-${lifecycle.phase}`}>{lifecycle.label}</span>
}

function LifecycleProgress({ percent }: { percent: number }) {
  return (
    <div className="lifecycle-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Flight progress">
      <div className="lifecycle-progress-bar" style={{ width: `${percent}%` }} />
    </div>
  )
}

function DayOfTravelCard({ item, isOnline, onOpen, onRefresh }: { item: DayOfTravelFlight; isOnline: boolean; onOpen: (flight: FlightLogEntry) => void; onRefresh: (flight: FlightLogEntry) => Promise<void> }) {
  const settings = useAppSettings()
  const displayOptions = flightTimeDisplayOptions(settings)
  const { flight, lifecycle } = item
  const checkInLink = externalFlightLinks(flight).find((link) => link.label.toLowerCase().includes('check-in'))
  return (
    <section className="panel day-of-panel">
      <div className="flight-main">
        <div>
          <p className="eyebrow">Day of travel</p>
          <h2>{flight.flightNumber} · {flight.origin} {'->'} {flight.destination}</h2>
        </div>
        <LifecycleChip lifecycle={lifecycle} />
      </div>
      {lifecycle.detail && <p className="day-of-detail">{lifecycle.detail}</p>}
      {lifecycle.progressPercent !== undefined && <LifecycleProgress percent={lifecycle.progressPercent} />}
      <dl className="meta-grid">
        <div><dt>Departure</dt><dd>{formatDepartureLocalTime(flight, displayOptions).label}</dd></div>
        <div><dt>Arrival</dt><dd>{formatArrivalLocalTime(flight, displayOptions).label}</dd></div>
        <div><dt>Terminal / gate</dt><dd>{[flight.liveStatus?.departureTerminal, flight.liveStatus?.departureGate].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
        <div><dt>Cabin / seat</dt><dd>{[flight.cabin, flight.seat].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
      </dl>
      {lifecycle.hint && <p className="notice">{lifecycle.hint}</p>}
      <div className="actions">
        <button type="button" onClick={() => onOpen(flight)}>View flight</button>
        <button type="button" className="secondary" disabled={!isOnline || !canRefreshLiveStatus(flight.lastFetchedAt)} onClick={() => void onRefresh(flight)}><RefreshCw aria-hidden="true" /> Refresh status</button>
        {(lifecycle.phase === 'check-in' || lifecycle.phase === 'departing-soon') && checkInLink && <a className="button-link secondary-link" href={checkInLink.url} target="_blank" rel="noopener noreferrer">{checkInLink.label}</a>}
      </div>
    </section>
  )
}

function CompletionPromptsPanel({ prompts, isOnline, onEdit, onDismiss, onRefresh }: {
  prompts: FlightCompletionPrompt[]
  isOnline: boolean
  onEdit: (flight: FlightLogEntry) => void
  onDismiss: (flight: FlightLogEntry) => Promise<void>
  onRefresh: (flight: FlightLogEntry) => Promise<void>
}) {
  return (
    <section className="panel completion-panel">
      <div className="section-heading compact-heading"><div><p className="eyebrow">Just landed</p><h2>Complete your flight log</h2></div></div>
      <p className="muted">Confirm details for recently landed flights so your passport stats stay accurate.</p>
      <div className="stack compact-stack">
        {prompts.map((prompt) => (
          <article className="completion-item" key={prompt.flight.id}>
            <div>
              <p className="eyebrow">Landed {prompt.arrivedAgoLabel}</p>
              <h3>{prompt.flight.flightNumber} · {prompt.flight.origin} {'->'} {prompt.flight.destination}</h3>
              <p className="muted">Missing {prompt.missing.join(', ')}.</p>
            </div>
            <div className="actions">
              <button type="button" onClick={() => onEdit(prompt.flight)}>Confirm details</button>
              <button type="button" className="secondary" disabled={!isOnline || !canRefreshLiveStatus(prompt.flight.lastFetchedAt)} onClick={() => void onRefresh(prompt.flight)}><RefreshCw aria-hidden="true" /> Refresh from provider</button>
              <button type="button" className="ghost" onClick={() => void onDismiss(prompt.flight)}>Dismiss</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function FlightLifecycleSection({ flight, onEdit, onDismissCompletion }: {
  flight: FlightLogEntry
  onEdit: (flight: FlightLogEntry) => void
  onDismissCompletion: (flight: FlightLogEntry) => Promise<void>
}) {
  const lifecycle = flightLifecycle(flight)
  const completion = flightCompletionState(flight)
  return (
    <section className="panel lifecycle-panel">
      <div className="section-heading compact-heading">
        <div><p className="eyebrow">Lifecycle</p><h3>Flight assistant</h3></div>
        <LifecycleChip lifecycle={lifecycle} />
      </div>
      {lifecycle.detail && <p className="day-of-detail">{lifecycle.detail}</p>}
      {lifecycle.progressPercent !== undefined && <LifecycleProgress percent={lifecycle.progressPercent} />}
      {lifecycle.hint && <p className="notice">{lifecycle.hint}</p>}
      {completion.needsCompletion && (
        <div className="notice completion-notice">
          <p><strong>Complete this flight:</strong> missing {completion.missing.join(', ')}.</p>
          <div className="actions">
            <button type="button" onClick={() => onEdit(flight)}>Confirm details</button>
            <button type="button" className="ghost" onClick={() => void onDismissCompletion(flight)}>Dismiss</button>
          </div>
        </div>
      )}
    </section>
  )
}

function Dashboard({
  flights,
  loading,
  isOnline,
  airportDatasetLabel,
  appMetadata,
  syncStatus,
  cloudRestorePrompt,
  onAddDemo,
  onQuickAdd,
  onOpenFlight,
  onEditFlight,
  onDismissCompletion,
  onRefresh,
  onCompareSync,
}: {
  flights: FlightLogEntry[]
  loading: boolean
  isOnline: boolean
  airportDatasetLabel: string
  appMetadata: AppMetadata[]
  syncStatus: SyncStatusSnapshot
  cloudRestorePrompt?: {
    latestLabel: string
    onRestoreLatest: () => Promise<void>
    onChooseBackup: () => void
    onPullSync: () => void
    onStartFresh: () => Promise<void>
  }
  onAddDemo: () => Promise<void>
  onQuickAdd: () => void
  onOpenFlight: (flight: FlightLogEntry) => void
  onEditFlight: (flight: FlightLogEntry) => void
  onDismissCompletion: (flight: FlightLogEntry) => Promise<void>
  onRefresh: (flight: FlightLogEntry) => Promise<void>
  onCompareSync?: () => Promise<void>
}) {
  const settings = useAppSettings()
  const [, setLifecycleTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setLifecycleTick((tick) => tick + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])
  const stats = aggregateStats(flights)
  const warning = settings.backupReminderEnabled ? backupAgeWarning(flights, appMetadata, undefined, settings.backupAgeThresholdDays) : undefined
  const upcoming = listUpcomingFlights(flights).slice(0, 6)
  const dayOfTravel = pickDayOfTravelFlight(flights)
  const completionPrompts = listFlightsNeedingCompletion(flights).slice(0, 3)
  const recentFlights = flights.slice(0, 3).map(computeFlight)
  const syncNeedsAttention = ['conflicts', 'deletions', 'error', 'local-changes', 'cloud-changes'].includes(syncStatus.kind)
  const passportHighlights = [
    `${stats.countriesVisited.length} countries`,
    `${stats.airportsVisited.length} airports`,
    `${stats.airlines.length} airlines`,
  ]
  return (
    <main className="page dashboard-page">
      <section className="hero-shell">
        <div>
          <p className="eyebrow">FlightLog</p>
          <h1>Your personal flight passport.</h1>
          <p>Enter a flight number and departure date, preview real provider data, and save a complete route to your local passport.</p>
          <div className="hero-actions">
            <button type="button" onClick={onQuickAdd}><Search aria-hidden="true" /> Add by flight number</button>
            <span>{loading ? 'Loading local flights...' : airportDatasetLabel}</span>
          </div>
          {!isOnline && <p className="notice hero-notice">Local mode is active. Live lookup and cloud actions resume when you are online.</p>}
        </div>
        <div className="route-stamp" aria-hidden="true"><span>{stats.mostRecentFlight?.origin ?? 'SFO'}</span><ArrowRight /><span>{stats.mostRecentFlight?.destination ?? 'SIN'}</span></div>
      </section>
      {cloudRestorePrompt && (
        <section className="panel cloud-panel">
          <div className="section-heading compact-heading">
            <div><p className="eyebrow">Cloud backup</p><h2>Restore from cloud?</h2></div>
          </div>
          <p className="muted">You are signed in and this browser has no local flights. Latest cloud backup: {cloudRestorePrompt.latestLabel}.</p>
          <div className="actions">
            <button type="button" onClick={() => void cloudRestorePrompt.onRestoreLatest()}><Cloud aria-hidden="true" /> Restore latest</button>
            <button type="button" className="secondary" onClick={cloudRestorePrompt.onChooseBackup}>Choose another backup</button>
            <button type="button" className="secondary" onClick={cloudRestorePrompt.onPullSync}>Pull sync records</button>
            <button type="button" className="ghost" onClick={() => void cloudRestorePrompt.onStartFresh()}>Start fresh</button>
          </div>
        </section>
      )}
      {loading ? (
        <section className="panel"><LoadingSkeleton label="Loading dashboard flights" /></section>
      ) : flights.length === 0 ? (
        <EmptyState icon={Plane} title="No flights logged yet" body={isOnline ? 'Start with a flight lookup or load demo flights to explore the app.' : 'You can add a flight manually while offline, or use live lookup when you are online.'}>
          <div className="actions"><button type="button" onClick={onQuickAdd}><Search aria-hidden="true" /> Add by flight number</button><button type="button" className="secondary" onClick={onAddDemo}><Plus aria-hidden="true" /> Load demo flights</button></div>
        </EmptyState>
      ) : null}
      {dayOfTravel && <DayOfTravelCard item={dayOfTravel} isOnline={isOnline} onOpen={onOpenFlight} onRefresh={onRefresh} />}
      {completionPrompts.length > 0 && <CompletionPromptsPanel prompts={completionPrompts} isOnline={isOnline} onEdit={onEditFlight} onDismiss={onDismissCompletion} onRefresh={onRefresh} />}
      <section className="panel upcoming-panel">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Upcoming</p><h2>Upcoming flights</h2></div></div>
        <div className="stack">
          {upcoming.map((info) => <UpcomingFlightCard key={info.flight.id} info={info} isOnline={isOnline} onOpen={onOpenFlight} onRefresh={onRefresh} />)}
          {!loading && upcoming.length === 0 && <EmptyState icon={CalendarDays} title="No upcoming flights" body="Future flights you add will appear here with refresh and calendar actions." />}
          {loading && <LoadingSkeleton label="Loading upcoming flights" />}
        </div>
      </section>
      {syncNeedsAttention && <SyncStatusBadge status={syncStatus} onCompare={isOnline ? onCompareSync : undefined} />}
      {warning && <section className="notice warning backup-warning"><strong>Backup recommended.</strong> {warning}</section>}
      {flights.length > 0 && (
        <section className="stats-grid">
          <StatCard icon={Plane} label="Total flights" value={String(stats.totalFlights)} />
          <StatCard icon={Gauge} label="Total distance" value={formatDistance(stats.totalDistanceKm, settings.distanceUnit)} />
          <StatCard icon={Map} label="Airports" value={String(stats.airportsVisited.length)} />
          <StatCard icon={Globe2} label="Countries" value={String(stats.countriesVisited.length)} />
          <StatCard icon={Plane} label="Airlines" value={String(stats.airlines.length)} />
          <StatCard icon={ArrowRight} label="Longest flight" value={stats.longestFlight ? routeKey(stats.longestFlight) : 'None'} />
          <StatCard icon={CalendarDays} label="Most recent" value={stats.mostRecentFlight ? formatDate(stats.mostRecentFlight.date, settings.dateFormat) : 'None'} />
        </section>
      )}
      {flights.length > 0 && (
        <section className="panel">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Recent</p><h2>Recent flights</h2></div></div>
          <div className="stack compact-stack">
            {recentFlights.map((flight) => <FlightCard key={flight.id} flight={flight} isOnline={isOnline} onOpen={onOpenFlight} onEdit={() => undefined} onDelete={async () => undefined} onRefresh={onRefresh} compactActions />)}
          </div>
        </section>
      )}
      <section className="panel passport-highlight-panel">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Passport</p><h2>Highlights</h2></div></div>
        {flights.length === 0 ? <p className="empty-inline">Your passport unlocks as you log flights.</p> : (
          <div className="passport-highlight-row">{passportHighlights.map((highlight) => <span key={highlight}>{highlight}</span>)}</div>
        )}
      </section>
    </main>
  )
}

function FlightCard({
  flight,
  isOnline,
  onOpen,
  onEdit,
  onDelete,
  onRefresh,
  compactActions = false,
}: {
  flight: FlightWithComputed
  isOnline: boolean
  onOpen: (flight: FlightLogEntry) => void
  onEdit: (flight: FlightLogEntry) => void
  onDelete: (id: string) => Promise<void>
  onRefresh: (flight: FlightLogEntry) => Promise<void>
  compactActions?: boolean
}) {
  const settings = useAppSettings()
  const displayOptions = flightTimeDisplayOptions(settings)
  const liveStatusLabel = flight.liveStatus?.status ?? 'manual'
  const providerLabel = flight.liveStatus?.provider ? ` via ${flight.liveStatus.provider}` : ''
  const lastFetchedLabel = refreshStatusLabel(flight.lastFetchedAt)
  const warnings = flight.providerWarnings ?? flight.liveStatus?.warnings ?? (flight.liveStatus?.warning ? [flight.liveStatus.warning] : [])
  const departure = formatDepartureLocalTime(flight, displayOptions)
  const arrival = formatArrivalLocalTime(flight, displayOptions)
  const refreshAvailable = canRefreshLiveStatus(flight.lastFetchedAt)
  const airline = airlineForFlight(flight)
  return (
    <article className="flight-card">
      <div className="flight-main"><div><p className="eyebrow">{getFlightDepartureLocalDate(flight)}{airline?.country ? ` · ${airline.country}` : ''}</p><h3><button type="button" className="link-button" onClick={() => onOpen(flight)}>{flight.flightNumber} - {airline?.name ?? flight.airline}</button></h3></div><span className={`status ${flight.liveStatus?.status ?? 'unknown'}`}>{liveStatusLabel}{providerLabel}</span></div>
      <div className="route-line"><strong>{flight.origin}</strong><span>{flight.originAirport?.city || flight.originAirport?.name}</span><ArrowRight aria-hidden="true" /><strong>{flight.destination}</strong><span>{flight.destinationAirport?.city || flight.destinationAirport?.name}</span></div>
      <dl className="meta-grid">
        <div><dt>Departure local</dt><dd>{departure.label}</dd></div>
        <div><dt>Arrival local</dt><dd>{arrival.label}</dd></div>
        <div><dt>Distance</dt><dd>{flight.hasRouteCoordinates ? formatDistance(flight.distanceKm, settings.distanceUnit) : 'Unavailable'}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(flight.durationMinutes)}</dd></div>
        <div><dt>Aircraft</dt><dd>{flight.aircraftType || 'Not set'}</dd></div>
        <div><dt>Airline code</dt><dd>{[airline?.iata ?? flight.airlineIata, airline?.icao ?? flight.airlineIcao].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
        <div><dt>Cabin / seat</dt><dd>{[flight.cabin, flight.seat].filter(Boolean).join(' - ') || 'Not set'}</dd></div>
      </dl>
      {flight.liveStatus && <p className="notice">Gate {flight.liveStatus.departureGate ?? flight.liveStatus.terminalGate?.departureGate ?? 'TBD'} - {lastFetchedLabel}</p>}
      {[departure.warning, arrival.warning].filter((warning): warning is string => Boolean(warning)).map((warning, index) => <p className="notice warning" key={`time-${index}-${warning}`}>{warning}</p>)}
      {warnings.map((warning, index) => <p className="notice warning" key={`provider-${index}-${warning}`}>{warning}</p>)}
      <div className="actions">
        <button type="button" onClick={() => onOpen(flight)}>View details</button>
        {!compactActions && <button type="button" className="ghost" onClick={() => onEdit(flight)}>Edit</button>}
        {!compactActions && <button type="button" className="ghost danger" onClick={() => onDelete(flight.id)}><Trash2 aria-hidden="true" /> Delete</button>}
        <button type="button" className="secondary" disabled={!isOnline || !refreshAvailable} onClick={() => onRefresh(flight)}><RefreshCw aria-hidden="true" /> {refreshAvailable ? 'Refresh status' : lastFetchedLabel}</button>
      </div>
    </article>
  )
}

function FlightsPage({ flights, airportVersion, isOnline, onOpen, onEdit, onDelete, onRefresh, onQuickAdd }: { flights: FlightLogEntry[]; airportVersion: number; isOnline: boolean; onOpen: (flight: FlightLogEntry) => void; onEdit: (flight: FlightLogEntry) => void; onDelete: (id: string) => Promise<void>; onRefresh: (flight: FlightLogEntry) => Promise<void>; onQuickAdd: () => void }) {
  const [query, setQuery] = useState('')
  const computed = useMemo(() => {
    void airportVersion
    return flights.map(computeFlight)
  }, [flights, airportVersion])
  const filtered = computed.filter((flight) =>
    [flight.flightNumber, flight.airline, flight.origin, flight.destination, flight.originAirport?.country, flight.destinationAirport?.country, flight.originAirport?.name, flight.destinationAirport?.name, flight.date.slice(0, 4)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase()),
  )
  return (
    <main className="page">
      <div className="section-heading"><div><p className="eyebrow">Manifest</p><h2>Flights</h2></div><div className="heading-actions"><label className="search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search airport, airline, year, country..." /></label><button type="button" onClick={onQuickAdd}><Plus aria-hidden="true" /> Add by flight number</button></div></div>
      <div className="stack">{filtered.map((flight) => <FlightCard key={flight.id} flight={flight} isOnline={isOnline} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onRefresh={onRefresh} />)}{filtered.length === 0 && <p className="empty-inline">No matching flights.</p>}</div>
    </main>
  )
}

function FlightTimeline({ flight }: { flight: FlightLogEntry }) {
  const settings = useAppSettings()
  const displayOptions = flightTimeDisplayOptions(settings)
  const rows = [
    { label: 'Scheduled departure', direction: 'departure' as const, kind: 'scheduled' as const, localLabel: `${flight.origin} local time` },
    { label: 'Estimated departure', direction: 'departure' as const, kind: 'estimated' as const, localLabel: `${flight.origin} local time` },
    { label: 'Actual departure', direction: 'departure' as const, kind: 'actual' as const, localLabel: `${flight.origin} local time` },
    { label: 'Scheduled arrival', direction: 'arrival' as const, kind: 'scheduled' as const, localLabel: `${flight.destination} local time` },
    { label: 'Estimated arrival', direction: 'arrival' as const, kind: 'estimated' as const, localLabel: `${flight.destination} local time` },
    { label: 'Actual arrival', direction: 'arrival' as const, kind: 'actual' as const, localLabel: `${flight.destination} local time` },
  ]
  return (
    <section className="panel">
      <h3>Timeline</h3>
      <div className="timeline">
        {rows.map((row) => {
          const time = resolveFlightTime(flight, row.kind, row.direction, displayOptions)
          return (
            <div className="timeline-row" key={`${row.kind}-${row.direction}`}>
              <div><strong>{row.label}</strong><span>{row.localLabel}</span></div>
              <div>{time?.label ?? 'Not set'}{time?.warning && <p className="notice warning">{time.warning}</p>}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function RouteMapPreview({ flight }: { flight: FlightWithComputed }) {
  const settings = useAppSettings()
  return (
    <section className="panel route-preview">
      <div className="section-heading compact-heading"><div><p className="eyebrow">Route preview</p><h3>{flight.origin} to {flight.destination}</h3></div></div>
      <div className="route-mini-map" aria-label={`${flight.origin} to ${flight.destination} route preview`}>
        <span>{flight.origin}</span>
        <div />
        <span>{flight.destination}</span>
      </div>
      <p className="muted">{flight.hasRouteCoordinates ? `${formatDistance(flight.distanceKm, settings.distanceUnit)} great-circle distance` : 'Airport coordinates unavailable for this route.'}</p>
    </section>
  )
}

function ExternalLinksSection({ flight }: { flight: FlightLogEntry }) {
  return (
    <section className="panel">
      <h3>More flight information</h3>
      <div className="link-grid">
        {externalFlightLinks(flight).map((link) => (
          <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
        ))}
      </div>
    </section>
  )
}

function CalendarSection({ flight }: { flight: FlightLogEntry }) {
  const [copyMessage, setCopyMessage] = useState('')
  const appUrl = `${window.location.href.split('#')[0]}#/flights/${encodeURIComponent(flight.id)}`
  const details = buildCalendarEventDetails(flight, appUrl)
  const prominent = isFutureOrSameDayFlight(flight)

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(details.description)
      setCopyMessage('Calendar details copied.')
    } catch {
      setCopyMessage('Unable to copy calendar details.')
    }
  }

  return (
    <section className={`panel calendar-panel ${prominent ? 'prominent' : ''}`}>
      <div className="section-heading compact-heading">
        <div><p className="eyebrow">{prominent ? 'Upcoming flight' : 'Historical flight'}</p><h3>Add to calendar</h3></div>
      </div>
      {!details.available ? (
        <p className="notice warning">{details.reason ?? 'Calendar export needs departure and arrival times.'}</p>
      ) : (
        <>
          {details.warning && <p className="notice warning">{details.warning}</p>}
          <div className="actions">
            <a className="button-link" href={details.googleUrl} target="_blank" rel="noopener noreferrer"><CalendarDays aria-hidden="true" /> Add to Google Calendar</a>
            <a className="button-link secondary-link" href={details.outlookUrl} target="_blank" rel="noopener noreferrer"><CalendarDays aria-hidden="true" /> Add to Outlook Calendar</a>
            <button type="button" className="secondary" onClick={() => downloadFile(`${flight.flightNumber}-${getFlightDepartureLocalDate(flight)}.ics`, details.ics ?? '', 'text/calendar')}><Download aria-hidden="true" /> Download .ics</button>
            <button type="button" className="ghost" onClick={() => void copyDetails()}>Copy calendar details</button>
          </div>
        </>
      )}
      {copyMessage && <p className="notice">{copyMessage}</p>}
    </section>
  )
}

function TripCard({ trip, onOpen, onUpdate }: { trip: TripGroup; onOpen: (trip: TripGroup) => void; onUpdate: (tripId: string, patch: Partial<TripMetadata>) => void }) {
  const settings = useAppSettings()
  return (
    <article className="flight-card trip-card">
      <div className="flight-main">
        <div>
          <p className="eyebrow">{trip.startDate} to {trip.endDate}</p>
          <input className="inline-name-input" value={trip.name} onChange={(event) => onUpdate(trip.id, { name: event.target.value })} aria-label="Trip name" />
        </div>
        <span className="status scheduled">{trip.isManual ? 'Editable · ' : ''}{trip.isFavorite ? 'Pinned · ' : ''}{trip.flights.length} flight{trip.flights.length === 1 ? '' : 's'}</span>
      </div>
      {trip.flights.length > 0 ? (
        <>
          <p className="trip-route-chain">{trip.routeSummary}</p>
          <div className="route-line"><strong>{trip.routeSummary.split(' -> ')[0]}</strong><span>{trip.routeSummary}</span><ArrowRight aria-hidden="true" /><strong>{trip.routeSummary.split(' -> ').at(-1)}</strong><span>{trip.countries.join(', ') || 'Countries unavailable'}</span></div>
        </>
      ) : (
        <p className="empty-inline">No flights in this trip yet. Open it to add flights.</p>
      )}
      <dl className="meta-grid">
        <div><dt>Total distance</dt><dd>{formatDistance(trip.distanceKm, settings.distanceUnit)}</dd></div>
        <div><dt>Airports</dt><dd>{trip.airports.join(', ') || 'Not set'}</dd></div>
        <div><dt>Countries</dt><dd>{trip.countries.join(', ') || 'Not set'}</dd></div>
        <div><dt>Trip type</dt><dd>{trip.type}</dd></div>
      </dl>
      {trip.notes && <p className="notice">{trip.notes}</p>}
      {trip.warning && <p className="notice warning">{trip.warning}</p>}
      <div className="actions"><button type="button" onClick={() => onOpen(trip)}>View trip</button><button type="button" className="secondary" onClick={() => onUpdate(trip.id, { isFavorite: !trip.isFavorite })}>{trip.isFavorite ? 'Unpin' : 'Pin trip'}</button></div>
    </article>
  )
}

function TripsPage({
  trips,
  onOpen,
  onUpdate,
  onCreateTrip,
}: {
  trips: TripGroup[]
  onOpen: (trip: TripGroup) => void
  onUpdate: (tripId: string, patch: Partial<TripMetadata>) => void
  onCreateTrip: () => Promise<void>
}) {
  return (
    <main className="page">
      <div className="section-heading">
        <div><p className="eyebrow">Trips</p><h2>Grouped journeys</h2></div>
        <button type="button" onClick={() => void onCreateTrip()}><Plus aria-hidden="true" /> New trip</button>
      </div>
      <p className="muted">Flights within three days group automatically. Editable trips let you choose exactly which flights belong together.</p>
      <div className="stack">
        {trips.map((trip) => <TripCard key={trip.id} trip={trip} onOpen={onOpen} onUpdate={onUpdate} />)}
        {trips.length === 0 && <p className="empty-inline">Log flights to build your first trip, or create one manually.</p>}
      </div>
    </main>
  )
}

function TripDetailPage({
  trip,
  trips,
  flights,
  onBack,
  onOpenFlight,
  onUpdate,
  onAddFlight,
  onRemoveFlight,
  onConvertToManual,
  onDeleteTrip,
}: {
  trip?: TripGroup
  trips: TripGroup[]
  flights: FlightLogEntry[]
  onBack: () => void
  onOpenFlight: (flight: FlightLogEntry) => void
  onUpdate: (tripId: string, patch: Partial<TripMetadata>) => void
  onAddFlight: (trip: TripGroup, flightId: string) => Promise<void>
  onRemoveFlight: (trip: TripGroup, flightId: string) => Promise<void>
  onConvertToManual: (trip: TripGroup) => Promise<void>
  onDeleteTrip: (trip: TripGroup) => Promise<void>
}) {
  const settings = useAppSettings()
  const displayOptions = flightTimeDisplayOptions(settings)
  const [includeShareNotes, setIncludeShareNotes] = useState(false)
  const [flightQuery, setFlightQuery] = useState('')
  if (!trip) {
    return <main className="page"><section className="empty-state"><Plane aria-hidden="true" /><h2>Trip not found</h2><button type="button" onClick={onBack}>Back to trips</button></section></main>
  }
  const shareData = tripShareCardData(trip, { distanceUnit: settings.distanceUnit, includeNotes: includeShareNotes })
  const memberIds = new Set(trip.flights.map((flight) => flight.id))
  const claimedElsewhere = new Set(trips.filter((other) => other.isManual && other.id !== trip.id).flatMap((other) => other.metadata?.flightIds ?? []))
  const query = flightQuery.trim().toLowerCase()
  const candidateFlights = trip.isManual
    ? flights
        .filter((flight) => !memberIds.has(flight.id) && !claimedElsewhere.has(flight.id))
        .filter((flight) => !query || `${flight.flightNumber} ${flight.airline} ${flight.origin} ${flight.destination} ${getFlightDepartureLocalDate(flight)}`.toLowerCase().includes(query))
        .slice(0, 8)
    : []
  return (
    <main className="page detail-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{trip.startDate} to {trip.endDate}</p>
          <h2>{trip.name}</h2>
        </div>
        <button type="button" className="ghost" onClick={onBack}>Back to trips</button>
      </div>
      <section className="panel">
        <input className="inline-name-input large" value={trip.name} onChange={(event) => onUpdate(trip.id, { name: event.target.value })} aria-label="Trip name" />
        <div className="route-mini-map trip-route"><span>{trip.routeSummary || 'No flights yet'}</span></div>
        <dl className="meta-grid">
          <div><dt>Flights</dt><dd>{trip.flights.length}</dd></div>
          <div><dt>Total distance</dt><dd>{formatDistance(trip.distanceKm, settings.distanceUnit)}</dd></div>
          <div><dt>Airports</dt><dd>{trip.airports.join(', ')}</dd></div>
          <div><dt>Countries</dt><dd>{trip.countries.join(', ') || 'Not set'}</dd></div>
          <div><dt>Trip type</dt><dd><select value={trip.type} onChange={(event) => onUpdate(trip.id, { type: event.target.value as TripType })}><option value="personal">Personal</option><option value="work">Work</option><option value="school">School</option><option value="other">Other</option></select></dd></div>
          <div><dt>Favorite</dt><dd><label className="checkbox-row"><input type="checkbox" checked={trip.isFavorite} onChange={(event) => onUpdate(trip.id, { isFavorite: event.target.checked })} /> Pin trip</label></dd></div>
        </dl>
        <label className="wide trip-notes">Trip notes<textarea value={trip.notes ?? ''} onChange={(event) => onUpdate(trip.id, { notes: event.target.value })} rows={3} placeholder="Trip notes, purpose, memories..." /></label>
        <div className="actions"><button type="button" className="secondary" onClick={() => onUpdate(trip.id, { isFavorite: !trip.isFavorite })}>{trip.isFavorite ? 'Unpin trip' : 'Pin trip'}</button></div>
      </section>
      <div className="stack">
        {trip.flights.map((flight) => (
          <article className="flight-card" key={flight.id}>
            <div className="flight-main"><div><p className="eyebrow">{getFlightDepartureLocalDate(flight)}</p><h3>{flight.flightNumber} - {flight.airline}</h3></div><span className="status scheduled">{flight.origin}{' -> '}{flight.destination}</span></div>
            <dl className="meta-grid"><div><dt>Departure</dt><dd>{formatDepartureLocalTime(flight, displayOptions).label}</dd></div><div><dt>Arrival</dt><dd>{formatArrivalLocalTime(flight, displayOptions).label}</dd></div><div><dt>Distance</dt><dd>{formatDistance(flight.distanceKm, settings.distanceUnit)}</dd></div></dl>
            <div className="actions">
              <button type="button" onClick={() => onOpenFlight(flight)}>View flight</button>
              {trip.isManual && <button type="button" className="ghost" onClick={() => void onRemoveFlight(trip, flight.id)}><X aria-hidden="true" /> Remove from trip</button>}
            </div>
          </article>
        ))}
        {trip.isManual && trip.flights.length === 0 && <p className="empty-inline">No flights in this trip yet. Add flights below.</p>}
      </div>
      {trip.isManual ? (
        <section className="panel trip-editor-panel">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Trip editor</p><h3>Add flights to this trip</h3></div></div>
          <p className="muted">This trip is editable: it keeps exactly the flights you add. Removed flights return to automatic grouping.</p>
          <label className="wide">Search your flights<input className="search" value={flightQuery} onChange={(event) => setFlightQuery(event.target.value)} placeholder="Flight number, airline, route, or date" /></label>
          <div className="stack compact-stack">
            {candidateFlights.map((flight) => (
              <article className="trip-candidate" key={flight.id}>
                <div>
                  <p className="eyebrow">{getFlightDepartureLocalDate(flight)}</p>
                  <h4>{flight.flightNumber} · {flight.origin} {'->'} {flight.destination}</h4>
                  <p className="muted">{flight.airline}</p>
                </div>
                <button type="button" className="secondary" onClick={() => void onAddFlight(trip, flight.id)}><Plus aria-hidden="true" /> Add</button>
              </article>
            ))}
            {candidateFlights.length === 0 && <p className="empty-inline">{query ? 'No available flights match this search.' : 'All of your flights are already in this or another editable trip.'}</p>}
          </div>
          <div className="actions trip-editor-danger">
            <button type="button" className="ghost danger" onClick={() => void onDeleteTrip(trip)}><Trash2 aria-hidden="true" /> Delete this trip</button>
          </div>
          <p className="muted">Deleting a trip never deletes flights; they simply regroup automatically.</p>
        </section>
      ) : (
        <section className="panel trip-editor-panel">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Trip editor</p><h3>Make this trip editable</h3></div></div>
          <p className="muted">This trip was grouped automatically from flights within three days of each other. Convert it to an editable trip to add or remove flights manually; its name, notes, and pin carry over.</p>
          <div className="actions"><button type="button" className="secondary" onClick={() => void onConvertToManual(trip)}><SlidersHorizontal aria-hidden="true" /> Convert to editable trip</button></div>
        </section>
      )}
      <ShareCardPreview data={shareData} includeNotes={includeShareNotes} onIncludeNotesChange={setIncludeShareNotes} />
    </main>
  )
}

function FlightDetailPage({
  flight,
  airportVersion,
  isOnline,
  onBack,
  onEdit,
  onDelete,
  onRefresh,
  onDismissCompletion,
}: {
  flight?: FlightLogEntry
  airportVersion: number
  isOnline: boolean
  onBack: () => void
  onEdit: (flight: FlightLogEntry) => void
  onDelete: (id: string) => Promise<void>
  onRefresh: (flight: FlightLogEntry) => Promise<void>
  onDismissCompletion: (flight: FlightLogEntry) => Promise<void>
}) {
  const settings = useAppSettings()
  const displayOptions = flightTimeDisplayOptions(settings)
  const [includeShareNotes, setIncludeShareNotes] = useState(false)
  const computed = useMemo(() => {
    void airportVersion
    return flight ? computeFlight(flight) : undefined
  }, [flight, airportVersion])
  if (!flight || !computed) {
    return <main className="page"><section className="empty-state"><Plane aria-hidden="true" /><h2>Flight not found</h2><button type="button" onClick={onBack}>Back to flights</button></section></main>
  }
  const departure = formatDepartureLocalTime(flight, displayOptions)
  const arrival = formatArrivalLocalTime(flight, displayOptions)
  const warnings = [...(flight.providerWarnings ?? []), ...(departure.warning ? [departure.warning] : []), ...(arrival.warning ? [arrival.warning] : [])]
  const refreshAvailable = canRefreshLiveStatus(flight.lastFetchedAt)
  const refreshLabel = refreshStatusLabel(flight.lastFetchedAt)
  const airline = airlineForFlight(flight)
  const detailsUrl = `${window.location.href.split('#')[0]}#/flights/${encodeURIComponent(flight.id)}`
  const calendar = buildCalendarEventDetails(flight, detailsUrl)
  const links = externalFlightLinks(flight)
  const shareData = flightShareCardData(flight, { ...displayOptions, distanceUnit: settings.distanceUnit, includeNotes: includeShareNotes })
  return (
    <main className="page detail-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{getFlightDepartureLocalDate(flight)} · {flight.source}</p>
          <h2>{flight.flightNumber} - {airline?.name ?? flight.airline}</h2>
        </div>
        <div className="heading-actions">
          <button type="button" className="ghost" onClick={onBack}>Back</button>
          <button type="button" className="secondary" onClick={() => onEdit(flight)}>Edit</button>
        </div>
      </div>
      <section className="panel detail-hero">
        <div className="flight-main">
          <div>
            <p className="eyebrow">{airline?.country ?? 'Flight detail'}</p>
            <h3>{flight.flightNumber}</h3>
            <div className="route-line detail-route"><strong>{flight.origin}</strong><span>{computed.originAirport?.name}</span><ArrowRight aria-hidden="true" /><strong>{flight.destination}</strong><span>{computed.destinationAirport?.name}</span></div>
          </div>
          <span className={`status ${flight.liveStatus?.status ?? 'unknown'}`}>{flight.liveStatus?.status ?? 'manual'}</span>
        </div>
        {flight.deletedAt && <p className="notice warning">This flight is deleted and should only appear from Trash.</p>}
        <dl className="meta-grid">
          <div><dt>Departure local</dt><dd>{departure.label}</dd></div>
          <div><dt>Arrival local</dt><dd>{arrival.label}</dd></div>
          <div><dt>Terminal / gate</dt><dd>{[flight.liveStatus?.departureTerminal, flight.liveStatus?.departureGate].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
          <div><dt>Baggage</dt><dd>{flight.liveStatus?.baggageClaim ?? 'Not set'}</dd></div>
          <div><dt>Aircraft</dt><dd>{[flight.aircraftType, flight.aircraftRegistration].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
          <div><dt>Cabin / seat</dt><dd>{[flight.cabin, flight.seat].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
          <div><dt>Purpose</dt><dd>{flight.purpose}</dd></div>
          <div><dt>Provider</dt><dd>{[flight.liveStatus?.provider, flight.providerFetchedAt ?? flight.lastFetchedAt].filter(Boolean).join(' / ') || 'Not fetched'}</dd></div>
          <div><dt>Status check</dt><dd>{refreshLabel}</dd></div>
        </dl>
        {flight.notes && <p className="notice">{flight.notes}</p>}
        {warnings.map((warning, index) => <p className="notice warning" key={`detail-${index}-${warning}`}>{warning}</p>)}
        <div className="actions action-row">
          <button type="button" className="secondary" disabled={!isOnline || !refreshAvailable} onClick={() => onRefresh(flight)}><RefreshCw aria-hidden="true" /> {refreshAvailable ? 'Refresh' : refreshLabel}</button>
          {calendar.googleUrl && <a className="button-link" href={calendar.googleUrl} target="_blank" rel="noopener noreferrer"><CalendarDays aria-hidden="true" /> Calendar</a>}
          {links[0] && <a className="button-link secondary-link" href={links[0].url} target="_blank" rel="noopener noreferrer">{links[0].label}</a>}
          <button type="button" className="secondary" onClick={() => onEdit(flight)}>Edit</button>
          <button type="button" className="secondary" onClick={() => downloadFile(`${flight.flightNumber}-${flight.id}.json`, JSON.stringify({ flight }, null, 2), 'application/json')}><Download aria-hidden="true" /> Export this flight as JSON</button>
        </div>
      </section>
      <FlightLifecycleSection flight={flight} onEdit={onEdit} onDismissCompletion={onDismissCompletion} />
      <div className="two-columns detail-columns">
        <FlightTimeline flight={flight} />
        <RouteMapPreview flight={computed} />
      </div>
      <CalendarSection flight={flight} />
      <ExternalLinksSection flight={flight} />
      <ShareCardPreview data={shareData} includeNotes={includeShareNotes} onIncludeNotesChange={setIncludeShareNotes} />
      <section className="panel danger-zone">
        <div className="flight-main"><div><p className="eyebrow">Secondary action</p><h3>Delete flight</h3></div><Trash2 aria-hidden="true" /></div>
        <p className="muted">Deletion moves the flight to Trash and preserves a tombstone for Sync Lite. Permanent deletion remains separate in Trash.</p>
        <div className="actions"><button type="button" className="ghost danger" onClick={() => onDelete(flight.id)}><Trash2 aria-hidden="true" /> Delete</button></div>
      </section>
    </main>
  )
}

function MapPage({ flights, airportVersion }: { flights: FlightLogEntry[]; airportVersion: number }) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const leafletRef = useRef<import('leaflet').Map | null>(null)
  const leafletModuleRef = useRef<typeof import('leaflet') | null>(null)
  const [leafletReady, setLeafletReady] = useState(false)
  const computed = useMemo(() => {
    void airportVersion
    return flights.map(computeFlight)
  }, [flights, airportVersion])

  useEffect(() => {
    if (!mapRef.current) return
    let cancelled = false
    void Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([L]) => {
      if (cancelled || !mapRef.current) return
      leafletModuleRef.current = L
      const map = L.map(mapRef.current, { scrollWheelZoom: false }).setView([25, 0], 2)
      leafletRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map)
      setLeafletReady(true)
    })
    return () => {
      cancelled = true
      leafletRef.current?.remove()
      leafletRef.current = null
      leafletModuleRef.current = null
      setLeafletReady(false)
    }
  }, [])

  useEffect(() => {
    const map = leafletRef.current
    const L = leafletModuleRef.current
    if (!map || !L || !leafletReady) return
    const layer = L.layerGroup().addTo(map)
    const bounds: import('leaflet').LatLngTuple[] = []
    const markerIcon = L.divIcon({ className: 'airport-marker', html: '<span></span>', iconSize: [16, 16] })
    for (const flight of computed) {
      const { originAirport, destinationAirport } = flight
      if (
        !flight.hasRouteCoordinates ||
        originAirport?.lat === undefined ||
        originAirport.lon === undefined ||
        destinationAirport?.lat === undefined ||
        destinationAirport.lon === undefined
      ) continue
      const originPoint: import('leaflet').LatLngTuple = [originAirport.lat, originAirport.lon]
      const destinationPoint: import('leaflet').LatLngTuple = [destinationAirport.lat, destinationAirport.lon]
      const points: import('leaflet').LatLngTuple[] = [originPoint, destinationPoint]
      bounds.push(...points)
      L.polyline(points, { color: '#0f766e', weight: 3, opacity: 0.75 }).bindPopup(`${flight.flightNumber}: ${flight.origin} to ${flight.destination}`).addTo(layer)
      L.marker(originPoint, { icon: markerIcon }).bindPopup(`<strong>${originAirport.iata}</strong><br>${originAirport.name}<br>${[originAirport.city, originAirport.country].filter(Boolean).join(', ')}`).addTo(layer)
      L.marker(destinationPoint, { icon: markerIcon }).bindPopup(`<strong>${destinationAirport.iata}</strong><br>${destinationAirport.name}<br>${[destinationAirport.city, destinationAirport.country].filter(Boolean).join(', ')}`).addTo(layer)
    }
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [28, 28] })
    return () => {
      layer.remove()
    }
  }, [computed, leafletReady])

  const mappedFlights = computed.filter((flight) => flight.hasRouteCoordinates).length
  return <main className="page"><div className="section-heading"><div><p className="eyebrow">Route atlas</p><h2>Map</h2></div></div>{flights.length === 0 ? <p className="empty-inline">Log a flight to draw your first route.</p> : <><div className="map-frame" ref={mapRef} />{mappedFlights < flights.length && <p className="notice warning">{flights.length - mappedFlights} flight route{flights.length - mappedFlights === 1 ? '' : 's'} saved without coordinates and cannot be mapped yet.</p>}</>}</main>
}

function ListPanel({ title, rows }: { title: string; rows: string[] }) {
  return <article className="panel"><h3>{title}</h3>{rows.length === 0 ? <p className="muted">No data yet.</p> : <ul>{rows.map((row) => <li key={row}>{row}</li>)}</ul>}</article>
}

function tripHasUpcomingFlight(trip: TripGroup): boolean {
  return trip.flights.some((flight) => listUpcomingFlights([flight]).length > 0)
}

function PassportPage({ flights, trips }: { flights: FlightLogEntry[]; trips: TripGroup[] }) {
  const settings = useAppSettings()
  const stats = aggregateStats(flights)
  const computedFlights = flights.map(computeFlight)
  const longestFlights = computedFlights.filter((flight) => flight.distanceKm > 0).sort((a, b) => b.distanceKm - a.distanceKm).slice(0, 5)
  const favoriteAirline = stats.topAirlines[0]
  const favoriteRoute = stats.topRoutes[0]
  const upcomingTripCount = trips.filter(tripHasUpcomingFlight).length
  const latestTrip = trips[0]
  const longestTrip = trips.slice().sort((a, b) => b.distanceKm - a.distanceKm)[0]
  const mostFlightsTrip = trips.slice().sort((a, b) => b.flights.length - a.flights.length)[0]
  const shareYear = stats.bestTravelYear ?? new Date().getFullYear().toString()
  const yearlyShareData = flights.length > 0 ? yearlyPassportShareCardData(flights, shareYear, { distanceUnit: settings.distanceUnit }) : undefined
  const cabinCounts = computedFlights.reduce((counts, flight) => {
    const cabin = flight.cabin?.trim() || 'Unspecified'
    counts.set(cabin, (counts.get(cabin) ?? 0) + 1)
    return counts
  }, new globalThis.Map<string, number>())
  const topCabin = [...cabinCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  const passportScore = Math.min(100, Math.round(
    stats.totalFlights * 1.5 +
    stats.airportsVisited.length * 2 +
    stats.countriesVisited.length * 3 +
    stats.airlines.length * 1.5 +
    trips.length * 2,
  ))
  const milestoneCards = [
    { label: 'Explorer score', value: `${passportScore}/100`, detail: 'A free, local-only progress score from flights, airports, countries, airlines, and trips.' },
    { label: 'Next country goal', value: `${stats.countriesVisited.length}/25`, detail: `${Math.max(25 - stats.countriesVisited.length, 0)} more ${stats.countriesVisited.length >= 25 ? 'needed to keep the badge' : 'to unlock the 25-country badge'}.` },
    { label: 'Airport collector', value: `${stats.airportsVisited.length}/50`, detail: `${Math.max(50 - stats.airportsVisited.length, 0)} more unique airports to reach the 50-airport badge.` },
    { label: 'Cabin profile', value: topCabin ? topCabin[0] : 'Not set', detail: topCabin ? `${topCabin[1]} logged flight${topCabin[1] === 1 ? '' : 's'} in this cabin.` : 'Add cabin details to see your travel style.' },
  ]
  const proInsights = [
    favoriteRoute ? `Signature route: ${favoriteRoute.route} (${favoriteRoute.count} flights).` : 'Log repeat routes to reveal your signature route.',
    stats.shortestFlight ? `Shortest hop: ${routeKey(stats.shortestFlight)} at ${formatDistance(stats.shortestFlight.distanceKm, settings.distanceUnit)}.` : 'Add route coordinates to rank your shortest hop.',
    stats.bestTravelYear ? `Best travel year: ${stats.bestTravelYear} with ${stats.yearly.find((row) => row.year === stats.bestTravelYear)?.flights ?? 0} flights.` : 'Your best travel year appears after your first flight.',
    longestTrip ? `Biggest trip: ${longestTrip.name} covered ${formatDistance(longestTrip.distanceKm, settings.distanceUnit)}.` : 'Group flights into trips to unlock trip superlatives.',
  ]
  return (
    <main className="page passport">
      <div className="passport-cover"><p className="eyebrow">Digital passport</p><h2>Lifetime travel record</h2><div className="passport-number">{stats.totalFlights.toString().padStart(3, '0')} flights</div><p className="passport-cover-copy">Passport Pro-style achievements, superlatives, and shareable summaries are included for free and stay open source.</p><button type="button" className="secondary" disabled={!yearlyShareData}>Share summary</button></div>
      <section className="panel passport-pro-panel">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Open Passport Pro</p><h2>Free achievement board</h2></div><CheckCircle2 aria-hidden="true" /></div>
        <div className="passport-pro-grid">{milestoneCards.map((card) => <article className="passport-pro-card" key={card.label}><span>{card.label}</span><strong>{card.value}</strong><p>{card.detail}</p></article>)}</div>
        <ul className="passport-insight-list">{proInsights.map((insight) => <li key={insight}>{insight}</li>)}</ul>
      </section>
      <section className="stats-grid">
        <StatCard icon={Gauge} label="Flight time" value={formatDuration(stats.totalDurationMinutes)} />
        <StatCard icon={Map} label="Airports unlocked" value={String(stats.airportsVisited.length)} />
        <StatCard icon={Globe2} label="Countries unlocked" value={String(stats.countriesVisited.length)} />
        <StatCard icon={Plane} label="Airlines flown" value={String(stats.airlines.length)} />
        <StatCard icon={Plane} label="Aircraft types" value={String(stats.aircraftTypes.length)} />
        <StatCard icon={ArrowRight} label="Longest flight" value={stats.longestFlight ? routeKey(stats.longestFlight) : 'None'} />
        <StatCard icon={CalendarDays} label="Best travel year" value={stats.bestTravelYear ?? 'None'} />
        <StatCard icon={Plane} label="Favorite airline" value={favoriteAirline ? airlineDisplayName(favoriteAirline.airline) : 'None'} />
        <StatCard icon={ArrowRight} label="Favorite route" value={favoriteRoute ? favoriteRoute.route : 'None'} />
        <StatCard icon={CalendarDays} label="Upcoming trips" value={String(upcomingTripCount)} />
      </section>
      <section className="stamp-grid">
        {stats.airportsVisited.slice(0, 12).map((airport) => <article className="passport-stamp" key={airport.iata}><strong>{airport.iata}</strong><span>{airport.city || airport.name}</span><small>{airport.country}</small></article>)}
        {flights.length === 0 && <article className="passport-stamp empty-stamp"><strong>---</strong><span>No stamps yet</span><small>Add a flight to unlock airports.</small></article>}
      </section>
      <section className="three-columns">
        <ListPanel title="Trip stamps" rows={[
          latestTrip ? `Latest: ${latestTrip.name} - ${latestTrip.routeSummary}` : '',
          longestTrip ? `Longest: ${longestTrip.name} - ${formatDistance(longestTrip.distanceKm, settings.distanceUnit)}` : '',
          mostFlightsTrip ? `Most flights: ${mostFlightsTrip.name} - ${mostFlightsTrip.flights.length}` : '',
        ].filter(Boolean)} />
        <ListPanel title="Unlocked" rows={[`${stats.countriesVisited.length} countries`, `${stats.airportsVisited.length} airports`, `${stats.airlines.length} airlines`]} />
        <ListPanel title="Top airlines" rows={stats.topAirlines.slice(0, 8).map((row) => `${airlineDisplayName(row.airline)}: ${row.count}`)} />
      </section>
      <section className="three-columns"><ListPanel title="Yearly summary" rows={stats.yearly.map((row) => `${row.year}: ${row.flights} flights - ${formatDistance(row.distanceKm, settings.distanceUnit)}`)} /><ListPanel title="Top airports" rows={stats.topAirports.slice(0, 8).map((row) => `${row.code}: ${row.count} visits - ${row.label}`)} /><ListPanel title="Most frequent routes" rows={stats.topRoutes.slice(0, 8).map((row) => `${row.route}: ${row.count} - ${formatDistance(row.distanceKm, settings.distanceUnit)}`)} /></section>
      <section className="three-columns"><ListPanel title="Longest flights" rows={longestFlights.map((flight) => `${routeKey(flight)} - ${formatDistance(flight.distanceKm, settings.distanceUnit)}`)} /><ListPanel title="Aircraft" rows={stats.aircraftTypes} /><ListPanel title="Favorite trips" rows={trips.filter((trip) => trip.isFavorite).slice(0, 8).map((trip) => `${trip.name}: ${trip.routeSummary}`)} /></section>
      <section className="two-columns"><ListPanel title="Countries unlocked" rows={stats.countriesVisited} /><ListPanel title="First-time badges" rows={stats.airportsVisited.slice(0, 8).map((airport) => `First logged ${airport.iata} - ${airport.country}`)} /></section>
      {yearlyShareData && <ShareCardPreview data={yearlyShareData} />}
    </main>
  )
}

function DataOwnershipCard() {
  return (
    <section className="panel">
      <div className="flight-main">
        <div>
          <p className="eyebrow">Data ownership</p>
          <h3>FlightLog is local-first.</h3>
        </div>
        <Shield aria-hidden="true" />
      </div>
      <p className="muted">Without sign-in, your data stays in this browser&apos;s IndexedDB. With cloud backup or Sync Lite, snapshots or records are stored in Supabase under your signed-in user. Signing out does not delete local data, deleting cloud backups does not delete local data, and clearing local data does not delete cloud backups. Deleted flights move to Trash first and sync as tombstones; permanent deletion is a separate local action.</p>
      <details>
        <summary>What is stored in cloud?</summary>
        <p className="muted">Flights, deleted-flight tombstones, trip metadata, provider-derived airports, app settings, sync metadata, sync history, and device records. Cloud backups and sync records are plain JSON protected by Supabase Auth and RLS; they are not end-to-end encrypted yet. Client-side encrypted backups remain a future option.</p>
      </details>
    </section>
  )
}

function accountStatusLabel(configured: boolean, session: Session | null): string {
  if (!configured) return 'Supabase not configured'
  if (!session) return 'Supabase configured, signed out'
  return 'Signed in, cloud backup available'
}

function SettingsPage({
  configured,
  authLoading,
  session,
  authMessage,
  settings,
  syncMetadata,
  flights,
  allFlights,
  allTripMetadata,
  providerAirports,
  appMetadata,
  syncStatus,
  syncComparison,
  cloud,
  currentChecksum,
  liveApiStatus,
  standalone,
  installPromptAvailable,
  onGoogleSignIn,
  onEmailSignIn,
  onSignOut,
  onSettingsChange,
  onNavigateBackup,
  onNavigateSync,
  onNavigateTrash,
  onExportBackup,
  onRepairData,
  onClearLocalData,
  onRunLiveApiTest,
  onInstallPrompt,
  onCompareSync,
}: {
  configured: boolean
  authLoading: boolean
  session: Session | null
  authMessage: string
  settings: AppSettings
  syncMetadata: SyncMetadata
  flights: FlightLogEntry[]
  allFlights: FlightLogEntry[]
  allTripMetadata: TripMetadata[]
  providerAirports: ProviderAirportSnapshot[]
  appMetadata: AppMetadata[]
  syncStatus: SyncStatusSnapshot
  syncComparison?: SyncComparison
  cloud: CloudBackupControls
  currentChecksum?: string
  liveApiStatus: { status: 'unchecked' | 'checking' | 'reachable' | 'error'; checkedAt?: string; message?: string }
  standalone: boolean
  installPromptAvailable: boolean
  onGoogleSignIn: () => Promise<void>
  onEmailSignIn: (email: string) => Promise<void>
  onSignOut: () => Promise<void>
  onSettingsChange: (patch: Partial<AppSettings>) => Promise<void>
  onNavigateBackup: () => void
  onNavigateSync: () => void
  onNavigateTrash: () => void
  onExportBackup: () => Promise<void>
  onRepairData: () => Promise<void>
  onClearLocalData: () => Promise<void>
  onRunLiveApiTest: () => Promise<void>
  onInstallPrompt: () => Promise<void>
  onCompareSync?: () => Promise<void>
}) {
  const displayOptions = flightTimeDisplayOptions(settings)
  const [email, setEmail] = useState('')
  const [diagnosticsMessage, setDiagnosticsMessage] = useState('')
  const storage = localStorageSummary({ flights, allFlights, tripMetadata: allTripMetadata, providerAirports, appMetadata, localSchemaVersion: LOCAL_SCHEMA_VERSION })
  const health = analyzeDataHealth(flights, { allFlights, tripMetadata: allTripMetadata, syncComparison })
  const provider = session?.user.app_metadata?.provider
  const lastSuccessfulLookup = appMetadataValue(appMetadata, 'lastSuccessfulLiveLookupAt')
  const diagnostics = diagnosticsText({
    supabaseConfigured: configured,
    signedIn: Boolean(session),
    userEmail: session?.user.email,
    localSchemaVersion: LOCAL_SCHEMA_VERSION,
    backupSchemaVersion: 4,
    latestCloudBackupChecksum: appMetadataValue(appMetadata, 'lastCloudBackupChecksum')?.slice(0, 12),
    latestLocalBackupChecksum: currentChecksum?.slice(0, 12),
    workerConfigured: Boolean(import.meta.env.VITE_FLIGHTLOG_API_BASE_URL),
    workerUrl: import.meta.env.VITE_FLIGHTLOG_API_BASE_URL || 'not configured',
    serviceWorkerCacheVersion: 'flightlog-v20',
    syncMetadata,
  })

  async function submitEmail(event: FormEvent) {
    event.preventDefault()
    await onEmailSignIn(email)
  }

  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(diagnostics)
      setDiagnosticsMessage('Diagnostics copied.')
    } catch {
      setDiagnosticsMessage('Unable to copy diagnostics.')
    }
  }

  return (
    <main className="page settings-page">
      <div className="section-heading"><div><p className="eyebrow">Settings</p><h2>Preferences, cloud, and diagnostics</h2></div></div>
      <nav className="settings-nav" aria-label="Settings sections">
        <a href="#account">Account</a>
        <a href="#sync-lite">Sync</a>
        <a href="#display">Display</a>
        <a href="#pwa">PWA</a>
        <a href="#data-storage">Data</a>
        <a href="#diagnostics">Diagnostics</a>
      </nav>
      <DataOwnershipCard />
      <div id="pwa"><PwaInstallPanel standalone={standalone} canPrompt={installPromptAvailable} onInstall={onInstallPrompt} /></div>
      <SyncStatusBadge status={syncStatus} onCompare={onCompareSync} />
      <section className="panel" id="account">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Account</p><h3>{accountStatusLabel(configured, session)}</h3></div><span className="status scheduled">{session ? 'signed in' : configured ? 'local-only' : 'offline-ready'}</span></div>
        {!configured ? (
          <p className="notice warning">Supabase is not configured. FlightLog still works locally, and local backup export/import remains available.</p>
        ) : authLoading ? (
          <p className="empty-inline">Loading Supabase session...</p>
        ) : !session ? (
          <>
            <p className="muted">You can keep using FlightLog without signing in. Sign in only if you want optional cloud backup snapshots or manual Sync Lite push/pull.</p>
            <div className="actions"><button type="button" onClick={() => void onGoogleSignIn()}><LogIn aria-hidden="true" /> Continue with Google</button></div>
            <form onSubmit={submitEmail} className="form-grid compact"><label>Email magic link<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label><div className="actions"><button type="submit"><Mail aria-hidden="true" /> Send magic link</button></div></form>
            <p className="muted">Cloud backup gives restore points. Sync Lite lets you compare, push, and pull records manually. Neither runs automatically.</p>
          </>
        ) : (
          <>
            <dl className="meta-grid">
              <div><dt>Email</dt><dd>{session.user.email ?? 'Supabase user'}</dd></div>
              <div><dt>Provider</dt><dd>{typeof provider === 'string' ? provider : 'auth'}</dd></div>
              <div><dt>Status</dt><dd>Signed in</dd></div>
            </dl>
            <details><summary>Diagnostics identifiers</summary><p className="muted">User ID: {session.user.id}</p></details>
            <div className="actions"><button type="button" className="secondary" onClick={() => void onSignOut()}><LogOut aria-hidden="true" /> Sign out</button></div>
          </>
        )}
        {authMessage && <p className="notice">{authMessage}</p>}
      </section>

      <CloudBackupSection cloud={cloud} appMetadata={appMetadata} />

      <section className="panel" id="sync-lite">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Cloud Sync Lite</p><h3>Manual compare, push, and pull</h3></div><button type="button" onClick={onNavigateSync}><Cloud aria-hidden="true" /> Open Sync</button></div>
        <dl className="meta-grid">
          <div><dt>Last compared</dt><dd>{syncMetadata.lastCloudCompareAt ? formatDateTime(syncMetadata.lastCloudCompareAt, displayOptions) : 'Never'}</dd></div>
          <div><dt>Last push</dt><dd>{syncMetadata.lastCloudPushAt ? formatDateTime(syncMetadata.lastCloudPushAt, displayOptions) : 'Never'}</dd></div>
          <div><dt>Last pull</dt><dd>{syncMetadata.lastCloudPullAt ? formatDateTime(syncMetadata.lastCloudPullAt, displayOptions) : 'Never'}</dd></div>
          <div><dt>Tombstones</dt><dd>{syncStatus.tombstoneCount}</dd></div>
          <div><dt>Conflicts</dt><dd>{syncComparison?.conflicts.length ?? 'Not compared'}</dd></div>
        </dl>
        <p className="muted">Backup is a snapshot restore point. Sync Lite is manual record-level push/pull. It does not poll, auto-merge, or silently overwrite data.</p>
      </section>

      <section className="two-columns settings-columns">
        <article className="panel" id="display">
          <p className="eyebrow">Display</p>
          <h3>Theme</h3>
          <div className="segmented" role="group" aria-label="Theme">
            {(['system', 'light', 'dark'] as const).map((theme) => <button key={theme} type="button" className={settings.theme === theme ? 'active' : ''} onClick={() => void onSettingsChange({ theme })}>{theme}</button>)}
          </div>
        </article>
        <article className="panel" id="units">
          <p className="eyebrow">Units & Formatting</p>
          <div className="form-grid compact">
            <label>Distance unit<select value={settings.distanceUnit} onChange={(event) => void onSettingsChange({ distanceUnit: event.target.value as AppSettings['distanceUnit'] })}><option value="kilometers">Kilometers</option><option value="miles">Miles</option></select></label>
            <label>Time format<select value={settings.timeFormat} onChange={(event) => void onSettingsChange({ timeFormat: event.target.value as AppSettings['timeFormat'] })}><option value="system">System</option><option value="12h">12-hour</option><option value="24h">24-hour</option></select></label>
            <label>Date format<select value={settings.dateFormat} onChange={(event) => void onSettingsChange({ dateFormat: event.target.value as AppSettings['dateFormat'] })}><option value="medium">Medium</option><option value="compact">Compact</option><option value="iso">ISO-like</option></select></label>
          </div>
        </article>
      </section>

      <section className="two-columns settings-columns">
        <article className="panel" id="defaults">
          <p className="eyebrow">Defaults</p>
          <div className="form-grid compact">
            <label>Default cabin<select value={settings.defaultCabin} onChange={(event) => void onSettingsChange({ defaultCabin: event.target.value as AppSettings['defaultCabin'] })}><option value="">No default</option><option>Economy</option><option>Premium Economy</option><option>Business</option><option>First</option></select></label>
            <label>Default purpose<select value={settings.defaultPurpose} onChange={(event) => void onSettingsChange({ defaultPurpose: event.target.value as AppSettings['defaultPurpose'] })}><option value="">No default</option><option value="personal">Personal</option><option value="work">Work</option><option value="school">School</option><option value="other">Other</option></select></label>
          </div>
        </article>
        <article className="panel" id="reminders">
          <p className="eyebrow">Reminders</p>
          <label className="checkbox-row"><input type="checkbox" checked={settings.backupReminderEnabled} onChange={(event) => void onSettingsChange({ backupReminderEnabled: event.target.checked })} /> Backup reminder</label>
          <label>Backup age threshold days<input type="number" min={1} max={365} value={settings.backupAgeThresholdDays} onChange={(event) => void onSettingsChange({ backupAgeThresholdDays: Number(event.target.value) })} /></label>
          <label className="checkbox-row"><input type="checkbox" checked={settings.syncReminderEnabled} onChange={(event) => void onSettingsChange({ syncReminderEnabled: event.target.checked })} /> Sync reminder</label>
          <label className="checkbox-row"><input type="checkbox" checked={settings.upcomingFlightRefreshReminderEnabled} onChange={(event) => void onSettingsChange({ upcomingFlightRefreshReminderEnabled: event.target.checked })} /> Upcoming flight refresh reminder</label>
        </article>
      </section>

      <section className="panel" id="live-data">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Live Flight Data</p><h3>Worker API</h3></div><button type="button" className="secondary" onClick={() => void onRunLiveApiTest()} disabled={liveApiStatus.status === 'checking'}><RefreshCw aria-hidden="true" /> Test flight lookup</button></div>
        <div className="form-grid compact"><label>Live data mode<select value={settings.liveDataMode} onChange={(event) => void onSettingsChange({ liveDataMode: event.target.value as AppSettings['liveDataMode'] })}><option value="real">Real Worker mode</option><option value="mock">Mock data mode</option><option value="disabled">Disabled</option></select></label></div>
        <dl className="meta-grid">
          <div><dt>Worker</dt><dd>{import.meta.env.VITE_FLIGHTLOG_API_BASE_URL ? 'Configured' : 'Not configured'}</dd></div>
          <div><dt>Status</dt><dd>{liveApiStatus.status}</dd></div>
          <div><dt>Last checked</dt><dd>{liveApiStatus.checkedAt ? formatDateTime(liveApiStatus.checkedAt, displayOptions) : 'Never'}</dd></div>
          <div><dt>Provider</dt><dd>AeroDataBox</dd></div>
          <div><dt>Last success</dt><dd>{lastSuccessfulLookup ? formatDateTime(lastSuccessfulLookup, displayOptions) : 'Never'}</dd></div>
          <div><dt>Worker URL</dt><dd>{import.meta.env.VITE_FLIGHTLOG_API_BASE_URL || 'Not configured'}</dd></div>
        </dl>
        {liveApiStatus.message && <p className={`notice ${liveApiStatus.status === 'error' ? 'warning' : ''}`}>{liveApiStatus.message}</p>}
      </section>

      <section className="panel" id="data-storage">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Data & Storage</p><h3>Local browser data</h3></div></div>
        <dl className="meta-grid">
          <div><dt>Flights</dt><dd>{storage.flightCount}</dd></div>
          <div><dt>Active flights</dt><dd>{storage.activeFlightCount}</dd></div>
          <div><dt>Deleted flights</dt><dd>{storage.deletedFlightCount}</dd></div>
          <div><dt>Trip metadata</dt><dd>{storage.tripMetadataCount}</dd></div>
          <div><dt>Provider airports</dt><dd>{storage.providerAirportCount}</dd></div>
          <div><dt>App metadata</dt><dd>{storage.appMetadataCount}</dd></div>
          <div><dt>Backup size</dt><dd>{storage.estimatedBackupLabel}</dd></div>
          <div><dt>Local schema</dt><dd>v{storage.localSchemaVersion}</dd></div>
        </dl>
        <div className="actions">
          <button type="button" onClick={() => void onExportBackup()}><Download aria-hidden="true" /> Export local backup</button>
          <button type="button" className="secondary" onClick={onNavigateBackup}><Upload aria-hidden="true" /> Import local backup</button>
          <button type="button" className="secondary" onClick={onNavigateTrash}><Trash2 aria-hidden="true" /> Open Trash</button>
          <button type="button" className="secondary" onClick={() => void onRepairData()} disabled={health.repairableAirportSnapshotCount === 0}><Database aria-hidden="true" /> Re-resolve airport snapshots</button>
        </div>
        <dl className="meta-grid">
          <div><dt>Missing timezone</dt><dd>{health.missingTimezoneCount}</dd></div>
          <div><dt>Missing coordinates</dt><dd>{health.missingAirportCoordinateCount}</dd></div>
          <div><dt>Provider warnings</dt><dd>{health.providerWarningCount}</dd></div>
          <div><dt>Missing times</dt><dd>{health.missingTimeCount}</dd></div>
          <div><dt>Orphaned trip metadata</dt><dd>{health.orphanedTripMetadataCount}</dd></div>
          <div><dt>Missing sync metadata</dt><dd>{health.missingSyncMetadataCount}</dd></div>
          <div><dt>Remote tombstones</dt><dd>{health.remoteTombstonesCount}</dd></div>
        </dl>
      </section>

      <section className="panel" id="diagnostics">
        <details>
          <summary><span><SlidersHorizontal aria-hidden="true" /> Diagnostics</span></summary>
          <pre className="diagnostics-output">{diagnostics}</pre>
          <div className="actions"><button type="button" className="secondary" onClick={() => void copyDiagnostics()}><Copy aria-hidden="true" /> Copy diagnostics</button></div>
          {diagnosticsMessage && <p className="notice">{diagnosticsMessage}</p>}
        </details>
      </section>

      <section className="panel danger-zone" id="danger-zone">
        <div className="flight-main"><div><p className="eyebrow">Danger Zone</p><h3>Clear local data</h3></div><AlertTriangle aria-hidden="true" /></div>
        <p className="muted">Export a local backup or create a cloud backup before clearing local data. This does not delete cloud backups or cloud sync records.</p>
        <div className="actions"><button type="button" className="secondary" onClick={onNavigateTrash}><Trash2 aria-hidden="true" /> Open Trash</button><button type="button" className="ghost danger" onClick={() => void onClearLocalData()}><Trash2 aria-hidden="true" /> Clear local data</button></div>
      </section>
    </main>
  )
}

function AccountPage({
  configured,
  authLoading,
  session,
  authMessage,
  appMetadata,
  cloudBackups,
  showRestorePrompt,
  latestCloudBackup,
  onGoogleSignIn,
  onEmailSignIn,
  onSignOut,
  onNavigateBackup,
  onRestoreLatest,
  onDismissRestorePrompt,
  onSetCloudReminder,
  onDeleteAllCloudBackups,
}: {
  configured: boolean
  authLoading: boolean
  session: Session | null
  authMessage: string
  appMetadata: AppMetadata[]
  cloudBackups: CloudBackupSummary[]
  showRestorePrompt: boolean
  latestCloudBackup?: CloudBackupSummary
  onGoogleSignIn: () => Promise<void>
  onEmailSignIn: (email: string) => Promise<void>
  onSignOut: () => Promise<void>
  onNavigateBackup: () => void
  onRestoreLatest: () => Promise<void>
  onDismissRestorePrompt: () => Promise<void>
  onSetCloudReminder: (enabled: boolean) => Promise<void>
  onDeleteAllCloudBackups: () => Promise<void>
}) {
  const settings = useAppSettings()
  const displayOptions = flightTimeDisplayOptions(settings)
  const [email, setEmail] = useState('')
  const reminderEnabled = appMetadataValue(appMetadata, 'cloudBackupReminderEnabled') !== 'false'
  const provider = session?.user.app_metadata?.provider

  async function submitEmail(event: FormEvent) {
    event.preventDefault()
    await onEmailSignIn(email)
  }

  return (
    <main className="page account-page">
      <div className="section-heading">
        <div><p className="eyebrow">Account</p><h2>Local-first cloud backup</h2></div>
        <button type="button" className="ghost" onClick={onNavigateBackup}>Backup Center</button>
      </div>
      <section className="panel">
        <div className="flight-main">
          <div>
            <p className="eyebrow">Data ownership</p>
            <h3>FlightLog works without signing in.</h3>
          </div>
          <Shield aria-hidden="true" />
        </div>
        <p className="muted">Without sign-in, your flights stay in this browser&apos;s IndexedDB. With cloud backup enabled, FlightLog uploads plain JSON backup snapshots to your Supabase project and protects rows with Supabase Auth and RLS. Signing out does not delete local data, and cloud backups remain until you delete them.</p>
      </section>
      {!configured ? (
        <section className="panel">
          <h3>Cloud backup is not configured</h3>
          <p className="notice warning">Local backups still work. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, run the SQL migration, and configure Supabase redirect URLs to enable cloud backup.</p>
        </section>
      ) : authLoading ? (
        <section className="panel"><p className="empty-inline">Loading Supabase session...</p></section>
      ) : !session ? (
        <section className="two-columns">
          <article className="panel">
            <h3>Sign in to enable cloud backup</h3>
            <p className="muted">Google OAuth and email magic link are supported for v1.6. Apple login is reserved for a future release.</p>
            <div className="actions"><button type="button" onClick={() => void onGoogleSignIn()}><LogIn aria-hidden="true" /> Continue with Google</button></div>
          </article>
          <article className="panel">
            <h3>Email magic link</h3>
            <form onSubmit={submitEmail}>
              <div className="form-grid compact"><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label></div>
              <div className="actions"><button type="submit"><Mail aria-hidden="true" /> Send magic link</button></div>
            </form>
          </article>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="flight-main">
              <div><p className="eyebrow">Signed in</p><h3>{session.user.email ?? 'Supabase user'}</h3></div>
              <span className="status scheduled">{typeof provider === 'string' ? provider : 'auth'}</span>
            </div>
            <dl className="meta-grid">
              <div><dt>Cloud backups</dt><dd>{cloudBackups.length}</dd></div>
              <div><dt>Latest backup</dt><dd>{latestCloudBackup ? formatDateTime(latestCloudBackup.createdAt, displayOptions) : 'None'}</dd></div>
              <div><dt>Reminder</dt><dd>{reminderEnabled ? 'On' : 'Off'}</dd></div>
            </dl>
            <label className="checkbox-row"><input type="checkbox" checked={reminderEnabled} onChange={(event) => void onSetCloudReminder(event.target.checked)} /> Remind me to back up after local changes</label>
            <div className="actions">
              <button type="button" onClick={onNavigateBackup}><Cloud aria-hidden="true" /> Manage cloud backups</button>
              <button type="button" className="secondary" onClick={() => void onSignOut()}><LogOut aria-hidden="true" /> Sign out</button>
              <button type="button" className="ghost danger" disabled={cloudBackups.length === 0} onClick={() => void onDeleteAllCloudBackups()}>Delete all cloud backups</button>
            </div>
          </section>
          {showRestorePrompt && latestCloudBackup && (
            <section className="panel cloud-panel">
              <div className="section-heading compact-heading"><div><p className="eyebrow">New device</p><h3>Restore from cloud backup?</h3></div></div>
              <p className="muted">This browser has no local flights. Latest backup: {latestCloudBackup.label || 'Cloud backup'} from {formatDateTime(latestCloudBackup.createdAt, displayOptions)}.</p>
              <div className="actions">
                <button type="button" onClick={() => void onRestoreLatest()}><Cloud aria-hidden="true" /> Restore latest</button>
                <button type="button" className="secondary" onClick={onNavigateBackup}>Choose another backup</button>
                <button type="button" className="ghost" onClick={() => void onDismissRestorePrompt()}>Start fresh</button>
              </div>
            </section>
          )}
        </>
      )}
      {authMessage && <p className="notice">{authMessage}</p>}
    </main>
  )
}

interface CloudBackupControls {
  configured: boolean
  signedIn: boolean
  userEmail?: string
  backups: CloudBackupSummary[]
  busy: boolean
  message: string
  currentChecksum?: string
  preview?: { snapshot: CloudBackupSnapshot; preview: BackupImportPreview }
  onNavigateAccount: () => void
  onNavigateSync: () => void
  onUpload: (label: string, encryptPassphrase?: string) => Promise<void>
  onRefresh: () => Promise<void>
  onPreview: (id: string) => Promise<void>
  onRestore: (id: string, mode: 'merge' | 'replace') => Promise<void>
  onDownload: (id: string) => Promise<void>
  onDownloadLatest: () => Promise<void>
  onRestoreLatest: () => Promise<void>
  onDelete: (id: string) => Promise<void>
  onDeleteAll: () => Promise<void>
  onKeepLatest: () => Promise<void>
  onClearPreview: () => void
}

function CloudBackupSection({ cloud, appMetadata }: { cloud: CloudBackupControls; appMetadata: AppMetadata[] }) {
  const settings = useAppSettings()
  const displayOptions = flightTimeDisplayOptions(settings)
  const [label, setLabel] = useState('')
  const [encryptEnabled, setEncryptEnabled] = useState(false)
  const [encryptPassphrase, setEncryptPassphrase] = useState('')
  const [encryptConfirm, setEncryptConfirm] = useState('')
  const [encryptError, setEncryptError] = useState('')
  const lastCloudRestoreAt = appMetadataValue(appMetadata, 'lastCloudRestoreAt')
  const lastBackupAt = appMetadataValue(appMetadata, 'lastBackupAt')
  const reminderEnabled = settings.backupReminderEnabled && appMetadataValue(appMetadata, 'cloudBackupReminderEnabled') !== 'false'
  const localChanged = reminderEnabled && hasLocalDataChangedSinceCloudBackup(cloud.currentChecksum, appMetadataValue(appMetadata, 'lastCloudBackupChecksum'))
  const latest = cloud.backups[0]

  async function upload() {
    setEncryptError('')
    const baseLabel = label || `Manual backup - ${new Date().toISOString().slice(0, 10)}`
    if (encryptEnabled) {
      const validationError = validateBackupPassphrase(encryptPassphrase, encryptConfirm)
      if (validationError) {
        setEncryptError(validationError)
        return
      }
      await cloud.onUpload(`${baseLabel} · encrypted`, encryptPassphrase)
      setEncryptPassphrase('')
      setEncryptConfirm('')
    } else {
      await cloud.onUpload(baseLabel)
    }
    setLabel('')
  }

  return (
    <section className="panel cloud-panel">
      <div className="section-heading compact-heading">
        <div><p className="eyebrow">Cloud Backup</p><h3>Supabase snapshots</h3></div>
        <div className="heading-actions">
          <button type="button" className="ghost" onClick={cloud.onNavigateAccount}>Account</button>
          <button type="button" className="ghost" onClick={cloud.onNavigateSync}>Sync Lite</button>
        </div>
      </div>
      {!cloud.configured ? (
        <p className="notice warning">Cloud backup is not configured. Local backups still work.</p>
      ) : !cloud.signedIn ? (
        <div>
          <p className="muted">Sign in to upload plain JSON backup snapshots protected by Supabase Auth and RLS.</p>
          <div className="actions"><button type="button" onClick={cloud.onNavigateAccount}><LogIn aria-hidden="true" /> Sign in</button></div>
        </div>
      ) : (
        <>
          <dl className="meta-grid">
            <div><dt>Signed in</dt><dd>{cloud.userEmail ?? 'Supabase user'}</dd></div>
            <div><dt>Status</dt><dd>{cloud.configured && cloud.signedIn ? 'Enabled' : 'Disabled'}</dd></div>
            <div><dt>Cloud backups</dt><dd>{cloud.backups.length}</dd></div>
            <div><dt>Latest cloud backup</dt><dd>{latest ? formatDateTime(latest.createdAt, displayOptions) : 'Never'}</dd></div>
            <div><dt>Last local export</dt><dd>{lastBackupAt ? formatDateTime(lastBackupAt, displayOptions) : 'Never'}</dd></div>
            <div><dt>Last cloud restore</dt><dd>{lastCloudRestoreAt ? formatDateTime(lastCloudRestoreAt, displayOptions) : 'Never'}</dd></div>
            <div><dt>Backup schema</dt><dd>v4</dd></div>
            <div><dt>Current checksum</dt><dd>{shortChecksum(cloud.currentChecksum)}</dd></div>
            <div><dt>Last cloud checksum</dt><dd>{shortChecksum(appMetadataValue(appMetadata, 'lastCloudBackupChecksum'))}</dd></div>
          </dl>
          {localChanged && <p className="notice warning">Local data has changed since your last cloud backup.</p>}
          <div className="form-grid compact">
            <label>Backup label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={`Manual backup - ${new Date().toISOString().slice(0, 10)}`} /></label>
            <label className="checkbox-row"><input type="checkbox" checked={encryptEnabled} onChange={(event) => setEncryptEnabled(event.target.checked)} /> Encrypt this snapshot end-to-end</label>
            {encryptEnabled && (
              <>
                <label>Passphrase<input type="password" value={encryptPassphrase} onChange={(event) => setEncryptPassphrase(event.target.value)} autoComplete="new-password" /></label>
                <label>Confirm passphrase<input type="password" value={encryptConfirm} onChange={(event) => setEncryptConfirm(event.target.value)} autoComplete="new-password" /></label>
              </>
            )}
          </div>
          {encryptEnabled && <p className="notice warning">The passphrase never leaves this device and cannot be recovered. Losing it makes the encrypted snapshot unreadable, even for you.</p>}
          {encryptError && <p className="notice warning">{encryptError}</p>}
          <div className="actions">
            <button type="button" disabled={cloud.busy} onClick={() => void upload()}><Cloud aria-hidden="true" /> Back up now</button>
            <button type="button" className="secondary" disabled={cloud.busy} onClick={() => void cloud.onRefresh()}><RefreshCw aria-hidden="true" /> Refresh list</button>
            <button type="button" className="secondary" disabled={cloud.busy || !latest} onClick={() => latest && void cloud.onRestoreLatest()}><Cloud aria-hidden="true" /> Restore latest</button>
            <button type="button" className="secondary" disabled={cloud.busy || !latest} onClick={() => latest && void cloud.onDownloadLatest()}><Download aria-hidden="true" /> Download latest</button>
            <button type="button" className="secondary" disabled={cloud.busy || cloud.backups.length <= 10} onClick={() => void cloud.onKeepLatest()}>Keep latest 10</button>
            <button type="button" className="ghost danger" disabled={cloud.busy || cloud.backups.length === 0} onClick={() => void cloud.onDeleteAll()}>Delete all cloud backups</button>
          </div>
          {cloud.message && <p className="notice">{cloud.message}</p>}
          {cloud.preview && (
            <article className="cloud-preview">
              <h3>Cloud backup preview</h3>
              <dl className="meta-grid">
                <div><dt>Label</dt><dd>{cloud.preview.snapshot.label ?? 'Unlabeled backup'}</dd></div>
                <div><dt>Flights to add</dt><dd>{cloud.preview.preview.flightsToAdd}</dd></div>
                <div><dt>Existing flights</dt><dd>{cloud.preview.preview.existingFlights}</dd></div>
                <div><dt>Likely duplicates</dt><dd>{cloud.preview.preview.duplicateFlights}</dd></div>
                <div><dt>Deleted flights</dt><dd>{cloud.preview.preview.deletedFlights}</dd></div>
                <div><dt>Checksum</dt><dd>{shortChecksum(cloud.preview.snapshot.checksum)}</dd></div>
                <div><dt>Created</dt><dd>{formatDateTime(cloud.preview.snapshot.createdAt, displayOptions)}</dd></div>
              </dl>
              {cloud.preview.preview.warnings.map((warning) => <p className="notice warning" key={warning}>{warning}</p>)}
              <div className="actions">
                <button type="button" onClick={() => void cloud.onRestore(cloud.preview!.snapshot.id, 'merge')}>Restore / merge</button>
                <button type="button" className="secondary" onClick={() => void cloud.onRestore(cloud.preview!.snapshot.id, 'replace')}>Restore / replace</button>
                <button type="button" className="ghost" onClick={cloud.onClearPreview}>Close preview</button>
              </div>
            </article>
          )}
          <div className="stack compact-stack">
            {cloud.backups.map((backup) => (
              <article className="flight-card compact-card" key={backup.id}>
                <div className="flight-main">
                  <div><p className="eyebrow">{formatDateTime(backup.createdAt, displayOptions)}</p><h3>{backup.label || 'Cloud backup'}</h3></div>
                  <span className="status scheduled">schema v{backup.schemaVersion}</span>
                </div>
                <dl className="meta-grid">
                  <div><dt>Flights</dt><dd>{backup.flightCount}</dd></div>
                  <div><dt>Trip metadata</dt><dd>{backup.tripMetadataCount}</dd></div>
                  <div><dt>Provider airports</dt><dd>{backup.providerAirportCount}</dd></div>
                  <div><dt>Checksum</dt><dd>{shortChecksum(backup.checksum)}</dd></div>
                  <div><dt>Device</dt><dd>{backup.deviceId ?? 'Not set'}</dd></div>
                  <div><dt>Exported</dt><dd>{backup.exportedAt ? formatDateTime(backup.exportedAt, displayOptions) : 'Not set'}</dd></div>
                </dl>
                <div className="actions">
                  <button type="button" onClick={() => void cloud.onPreview(backup.id)}>Preview</button>
                  <button type="button" className="secondary" onClick={() => void cloud.onRestore(backup.id, 'merge')}>Merge restore</button>
                  <button type="button" className="secondary" onClick={() => void cloud.onRestore(backup.id, 'replace')}>Replace restore</button>
                  <button type="button" className="ghost" onClick={() => void cloud.onDownload(backup.id)}><Download aria-hidden="true" /> Download JSON</button>
                  <button type="button" className="ghost danger" onClick={() => void cloud.onDelete(backup.id)}>Delete</button>
                </div>
              </article>
            ))}
            {cloud.backups.length === 0 && <p className="empty-inline">No cloud backups yet.</p>}
          </div>
        </>
      )}
    </section>
  )
}

function BackupCenterPage({
  flights,
  allFlights,
  trips,
  tripMetadata,
  allTripMetadata,
  providerAirports,
  appMetadata,
  syncMetadata,
  syncStatus,
  syncComparison,
  cloud,
  onImported,
  onExportBackup,
  onExportEncryptedBackup,
  onMergeBackup,
  onReplaceBackup,
  onRepairData,
  onNavigateTrash,
  onCompareSync,
}: {
  flights: FlightLogEntry[]
  allFlights: FlightLogEntry[]
  trips: TripGroup[]
  tripMetadata: TripMetadata[]
  allTripMetadata: TripMetadata[]
  providerAirports: ProviderAirportSnapshot[]
  appMetadata: AppMetadata[]
  syncMetadata: SyncMetadata
  syncStatus: SyncStatusSnapshot
  syncComparison?: SyncComparison
  cloud: CloudBackupControls
  onImported: () => Promise<void>
  onExportBackup: () => Promise<void>
  onExportEncryptedBackup: (passphrase: string, hint?: string) => Promise<void>
  onMergeBackup: (preview: BackupImportPreview) => Promise<void>
  onReplaceBackup: (preview: BackupImportPreview) => Promise<void>
  onRepairData: () => Promise<void>
  onNavigateTrash: () => void
  onCompareSync?: () => Promise<void>
}) {
  const settings = useAppSettings()
  const displayOptions = flightTimeDisplayOptions(settings)
  const [preview, setPreview] = useState<{ valid: FlightLogEntry[]; errors: string[] }>({ valid: [], errors: [] })
  const [backupPreview, setBackupPreview] = useState<BackupImportPreview | undefined>()
  const [backupMessage, setBackupMessage] = useState('')
  const [encryptedImport, setEncryptedImport] = useState<EncryptedBackupEnvelope | undefined>()
  const [importPassphrase, setImportPassphrase] = useState('')
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [exportConfirm, setExportConfirm] = useState('')
  const [exportHint, setExportHint] = useState('')
  const [exportError, setExportError] = useState('')
  const health = analyzeDataHealth(flights, { allFlights, tripMetadata: allTripMetadata, activeTripIds: trips.map((trip) => trip.id), syncComparison })
  const lastBackupAt = appMetadataValue(appMetadata, 'lastBackupAt')
  const lastImportAt = appMetadataValue(appMetadata, 'lastImportAt')
  async function handleFile(file: File) {
    const text = await file.text()
    setPreview(file.name.endsWith('.json') ? parseFlightsJson(text) : parseFlightsCsv(text))
  }
  async function handleBackupFile(file: File) {
    setBackupMessage('')
    setEncryptedImport(undefined)
    setImportPassphrase('')
    try {
      const text = await file.text()
      const envelope = parseEncryptedBackupJson(text)
      if (envelope) {
        setBackupPreview(undefined)
        setEncryptedImport(envelope)
        return
      }
      const backup = parseFullBackupJson(text)
      setBackupPreview(previewBackupImport(backup, flights))
    } catch (error) {
      setBackupPreview(undefined)
      setBackupMessage(error instanceof Error ? error.message : 'Unable to read backup file')
    }
  }
  async function decryptImport() {
    if (!encryptedImport) return
    setBackupMessage('')
    try {
      const decrypted = await decryptBackupEnvelope(encryptedImport, importPassphrase)
      const backup = parseFullBackupJson(decrypted)
      setBackupPreview(previewBackupImport(backup, flights))
      setEncryptedImport(undefined)
      setImportPassphrase('')
      setBackupMessage('Encrypted backup decrypted locally. Review the preview below before applying it.')
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : 'Unable to decrypt backup file')
    }
  }
  async function exportEncrypted() {
    setExportError('')
    const validationError = validateBackupPassphrase(exportPassphrase, exportConfirm)
    if (validationError) {
      setExportError(validationError)
      return
    }
    await onExportEncryptedBackup(exportPassphrase, exportHint)
    setExportPassphrase('')
    setExportConfirm('')
    setExportHint('')
  }
  async function savePreview() {
    await bulkSaveFlights(preview.valid)
    setPreview({ valid: [], errors: [] })
    await onImported()
  }
  async function mergeBackup() {
    if (!backupPreview) return
    await onMergeBackup(backupPreview)
    setBackupMessage(`Imported ${backupPreview.flightsToAdd} new flights and skipped ${backupPreview.duplicateFlights} duplicate flights.`)
    setBackupPreview(undefined)
  }
  async function replaceBackup() {
    if (!backupPreview) return
    await onReplaceBackup(backupPreview)
    setBackupMessage(`Replaced local data with ${backupPreview.backup.flights.length} flights from backup.`)
    setBackupPreview(undefined)
  }
  return (
    <main className="page">
      <div className="section-heading"><div><p className="eyebrow">Data safety</p><h2>Backup Center</h2></div></div>
      <section className="stats-grid">
        <StatCard icon={Plane} label="Flights" value={String(flights.length)} />
        <StatCard icon={Trash2} label="Deleted flights" value={String(health.deletedFlightsCount)} />
        <StatCard icon={Map} label="Trips" value={String(trips.length)} />
        <StatCard icon={Gauge} label="Trip metadata" value={String(tripMetadata.length)} />
        <StatCard icon={Globe2} label="Provider airports" value={String(providerAirports.length)} />
        <StatCard icon={CalendarDays} label="Schema version" value={`v${LOCAL_SCHEMA_VERSION}`} />
        <StatCard icon={Download} label="Last backup" value={lastBackupAt ? formatDateTime(lastBackupAt, displayOptions) : 'Never'} />
        <StatCard icon={Import} label="Last import" value={lastImportAt ? formatDateTime(lastImportAt, displayOptions) : 'Never'} />
        <StatCard icon={Cloud} label="Last sync compare" value={syncMetadata.lastCloudCompareAt ? formatDateTime(syncMetadata.lastCloudCompareAt, displayOptions) : 'Never'} />
        <StatCard icon={AlertTriangle} label="Sync conflicts" value={String(syncComparison?.conflicts.length ?? 0)} />
      </section>
      <DataOwnershipCard />
      <SyncStatusBadge status={syncStatus} onCompare={onCompareSync} />
      <CloudBackupSection cloud={cloud} appMetadata={appMetadata} />
      <section className="two-columns">
        <article className="panel">
          <h3>Full backup</h3>
          <p className="muted">Exports flights, trip metadata, provider airports, app metadata, schema version, and export time.</p>
          <div className="actions"><button type="button" onClick={() => void onExportBackup()}><Download aria-hidden="true" /> Export full backup</button></div>
        </article>
        <article className="panel">
          <h3>Restore backup</h3>
          <p className="muted">Preview a full backup before merging or replacing local data. Plain and encrypted backup files are both accepted.</p>
          <label className="file-drop"><Upload aria-hidden="true" /><span>Choose backup JSON</span><input type="file" accept=".json,application/json" onChange={(event) => event.target.files?.[0] && void handleBackupFile(event.target.files[0])} /></label>
        </article>
      </section>
      <section className="panel">
        <div className="section-heading compact-heading"><div><p className="eyebrow">End-to-end encryption</p><h3>Encrypted backup export</h3></div><Shield aria-hidden="true" /></div>
        <p className="muted">Encrypts the full backup on this device with AES-GCM before it is written, using a key derived from your passphrase (PBKDF2, 600k iterations). The passphrase is never stored and cannot be recovered.</p>
        <div className="form-grid compact">
          <label>Passphrase<input type="password" value={exportPassphrase} onChange={(event) => setExportPassphrase(event.target.value)} autoComplete="new-password" /></label>
          <label>Confirm passphrase<input type="password" value={exportConfirm} onChange={(event) => setExportConfirm(event.target.value)} autoComplete="new-password" /></label>
          <label>Optional hint (stored unencrypted)<input value={exportHint} onChange={(event) => setExportHint(event.target.value)} placeholder="e.g. the usual travel one" /></label>
        </div>
        {exportError && <p className="notice warning">{exportError}</p>}
        <div className="actions"><button type="button" onClick={() => void exportEncrypted()}><Shield aria-hidden="true" /> Export encrypted backup</button></div>
      </section>
      {encryptedImport && (
        <section className="panel">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Encrypted backup</p><h3>Passphrase needed</h3></div><Shield aria-hidden="true" /></div>
          <p className="muted">This file is an end-to-end encrypted FlightLog backup{encryptedImport.createdAt ? ` from ${formatDateTime(encryptedImport.createdAt, displayOptions)}` : ''}. It will be decrypted locally in your browser.</p>
          {encryptedImport.hint && <p className="notice">Passphrase hint: {encryptedImport.hint}</p>}
          <div className="form-grid compact">
            <label>Passphrase<input type="password" value={importPassphrase} onChange={(event) => setImportPassphrase(event.target.value)} autoComplete="current-password" /></label>
          </div>
          <div className="actions">
            <button type="button" disabled={!importPassphrase} onClick={() => void decryptImport()}>Decrypt backup</button>
            <button type="button" className="ghost" onClick={() => { setEncryptedImport(undefined); setImportPassphrase('') }}>Cancel</button>
          </div>
        </section>
      )}
      {backupMessage && <p className="notice">{backupMessage}</p>}
      {backupPreview && (
        <section className="panel">
          <h3>Backup import preview</h3>
          <dl className="meta-grid">
            <div><dt>Flights to add</dt><dd>{backupPreview.flightsToAdd}</dd></div>
            <div><dt>Existing flights</dt><dd>{backupPreview.existingFlights}</dd></div>
            <div><dt>Likely duplicates</dt><dd>{backupPreview.duplicateFlights}</dd></div>
            <div><dt>Deleted flights</dt><dd>{backupPreview.deletedFlights}</dd></div>
            <div><dt>Trip metadata</dt><dd>{backupPreview.tripMetadata}</dd></div>
            <div><dt>Provider airports</dt><dd>{backupPreview.providerAirports}</dd></div>
            <div><dt>Exported</dt><dd>{formatDateTime(backupPreview.backup.exportedAt, displayOptions)}</dd></div>
          </dl>
          {backupPreview.warnings.map((warning) => <p className="notice warning" key={warning}>{warning}</p>)}
          <div className="actions"><button type="button" onClick={() => void mergeBackup()}>Merge new records</button><button type="button" className="secondary" onClick={() => void replaceBackup()}>Replace all local data</button><button type="button" className="ghost" onClick={() => setBackupPreview(undefined)}>Cancel</button></div>
        </section>
      )}
      <section className="panel">
        <h3>Data Health</h3>
        <dl className="meta-grid">
          <div><dt>Missing timezone</dt><dd>{health.missingTimezoneCount}</dd></div>
          <div><dt>Missing coordinates</dt><dd>{health.missingAirportCoordinateCount}</dd></div>
          <div><dt>Provider warnings</dt><dd>{health.providerWarningCount}</dd></div>
          <div><dt>Missing times</dt><dd>{health.missingTimeCount}</dd></div>
          <div><dt>Safe repairs</dt><dd>{health.repairableAirportSnapshotCount}</dd></div>
          <div><dt>Active flights</dt><dd>{health.activeFlightsCount}</dd></div>
          <div><dt>Deleted flights</dt><dd>{health.deletedFlightsCount}</dd></div>
          <div><dt>Orphaned trip metadata</dt><dd>{health.orphanedTripMetadataCount}</dd></div>
          <div><dt>Missing sync metadata</dt><dd>{health.missingSyncMetadataCount}</dd></div>
          <div><dt>Remote tombstones</dt><dd>{health.remoteTombstonesCount}</dd></div>
        </dl>
        <div className="actions"><button type="button" className="secondary" disabled={health.repairableAirportSnapshotCount === 0} onClick={() => void onRepairData()}>Re-resolve airport snapshots</button><button type="button" className="secondary" onClick={onNavigateTrash}><Trash2 aria-hidden="true" /> Open Trash</button></div>
      </section>
      <section className="two-columns">
        <article className="panel"><h3>Legacy export</h3><p className="muted">Keep old JSON and CSV exports available for portability.</p><div className="actions"><button type="button" onClick={() => downloadFile('flightlog.json', JSON.stringify({ flights }, null, 2), 'application/json')}><Download aria-hidden="true" /> Export JSON</button><button type="button" className="secondary" onClick={() => downloadFile('flightlog.csv', flightsToCsv(flights), 'text/csv')}><Download aria-hidden="true" /> Export CSV</button></div></article>
        <article className="panel"><h3>Legacy import</h3><p className="muted">CSV core columns: {csvColumns.join(', ')}</p><label className="file-drop"><Upload aria-hidden="true" /><span>Choose CSV or JSON</span><input type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => event.target.files?.[0] && void handleFile(event.target.files[0])} /></label></article>
      </section>
      {(preview.errors.length > 0 || preview.valid.length > 0) && <section className="panel"><h3>Import preview</h3><p>{preview.valid.length} valid flights - {preview.errors.length} errors</p>{preview.errors.length > 0 && <ul className="errors">{preview.errors.map((error) => <li key={error}>{error}</li>)}</ul>}<button type="button" disabled={preview.valid.length === 0 || preview.errors.length > 0} onClick={savePreview}><Import aria-hidden="true" /> Save imported flights</button></section>}
      <section className="panel"><h3>Samples</h3><p><a href={`${import.meta.env.BASE_URL}samples/sample_flights.csv`}>Download sample CSV</a> - <a href={`${import.meta.env.BASE_URL}samples/sample_flights.json`}>Download sample JSON</a></p></section>
    </main>
  )
}

function TrashPage({
  flights,
  tripMetadata,
  busy,
  signedIn,
  onRestore,
  onPermanentDelete,
  onRestoreSelected,
  onPermanentDeleteSelected,
  onEmptyTrash,
  onExport,
  onCreateSafetyBackup,
  onNavigateSettings,
}: {
  flights: FlightLogEntry[]
  tripMetadata: TripMetadata[]
  busy: boolean
  signedIn: boolean
  onRestore: (id: string) => Promise<void>
  onPermanentDelete: (id: string) => Promise<void>
  onRestoreSelected: (ids: string[]) => Promise<void>
  onPermanentDeleteSelected: (ids: string[]) => Promise<void>
  onEmptyTrash: () => Promise<void>
  onExport: (flight: FlightLogEntry) => void
  onCreateSafetyBackup: () => Promise<void>
  onNavigateSettings: () => void
}) {
  const settings = useAppSettings()
  const displayOptions = flightTimeDisplayOptions(settings)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const selectedIds = [...selected]

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function restoreSelected() {
    await onRestoreSelected(selectedIds)
    setSelected(new Set())
  }

  async function deleteSelected() {
    await onPermanentDeleteSelected(selectedIds)
    setSelected(new Set())
  }

  return (
    <main className="page trash-page">
      <div className="section-heading">
        <div><p className="eyebrow">Recently Deleted</p><h2>Trash</h2></div>
        <div className="heading-actions">
          <button type="button" className="ghost" onClick={onNavigateSettings}>Settings</button>
          {signedIn && <button type="button" className="secondary" disabled={busy} onClick={() => void onCreateSafetyBackup()}><Shield aria-hidden="true" /> Create backup</button>}
        </div>
      </div>
      <section className="panel">
        <p className="muted">Deleted flights stay here until you restore or permanently delete them. Deleted flights will remain in Trash and sync as tombstones. Permanent deletion is not automatic.</p>
        <dl className="meta-grid">
          <div><dt>Deleted flights</dt><dd>{flights.length}</dd></div>
          <div><dt>Deleted trip metadata</dt><dd>{tripMetadata.length}</dd></div>
          <div><dt>Selected</dt><dd>{selected.size}</dd></div>
        </dl>
        <div className="actions">
          <button type="button" className="secondary" disabled={busy || selected.size === 0} onClick={() => void restoreSelected()}><RotateCcw aria-hidden="true" /> Restore selected</button>
          <button type="button" className="ghost danger" disabled={busy || selected.size === 0} onClick={() => void deleteSelected()}><Trash2 aria-hidden="true" /> Permanently delete selected</button>
          <button type="button" className="ghost danger" disabled={busy || flights.length === 0} onClick={() => void onEmptyTrash()}>Empty trash</button>
        </div>
      </section>
      <div className="stack">
        {flights.map((flight) => (
          <article className="flight-card trash-card" key={flight.id}>
            <div className="flight-main">
              <label className="checkbox-row">
                <input type="checkbox" checked={selected.has(flight.id)} onChange={() => toggle(flight.id)} />
                <span><span className="eyebrow">{flight.date}</span><strong>{flight.flightNumber} - {flight.airline}</strong></span>
              </label>
              <span className="status cancelled">deleted</span>
            </div>
            <div className="route-line"><strong>{flight.origin}</strong><span>{flight.originAirportSnapshot?.name}</span><ArrowRight aria-hidden="true" /><strong>{flight.destination}</strong><span>{flight.destinationAirportSnapshot?.name}</span></div>
            <dl className="meta-grid">
              <div><dt>Original departure</dt><dd>{formatDate(flight.date, settings.dateFormat)}</dd></div>
              <div><dt>Deleted</dt><dd>{flight.deletedAt ? formatDateTime(flight.deletedAt, displayOptions) : 'Unknown'}</dd></div>
              <div><dt>Reason</dt><dd>{flight.deleteReason ?? 'Deleted from FlightLog'}</dd></div>
              <div><dt>Cloud behavior</dt><dd>This deletion will sync as a tombstone.</dd></div>
            </dl>
            <div className="actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => void onRestore(flight.id)}><RotateCcw aria-hidden="true" /> Restore</button>
              <button type="button" className="ghost" onClick={() => onExport(flight)}><Download aria-hidden="true" /> Export JSON</button>
              <button type="button" className="ghost danger" disabled={busy} onClick={() => void onPermanentDelete(flight.id)}><Trash2 aria-hidden="true" /> Permanently delete</button>
            </div>
          </article>
        ))}
        {flights.length === 0 && <section className="empty-state"><Trash2 aria-hidden="true" /><h2>Trash is empty</h2><p>No deleted flights are waiting for restore or permanent delete.</p></section>}
      </div>
    </main>
  )
}

function SyncPage({
  configured,
  session,
  cloudBackups,
  syncMetadata,
  status,
  comparison,
  syncEvents,
  syncDevices,
  deviceName,
  busy,
  message,
  onCompare,
  onCreateSafetyBackup,
  onPushLocal,
  onPullRemote,
  onPushTombstones,
  onPullTombstones,
  onSyncSafe,
  onResolveConflict,
  onResolveAll,
  onMergeFields,
  onRenameDevice,
  onNavigateSettings,
  onNavigateBackup,
}: {
  configured: boolean
  session: Session | null
  cloudBackups: CloudBackupSummary[]
  syncMetadata: SyncMetadata
  status: SyncStatusSnapshot
  comparison?: SyncComparison
  syncEvents: SyncEventLog[]
  syncDevices: SyncDevice[]
  deviceName: string
  busy: boolean
  message: string
  onCompare: () => Promise<void>
  onCreateSafetyBackup: () => Promise<void>
  onPushLocal: () => Promise<void>
  onPullRemote: () => Promise<void>
  onPushTombstones: () => Promise<void>
  onPullTombstones: () => Promise<void>
  onSyncSafe: () => Promise<void>
  onResolveConflict: (item: SyncComparisonItem, action: SyncConflictAction) => Promise<void>
  onResolveAll: (action: SyncConflictAction) => Promise<void>
  onMergeFields: (item: SyncComparisonItem, choices: Record<string, MergeSide>) => Promise<void>
  onRenameDevice: (name: string) => Promise<void>
  onNavigateSettings: () => void
  onNavigateBackup: () => void
}) {
  const settings = useAppSettings()
  const displayOptions = flightTimeDisplayOptions(settings)
  const [deviceDraft, setDeviceDraft] = useState(deviceName)
  const [nowMs] = useState(() => Date.now())
  const [mergeOpen, setMergeOpen] = useState<Record<string, boolean>>({})
  const [mergeChoices, setMergeChoices] = useState<Record<string, Record<string, MergeSide>>>({})

  function setMergeChoice(itemKey: string, field: string, side: MergeSide) {
    setMergeChoices((choices) => ({ ...choices, [itemKey]: { ...choices[itemKey], [field]: side } }))
  }
  const latestBackup = cloudBackups[0]
  const recentBackup = latestBackup && nowMs - Date.parse(latestBackup.createdAt) < 24 * 60 * 60 * 1000
  const localCount = comparison?.local.records.length ?? 0
  const remoteCount = comparison?.remote.records.length ?? 0
  const tombstonesToPush = comparison?.tombstonesToPush.length ?? 0
  const tombstonesToPull = comparison?.tombstonesToPull.length ?? 0
  const safeChangeCount = (comparison?.localOnly.length ?? 0) + (comparison?.remoteOnly.length ?? 0) + tombstonesToPush + tombstonesToPull

  async function renameDevice(event: FormEvent) {
    event.preventDefault()
    await onRenameDevice(deviceDraft)
  }

  return (
    <main className="page sync-page">
      <div className="section-heading">
        <div><p className="eyebrow">Cloud Sync Lite</p><h2>Manual local/cloud compare</h2></div>
        <div className="heading-actions"><button type="button" className="ghost" onClick={onNavigateSettings}>Settings</button><button type="button" className="ghost" onClick={onNavigateBackup}>Backup Center</button></div>
      </div>
      <SyncStatusBadge status={status} onCompare={configured && session ? onCompare : undefined} />
      <section className="panel">
        <div className="flight-main"><div><p className="eyebrow">Status</p><h3>{session ? 'Signed in, manual sync available' : configured ? 'Sign in to sync' : 'Supabase not configured'}</h3></div><Cloud aria-hidden="true" /></div>
        {!configured && <p className="notice warning">Cloud Sync Lite is disabled until Supabase variables are configured and migrations 002 and 003 are run.</p>}
        {configured && !session && <p className="notice warning">Sign in from Settings to compare, push, or pull cloud sync records.</p>}
        <dl className="meta-grid">
          <div><dt>Last compared</dt><dd>{syncMetadata.lastCloudCompareAt ? formatDateTime(syncMetadata.lastCloudCompareAt, displayOptions) : 'Never'}</dd></div>
          <div><dt>Last push</dt><dd>{syncMetadata.lastCloudPushAt ? formatDateTime(syncMetadata.lastCloudPushAt, displayOptions) : 'Never'}</dd></div>
          <div><dt>Last pull</dt><dd>{syncMetadata.lastCloudPullAt ? formatDateTime(syncMetadata.lastCloudPullAt, displayOptions) : 'Never'}</dd></div>
          <div><dt>Last tombstone push</dt><dd>{syncMetadata.lastTombstonePushAt ? formatDateTime(syncMetadata.lastTombstonePushAt, displayOptions) : 'Never'}</dd></div>
          <div><dt>Last tombstone pull</dt><dd>{syncMetadata.lastTombstonePullAt ? formatDateTime(syncMetadata.lastTombstonePullAt, displayOptions) : 'Never'}</dd></div>
          <div><dt>Local records</dt><dd>{comparison ? localCount : 'Not compared'}</dd></div>
          <div><dt>Remote records</dt><dd>{comparison ? remoteCount : 'Not compared'}</dd></div>
          <div><dt>Conflicts</dt><dd>{comparison?.conflicts.length ?? 'Not compared'}</dd></div>
        </dl>
        <p className={recentBackup ? 'notice' : 'notice warning'}>{recentBackup ? `Safety backup available: ${latestBackup.label || 'Cloud backup'} from ${formatDateTime(latestBackup.createdAt, displayOptions)}.` : 'Create a cloud backup snapshot before push, pull, or tombstone sync if this data matters.'}</p>
        <div className="actions">
          <button type="button" disabled={busy || !configured || !session} onClick={() => void onCompare()}><Search aria-hidden="true" /> Compare local and cloud</button>
          <button type="button" className="secondary" disabled={busy || !configured || !session} onClick={() => void onCreateSafetyBackup()}><Shield aria-hidden="true" /> Create safety backup</button>
          <button type="button" className="secondary" disabled={busy || !comparison || safeChangeCount === 0} onClick={() => void onSyncSafe()}>Sync safe changes</button>
          <button type="button" className="secondary" disabled={busy || !comparison || comparison.localOnly.length === 0} onClick={() => void onPushLocal()}><Upload aria-hidden="true" /> Push local changes</button>
          <button type="button" className="secondary" disabled={busy || !comparison || comparison.remoteOnly.length === 0} onClick={() => void onPullRemote()}><Download aria-hidden="true" /> Pull cloud changes</button>
          <button type="button" className="secondary" disabled={busy || !comparison || tombstonesToPush === 0} onClick={() => void onPushTombstones()}><Trash2 aria-hidden="true" /> Push tombstones</button>
          <button type="button" className="secondary" disabled={busy || !comparison || tombstonesToPull === 0} onClick={() => void onPullTombstones()}><Download aria-hidden="true" /> Pull tombstones</button>
        </div>
        {message && <p className="notice">{message}</p>}
        <p className="muted">Deleted flights will remain in Trash and sync as tombstones. Permanent deletion is not automatic. No records will be overwritten without confirmation.</p>
      </section>

      <section className="stats-grid">
        <StatCard icon={Database} label="Local records" value={String(localCount)} />
        <StatCard icon={Cloud} label="Cloud records" value={String(remoteCount)} />
        <StatCard icon={Upload} label="To push" value={String(comparison?.localOnly.length ?? 0)} />
        <StatCard icon={Download} label="To pull" value={String(comparison?.remoteOnly.length ?? 0)} />
        <StatCard icon={Trash2} label="Tombstones" value={String(tombstonesToPush + tombstonesToPull)} />
        <StatCard icon={CheckCircle2} label="In sync" value={String(comparison?.same.length ?? 0)} />
        <StatCard icon={AlertTriangle} label="Conflicts" value={String(comparison?.conflicts.length ?? 0)} />
      </section>

      {!comparison && <section className="empty-state"><Cloud aria-hidden="true" /><h2>No comparison yet</h2><p>Run Compare to preview local-only records, cloud-only records, tombstones, and conflicts before applying any sync action.</p></section>}
      {comparison && comparison.items.length === 0 && <section className="empty-state"><CheckCircle2 aria-hidden="true" /><h2>No sync records yet</h2><p>Push local changes to create record-level cloud sync data, or keep using cloud backup snapshots.</p></section>}
      {comparison && comparison.items.length > 0 && safeChangeCount === 0 && comparison.conflicts.length === 0 && <p className="notice">Local and cloud sync records are already in sync.</p>}

      {comparison && (comparison.localOnly.length > 0 || comparison.remoteOnly.length > 0 || tombstonesToPush > 0 || tombstonesToPull > 0 || comparison.deletedSame.length > 0) && (
        <section className="sync-preview-grid">
          <article className="panel">
            <p className="eyebrow">Ready to push</p>
            <h3>Local records</h3>
            <p className="muted">{comparison.localOnly.length} local-only record{comparison.localOnly.length === 1 ? '' : 's'} will be uploaded. Conflicts are excluded.</p>
            <ul>{comparison.localOnly.slice(0, 12).map((item) => <li key={item.key}>{item.entityType}: {syncRecordLabel(item)}</li>)}</ul>
            {comparison.localOnly.length === 0 && <p className="empty-inline">No active local-only records.</p>}
          </article>
          <article className="panel">
            <p className="eyebrow">Ready to pull</p>
            <h3>Cloud records</h3>
            <p className="muted">{comparison.remoteOnly.length} cloud-only record{comparison.remoteOnly.length === 1 ? '' : 's'} will be added locally. Existing local records are not overwritten.</p>
            <ul>{comparison.remoteOnly.slice(0, 12).map((item) => <li key={item.key}>{item.entityType}: {syncRecordLabel(item)}</li>)}</ul>
            {comparison.remoteOnly.length === 0 && <p className="empty-inline">No active cloud-only records.</p>}
          </article>
          <article className="panel">
            <p className="eyebrow">Deletions / Trash</p>
            <h3>Tombstones</h3>
            <p className="muted">{tombstonesToPush} local tombstone{tombstonesToPush === 1 ? '' : 's'} to push, {tombstonesToPull} cloud tombstone{tombstonesToPull === 1 ? '' : 's'} to pull.</p>
            <ul>{[...comparison.tombstonesToPush, ...comparison.tombstonesToPull].slice(0, 12).map((item) => <li key={item.key}>{item.status}: {syncRecordLabel(item)}</li>)}</ul>
            {tombstonesToPush + tombstonesToPull === 0 && <p className="empty-inline">No deletion tombstones pending.</p>}
          </article>
          <article className="panel">
            <p className="eyebrow">In sync</p>
            <h3>Matched records</h3>
            <p className="muted">{comparison.same.length} matched record{comparison.same.length === 1 ? '' : 's'}, including {comparison.deletedSame.length} deleted tombstone match{comparison.deletedSame.length === 1 ? '' : 'es'}.</p>
          </article>
        </section>
      )}

      {comparison && comparison.conflicts.length > 0 && (
        <section className="panel conflict-panel">
          <div className="section-heading compact-heading">
            <div><p className="eyebrow">Conflicts</p><h3>Choose one side per record</h3></div>
            <div className="heading-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => void onResolveAll('keep-local')}>Keep all local</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => void onResolveAll('use-cloud')}>Use all cloud</button>
              <button type="button" className="secondary" disabled={busy || comparison.deleteConflicts.length === 0} onClick={() => void onResolveAll('keep-deleted')}>Keep all deletions</button>
              <button type="button" className="ghost" disabled={busy} onClick={() => void onResolveAll('skip')}>Skip all</button>
            </div>
          </div>
          <div className="stack compact-stack">
            {comparison.conflicts.map((item) => {
              const mergeDiffs = item.entityType === 'flight' && item.local?.record && item.remote?.record && !item.local.deletedAt && !item.remote.deletedAt
                ? mergeableFlightFieldDiffs(item.local.record as Partial<FlightLogEntry>, item.remote.record as Partial<FlightLogEntry>)
                : []
              return (
              <article className="flight-card compact-card" key={item.key}>
                <div className="flight-main">
                  <div><p className="eyebrow">{item.entityType}</p><h3>{syncRecordLabel(item)}</h3></div>
                  <span className="status diverted">{item.status === 'delete-conflict' ? 'delete conflict' : 'conflict'}</span>
                </div>
                <dl className="meta-grid">
                  <div><dt>Local updated</dt><dd>{item.local?.recordUpdatedAt ? formatDateTime(item.local.recordUpdatedAt, displayOptions) : 'Unknown'}</dd></div>
                  <div><dt>Cloud updated</dt><dd>{item.remote?.recordUpdatedAt ? formatDateTime(item.remote.recordUpdatedAt, displayOptions) : 'Unknown'}</dd></div>
                  <div><dt>Local deleted</dt><dd>{item.local?.deletedAt ? formatDateTime(item.local.deletedAt, displayOptions) : 'No'}</dd></div>
                  <div><dt>Cloud deleted</dt><dd>{item.remote?.deletedAt ? formatDateTime(item.remote.deletedAt, displayOptions) : 'No'}</dd></div>
                  <div><dt>Newer</dt><dd>{item.newerSide ?? 'unknown'}</dd></div>
                  <div><dt>ID</dt><dd>{item.localId}</dd></div>
                </dl>
                {item.entityType === 'flight' && (
                  <div className="conflict-diff-grid">
                    {diffFlightFields(item.local?.record as Partial<FlightLogEntry> | undefined, item.remote?.record as Partial<FlightLogEntry> | undefined).map((diff) => (
                      <div className={diff.changed ? 'changed' : ''} key={diff.field}>
                        <dt>{diff.label}</dt>
                        <dd><strong>Local:</strong> {diff.localValue}</dd>
                        <dd><strong>Cloud:</strong> {diff.cloudValue}</dd>
                      </div>
                    ))}
                  </div>
                )}
                {mergeOpen[item.key] && mergeDiffs.length > 0 && (
                  <div className="merge-editor">
                    <p className="muted">Choose which side to keep for each differing field. Fields not listed keep the local value. The merged record is saved locally and pushed to the cloud.</p>
                    <div className="merge-field-grid">
                      {mergeDiffs.map((diff) => {
                        const side = mergeChoices[item.key]?.[diff.field] ?? 'local'
                        return (
                          <div className="merge-field" key={diff.field}>
                            <span className="merge-field-label">{diff.label}</span>
                            <label className="checkbox-row"><input type="radio" name={`merge-${item.key}-${diff.field}`} checked={side === 'local'} onChange={() => setMergeChoice(item.key, diff.field, 'local')} /> Local: {diff.localValue}</label>
                            <label className="checkbox-row"><input type="radio" name={`merge-${item.key}-${diff.field}`} checked={side === 'cloud'} onChange={() => setMergeChoice(item.key, diff.field, 'cloud')} /> Cloud: {diff.cloudValue}</label>
                          </div>
                        )
                      })}
                    </div>
                    <div className="actions">
                      <button type="button" disabled={busy} onClick={() => void onMergeFields(item, mergeChoices[item.key] ?? {})}>Apply merge and push</button>
                      <button type="button" className="ghost" onClick={() => setMergeOpen((open) => ({ ...open, [item.key]: false }))}>Close merge editor</button>
                    </div>
                  </div>
                )}
                <div className="actions">
                  {mergeDiffs.length > 0 && <button type="button" disabled={busy} onClick={() => setMergeOpen((open) => ({ ...open, [item.key]: !open[item.key] }))}><SlidersHorizontal aria-hidden="true" /> {mergeOpen[item.key] ? 'Hide merge editor' : 'Merge fields'}</button>}
                  <button type="button" className="secondary" disabled={busy} onClick={() => void onResolveConflict(item, 'keep-local')}>Keep local</button>
                  <button type="button" className="secondary" disabled={busy} onClick={() => void onResolveConflict(item, 'use-cloud')}>Use cloud</button>
                  <button type="button" className="secondary" disabled={busy || (!item.local?.deletedAt && !item.remote?.deletedAt)} onClick={() => void onResolveConflict(item, 'keep-deleted')}>Keep deleted</button>
                  <button type="button" className="secondary" disabled={busy || !item.local || Boolean(item.local.deletedAt)} onClick={() => void onResolveConflict(item, 'restore-local')}>Restore local active</button>
                  <button type="button" className="secondary" disabled={busy || !item.remote || Boolean(item.remote.deletedAt)} onClick={() => void onResolveConflict(item, 'restore-cloud')}>Restore cloud active</button>
                  <button type="button" className="ghost" disabled={busy} onClick={() => void onResolveConflict(item, 'skip')}>Skip</button>
                </div>
              </article>
              )
            })}
          </div>
        </section>
      )}

      <section className="two-columns">
        <article className="panel">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Sync history</p><h3>Recent events</h3></div></div>
          <div className="stack compact-stack">
            {syncEvents.slice(0, 8).map((event) => (
              <details className="sync-event" key={event.id}>
                <summary>{event.eventType} - {formatDateTime(event.createdAt, displayOptions)}</summary>
                <p className="muted">{syncHistorySummaryLabel(event)}</p>
                {event.summary && <pre className="diagnostics-output">{JSON.stringify(event.summary, null, 2)}</pre>}
              </details>
            ))}
            {syncEvents.length === 0 && <p className="empty-inline">No sync history yet.</p>}
          </div>
        </article>
        <article className="panel">
          <div className="section-heading compact-heading"><div><p className="eyebrow">Devices</p><h3>Manual sync devices</h3></div></div>
          <form onSubmit={renameDevice} className="form-grid compact">
            <label>Current device name<input value={deviceDraft} onChange={(event) => setDeviceDraft(event.target.value)} /></label>
            <div className="actions"><button type="submit" className="secondary" disabled={busy}>Rename current device</button></div>
          </form>
          <div className="stack compact-stack">
            {syncDevices.map((device) => (
              <article className="compact-device" key={device.deviceId}>
                <strong>{device.deviceName ?? device.deviceId}</strong>
                <span>{device.isCurrent ? 'Current device' : 'Other device'}</span>
                <span>{device.lastSeenAt ? `Last seen ${formatDateTime(device.lastSeenAt, displayOptions)}` : 'Last seen unknown'}</span>
              </article>
            ))}
            {syncDevices.length === 0 && <p className="empty-inline">Device list appears after migration 003 is installed and Compare runs.</p>}
          </div>
        </article>
      </section>
    </main>
  )
}

function MobileMoreMenu({
  open,
  route,
  onNavigate,
  onClose,
}: {
  open: boolean
  route: AppRoute
  onNavigate: (page: Page) => void
  onClose: () => void
}) {
  if (!open) return null
  return (
    <div className="mobile-more-sheet" role="dialog" aria-label="More navigation">
      <div className="mobile-more-header">
        <strong>More</strong>
        <button type="button" className="ghost icon-button" onClick={onClose} aria-label="Close more navigation"><X aria-hidden="true" /></button>
      </div>
      <div className="mobile-more-grid">
        {moreNavItems.map((item) => (
          <button key={item.page} type="button" className={navPage(route) === item.page ? 'active' : ''} onClick={() => onNavigate(item.page)}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function App() {
  const [route, setRoute] = useState<AppRoute>(routeFromHash)
  const [flights, setFlights] = useState<FlightLogEntry[]>([])
  const [allFlights, setAllFlights] = useState<FlightLogEntry[]>([])
  const [editing, setEditing] = useState<FlightLogEntry | undefined>()
  const [showForm, setShowForm] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [initialDataLoading, setInitialDataLoading] = useState(true)
  const [airportVersion, setAirportVersion] = useState(0)
  const [airportDatasetLabel, setAirportDatasetLabel] = useState(`${airportCount()} airport fallback loaded`)
  const [providerAirportState, setProviderAirportState] = useState<ProviderAirportSnapshot[]>([])
  const [tripMetadata, setTripMetadataState] = useState<TripMetadata[]>([])
  const [allTripMetadata, setAllTripMetadataState] = useState<TripMetadata[]>([])
  const [appMetadata, setAppMetadataState] = useState<AppMetadata[]>([])
  const [authSession, setAuthSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [authMessage, setAuthMessage] = useState('')
  const [cloudBackups, setCloudBackups] = useState<CloudBackupSummary[]>([])
  const [cloudBusy, setCloudBusy] = useState(false)
  const [cloudMessage, setCloudMessage] = useState('')
  const [cloudPreview, setCloudPreview] = useState<{ snapshot: CloudBackupSnapshot; preview: BackupImportPreview } | undefined>()
  const [currentBackupChecksum, setCurrentBackupChecksum] = useState<string | undefined>()
  const [syncComparison, setSyncComparison] = useState<SyncComparison | undefined>()
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [syncConflictActions, setSyncConflictActions] = useState<Record<string, SyncConflictAction>>({})
  const [syncEvents, setSyncEvents] = useState<SyncEventLog[]>([])
  const [syncDevices, setSyncDevices] = useState<SyncDevice[]>([])
  const [deviceName, setDeviceNameState] = useState(() => getDeviceName())
  const [liveApiStatus, setLiveApiStatus] = useState<{ status: 'unchecked' | 'checking' | 'reachable' | 'error'; checkedAt?: string; message?: string }>(() => ({ status: 'unchecked' }))
  const isOnline = useOnlineStatus()
  const isStandalone = useStandaloneMode()
  const installPrompt = usePwaInstallPrompt()
  const deviceId = useMemo(() => localDeviceId(), [])
  const deletedFlightList = useMemo(() => sortDeletedFlights(allFlights), [allFlights])
  const deletedTripMetadataList = useMemo(() => deletedTripMetadata(allTripMetadata), [allTripMetadata])
  const trips = useMemo(() => groupFlightsIntoTrips(flights, tripMetadata), [flights, tripMetadata])
  const settings = useMemo(() => appSettingsFromMetadata(appMetadata), [appMetadata])
  const syncMetadata = useMemo(() => syncMetadataFromMetadata(appMetadata, deviceId), [appMetadata, deviceId])
  const syncStatus = useMemo(() => syncStatusSnapshot({ configured: isSupabaseConfigured, signedIn: Boolean(authSession), syncMetadata, comparison: syncComparison, error: syncMessage.toLowerCase().includes('unable') ? syncMessage : undefined }), [authSession, syncComparison, syncMessage, syncMetadata])
  const currentFlight = route.flightId ? flights.find((flight) => flight.id === route.flightId) : undefined
  const currentTrip = route.tripId ? trips.find((trip) => trip.id === route.tripId) : undefined
  const authUserId = authSession?.user.id
  const latestCloudBackup = cloudBackups[0]
  const showCloudRestorePrompt = shouldShowFirstRunCloudRestorePrompt({
    localFlightCount: flights.length,
    signedIn: Boolean(authSession),
    cloudBackupCount: cloudBackups.length,
    dismissedAt: appMetadataValue(appMetadata, 'cloudRestorePromptDismissedAt'),
  })

  async function loadFlights() {
    const [active, all] = await Promise.all([getFlights(), getAllFlights()])
    setFlights(active)
    setAllFlights(all)
  }

  async function loadTripMetadata() {
    const [active, all] = await Promise.all([getTripMetadata(), getAllTripMetadata()])
    setTripMetadataState(active)
    setAllTripMetadataState(all)
  }

  async function loadAppMetadata() {
    const loaded = await getAllAppMetadata()
    const migrated = migrateAppMetadataDefaults(loaded, deviceId)
    if (migrated.changed) await bulkSetAppMetadata(migrated.metadata)
    setAppMetadataState(migrated.metadata)
  }

  async function refreshProviderAirports() {
    const airports = await getProviderAirports()
    setProviderAirports(airports)
    setProviderAirportState(airports)
    setAirportVersion((version) => version + 1)
  }

  async function reloadLocalData() {
    await Promise.all([loadFlights(), refreshProviderAirports(), loadTripMetadata(), loadAppMetadata(), loadSyncEvents()])
  }

  async function buildCurrentFullBackup(exportedAt = new Date().toISOString()) {
    return createFullBackup({
      flights: await getAllFlights(),
      tripMetadata: await getAllTripMetadata(),
      providerAirports: await getProviderAirports(),
      appMetadata: await getAllAppMetadata(),
      exportedAt,
    })
  }

  async function loadSyncEvents() {
    setSyncEvents(await listLocalSyncEvents(20))
  }

  async function loadCloudBackups(session: Session | null = authSession) {
    if (!supabase || !session) {
      setCloudBackups([])
      return
    }
    setCloudBusy(true)
    try {
      setCloudBackups(await listCloudBackups(supabase))
      setCloudMessage('')
    } catch (error) {
      setCloudMessage(cloudBackupErrorMessage(error, 'Unable to load cloud backups.'))
    } finally {
      setCloudBusy(false)
    }
  }

  async function cacheProviderAirports(liveStatus: FlightLiveStatus) {
    const snapshots = providerAirportSnapshotsFromLiveStatus(liveStatus)
    if (snapshots.length === 0) return
    await saveProviderAirports(snapshots)
    await refreshProviderAirports()
  }

  useEffect(() => {
    let mounted = true
    void Promise.all([getFlights(), getAllFlights()]).then(([loadedFlights, loadedAllFlights]) => {
      if (!mounted) return
      setFlights(loadedFlights)
      setAllFlights(loadedAllFlights)
    }).finally(() => {
      if (mounted) setInitialDataLoading(false)
    })
    void getProviderAirports().then((airports) => {
      if (!mounted) return
      setProviderAirports(airports)
      setProviderAirportState(airports)
      setAirportVersion((version) => version + 1)
    })
    void migrateLegacyTripNames(legacyTripNamesFromLocalStorage()).then(async (metadata) => {
      const allMetadata = await getAllTripMetadata()
      if (!mounted) return
      setTripMetadataState(metadata.filter((item) => !item.deletedAt))
      setAllTripMetadataState(allMetadata)
    })
    void getAllAppMetadata().then(async (metadata) => {
      const migrated = migrateAppMetadataDefaults(metadata, localDeviceId())
      if (migrated.changed) await bulkSetAppMetadata(migrated.metadata)
      if (mounted) setAppMetadataState(migrated.metadata)
    })
    void listLocalSyncEvents(20).then((events) => {
      if (mounted) setSyncEvents(events)
    })
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void) => number
      cancelIdleCallback?: (handle: number) => void
    }
    const loadAirports = () => {
      void loadGeneratedAirports()
        .then((count) => {
          if (!mounted) return
          setAirportDatasetLabel(`${count.toLocaleString()} airports loaded`)
          setAirportVersion((version) => version + 1)
        })
        .catch(() => {
          if (mounted) setAirportDatasetLabel(`${airportCount().toLocaleString()} airport fallback loaded`)
        })
    }
    const usedIdleCallback = Boolean(idleWindow.requestIdleCallback)
    const idleHandle = usedIdleCallback && idleWindow.requestIdleCallback ? idleWindow.requestIdleCallback(loadAirports) : window.setTimeout(loadAirports, 350)
    const onHashChange = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => {
      mounted = false
      if (usedIdleCallback && idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleHandle)
      else window.clearTimeout(idleHandle)
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let mounted = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) setAuthMessage(friendlyAuthError(error))
      setAuthSession(data.session)
      setAuthLoading(false)
      if (data.session && window.sessionStorage.getItem('flightlog-auth-return')) {
        window.sessionStorage.removeItem('flightlog-auth-return')
        navigate('account')
      }
    })
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      setAuthSession(session)
      setAuthLoading(false)
      if (event === 'SIGNED_IN') {
        setAuthMessage('Signed in. Local data was not changed.')
        if (window.sessionStorage.getItem('flightlog-auth-return')) {
          window.sessionStorage.removeItem('flightlog-auth-return')
          navigate('account')
        }
      }
      if (event === 'SIGNED_OUT') {
        setAuthMessage('Signed out. Local data was not deleted.')
        setCloudBackups([])
        setSyncDevices([])
      }
    })
    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase || !authUserId) return
    let cancelled = false
    void Promise.resolve().then(async () => {
      setCloudBusy(true)
      try {
        const backups = await listCloudBackups(supabase)
        if (cancelled) return
        setCloudBackups(backups)
        setCloudMessage('')
      } catch (error) {
        if (!cancelled) setCloudMessage(cloudBackupErrorMessage(error, 'Unable to load cloud backups.'))
      } finally {
        if (!cancelled) setCloudBusy(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [authUserId])

  useEffect(() => {
    if (!supabase || !authUserId) return
    let cancelled = false
    void Promise.resolve().then(async () => {
      const device = currentDeviceSnapshot({
        deviceId,
        deviceName,
        userAgent: navigator.userAgent,
        now: new Date().toISOString(),
      })
      device.lastSyncEventAt = syncMetadata.lastSyncEventAt
      try {
        await registerSyncDevice({ client: supabase, userId: authUserId, device })
        const devices = await listSyncDevices(supabase, deviceId)
        if (!cancelled) setSyncDevices(devices)
      } catch {
        if (!cancelled) setSyncDevices([])
      }
    })
    return () => {
      cancelled = true
    }
  }, [authUserId, deviceId, deviceName, syncMetadata.lastSyncEventAt])

  useEffect(() => {
    let cancelled = false
    const backup = createFullBackup({
      flights: allFlights,
      tripMetadata: allTripMetadata,
      providerAirports: providerAirportState,
      appMetadata,
      exportedAt: new Date().toISOString(),
    })
    void computeBackupChecksum(backup)
      .then((checksum) => {
        if (!cancelled) setCurrentBackupChecksum(checksum)
      })
      .catch(() => {
        if (!cancelled) setCurrentBackupChecksum(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [allFlights, allTripMetadata, providerAirportState, appMetadata])

  useEffect(() => {
    const root = document.documentElement
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
    const effectiveTheme = settings.theme === 'system' ? (prefersDark ? 'dark' : 'light') : settings.theme
    root.dataset.theme = effectiveTheme
    root.style.colorScheme = effectiveTheme
  }, [settings.theme])

  function navigate(next: Page) {
    setMobileMoreOpen(false)
    window.location.hash = `/${next}`
    setRoute({ page: next })
  }

  function navigateToFlight(id: string) {
    setMobileMoreOpen(false)
    window.location.hash = `/flights/${encodeURIComponent(id)}`
    setRoute({ page: 'flight-detail', flightId: id })
  }

  function navigateToTrip(id: string) {
    setMobileMoreOpen(false)
    window.location.hash = `/trips/${encodeURIComponent(id)}`
    setRoute({ page: 'trip-detail', tripId: id })
  }

  function openQuickAdd() {
    setMobileMoreOpen(false)
    setEditing(undefined)
    setShowForm(true)
  }

  async function handleDelete(id: string) {
    await deleteFlight(id, { deviceId, reason: 'Deleted from active flight list' })
    await loadFlights()
    await markLocalChange()
    if (route.page === 'flight-detail' && route.flightId === id) navigate('flights')
  }

  async function offerBackupBeforePermanentDelete(label: string): Promise<void> {
    if (authSession && supabase && window.confirm(`Create a cloud backup snapshot before permanently deleting ${label}?`)) {
      await handleCloudUpload(`Safety backup before permanent delete - ${new Date().toISOString().slice(0, 10)}`)
    }
  }

  async function handleRestoreDeletedFlight(id: string) {
    await restoreFlight(id)
    await loadFlights()
    await markLocalChange()
    setToast('Flight restored from Trash.')
  }

  async function handleRestoreDeletedFlights(ids: string[]) {
    if (ids.length === 0) return
    await bulkRestoreFlights(ids)
    await loadFlights()
    await markLocalChange()
    setToast(`Restored ${ids.length} flight${ids.length === 1 ? '' : 's'} from Trash.`)
  }

  async function handlePermanentDeleteFlight(id: string) {
    const flight = allFlights.find((item) => item.id === id)
    if (!flight) return
    await offerBackupBeforePermanentDelete(flight.flightNumber)
    if (!requireTypedConfirmation(`Permanently delete ${flight.flightNumber}? This removes it from this browser and cannot be undone from Trash. Cloud tombstones are not hard-deleted.`, 'DELETE FOREVER')) return
    await permanentlyDeleteFlight(id)
    await loadFlights()
    await markLocalChange()
    setToast('Flight permanently deleted locally.')
  }

  async function handlePermanentDeleteFlights(ids: string[]) {
    if (ids.length === 0) return
    await offerBackupBeforePermanentDelete(`${ids.length} deleted flights`)
    if (!requireTypedConfirmation(`Permanently delete ${ids.length} deleted flight${ids.length === 1 ? '' : 's'} from this browser? Cloud tombstones are not hard-deleted.`, 'DELETE FOREVER')) return
    await bulkPermanentlyDeleteFlights(ids)
    await loadFlights()
    await markLocalChange()
    setToast(`Permanently deleted ${ids.length} local flight${ids.length === 1 ? '' : 's'}.`)
  }

  async function handleEmptyTrash() {
    const deleted = await getDeletedFlights()
    await handlePermanentDeleteFlights(deleted.map((flight) => flight.id))
  }

  function handleExportDeletedRecord(flight: FlightLogEntry) {
    downloadFile(`flightlog-deleted-${flight.flightNumber}-${flight.id}.json`, JSON.stringify({ flight }, null, 2), 'application/json')
  }

  async function handleRefresh(flight: FlightLogEntry) {
    if (!isOnline) {
      setToast(offlineActionMessage('live status refresh'))
      return
    }
    try {
      if (!canRefreshLiveStatus(flight.lastFetchedAt)) {
        setToast('Refresh available in a few minutes.')
        return
      }
      const liveStatus = await fetchLiveStatus(flight.flightNumber, flight.date, { dateRole: flight.lookupDateRole ?? 'Departure', liveDataMode: settings.liveDataMode })
      const fetchedAt = new Date().toISOString()
      await saveFlight(enrichFlightWithLiveStatus(flight, liveStatus, fetchedAt, flight.lookupDateRole ?? 'Departure'))
      await cacheProviderAirports(liveStatus)
      setToast(`Updated just now: ${flight.flightNumber} is ${liveStatus.status}`)
      await loadFlights()
      await markLocalChange()
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Unable to refresh live status')
    }
  }

  async function addDemoFlights() {
    await bulkSaveFlights(sampleFlights)
    await loadFlights()
    await markLocalChange()
    setToast('Demo flights loaded.')
  }

  async function handleSavedFlight(savedFlightId?: string) {
    await loadFlights()
    await markLocalChange()
    if (savedFlightId) navigateToFlight(savedFlightId)
  }

  async function handleDismissCompletion(flight: FlightLogEntry) {
    await saveFlight({ ...flight, completionDismissedAt: new Date().toISOString() })
    await loadFlights()
    await markLocalChange()
    setToast(`Completion reminder dismissed for ${flight.flightNumber}.`)
  }

  async function handleTripMetadataUpdate(tripId: string, patch: Partial<TripMetadata>) {
    await saveTripMetadata({ id: tripId, ...patch })
    await loadTripMetadata()
    await markLocalChange()
  }

  async function handleCreateTrip() {
    const id = crypto.randomUUID()
    await saveTripMetadata({ id, name: 'New trip', isManual: true, flightIds: [] })
    await loadTripMetadata()
    await markLocalChange()
    setToast('Trip created. Add flights from the trip editor.')
    navigateToTrip(id)
  }

  async function handleConvertTripToManual(trip: TripGroup) {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const descriptiveName = trip.flights.length > 0
      ? `${trip.flights[0].origin} -> ${trip.flights.at(-1)?.destination} · ${trip.startDate}`
      : undefined
    await saveTripMetadata({
      id,
      name: trip.metadata?.name ?? descriptiveName,
      notes: trip.notes,
      type: trip.type,
      isFavorite: trip.isFavorite,
      isManual: true,
      flightIds: trip.flights.map((flight) => flight.id),
    })
    if (trip.metadata && !trip.metadata.isManual) {
      await saveTripMetadata({
        id: trip.metadata.id,
        deletedAt: now,
        deletedByDeviceId: deviceId,
        deleteReason: 'Converted to editable trip',
        tombstoneVersion: trip.metadata.tombstoneVersion ?? 1,
        lastOperation: 'delete',
      })
    }
    await loadTripMetadata()
    await markLocalChange()
    setToast('Trip is now editable. Add or remove flights freely.')
    navigateToTrip(id)
  }

  async function handleAddFlightToTrip(trip: TripGroup, flightId: string) {
    if (!trip.isManual) return
    await mutateTripFlightIds(trip.id, (roster) => (roster.includes(flightId) ? roster : [...roster, flightId]))
    await loadTripMetadata()
    await markLocalChange()
  }

  async function handleRemoveFlightFromTrip(trip: TripGroup, flightId: string) {
    if (!trip.isManual) return
    await mutateTripFlightIds(trip.id, (roster) => roster.filter((id) => id !== flightId))
    await loadTripMetadata()
    await markLocalChange()
  }

  async function handleDeleteTrip(trip: TripGroup) {
    if (!trip.isManual || !trip.metadata) return
    if (!window.confirm(`Delete trip "${trip.name}"? Flights stay in your log and return to automatic grouping.`)) return
    await saveTripMetadata({
      id: trip.id,
      deletedAt: new Date().toISOString(),
      deletedByDeviceId: deviceId,
      deleteReason: 'Trip deleted from trip editor',
      tombstoneVersion: trip.metadata.tombstoneVersion ?? 1,
      lastOperation: 'delete',
    })
    await loadTripMetadata()
    await markLocalChange()
    setToast('Trip deleted. Its flights returned to automatic grouping.')
    navigate('trips')
  }

  async function updateSyncMetadata(patch: Partial<SyncMetadata>, now = new Date().toISOString()) {
    await bulkSetAppMetadata([patchSyncMetadata(await getAllAppMetadata(), deviceId, patch, now)])
    await loadAppMetadata()
  }

  async function markLocalChange(now = new Date().toISOString()) {
    await updateSyncMetadata({ lastLocalChangeAt: now }, now)
  }

  async function handleSettingsChange(patch: Partial<AppSettings>) {
    const now = new Date().toISOString()
    await bulkSetAppMetadata([
      settingsMetadataEntry({ ...settings, ...patch }, now),
      patchSyncMetadata(await getAllAppMetadata(), deviceId, { lastLocalChangeAt: now }, now),
    ])
    await loadAppMetadata()
  }

  async function buildExportBackup(now: string) {
    const appMetadataForBackup = [
      ...(await getAllAppMetadata()).filter((item) => item.key !== 'lastBackupAt'),
      { key: 'lastBackupAt', value: now, updatedAt: now },
    ]
    return createFullBackup({
      flights: await getAllFlights(),
      tripMetadata: await getAllTripMetadata(),
      providerAirports: await getProviderAirports(),
      appMetadata: appMetadataForBackup,
      exportedAt: now,
    })
  }

  async function handleExportFullBackup() {
    const now = new Date().toISOString()
    const backup = await buildExportBackup(now)
    downloadFile(`flightlog-backup-${now.slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json')
    await setAppMetadata('lastBackupAt', now)
    await loadAppMetadata()
    setToast('Full backup exported.')
  }

  async function handleExportEncryptedBackup(passphrase: string, hint?: string) {
    const now = new Date().toISOString()
    const backup = await buildExportBackup(now)
    const envelope = await encryptBackupJson(JSON.stringify(backup), passphrase, { hint, now })
    downloadFile(`flightlog-encrypted-backup-${now.slice(0, 10)}.json`, JSON.stringify(envelope, null, 2), 'application/json')
    await setAppMetadata('lastBackupAt', now)
    await loadAppMetadata()
    setToast('Encrypted backup exported. Keep the passphrase safe; it cannot be recovered.')
  }

  async function handleMergeBackup(preview: BackupImportPreview) {
    const now = new Date().toISOString()
    if (preview.mergeFlights.length > 0) await bulkSaveFlights(preview.mergeFlights)
    await saveProviderAirports(preview.backup.providerAirports)
    const localTripMetadata = await getAllTripMetadata()
    const tripMetadataToMerge = preview.backup.tripMetadata.filter((item) => {
      const local = localTripMetadata.find((row) => row.id === item.id)
      if (!local) return true
      if (local.deletedAt && !item.deletedAt) return false
      return (item.updatedAt ?? '') > (local.updatedAt ?? '')
    })
    if (tripMetadataToMerge.length > 0) await bulkSaveTripMetadata(tripMetadataToMerge)
    await bulkSetAppMetadata([
      ...importableAppMetadata(preview.backup.appMetadata),
      { key: 'lastImportAt', value: now, updatedAt: now },
    ])
    await reloadLocalData()
    await markLocalChange(now)
    setToast(`Imported ${preview.flightsToAdd} new flights and skipped ${preview.duplicateFlights} duplicate flights.`)
  }

  async function handleReplaceBackup(preview: BackupImportPreview) {
    const now = new Date().toISOString()
    await replaceFlights(preview.backup.flights)
    await replaceProviderAirports(preview.backup.providerAirports)
    await replaceTripMetadata(preview.backup.tripMetadata)
    await replaceAppMetadata([
      ...importableAppMetadata(preview.backup.appMetadata),
      { key: 'lastImportAt', value: now, updatedAt: now },
    ])
    await reloadLocalData()
    await markLocalChange(now)
    setToast(`Restored ${preview.backup.flights.length} flights from backup.`)
  }

  async function handleRepairData() {
    await bulkSaveFlights(repairFlightsFromAirportDataset(flights))
    await loadFlights()
    await markLocalChange()
    setAirportVersion((version) => version + 1)
    setToast('Airport snapshots re-resolved where local data was available.')
  }

  async function handleGoogleSignIn() {
    if (!isOnline) {
      setAuthMessage(offlineActionMessage('login'))
      return
    }
    if (!supabase) {
      setAuthMessage('Cloud backup is not configured. Local backups still work.')
      return
    }
    setAuthMessage('')
    window.sessionStorage.setItem('flightlog-auth-return', '#/account')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: authRedirectUrl() },
    })
    if (error) setAuthMessage(friendlyAuthError(error))
  }

  async function handleEmailSignIn(email: string) {
    if (!isOnline) {
      setAuthMessage(offlineActionMessage('email login'))
      return
    }
    if (!supabase) {
      setAuthMessage('Cloud backup is not configured. Local backups still work.')
      return
    }
    setAuthMessage('')
    window.sessionStorage.setItem('flightlog-auth-return', '#/account')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: authRedirectUrl() },
    })
    setAuthMessage(error ? friendlyAuthError(error) : 'Check your email for a FlightLog magic link.')
  }

  async function handleSignOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    setAuthMessage(error ? friendlyAuthError(error) : 'Signed out. Local data was not deleted.')
  }

  async function handleCloudUpload(label: string, encryptPassphrase?: string) {
    if (!isOnline) {
      setCloudMessage(offlineActionMessage('cloud backup'))
      return
    }
    setCloudBusy(true)
    setCloudMessage('')
    try {
      const now = new Date().toISOString()
      const backup = await buildCurrentFullBackup(now)
      const expectedChecksum = await computeBackupChecksum(backup)
      const uploaded = await createCloudBackupSnapshot({
        client: supabase,
        userId: authSession?.user.id,
        backup,
        label,
        deviceId,
        appVersion: 'v2.1',
        encryptPassphrase,
      })
      const verification = await verifyCloudBackupSnapshot({ client: supabase, id: uploaded.id, expectedChecksum, passphrase: encryptPassphrase })
      await bulkSetAppMetadata([
        { key: 'lastCloudBackupAt', value: uploaded.createdAt, updatedAt: now },
        { key: 'lastCloudBackupChecksum', value: verification.fetchedChecksum ?? uploaded.checksum ?? expectedChecksum, updatedAt: now },
        { key: 'lastCloudBackupId', value: uploaded.id, updatedAt: now },
        patchSyncMetadata(await getAllAppMetadata(), deviceId, {
          lastCloudBackupAt: uploaded.createdAt,
          lastKnownCloudChecksum: verification.fetchedChecksum ?? uploaded.checksum ?? expectedChecksum,
        }, now),
      ])
      await Promise.all([loadAppMetadata(), loadCloudBackups()])
      setCloudMessage(verification.verified ? 'Cloud backup uploaded and verified.' : verification.warning ?? 'Cloud backup uploaded with a verification warning.')
      setToast(verification.verified ? 'Cloud backup uploaded and verified.' : 'Cloud backup uploaded, but verification needs review.')
    } catch (error) {
      setCloudMessage(cloudBackupErrorMessage(error, 'Unable to upload cloud backup.'))
    } finally {
      setCloudBusy(false)
    }
  }

  async function resolveSnapshotBackupWithPrompt(snapshot: CloudBackupSnapshot) {
    try {
      return await resolveSnapshotBackup(snapshot)
    } catch (error) {
      if (!(error instanceof EncryptedCloudBackupError)) throw error
      const hint = snapshot.encryptedEnvelope?.hint
      const passphrase = window.prompt(`This cloud backup is encrypted end-to-end.${hint ? ` Hint: ${hint}.` : ''} Enter its passphrase:`)
      if (!passphrase) throw new Error('Passphrase required: this cloud backup is encrypted end-to-end.', { cause: error })
      return await resolveSnapshotBackup(snapshot, passphrase)
    }
  }

  async function handleCloudPreview(id: string) {
    if (!isOnline) {
      setCloudMessage(offlineActionMessage('cloud backup preview'))
      return
    }
    setCloudBusy(true)
    setCloudMessage('')
    try {
      const snapshot = await getCloudBackup(supabase, id)
      const backup = await resolveSnapshotBackupWithPrompt(snapshot)
      setCloudPreview({ snapshot, preview: previewBackupImport(backup, flights) })
    } catch (error) {
      setCloudMessage(cloudBackupErrorMessage(error, 'Unable to preview cloud backup.'))
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleCloudRestore(id: string, mode: 'merge' | 'replace') {
    if (!isOnline) {
      setCloudMessage(offlineActionMessage('cloud restore'))
      return
    }
    const replacing = mode === 'replace'
    if (replacing && flights.length > 0 && !requireTypedConfirmation('Replace all local FlightLog data with this cloud backup? Cloud backups will not be deleted.', 'REPLACE LOCAL DATA')) return
    setCloudBusy(true)
    setCloudMessage('')
    try {
      const snapshot = await getCloudBackup(supabase, id)
      const backup = await resolveSnapshotBackupWithPrompt(snapshot)
      const preview = previewBackupImport(backup, flights)
      if (mode === 'merge') await handleMergeBackup(preview)
      else await handleReplaceBackup(preview)
      const now = new Date().toISOString()
      await setAppMetadata('lastCloudRestoreAt', now)
      await updateSyncMetadata({ lastCloudRestoreAt: now }, now)
      await reloadLocalData()
      setCloudPreview(undefined)
      setCloudMessage(mode === 'merge' ? 'Cloud backup merged into local data.' : 'Local data replaced from cloud backup.')
    } catch (error) {
      setCloudMessage(cloudBackupErrorMessage(error, 'Unable to restore cloud backup.'))
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleCloudDownload(id: string) {
    if (!isOnline) {
      setCloudMessage(offlineActionMessage('cloud backup download'))
      return
    }
    setCloudBusy(true)
    setCloudMessage('')
    try {
      const snapshot = await getCloudBackup(supabase, id)
      if (snapshot.encryptedEnvelope) {
        downloadFile(`flightlog-encrypted-cloud-backup-${snapshot.createdAt.slice(0, 10)}.json`, JSON.stringify(snapshot.encryptedEnvelope, null, 2), 'application/json')
      } else {
        downloadFile(`flightlog-cloud-backup-${snapshot.createdAt.slice(0, 10)}.json`, JSON.stringify(snapshot.backup, null, 2), 'application/json')
      }
    } catch (error) {
      setCloudMessage(cloudBackupErrorMessage(error, 'Unable to download cloud backup.'))
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleCloudDownloadLatest() {
    if (!latestCloudBackup) return
    await handleCloudDownload(latestCloudBackup.id)
  }

  async function handleCloudRestoreLatest() {
    if (!latestCloudBackup) return
    await handleCloudRestore(latestCloudBackup.id, 'replace')
  }

  async function handleCloudDelete(id: string) {
    if (!isOnline) {
      setCloudMessage(offlineActionMessage('cloud backup delete'))
      return
    }
    if (!window.confirm('Delete this cloud backup? Local data will not be deleted.')) return
    setCloudBusy(true)
    setCloudMessage('')
    try {
      await deleteCloudBackup(supabase, id)
      await loadCloudBackups()
      setCloudPreview((preview) => preview?.snapshot.id === id ? undefined : preview)
      setCloudMessage('Cloud backup deleted.')
    } catch (error) {
      setCloudMessage(cloudBackupErrorMessage(error, 'Unable to delete cloud backup.'))
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleCloudDeleteAll() {
    if (!isOnline) {
      setCloudMessage(offlineActionMessage('cloud backup delete'))
      return
    }
    if (!requireTypedConfirmation('Delete all cloud backups for this signed-in account? Local data will not be deleted.', 'DELETE CLOUD BACKUPS')) return
    setCloudBusy(true)
    setCloudMessage('')
    try {
      const deleted = await deleteAllCloudBackups(supabase)
      await loadCloudBackups()
      setCloudPreview(undefined)
      setCloudMessage(`Deleted ${deleted} cloud backup${deleted === 1 ? '' : 's'}.`)
    } catch (error) {
      setCloudMessage(cloudBackupErrorMessage(error, 'Unable to delete cloud backups.'))
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleCloudKeepLatest() {
    if (!isOnline) {
      setCloudMessage(offlineActionMessage('cloud backup cleanup'))
      return
    }
    if (!requireTypedConfirmation('Delete older cloud backups and keep the latest 10? Local data will not be deleted.', 'KEEP LATEST 10')) return
    setCloudBusy(true)
    setCloudMessage('')
    try {
      const deleted = await deleteOlderCloudBackups(supabase, 10)
      await loadCloudBackups()
      setCloudMessage(`Deleted ${deleted} older cloud backup${deleted === 1 ? '' : 's'}.`)
    } catch (error) {
      setCloudMessage(cloudBackupErrorMessage(error, 'Unable to delete older cloud backups.'))
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleDismissCloudRestorePrompt() {
    await setAppMetadata('cloudRestorePromptDismissedAt', new Date().toISOString())
    await loadAppMetadata()
  }

  async function handleSetCloudReminder(enabled: boolean) {
    await bulkSetAppMetadata([
      { key: 'cloudBackupReminderEnabled', value: enabled ? 'true' : 'false', updatedAt: new Date().toISOString() },
      settingsMetadataEntry({ ...settings, backupReminderEnabled: enabled }),
    ])
    await loadAppMetadata()
  }

  async function recordSyncEvent(eventType: SyncEventLog['eventType'], summary?: Record<string, unknown>, error?: unknown) {
    const event = createSyncEvent({ eventType, deviceId, summary, error })
    await addSyncEvent(event)
    setSyncEvents(await listLocalSyncEvents(20))
    if (supabase && authSession) {
      try {
        await logRemoteSyncEvent({ client: supabase, userId: authSession.user.id, event })
      } catch {
        // Sync history is optional until migration 003 is installed.
      }
    }
    return event
  }

  async function refreshSyncDevices(lastSyncEventAt?: string) {
    if (!supabase || !authSession) {
      setSyncDevices([])
      return
    }
    const device = currentDeviceSnapshot({
      deviceId,
      deviceName,
      userAgent: navigator.userAgent,
      now: new Date().toISOString(),
    })
    device.lastSyncEventAt = lastSyncEventAt ?? syncMetadata.lastSyncEventAt
    try {
      await registerSyncDevice({ client: supabase, userId: authSession.user.id, device })
      setSyncDevices(await listSyncDevices(supabase, deviceId))
    } catch {
      setSyncDevices([])
    }
  }

  async function handleRenameDevice(name: string) {
    const cleaned = setDeviceName(name)
    setDeviceNameState(cleaned)
    const now = new Date().toISOString()
    await updateSyncMetadata({ localDeviceName: cleaned }, now)
    await refreshSyncDevices()
  }

  function hasRecentCloudBackup(): boolean {
    return Boolean(latestCloudBackup && Date.now() - Date.parse(latestCloudBackup.createdAt) < 24 * 60 * 60 * 1000)
  }

  function confirmSyncWithoutRecentBackup(action: string): boolean {
    if (hasRecentCloudBackup()) return true
    return window.confirm(`${action} without a cloud backup from the last 24 hours?\n\nNo records will be overwritten or deleted without confirmation, but a backup is recommended before sync.`)
  }

  async function buildLocalSyncState() {
    const settingsEntry = appMetadata.find((item) => item.key === 'settings')
    return getLocalSyncState({
      flights: await getAllFlights(),
      tripMetadata: await getAllTripMetadata(),
      providerAirports: await getProviderAirports(),
      settings,
      deviceId,
      settingsUpdatedAt: settingsEntry?.updatedAt,
    })
  }

  async function handleSyncCompare() {
    if (!isOnline) {
      setSyncMessage(offlineActionMessage('cloud sync compare'))
      return
    }
    if (!supabase || !authSession) {
      setSyncMessage(!supabase ? 'Cloud Sync Lite is not configured. Local data still works.' : 'Sign in to compare local and cloud sync records.')
      return
    }
    setSyncBusy(true)
    setSyncMessage('')
    try {
      const [local, remote] = await Promise.all([buildLocalSyncState(), getRemoteSyncState(supabase)])
      const comparison = compareLocalAndRemote(local, remote)
      setSyncComparison(comparison)
      setSyncConflictActions(Object.fromEntries(comparison.conflicts.map((item) => [item.key, 'skip'])))
      const now = new Date().toISOString()
      const summary = {
        records: comparison.items.length,
        localOnly: comparison.localOnly.length,
        remoteOnly: comparison.remoteOnly.length,
        conflicts: comparison.conflicts.length,
        tombstones: comparison.tombstonesToPush.length + comparison.tombstonesToPull.length,
      }
      await recordSyncEvent('compare', summary)
      await updateSyncMetadata({
        lastCloudCompareAt: now,
        lastSyncEventAt: now,
        lastSyncSummary: JSON.stringify(summary),
        lastConflictCount: comparison.conflicts.length,
        lastTombstoneCount: comparison.tombstonesToPush.length + comparison.tombstonesToPull.length,
        lastSyncError: undefined,
      }, now)
      await refreshSyncDevices(now)
      try {
        const remoteEvents = await listRemoteSyncEvents(supabase)
        if (remoteEvents.length > 0) setSyncEvents(remoteEvents)
      } catch {
        // Remote sync history is optional until migration 003 is installed.
      }
      setSyncMessage(`Compared ${comparison.items.length} records. ${comparison.conflicts.length} conflict${comparison.conflicts.length === 1 ? '' : 's'} and ${summary.tombstones} tombstone${summary.tombstones === 1 ? '' : 's'} need review.`)
    } catch (error) {
      await recordSyncEvent('error', { operation: 'compare' }, error)
      await updateSyncMetadata({ lastSyncError: cloudSyncErrorMessage(error, 'Unable to compare local and cloud records.') })
      setSyncMessage(cloudSyncErrorMessage(error, 'Unable to compare local and cloud records.'))
    } finally {
      setSyncBusy(false)
    }
  }

  async function handleCreateSafetyBackup() {
    await handleCloudUpload(`Safety backup before sync - ${new Date().toISOString().slice(0, 10)}`)
    await recordSyncEvent('backup_before_sync', { backups: cloudBackups.length + 1 })
  }

  function rehydrateSyncRecord<T extends { updatedAt?: string }>(record: SyncRecord): T {
    // record_json is stored without the volatile updatedAt key; restore it from
    // the row-level timestamp so local writes (and their filters) keep working.
    const value = record.record as T
    return { ...value, updatedAt: value.updatedAt ?? record.recordUpdatedAt ?? new Date().toISOString() }
  }

  async function applyRemoteSyncRecords(records: SyncRecord[]) {
    const remoteFlights = records.filter((record) => record.entityType === 'flight').map((record) => rehydrateSyncRecord<FlightLogEntry>(record))
    const remoteTripMetadata = records.filter((record) => record.entityType === 'tripMetadata').map((record) => rehydrateSyncRecord<TripMetadata>(record))
    const remoteProviderAirports = records.filter((record) => record.entityType === 'providerAirport').map((record) => rehydrateSyncRecord<ProviderAirportSnapshot>(record))
    const remoteSettings = records.find((record) => record.entityType === 'appSettings')?.record
    if (remoteFlights.length > 0) await bulkSaveFlights(remoteFlights)
    if (remoteTripMetadata.length > 0) await bulkPutTripMetadataRaw(remoteTripMetadata)
    if (remoteProviderAirports.length > 0) await bulkPutProviderAirportsRaw(remoteProviderAirports)
    if (remoteSettings) await bulkSetAppMetadata([settingsMetadataEntry(normalizeAppSettings(remoteSettings))])
    await reloadLocalData()
  }

  async function refreshSyncComparison(message?: string) {
    if (!supabase || !authSession) return
    const [local, remote] = await Promise.all([buildLocalSyncState(), getRemoteSyncState(supabase)])
    const comparison = compareLocalAndRemote(local, remote)
    setSyncComparison(comparison)
    setSyncConflictActions(Object.fromEntries(comparison.conflicts.map((item) => [item.key, syncConflictActions[item.key] ?? 'skip'])))
    if (message) setSyncMessage(message)
  }

  async function handleSyncPushLocalOnly() {
    if (!isOnline) {
      setSyncMessage(offlineActionMessage('cloud sync push'))
      return
    }
    if (!supabase || !authSession || !syncComparison) {
      await handleSyncCompare()
      return
    }
    setSyncBusy(true)
    setSyncMessage('')
    try {
      if (!confirmSyncWithoutRecentBackup('Push local changes')) return
      const records = syncComparison.localOnly.map((item) => item.local).filter((record): record is SyncRecord => Boolean(record))
      const count = await pushLocalChanges({ client: supabase, userId: authSession.user.id, records, deviceId })
      const now = new Date().toISOString()
      await recordSyncEvent('push', { pushed: count, tombstones: 0 })
      await updateSyncMetadata({ lastCloudPushAt: now, lastSyncEventAt: now, lastSyncSummary: `${count} pushed`, lastSyncError: undefined }, now)
      await refreshSyncDevices(now)
      await refreshSyncComparison(`Pushed ${count} local-only record${count === 1 ? '' : 's'} to cloud.`)
    } catch (error) {
      await recordSyncEvent('error', { operation: 'push' }, error)
      setSyncMessage(cloudSyncErrorMessage(error, 'Unable to push local records.'))
    } finally {
      setSyncBusy(false)
    }
  }

  async function handleSyncPullRemoteOnly() {
    if (!isOnline) {
      setSyncMessage(offlineActionMessage('cloud sync pull'))
      return
    }
    if (!syncComparison) {
      await handleSyncCompare()
      return
    }
    if (!requireTypedConfirmation('Pull remote-only cloud sync records into this browser? Existing local records will not be overwritten.', 'PULL CLOUD RECORDS')) return
    if (!confirmSyncWithoutRecentBackup('Pull cloud changes')) return
    setSyncBusy(true)
    setSyncMessage('')
    try {
      const records = pullRemoteChanges(syncComparison)
      await applyRemoteSyncRecords(records)
      const now = new Date().toISOString()
      await recordSyncEvent('pull', { pulled: records.length, tombstones: 0 })
      await updateSyncMetadata({ lastCloudPullAt: now, lastLocalChangeAt: now, lastSyncEventAt: now, lastSyncSummary: `${records.length} pulled`, lastSyncError: undefined }, now)
      await refreshSyncDevices(now)
      await refreshSyncComparison(`Pulled ${records.length} cloud record${records.length === 1 ? '' : 's'} into local data.`)
    } catch (error) {
      await recordSyncEvent('error', { operation: 'pull' }, error)
      setSyncMessage(cloudSyncErrorMessage(error, 'Unable to pull cloud records.'))
    } finally {
      setSyncBusy(false)
    }
  }

  async function handleSyncPushTombstones() {
    if (!isOnline) {
      setSyncMessage(offlineActionMessage('tombstone push'))
      return
    }
    if (!supabase || !authSession || !syncComparison) {
      await handleSyncCompare()
      return
    }
    if (!confirmSyncWithoutRecentBackup('Push deletion tombstones')) return
    if (!requireTypedConfirmation('Push local deletion tombstones to cloud? Deleted flights remain in Trash. Permanent deletion is not automatic.', 'PUSH TOMBSTONES')) return
    setSyncBusy(true)
    setSyncMessage('')
    try {
      const records = syncComparison.tombstonesToPush.map((item) => item.local).filter((record): record is SyncRecord => Boolean(record?.deletedAt))
      const count = await pushTombstones({ client: supabase, userId: authSession.user.id, records, deviceId })
      const now = new Date().toISOString()
      await recordSyncEvent('tombstone_push', { tombstones: count })
      await updateSyncMetadata({ lastTombstonePushAt: now, lastCloudPushAt: now, lastSyncEventAt: now, lastSyncSummary: `${count} tombstones pushed`, lastSyncError: undefined }, now)
      await refreshSyncDevices(now)
      await refreshSyncComparison(`Pushed ${count} deletion tombstone${count === 1 ? '' : 's'} to cloud.`)
    } catch (error) {
      await recordSyncEvent('error', { operation: 'tombstone_push' }, error)
      setSyncMessage(cloudSyncErrorMessage(error, 'Unable to push tombstones.'))
    } finally {
      setSyncBusy(false)
    }
  }

  async function handleSyncPullTombstones() {
    if (!isOnline) {
      setSyncMessage(offlineActionMessage('tombstone pull'))
      return
    }
    if (!syncComparison) {
      await handleSyncCompare()
      return
    }
    if (!confirmSyncWithoutRecentBackup('Pull deletion tombstones')) return
    if (!requireTypedConfirmation('Pull cloud deletion tombstones into this browser? Matching records will move to Trash, not be permanently deleted.', 'PULL TOMBSTONES')) return
    setSyncBusy(true)
    setSyncMessage('')
    try {
      const records = pullTombstones(syncComparison)
      await applyRemoteSyncRecords(records)
      const now = new Date().toISOString()
      await recordSyncEvent('tombstone_pull', { tombstones: records.length })
      await updateSyncMetadata({ lastTombstonePullAt: now, lastCloudPullAt: now, lastLocalChangeAt: now, lastSyncEventAt: now, lastSyncSummary: `${records.length} tombstones pulled`, lastSyncError: undefined }, now)
      await refreshSyncDevices(now)
      await refreshSyncComparison(`Pulled ${records.length} deletion tombstone${records.length === 1 ? '' : 's'} into Trash.`)
    } catch (error) {
      await recordSyncEvent('error', { operation: 'tombstone_pull' }, error)
      setSyncMessage(cloudSyncErrorMessage(error, 'Unable to pull tombstones.'))
    } finally {
      setSyncBusy(false)
    }
  }

  async function handleSyncSafeChanges() {
    if (!isOnline) {
      setSyncMessage(offlineActionMessage('cloud sync'))
      return
    }
    if (!syncComparison) {
      await handleSyncCompare()
      return
    }
    if (!confirmSyncWithoutRecentBackup('Sync safe non-conflicting changes')) return
    setSyncBusy(true)
    setSyncMessage('')
    try {
      const pushRecords = syncComparison.localOnly.map((item) => item.local).filter((record): record is SyncRecord => Boolean(record))
      const pullRecords = pullRemoteChanges(syncComparison)
      const tombstoneRecords = syncComparison.tombstonesToPush.map((item) => item.local).filter((record): record is SyncRecord => Boolean(record?.deletedAt))
      const pulledTombstones = pullTombstones(syncComparison)
      if (pushRecords.length > 0) await pushLocalChanges({ client: supabase, userId: authSession?.user.id, records: pushRecords, deviceId })
      if (tombstoneRecords.length > 0) await pushTombstones({ client: supabase, userId: authSession?.user.id, records: tombstoneRecords, deviceId })
      if (pullRecords.length > 0 || pulledTombstones.length > 0) await applyRemoteSyncRecords([...pullRecords, ...pulledTombstones])
      const now = new Date().toISOString()
      await recordSyncEvent('push', { pushed: pushRecords.length, pulled: pullRecords.length, tombstones: tombstoneRecords.length + pulledTombstones.length })
      await updateSyncMetadata({ lastCloudPushAt: pushRecords.length || tombstoneRecords.length ? now : syncMetadata.lastCloudPushAt, lastCloudPullAt: pullRecords.length || pulledTombstones.length ? now : syncMetadata.lastCloudPullAt, lastLocalChangeAt: pullRecords.length || pulledTombstones.length ? now : syncMetadata.lastLocalChangeAt, lastSyncEventAt: now, lastSyncSummary: 'Safe changes synced', lastSyncError: undefined }, now)
      await refreshSyncDevices(now)
      await refreshSyncComparison('Synced safe non-conflicting changes. Conflicts, if any, were left untouched.')
    } catch (error) {
      await recordSyncEvent('error', { operation: 'sync_safe_changes' }, error)
      setSyncMessage(cloudSyncErrorMessage(error, 'Unable to sync safe changes.'))
    } finally {
      setSyncBusy(false)
    }
  }

  async function handleResolveConflict(item: SyncComparisonItem, action: SyncConflictAction) {
    if (!isOnline && action !== 'skip') {
      setSyncMessage(offlineActionMessage('sync conflict resolution'))
      return
    }
    if (!supabase || !authSession || action === 'skip') {
      setSyncConflictActions((current) => ({ ...current, [item.key]: action }))
      return
    }
    if (!confirmSyncWithoutRecentBackup('Resolve sync conflict')) return
    setSyncBusy(true)
    setSyncMessage('')
    try {
      const deletedSide = item.local?.deletedAt ? item.local : item.remote?.deletedAt ? item.remote : undefined
      const activeLocal = item.local && !item.local.deletedAt ? item.local : undefined
      const activeRemote = item.remote && !item.remote.deletedAt ? item.remote : undefined
      if (action === 'keep-local' && item.local) {
        await pushLocalChanges({ client: supabase, userId: authSession.user.id, records: [item.local], deviceId })
      }
      if (action === 'use-cloud' && item.remote) {
        if (!requireTypedConfirmation(`Use the cloud version of ${syncRecordLabel(item)} and overwrite this local record?`, 'USE CLOUD')) return
        await applyRemoteSyncRecords([item.remote])
      }
      if (action === 'keep-deleted' && deletedSide) {
        if (deletedSide === item.local) await pushTombstones({ client: supabase, userId: authSession.user.id, records: [deletedSide], deviceId })
        else await applyRemoteSyncRecords([deletedSide])
      }
      if (action === 'restore-local' && activeLocal) {
        await pushLocalChanges({ client: supabase, userId: authSession.user.id, records: [activeLocal], deviceId })
      }
      if (action === 'restore-cloud' && activeRemote) {
        if (!requireTypedConfirmation(`Restore the active cloud version of ${syncRecordLabel(item)} into this browser?`, 'RESTORE CLOUD')) return
        await applyRemoteSyncRecords([activeRemote])
      }
      const now = new Date().toISOString()
      const pulled = action === 'use-cloud' || action === 'restore-cloud' || (action === 'keep-deleted' && deletedSide === item.remote)
      await updateSyncMetadata({
        lastConflictResolutionAt: now,
        lastConflictResolutionSummary: `${action} for ${item.entityType}:${item.localId}`,
        lastSyncEventAt: now,
        lastSyncSummary: `${action} for ${syncRecordLabel(item)}`,
        ...(pulled ? { lastCloudPullAt: now, lastLocalChangeAt: now } : { lastCloudPushAt: now }),
      }, now)
      await recordSyncEvent('conflict_resolve', { action, conflicts: 1, tombstones: action === 'keep-deleted' ? 1 : 0 })
      await refreshSyncDevices(now)
      await refreshSyncComparison(`Resolved conflict for ${syncRecordLabel(item)}.`)
    } catch (error) {
      await recordSyncEvent('error', { operation: 'conflict_resolve', action }, error)
      setSyncMessage(cloudSyncErrorMessage(error, 'Unable to resolve sync conflict.'))
    } finally {
      setSyncBusy(false)
    }
  }

  async function handleMergeConflictFields(item: SyncComparisonItem, choices: Record<string, MergeSide>) {
    if (!isOnline) {
      setSyncMessage(offlineActionMessage('sync conflict merge'))
      return
    }
    if (!supabase || !authSession) return
    if (item.entityType !== 'flight' || !item.local?.record || !item.remote?.record) return
    setSyncBusy(true)
    setSyncMessage('')
    try {
      const local = rehydrateSyncRecord<FlightLogEntry>(item.local)
      const cloud = rehydrateSyncRecord<FlightLogEntry>(item.remote)
      const merged = mergeFlightRecords(local, cloud, choices)
      const savedId = await saveFlight(merged)
      const saved = (await getAllFlights()).find((flight) => flight.id === savedId)
      if (!saved) throw new Error('Merged flight was not found after saving.')
      const record = await buildSyncRecord('flight', saved.id, saved, deviceId)
      await pushLocalChanges({ client: supabase, userId: authSession.user.id, records: [record], deviceId })
      await loadFlights()
      const now = new Date().toISOString()
      await recordSyncEvent('conflict_resolve', { action: 'merge-fields', conflicts: 1 })
      await updateSyncMetadata({
        lastConflictResolutionAt: now,
        lastConflictResolutionSummary: `merge-fields for ${item.entityType}:${item.localId}`,
        lastSyncEventAt: now,
        lastSyncSummary: `Merged fields for ${syncRecordLabel(item)}`,
        lastCloudPushAt: now,
        lastLocalChangeAt: now,
      }, now)
      await refreshSyncDevices(now)
      await refreshSyncComparison(`Merged fields for ${syncRecordLabel(item)} and pushed the result to the cloud.`)
    } catch (error) {
      await recordSyncEvent('error', { operation: 'conflict_merge_fields' }, error)
      setSyncMessage(cloudSyncErrorMessage(error, 'Unable to merge conflict fields.'))
    } finally {
      setSyncBusy(false)
    }
  }

  async function handleResolveAllConflicts(action: SyncConflictAction) {
    if (!syncComparison) return
    if (!isOnline && action !== 'skip') {
      setSyncMessage(offlineActionMessage('sync conflict resolution'))
      return
    }
    if (action === 'skip') {
      setSyncConflictActions(Object.fromEntries(syncComparison.conflicts.map((item) => [item.key, 'skip'])))
      return
    }
    if (action === 'use-cloud' && !requireTypedConfirmation('Use all cloud conflict records and overwrite matching local records?', 'USE CLOUD')) return
    if (action === 'keep-deleted' && !requireTypedConfirmation('Keep all deletion conflicts as deleted? Deleted records remain in Trash and sync as tombstones.', 'KEEP DELETED')) return
    if (!confirmSyncWithoutRecentBackup('Resolve all sync conflicts')) return
    setSyncBusy(true)
    setSyncMessage('')
    try {
      const conflicts = syncComparison.conflicts
      if (action === 'keep-local') {
        const records = conflicts.map((item) => item.local).filter((record): record is SyncRecord => Boolean(record))
        await pushLocalChanges({ client: supabase, userId: authSession?.user.id, records, deviceId })
      } else if (action === 'restore-local') {
        const records = conflicts.map((item) => item.local).filter((record): record is SyncRecord => Boolean(record && !record.deletedAt))
        await pushLocalChanges({ client: supabase, userId: authSession?.user.id, records, deviceId })
      } else if (action === 'use-cloud') {
        const records = conflicts.map((item) => item.remote).filter((record): record is SyncRecord => Boolean(record))
        await applyRemoteSyncRecords(records)
      } else if (action === 'restore-cloud') {
        const records = conflicts.map((item) => item.remote).filter((record): record is SyncRecord => Boolean(record && !record.deletedAt))
        await applyRemoteSyncRecords(records)
      } else if (action === 'keep-deleted') {
        const localDeleted = conflicts.map((item) => item.local).filter((record): record is SyncRecord => Boolean(record?.deletedAt))
        const remoteDeleted = conflicts.map((item) => item.remote).filter((record): record is SyncRecord => Boolean(record?.deletedAt))
        await pushTombstones({ client: supabase, userId: authSession?.user.id, records: localDeleted, deviceId })
        await applyRemoteSyncRecords(remoteDeleted)
      }
      const now = new Date().toISOString()
      const pulled = action === 'use-cloud' || action === 'restore-cloud'
      await updateSyncMetadata({
        lastConflictResolutionAt: now,
        lastConflictResolutionSummary: `${action} for ${conflicts.length} conflicts`,
        lastSyncEventAt: now,
        lastSyncSummary: `${conflicts.length} conflicts resolved`,
        ...(pulled ? { lastCloudPullAt: now, lastLocalChangeAt: now } : { lastCloudPushAt: now }),
      }, now)
      await recordSyncEvent('conflict_resolve', { action, conflicts: conflicts.length, tombstones: action === 'keep-deleted' ? conflicts.length : 0 })
      await refreshSyncDevices(now)
      await refreshSyncComparison(`Resolved ${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}.`)
    } catch (error) {
      await recordSyncEvent('error', { operation: 'conflict_resolve_all', action }, error)
      setSyncMessage(cloudSyncErrorMessage(error, 'Unable to resolve sync conflicts.'))
    } finally {
      setSyncBusy(false)
    }
  }

  async function handleClearLocalData() {
    if (!requireTypedConfirmation('Clear all local FlightLog data from this browser? Cloud backups and cloud sync records will not be deleted.', 'CLEAR LOCAL DATA')) return
    const now = new Date().toISOString()
    await replaceFlights([])
    await replaceProviderAirports([])
    await replaceTripMetadata([])
    await replaceAppMetadata([
      settingsMetadataEntry(settings, now),
      patchSyncMetadata(appMetadata, deviceId, { lastLocalChangeAt: now }, now),
      { key: 'cloudRestorePromptDismissedAt', value: now, updatedAt: now },
    ])
    setSyncComparison(undefined)
    await reloadLocalData()
    setToast('Local FlightLog data cleared. Cloud backups were not deleted.')
  }

  async function handleRunLiveApiTest() {
    if (!isOnline) {
      setLiveApiStatus({ status: 'error', checkedAt: new Date().toISOString(), message: offlineActionMessage('live lookup test') })
      return
    }
    setLiveApiStatus({ status: 'checking' })
    try {
      const status = await fetchLiveStatus('SQ38', '2026-06-02', { dateRole: 'Departure', liveDataMode: settings.liveDataMode })
      const checkedAt = new Date().toISOString()
      await setAppMetadata('lastSuccessfulLiveLookupAt', checkedAt)
      await loadAppMetadata()
      setLiveApiStatus({
        status: 'reachable',
        checkedAt,
        message: `${status.provider ?? 'Provider'} returned ${status.flightNumber ?? 'SQ38'} ${status.origin?.iata ?? status.departureAirport?.iata ?? '---'}-${status.destination?.iata ?? status.arrivalAirport?.iata ?? '---'}`,
      })
    } catch (error) {
      setLiveApiStatus({ status: 'error', checkedAt: new Date().toISOString(), message: error instanceof Error ? error.message : 'Live lookup test failed.' })
    }
  }

  const cloudControls: CloudBackupControls = {
    configured: isSupabaseConfigured,
    signedIn: Boolean(authSession),
    userEmail: authSession?.user.email ?? undefined,
    backups: cloudBackups,
    busy: cloudBusy,
    message: cloudMessage,
    currentChecksum: currentBackupChecksum,
    preview: cloudPreview,
    onNavigateAccount: () => navigate('account'),
    onNavigateSync: () => navigate('sync'),
    onUpload: handleCloudUpload,
    onRefresh: () => loadCloudBackups(),
    onPreview: handleCloudPreview,
    onRestore: handleCloudRestore,
    onDownload: handleCloudDownload,
    onDownloadLatest: handleCloudDownloadLatest,
    onRestoreLatest: handleCloudRestoreLatest,
    onDelete: handleCloudDelete,
    onDeleteAll: handleCloudDeleteAll,
    onKeepLatest: handleCloudKeepLatest,
    onClearPreview: () => setCloudPreview(undefined),
  }

  const mobileGroup = mobileNavGroup(route)
  const appShellClass = ['app-shell', isStandalone ? 'is-standalone' : '', isOnline ? '' : 'is-offline'].filter(Boolean).join(' ')

  return (
    <AppSettingsContext.Provider value={settings}>
    <div className={appShellClass}>
      <header>
        <button type="button" className="brand" onClick={() => navigate('dashboard')}><Plane aria-hidden="true" /><span>FlightLog</span></button>
        <nav aria-label="Primary navigation">{desktopNavItems.map((item) => <button key={item.page} type="button" className={navPage(route) === item.page ? 'active' : ''} onClick={() => navigate(item.page)}>{item.label}</button>)}</nav>
        <button type="button" onClick={openQuickAdd}><Plus aria-hidden="true" /> Add flight</button>
      </header>
      {!isOnline && <OfflineBanner />}
      {toast && <div className="toast" role="status"><span>{toast}</span><button type="button" onClick={() => setToast('')}>Dismiss</button></div>}
      {showForm && <FlightForm editing={editing} isOnline={isOnline} onCancel={() => { setShowForm(false); setEditing(undefined) }} onSaved={handleSavedFlight} onProviderAirportsSaved={cacheProviderAirports} />}
      {route.page === 'dashboard' && <Dashboard flights={flights} loading={initialDataLoading} isOnline={isOnline} airportDatasetLabel={airportDatasetLabel} appMetadata={appMetadata} syncStatus={syncStatus} cloudRestorePrompt={showCloudRestorePrompt && latestCloudBackup ? { latestLabel: `${latestCloudBackup.label || 'Cloud backup'} from ${formatDateTime(latestCloudBackup.createdAt, flightTimeDisplayOptions(settings))}`, onRestoreLatest: () => handleCloudRestore(latestCloudBackup.id, 'replace'), onChooseBackup: () => navigate('backup'), onPullSync: () => navigate('sync'), onStartFresh: handleDismissCloudRestorePrompt } : undefined} onAddDemo={addDemoFlights} onQuickAdd={openQuickAdd} onOpenFlight={(flight) => navigateToFlight(flight.id)} onEditFlight={(flight) => { setEditing(flight); setShowForm(true) }} onDismissCompletion={handleDismissCompletion} onRefresh={handleRefresh} onCompareSync={authSession ? handleSyncCompare : undefined} />}
      {route.page === 'flights' && <FlightsPage flights={flights} airportVersion={airportVersion} isOnline={isOnline} onOpen={(flight) => navigateToFlight(flight.id)} onEdit={(flight) => { setEditing(flight); setShowForm(true) }} onDelete={handleDelete} onRefresh={handleRefresh} onQuickAdd={openQuickAdd} />}
      {route.page === 'flight-detail' && <FlightDetailPage flight={currentFlight} airportVersion={airportVersion} isOnline={isOnline} onBack={() => navigate('flights')} onEdit={(flight) => { setEditing(flight); setShowForm(true) }} onDelete={handleDelete} onRefresh={handleRefresh} onDismissCompletion={handleDismissCompletion} />}
      {route.page === 'trips' && <TripsPage trips={trips} onOpen={(trip) => navigateToTrip(trip.id)} onUpdate={(tripId, patch) => void handleTripMetadataUpdate(tripId, patch)} onCreateTrip={handleCreateTrip} />}
      {route.page === 'trip-detail' && <TripDetailPage trip={currentTrip} trips={trips} flights={flights} onBack={() => navigate('trips')} onOpenFlight={(flight) => navigateToFlight(flight.id)} onUpdate={(tripId, patch) => void handleTripMetadataUpdate(tripId, patch)} onAddFlight={handleAddFlightToTrip} onRemoveFlight={handleRemoveFlightFromTrip} onConvertToManual={handleConvertTripToManual} onDeleteTrip={handleDeleteTrip} />}
      {route.page === 'map' && <MapPage flights={flights} airportVersion={airportVersion} />}
      {route.page === 'passport' && <PassportPage flights={flights} trips={trips} />}
      {route.page === 'backup' && <BackupCenterPage flights={flights} allFlights={allFlights} trips={trips} tripMetadata={tripMetadata} allTripMetadata={allTripMetadata} providerAirports={providerAirportState} appMetadata={appMetadata} syncMetadata={syncMetadata} syncStatus={syncStatus} syncComparison={syncComparison} cloud={cloudControls} onImported={reloadLocalData} onExportBackup={handleExportFullBackup} onExportEncryptedBackup={handleExportEncryptedBackup} onMergeBackup={handleMergeBackup} onReplaceBackup={handleReplaceBackup} onRepairData={handleRepairData} onNavigateTrash={() => navigate('trash')} onCompareSync={authSession ? handleSyncCompare : undefined} />}
      {route.page === 'account' && <AccountPage configured={isSupabaseConfigured} authLoading={authLoading} session={authSession} authMessage={authMessage} appMetadata={appMetadata} cloudBackups={cloudBackups} showRestorePrompt={showCloudRestorePrompt} latestCloudBackup={latestCloudBackup} onGoogleSignIn={handleGoogleSignIn} onEmailSignIn={handleEmailSignIn} onSignOut={handleSignOut} onNavigateBackup={() => navigate('backup')} onRestoreLatest={() => latestCloudBackup ? handleCloudRestore(latestCloudBackup.id, 'replace') : Promise.resolve()} onDismissRestorePrompt={handleDismissCloudRestorePrompt} onSetCloudReminder={handleSetCloudReminder} onDeleteAllCloudBackups={handleCloudDeleteAll} />}
      {route.page === 'settings' && <SettingsPage configured={isSupabaseConfigured} authLoading={authLoading} session={authSession} authMessage={authMessage} settings={settings} syncMetadata={syncMetadata} flights={flights} allFlights={allFlights} allTripMetadata={allTripMetadata} providerAirports={providerAirportState} appMetadata={appMetadata} syncStatus={syncStatus} cloud={cloudControls} syncComparison={syncComparison} currentChecksum={currentBackupChecksum} liveApiStatus={liveApiStatus} standalone={isStandalone} installPromptAvailable={installPrompt.canPrompt} onInstallPrompt={installPrompt.promptInstall} onGoogleSignIn={handleGoogleSignIn} onEmailSignIn={handleEmailSignIn} onSignOut={handleSignOut} onSettingsChange={handleSettingsChange} onNavigateBackup={() => navigate('backup')} onNavigateSync={() => navigate('sync')} onNavigateTrash={() => navigate('trash')} onExportBackup={handleExportFullBackup} onRepairData={handleRepairData} onClearLocalData={handleClearLocalData} onRunLiveApiTest={handleRunLiveApiTest} onCompareSync={authSession ? handleSyncCompare : undefined} />}
      {route.page === 'sync' && <SyncPage configured={isSupabaseConfigured} session={authSession} cloudBackups={cloudBackups} syncMetadata={syncMetadata} status={syncStatus} comparison={syncComparison} syncEvents={syncEvents} syncDevices={syncDevices} deviceName={deviceName} busy={syncBusy} message={syncMessage} onCompare={handleSyncCompare} onCreateSafetyBackup={handleCreateSafetyBackup} onPushLocal={handleSyncPushLocalOnly} onPullRemote={handleSyncPullRemoteOnly} onPushTombstones={handleSyncPushTombstones} onPullTombstones={handleSyncPullTombstones} onSyncSafe={handleSyncSafeChanges} onResolveConflict={handleResolveConflict} onResolveAll={handleResolveAllConflicts} onMergeFields={handleMergeConflictFields} onRenameDevice={handleRenameDevice} onNavigateSettings={() => navigate('settings')} onNavigateBackup={() => navigate('backup')} />}
      {route.page === 'trash' && <TrashPage flights={deletedFlightList} tripMetadata={deletedTripMetadataList} busy={cloudBusy} signedIn={Boolean(authSession)} onRestore={handleRestoreDeletedFlight} onPermanentDelete={handlePermanentDeleteFlight} onRestoreSelected={handleRestoreDeletedFlights} onPermanentDeleteSelected={handlePermanentDeleteFlights} onEmptyTrash={handleEmptyTrash} onExport={handleExportDeletedRecord} onCreateSafetyBackup={handleCreateSafetyBackup} onNavigateSettings={() => navigate('settings')} />}
      <MobileMoreMenu open={mobileMoreOpen} route={route} onNavigate={navigate} onClose={() => setMobileMoreOpen(false)} />
      <nav className="bottom-nav" aria-label="Mobile navigation">
        <button type="button" className={mobileGroup === 'home' ? 'active' : ''} onClick={() => navigate('dashboard')}><Home aria-hidden="true" /> Home</button>
        <button type="button" className="bottom-add" onClick={openQuickAdd}><Plus aria-hidden="true" /> Add</button>
        <button type="button" className={mobileGroup === 'flights' ? 'active' : ''} onClick={() => navigate('flights')}><Plane aria-hidden="true" /> Flights</button>
        <button type="button" className={mobileGroup === 'trips' ? 'active' : ''} onClick={() => navigate('trips')}><CalendarDays aria-hidden="true" /> Trips</button>
        <button type="button" className={mobileGroup === 'more' || mobileMoreOpen ? 'active' : ''} onClick={() => setMobileMoreOpen((open) => !open)}><MoreHorizontal aria-hidden="true" /> More</button>
      </nav>
      <footer><strong>FlightLog</strong><span>personal flight passport</span><span>data stored locally in your browser</span></footer>
    </div>
    </AppSettingsContext.Provider>
  )
}

export default App
