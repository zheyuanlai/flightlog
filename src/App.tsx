import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import 'leaflet/dist/leaflet.css'
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Cloud,
  Download,
  Gauge,
  Globe2,
  Import,
  LogIn,
  LogOut,
  Map,
  Mail,
  Plane,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import {
  bulkSaveFlights,
  bulkSaveTripMetadata,
  bulkSetAppMetadata,
  deleteFlight,
  getAllAppMetadata,
  getFlights,
  getProviderAirports,
  getTripMetadata,
  LOCAL_SCHEMA_VERSION,
  migrateLegacyTripNames,
  providerAirportSnapshotsFromLiveStatus,
  replaceAppMetadata,
  replaceFlights,
  replaceProviderAirports,
  replaceTripMetadata,
  saveFlight,
  saveProviderAirports,
  saveTripMetadata,
  setAppMetadata,
} from './db'
import { sampleFlights } from './sampleData'
import type { AppMetadata, FlightLiveAirport, FlightLiveStatus, FlightLogEntry, FlightPurpose, FlightSource, FlightWithComputed, LookupDateRole, ProviderAirportSnapshot, TripMetadata, TripType } from './types'
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
  restoreCloudBackup,
  type CloudBackupSummary,
  type CloudBackupSnapshot,
} from './lib/cloudBackup'
import { airportCount, formatAirportOption, hasKnownAirport, loadGeneratedAirports, normalizeIata, searchAirports, setProviderAirports } from './utils/airports'
import { airlineDisplayName, airlineForFlight, airlineForLiveStatus } from './utils/airlines'
import { appMetadataValue, backupAgeWarning, createFullBackup, parseFullBackupJson, previewBackupImport, shouldShowFirstRunCloudRestorePrompt, type BackupImportPreview } from './utils/backup'
import { csvColumns, flightFromInput, flightsToCsv, parseFlightsCsv, parseFlightsJson, validateFlightInput } from './utils/csv'
import { analyzeDataHealth, repairFlightsFromAirportDataset } from './utils/dataHealth'
import { formatDate, formatDateTime, formatDistance, formatDuration } from './utils/dates'
import { computeFlight, routeKey } from './utils/flights'
import { canRefreshLiveStatus, fetchLiveStatus, normalizeFlightNumber, refreshStatusLabel } from './utils/liveStatus'
import { aggregateStats } from './utils/stats'
import { buildCalendarEventDetails } from './utils/calendarLinks'
import { externalFlightLinks } from './utils/externalFlightLinks'
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
import './App.css'

type Page = 'dashboard' | 'flights' | 'map' | 'passport' | 'trips' | 'backup' | 'account' | 'flight-detail' | 'trip-detail'
interface AppRoute {
  page: Page
  flightId?: string
  tripId?: string
}
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

const navItems: Array<{ page: Page; label: string }> = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'flights', label: 'Flights' },
  { page: 'trips', label: 'Trips' },
  { page: 'map', label: 'Map' },
  { page: 'passport', label: 'Passport' },
  { page: 'backup', label: 'Backup' },
  { page: 'account', label: 'Account' },
]

function routeFromHash(): AppRoute {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const [section, id] = hash.split('/')
  if (section === 'flights' && id) return { page: 'flight-detail', flightId: decodeURIComponent(id) }
  if (section === 'trips' && id) return { page: 'trip-detail', tripId: decodeURIComponent(id) }
  if (section === 'import') return { page: 'backup' }
  return navItems.some((item) => item.page === section) ? { page: section as Page } : { page: 'dashboard' }
}

function navPage(route: AppRoute): Page {
  if (route.page === 'flight-detail') return 'flights'
  if (route.page === 'trip-detail') return 'trips'
  return route.page
}

function formFromFlight(flight?: FlightLogEntry): FlightFormState {
  if (!flight) return { ...emptyForm }
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
  const key = 'flightlog-device-id'
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const next = crypto.randomUUID()
  window.localStorage.setItem(key, next)
  return next
}

function shortChecksum(checksum?: string): string {
  return checksum ? checksum.slice(0, 12) : 'not set'
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

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <article className="stat-card">
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
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
  const origin = liveAirport(liveStatus, 'origin')
  const destination = liveAirport(liveStatus, 'destination')
  const airline = airlineForLiveStatus(liveStatus)
  const departureTime = formatAirportLocalTime(
    liveStatus.scheduledDepartureLocal ?? liveStatus.times?.scheduledDepartureLocal ?? liveStatus.scheduledDeparture ?? liveStatus.times?.scheduledDeparture,
    liveStatus.originTimeZone ?? origin?.timezone ?? origin?.timeZone,
    `${origin?.iata ?? 'Origin'} local`,
    liveStatus.scheduledDepartureUtc ?? liveStatus.times?.scheduledDepartureUtc,
  )
  const arrivalTime = formatAirportLocalTime(
    liveStatus.scheduledArrivalLocal ?? liveStatus.times?.scheduledArrivalLocal ?? liveStatus.scheduledArrival ?? liveStatus.times?.scheduledArrival,
    liveStatus.destinationTimeZone ?? destination?.timezone ?? destination?.timeZone,
    `${destination?.iata ?? 'Destination'} local`,
    liveStatus.scheduledArrivalUtc ?? liveStatus.times?.scheduledArrivalUtc,
  )
  const estimatedDeparture = formatAirportLocalTime(
    liveStatus.estimatedDepartureLocal ?? liveStatus.times?.estimatedDepartureLocal ?? liveStatus.estimatedDeparture ?? liveStatus.times?.estimatedDeparture,
    liveStatus.originTimeZone ?? origin?.timezone ?? origin?.timeZone,
    `${origin?.iata ?? 'Origin'} local`,
    liveStatus.estimatedDepartureUtc ?? liveStatus.times?.estimatedDepartureUtc,
  )
  const estimatedArrival = formatAirportLocalTime(
    liveStatus.estimatedArrivalLocal ?? liveStatus.times?.estimatedArrivalLocal ?? liveStatus.estimatedArrival ?? liveStatus.times?.estimatedArrival,
    liveStatus.destinationTimeZone ?? destination?.timezone ?? destination?.timeZone,
    `${destination?.iata ?? 'Destination'} local`,
    liveStatus.estimatedArrivalUtc ?? liveStatus.times?.estimatedArrivalUtc,
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
        <div><dt>Fetched</dt><dd>{formatDateTime(fetchedAt)}</dd></div>
      </dl>
      {[departureTime.warning, arrivalTime.warning, estimatedDeparture.local ? estimatedDeparture.warning : undefined, estimatedArrival.local ? estimatedArrival.warning : undefined].filter((warning): warning is string => Boolean(warning)).map((warning, index) => <p className="notice warning" key={`time-${index}-${warning}`}>{warning}</p>)}
      {warnings.map((warning, index) => <p className="notice warning" key={`provider-${index}-${warning}`}>{warning}</p>)}
    </article>
  )
}

function FlightForm({
  editing,
  onCancel,
  onSaved,
  onProviderAirportsSaved,
}: {
  editing?: FlightLogEntry
  onCancel: () => void
  onSaved: (savedFlightId?: string) => Promise<void>
  onProviderAirportsSaved: (liveStatus: FlightLiveStatus) => Promise<void>
}) {
  const [mode, setMode] = useState<'lookup' | 'manual'>(editing ? 'manual' : 'lookup')
  const [lookup, setLookup] = useState({ flightNumber: '', date: new Date().toISOString().slice(0, 10), dateRole: 'Departure' as LookupDateRole, useMock: false })
  const [lookupStatus, setLookupStatus] = useState<FlightLiveStatus | undefined>()
  const [lookupFetchedAt, setLookupFetchedAt] = useState('')
  const [form, setForm] = useState<FlightFormState>(() => formFromFlight(editing))
  const [fetchedLiveStatus, setFetchedLiveStatus] = useState<FlightLiveStatus | undefined>(() => editing?.liveStatus)
  const [fetchedAt, setFetchedAt] = useState(editing?.lastFetchedAt ?? '')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const errors = validateFlightInput(form)
  const computedPreview = errors.length === 0 ? computeFlight(flightFromInput(form, editing)) : undefined

  async function handleLookup(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    setLookupStatus(undefined)
    try {
      const liveStatus = await fetchLiveStatus(lookup.flightNumber, lookup.date, { dateRole: lookup.dateRole, useMock: lookup.useMock })
      const nextFetchedAt = new Date().toISOString()
      setLookupStatus(liveStatus)
      setLookupFetchedAt(nextFetchedAt)
      await onProviderAirportsSaved(liveStatus)
      setMessage(liveStatusMessage(liveStatus))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to look up this flight')
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
    const seededForm = formWithLiveStatus({ ...emptyForm, date: lookup.date, flightNumber: normalizeFlightNumber(lookup.flightNumber) }, lookupStatus)
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
    setBusy(true)
    setMessage('')
    try {
      const liveStatus = await fetchLiveStatus(form.flightNumber, form.date, { dateRole: 'Departure' })
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
    <section className="panel form-panel" aria-label={editing ? 'Edit flight' : 'Add flight'}>
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
          <div className="form-grid compact">
            <label>Flight number<input value={lookup.flightNumber} onChange={(event) => setLookup({ ...lookup, flightNumber: event.target.value.toUpperCase() })} placeholder="SQ38" required /></label>
            <label>Date<input type="date" value={lookup.date} onChange={(event) => setLookup({ ...lookup, date: event.target.value })} required /></label>
            <label>Date role<select value={lookup.dateRole} onChange={(event) => setLookup({ ...lookup, dateRole: event.target.value as LookupDateRole })}><option value="Departure">Departure date</option><option value="Arrival">Arrival date</option></select></label>
            <label className="checkbox-row"><input type="checkbox" checked={lookup.useMock} onChange={(event) => setLookup({ ...lookup, useMock: event.target.checked })} /> Use demo lookup</label>
          </div>
          <div className="actions">
            <button type="submit" disabled={busy || !lookup.flightNumber || !lookup.date}><Search aria-hidden="true" /> Look up flight</button>
            <button type="button" className="secondary" onClick={() => setMode('manual')}><Plane aria-hidden="true" /> Add manually</button>
          </div>
          {lookupStatus && <LiveStatusPreview liveStatus={lookupStatus} fetchedAt={lookupFetchedAt} />}
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
            <label>Flight number<input value={form.flightNumber} onChange={(event) => setForm({ ...form, flightNumber: event.target.value.toUpperCase() })} placeholder="SQ38" required /></label>
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
            <strong>{computedPreview ? (computedPreview.hasRouteCoordinates ? formatDistance(computedPreview.distanceKm) : 'Distance unavailable') : 'Enter route to calculate distance'}</strong>
            <span>{computedPreview ? formatDuration(computedPreview.durationMinutes) : 'Duration appears when times are set'}</span>
          </div>
          {message && <p className="notice">{message}</p>}
          <div className="actions">
            <button type="button" className="secondary" onClick={handleFetchLive} disabled={busy || !form.flightNumber || !form.date}><RefreshCw aria-hidden="true" /> Fetch flight data</button>
            <button type="submit"><Plane aria-hidden="true" /> Save flight</button>
          </div>
        </form>
      )}
    </section>
  )
}

function UpcomingFlightCard({ info, onOpen, onRefresh }: { info: UpcomingFlightInfo; onOpen: (flight: FlightLogEntry) => void; onRefresh: (flight: FlightLogEntry) => Promise<void> }) {
  const { flight } = info
  const departure = formatDepartureLocalTime(flight)
  const arrival = formatArrivalLocalTime(flight)
  const airline = airlineForFlight(flight)
  const detailsUrl = `${window.location.href.split('#')[0]}#/flights/${encodeURIComponent(flight.id)}`
  const calendar = buildCalendarEventDetails(flight, detailsUrl)
  const links = externalFlightLinks(flight)
  return (
    <article className="flight-card upcoming-card">
      <div className="flight-main">
        <div><p className="eyebrow">{info.countdownLabel}</p><h3>{flight.flightNumber} - {airline?.name ?? flight.airline}</h3></div>
        <span className={`status ${flight.liveStatus?.status ?? 'unknown'}`}>{flight.liveStatus?.status ?? 'manual'}</span>
      </div>
      <div className="route-line"><strong>{flight.origin}</strong><span>{flight.originAirport?.city || flight.originAirport?.name}</span><ArrowRight aria-hidden="true" /><strong>{flight.destination}</strong><span>{flight.destinationAirport?.city || flight.destinationAirport?.name}</span></div>
      <dl className="meta-grid">
        <div><dt>Departure</dt><dd>{departure.label}</dd></div>
        <div><dt>Arrival</dt><dd>{arrival.label}</dd></div>
        <div><dt>Terminal / gate</dt><dd>{[flight.liveStatus?.departureTerminal, flight.liveStatus?.departureGate].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
        <div><dt>Aircraft</dt><dd>{[flight.aircraftType, flight.aircraftRegistration].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
        <div><dt>Last checked</dt><dd>{refreshStatusLabel(flight.lastFetchedAt)}</dd></div>
      </dl>
      {info.staleLabel && <p className={`notice ${info.staleSeverity === 'strong' ? 'warning' : ''}`}>{info.staleLabel}</p>}
      {info.gateHint && <p className="notice">{info.gateHint}</p>}
      <div className="actions">
        <button type="button" onClick={() => onOpen(flight)}>View details</button>
        <button type="button" className="secondary" disabled={!canRefreshLiveStatus(flight.lastFetchedAt)} onClick={() => onRefresh(flight)}><RefreshCw aria-hidden="true" /> Refresh status</button>
        {calendar.googleUrl && <a className="button-link secondary-link" href={calendar.googleUrl} target="_blank" rel="noopener noreferrer"><CalendarDays aria-hidden="true" /> Add to calendar</a>}
        {links[0] && <a className="button-link secondary-link" href={links[0].url} target="_blank" rel="noopener noreferrer">External links</a>}
      </div>
    </article>
  )
}

function Dashboard({
  flights,
  airportDatasetLabel,
  appMetadata,
  cloudRestorePrompt,
  onAddDemo,
  onQuickAdd,
  onOpenFlight,
  onRefresh,
}: {
  flights: FlightLogEntry[]
  airportDatasetLabel: string
  appMetadata: AppMetadata[]
  cloudRestorePrompt?: {
    latestLabel: string
    onRestoreLatest: () => Promise<void>
    onChooseBackup: () => void
    onStartFresh: () => Promise<void>
  }
  onAddDemo: () => Promise<void>
  onQuickAdd: () => void
  onOpenFlight: (flight: FlightLogEntry) => void
  onRefresh: (flight: FlightLogEntry) => Promise<void>
}) {
  const stats = aggregateStats(flights)
  const warning = backupAgeWarning(flights, appMetadata)
  const upcoming = listUpcomingFlights(flights).slice(0, 6)
  return (
    <main className="page">
      <section className="hero-shell">
        <div>
          <p className="eyebrow">FlightLog</p>
          <h1>Your personal flight passport.</h1>
          <p>Enter a flight number and departure date, preview real provider data, and save a complete route to your local passport.</p>
          <div className="hero-actions"><button type="button" onClick={onQuickAdd}><Search aria-hidden="true" /> Add by flight number</button><span>{airportDatasetLabel}</span></div>
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
            <button type="button" className="ghost" onClick={() => void cloudRestorePrompt.onStartFresh()}>Start fresh</button>
          </div>
        </section>
      )}
      {flights.length === 0 ? (
        <section className="empty-state"><Plane aria-hidden="true" /><h2>No flights logged yet</h2><p>Start with a live lookup or load demo flights to explore the app.</p><div className="actions"><button type="button" onClick={onQuickAdd}><Search aria-hidden="true" /> Add by flight number</button><button type="button" className="secondary" onClick={onAddDemo}><Plus aria-hidden="true" /> Load demo flights</button></div></section>
      ) : (
        <section className="stats-grid">
          <StatCard icon={Plane} label="Total flights" value={String(stats.totalFlights)} />
          <StatCard icon={Gauge} label="Total distance" value={formatDistance(stats.totalDistanceKm)} />
          <StatCard icon={Map} label="Airports" value={String(stats.airportsVisited.length)} />
          <StatCard icon={Globe2} label="Countries" value={String(stats.countriesVisited.length)} />
          <StatCard icon={Plane} label="Airlines" value={String(stats.airlines.length)} />
          <StatCard icon={ArrowRight} label="Longest flight" value={stats.longestFlight ? routeKey(stats.longestFlight) : 'None'} />
          <StatCard icon={CalendarDays} label="Most recent" value={stats.mostRecentFlight ? formatDate(stats.mostRecentFlight.date) : 'None'} />
        </section>
      )}
      {warning && <section className="notice warning backup-warning"><strong>Backup recommended.</strong> {warning}</section>}
      <section className="panel upcoming-panel">
        <div className="section-heading compact-heading"><div><p className="eyebrow">Upcoming</p><h2>Upcoming flights</h2></div></div>
        <div className="stack">
          {upcoming.map((info) => <UpcomingFlightCard key={info.flight.id} info={info} onOpen={onOpenFlight} onRefresh={onRefresh} />)}
          {upcoming.length === 0 && <p className="empty-inline">No upcoming flights yet.</p>}
        </div>
      </section>
    </main>
  )
}

function FlightCard({
  flight,
  onOpen,
  onEdit,
  onDelete,
  onRefresh,
}: {
  flight: FlightWithComputed
  onOpen: (flight: FlightLogEntry) => void
  onEdit: (flight: FlightLogEntry) => void
  onDelete: (id: string) => Promise<void>
  onRefresh: (flight: FlightLogEntry) => Promise<void>
}) {
  const liveStatusLabel = flight.liveStatus?.status ?? 'manual'
  const providerLabel = flight.liveStatus?.provider ? ` via ${flight.liveStatus.provider}` : ''
  const lastFetchedLabel = refreshStatusLabel(flight.lastFetchedAt)
  const warnings = flight.providerWarnings ?? flight.liveStatus?.warnings ?? (flight.liveStatus?.warning ? [flight.liveStatus.warning] : [])
  const departure = formatDepartureLocalTime(flight)
  const arrival = formatArrivalLocalTime(flight)
  const refreshAvailable = canRefreshLiveStatus(flight.lastFetchedAt)
  const airline = airlineForFlight(flight)
  return (
    <article className="flight-card">
      <div className="flight-main"><div><p className="eyebrow">{getFlightDepartureLocalDate(flight)}{airline?.country ? ` · ${airline.country}` : ''}</p><h3><button type="button" className="link-button" onClick={() => onOpen(flight)}>{flight.flightNumber} - {airline?.name ?? flight.airline}</button></h3></div><span className={`status ${flight.liveStatus?.status ?? 'unknown'}`}>{liveStatusLabel}{providerLabel}</span></div>
      <div className="route-line"><strong>{flight.origin}</strong><span>{flight.originAirport?.city || flight.originAirport?.name}</span><ArrowRight aria-hidden="true" /><strong>{flight.destination}</strong><span>{flight.destinationAirport?.city || flight.destinationAirport?.name}</span></div>
      <dl className="meta-grid">
        <div><dt>Departure local</dt><dd>{departure.label}</dd></div>
        <div><dt>Arrival local</dt><dd>{arrival.label}</dd></div>
        <div><dt>Distance</dt><dd>{flight.hasRouteCoordinates ? formatDistance(flight.distanceKm) : 'Unavailable'}</dd></div>
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
        <button type="button" className="ghost" onClick={() => onEdit(flight)}>Edit</button>
        <button type="button" className="ghost danger" onClick={() => onDelete(flight.id)}><Trash2 aria-hidden="true" /> Delete</button>
        <button type="button" className="secondary" disabled={!refreshAvailable} onClick={() => onRefresh(flight)}><RefreshCw aria-hidden="true" /> {refreshAvailable ? 'Refresh status' : 'Refresh guarded'}</button>
      </div>
    </article>
  )
}

function FlightsPage({ flights, airportVersion, onOpen, onEdit, onDelete, onRefresh, onQuickAdd }: { flights: FlightLogEntry[]; airportVersion: number; onOpen: (flight: FlightLogEntry) => void; onEdit: (flight: FlightLogEntry) => void; onDelete: (id: string) => Promise<void>; onRefresh: (flight: FlightLogEntry) => Promise<void>; onQuickAdd: () => void }) {
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
      <div className="stack">{filtered.map((flight) => <FlightCard key={flight.id} flight={flight} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onRefresh={onRefresh} />)}{filtered.length === 0 && <p className="empty-inline">No matching flights.</p>}</div>
    </main>
  )
}

function FlightTimeline({ flight }: { flight: FlightLogEntry }) {
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
          const time = resolveFlightTime(flight, row.kind, row.direction)
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
  return (
    <section className="panel route-preview">
      <div className="section-heading compact-heading"><div><p className="eyebrow">Route preview</p><h3>{flight.origin} to {flight.destination}</h3></div></div>
      <div className="route-mini-map" aria-label={`${flight.origin} to ${flight.destination} route preview`}>
        <span>{flight.origin}</span>
        <div />
        <span>{flight.destination}</span>
      </div>
      <p className="muted">{flight.hasRouteCoordinates ? `${formatDistance(flight.distanceKm)} great-circle distance` : 'Airport coordinates unavailable for this route.'}</p>
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
  return (
    <article className="flight-card trip-card">
      <div className="flight-main">
        <div>
          <p className="eyebrow">{trip.startDate} to {trip.endDate}</p>
          <input className="inline-name-input" value={trip.name} onChange={(event) => onUpdate(trip.id, { name: event.target.value })} aria-label="Trip name" />
        </div>
        <span className="status scheduled">{trip.isFavorite ? 'Pinned · ' : ''}{trip.flights.length} flight{trip.flights.length === 1 ? '' : 's'}</span>
      </div>
      <div className="route-line"><strong>{trip.routeSummary.split(' -> ')[0]}</strong><span>{trip.routeSummary}</span><ArrowRight aria-hidden="true" /><strong>{trip.routeSummary.split(' -> ').at(-1)}</strong><span>{trip.countries.join(', ') || 'Countries unavailable'}</span></div>
      <dl className="meta-grid">
        <div><dt>Total distance</dt><dd>{formatDistance(trip.distanceKm)}</dd></div>
        <div><dt>Airports</dt><dd>{trip.airports.join(', ')}</dd></div>
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
}: {
  trips: TripGroup[]
  onOpen: (trip: TripGroup) => void
  onUpdate: (tripId: string, patch: Partial<TripMetadata>) => void
}) {
  return (
    <main className="page">
      <div className="section-heading"><div><p className="eyebrow">Trips</p><h2>Grouped journeys</h2></div></div>
      <div className="stack">
        {trips.map((trip) => <TripCard key={trip.id} trip={trip} onOpen={onOpen} onUpdate={onUpdate} />)}
        {trips.length === 0 && <p className="empty-inline">Log flights to build your first trip.</p>}
      </div>
    </main>
  )
}

function TripDetailPage({
  trip,
  onBack,
  onOpenFlight,
  onUpdate,
}: {
  trip?: TripGroup
  onBack: () => void
  onOpenFlight: (flight: FlightLogEntry) => void
  onUpdate: (tripId: string, patch: Partial<TripMetadata>) => void
}) {
  if (!trip) {
    return <main className="page"><section className="empty-state"><Plane aria-hidden="true" /><h2>Trip not found</h2><button type="button" onClick={onBack}>Back to trips</button></section></main>
  }
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
        <div className="route-mini-map trip-route"><span>{trip.routeSummary}</span></div>
        <dl className="meta-grid">
          <div><dt>Flights</dt><dd>{trip.flights.length}</dd></div>
          <div><dt>Total distance</dt><dd>{formatDistance(trip.distanceKm)}</dd></div>
          <div><dt>Airports</dt><dd>{trip.airports.join(', ')}</dd></div>
          <div><dt>Countries</dt><dd>{trip.countries.join(', ') || 'Not set'}</dd></div>
          <div><dt>Trip type</dt><dd><select value={trip.type} onChange={(event) => onUpdate(trip.id, { type: event.target.value as TripType })}><option value="personal">Personal</option><option value="work">Work</option><option value="school">School</option><option value="other">Other</option></select></dd></div>
          <div><dt>Favorite</dt><dd><label className="checkbox-row"><input type="checkbox" checked={trip.isFavorite} onChange={(event) => onUpdate(trip.id, { isFavorite: event.target.checked })} /> Pin trip</label></dd></div>
        </dl>
        <label className="wide trip-notes">Trip notes<textarea value={trip.notes ?? ''} onChange={(event) => onUpdate(trip.id, { notes: event.target.value })} rows={3} placeholder="Trip notes, purpose, memories..." /></label>
      </section>
      <div className="stack">
        {trip.flights.map((flight) => (
          <article className="flight-card" key={flight.id}>
            <div className="flight-main"><div><p className="eyebrow">{getFlightDepartureLocalDate(flight)}</p><h3>{flight.flightNumber} - {flight.airline}</h3></div><span className="status scheduled">{flight.origin}{' -> '}{flight.destination}</span></div>
            <dl className="meta-grid"><div><dt>Departure</dt><dd>{formatDepartureLocalTime(flight).label}</dd></div><div><dt>Arrival</dt><dd>{formatArrivalLocalTime(flight).label}</dd></div><div><dt>Distance</dt><dd>{formatDistance(flight.distanceKm)}</dd></div></dl>
            <div className="actions"><button type="button" onClick={() => onOpenFlight(flight)}>View flight</button></div>
          </article>
        ))}
      </div>
    </main>
  )
}

function FlightDetailPage({
  flight,
  airportVersion,
  onBack,
  onEdit,
  onDelete,
  onRefresh,
}: {
  flight?: FlightLogEntry
  airportVersion: number
  onBack: () => void
  onEdit: (flight: FlightLogEntry) => void
  onDelete: (id: string) => Promise<void>
  onRefresh: (flight: FlightLogEntry) => Promise<void>
}) {
  const computed = useMemo(() => {
    void airportVersion
    return flight ? computeFlight(flight) : undefined
  }, [flight, airportVersion])
  if (!flight || !computed) {
    return <main className="page"><section className="empty-state"><Plane aria-hidden="true" /><h2>Flight not found</h2><button type="button" onClick={onBack}>Back to flights</button></section></main>
  }
  const departure = formatDepartureLocalTime(flight)
  const arrival = formatArrivalLocalTime(flight)
  const warnings = [...(flight.providerWarnings ?? []), ...(departure.warning ? [departure.warning] : []), ...(arrival.warning ? [arrival.warning] : [])]
  const refreshAvailable = canRefreshLiveStatus(flight.lastFetchedAt)
  const refreshLabel = refreshStatusLabel(flight.lastFetchedAt)
  return (
    <main className="page detail-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{getFlightDepartureLocalDate(flight)} · {flight.source}</p>
          <h2>{flight.flightNumber} - {flight.airline}</h2>
        </div>
        <div className="heading-actions">
          <button type="button" className="ghost" onClick={onBack}>Back</button>
          <button type="button" className="secondary" onClick={() => onEdit(flight)}>Edit</button>
          <button type="button" className="secondary" disabled={!refreshAvailable} onClick={() => onRefresh(flight)}><RefreshCw aria-hidden="true" /> {refreshAvailable ? 'Refresh status' : refreshLabel}</button>
          <button type="button" className="ghost danger" onClick={() => onDelete(flight.id)}><Trash2 aria-hidden="true" /> Delete</button>
        </div>
      </div>
      <section className="panel detail-hero">
        <div className="flight-main">
          <div className="route-line detail-route"><strong>{flight.origin}</strong><span>{computed.originAirport?.name}</span><ArrowRight aria-hidden="true" /><strong>{flight.destination}</strong><span>{computed.destinationAirport?.name}</span></div>
          <span className={`status ${flight.liveStatus?.status ?? 'unknown'}`}>{flight.liveStatus?.status ?? 'manual'}</span>
        </div>
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
        <div className="actions">
          <button type="button" className="secondary" onClick={() => downloadFile(`${flight.flightNumber}-${flight.id}.json`, JSON.stringify({ flight }, null, 2), 'application/json')}><Download aria-hidden="true" /> Export this flight as JSON</button>
        </div>
      </section>
      <div className="two-columns detail-columns">
        <FlightTimeline flight={flight} />
        <RouteMapPreview flight={computed} />
      </div>
      <CalendarSection flight={flight} />
      <ExternalLinksSection flight={flight} />
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
    void import('leaflet').then((L) => {
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
  const stats = aggregateStats(flights)
  const longestFlights = flights.map(computeFlight).filter((flight) => flight.distanceKm > 0).sort((a, b) => b.distanceKm - a.distanceKm).slice(0, 5)
  const favoriteAirline = stats.topAirlines[0]
  const favoriteRoute = stats.topRoutes[0]
  const upcomingTripCount = trips.filter(tripHasUpcomingFlight).length
  const latestTrip = trips[0]
  const longestTrip = trips.slice().sort((a, b) => b.distanceKm - a.distanceKm)[0]
  const mostFlightsTrip = trips.slice().sort((a, b) => b.flights.length - a.flights.length)[0]
  return (
    <main className="page passport">
      <div className="passport-cover"><p className="eyebrow">Digital passport</p><h2>Lifetime travel record</h2><div className="passport-number">{stats.totalFlights.toString().padStart(3, '0')} flights</div></div>
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
          longestTrip ? `Longest: ${longestTrip.name} - ${formatDistance(longestTrip.distanceKm)}` : '',
          mostFlightsTrip ? `Most flights: ${mostFlightsTrip.name} - ${mostFlightsTrip.flights.length}` : '',
        ].filter(Boolean)} />
        <ListPanel title="Unlocked" rows={[`${stats.countriesVisited.length} countries`, `${stats.airportsVisited.length} airports`, `${stats.airlines.length} airlines`]} />
        <ListPanel title="Top airlines" rows={stats.topAirlines.slice(0, 8).map((row) => `${airlineDisplayName(row.airline)}: ${row.count}`)} />
      </section>
      <section className="three-columns"><ListPanel title="Yearly summary" rows={stats.yearly.map((row) => `${row.year}: ${row.flights} flights - ${formatDistance(row.distanceKm)}`)} /><ListPanel title="Top airports" rows={stats.topAirports.slice(0, 8).map((row) => `${row.code}: ${row.count} visits - ${row.label}`)} /><ListPanel title="Most frequent routes" rows={stats.topRoutes.slice(0, 8).map((row) => `${row.route}: ${row.count} - ${formatDistance(row.distanceKm)}`)} /></section>
      <section className="three-columns"><ListPanel title="Longest flights" rows={longestFlights.map((flight) => `${routeKey(flight)} - ${formatDistance(flight.distanceKm)}`)} /><ListPanel title="Aircraft" rows={stats.aircraftTypes} /><ListPanel title="Favorite trips" rows={trips.filter((trip) => trip.isFavorite).slice(0, 8).map((trip) => `${trip.name}: ${trip.routeSummary}`)} /></section>
      <section className="two-columns"><ListPanel title="Countries unlocked" rows={stats.countriesVisited} /><ListPanel title="First-time badges" rows={stats.airportsVisited.slice(0, 8).map((airport) => `First logged ${airport.iata} - ${airport.country}`)} /></section>
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
              <div><dt>Latest backup</dt><dd>{latestCloudBackup ? formatDateTime(latestCloudBackup.createdAt) : 'None'}</dd></div>
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
              <p className="muted">This browser has no local flights. Latest backup: {latestCloudBackup.label || 'Cloud backup'} from {formatDateTime(latestCloudBackup.createdAt)}.</p>
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
  onUpload: (label: string) => Promise<void>
  onRefresh: () => Promise<void>
  onPreview: (id: string) => Promise<void>
  onRestore: (id: string, mode: 'merge' | 'replace') => Promise<void>
  onDownload: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onDeleteAll: () => Promise<void>
  onKeepLatest: () => Promise<void>
  onClearPreview: () => void
}

function CloudBackupSection({ cloud, appMetadata }: { cloud: CloudBackupControls; appMetadata: AppMetadata[] }) {
  const [label, setLabel] = useState('')
  const lastCloudBackupAt = appMetadataValue(appMetadata, 'lastCloudBackupAt')
  const reminderEnabled = appMetadataValue(appMetadata, 'cloudBackupReminderEnabled') !== 'false'
  const localChanged = reminderEnabled && hasLocalDataChangedSinceCloudBackup(cloud.currentChecksum, appMetadataValue(appMetadata, 'lastCloudBackupChecksum'))

  async function upload() {
    await cloud.onUpload(label)
    setLabel('')
  }

  return (
    <section className="panel cloud-panel">
      <div className="section-heading compact-heading">
        <div><p className="eyebrow">Cloud Backup</p><h3>Supabase snapshots</h3></div>
        <button type="button" className="ghost" onClick={cloud.onNavigateAccount}>Account</button>
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
            <div><dt>Cloud backups</dt><dd>{cloud.backups.length}</dd></div>
            <div><dt>Last cloud backup</dt><dd>{lastCloudBackupAt ? formatDateTime(lastCloudBackupAt) : 'Never'}</dd></div>
            <div><dt>Current checksum</dt><dd>{shortChecksum(cloud.currentChecksum)}</dd></div>
          </dl>
          {localChanged && <p className="notice warning">Local data has changed since your last cloud backup.</p>}
          <div className="form-grid compact">
            <label>Backup label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Before trip to Tokyo" /></label>
          </div>
          <div className="actions">
            <button type="button" disabled={cloud.busy} onClick={() => void upload()}><Cloud aria-hidden="true" /> Upload backup</button>
            <button type="button" className="secondary" disabled={cloud.busy} onClick={() => void cloud.onRefresh()}><RefreshCw aria-hidden="true" /> Refresh list</button>
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
                <div><dt>Checksum</dt><dd>{shortChecksum(cloud.preview.snapshot.checksum)}</dd></div>
                <div><dt>Created</dt><dd>{formatDateTime(cloud.preview.snapshot.createdAt)}</dd></div>
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
                  <div><p className="eyebrow">{formatDateTime(backup.createdAt)}</p><h3>{backup.label || 'Cloud backup'}</h3></div>
                  <span className="status scheduled">schema v{backup.schemaVersion}</span>
                </div>
                <dl className="meta-grid">
                  <div><dt>Flights</dt><dd>{backup.flightCount}</dd></div>
                  <div><dt>Trip metadata</dt><dd>{backup.tripMetadataCount}</dd></div>
                  <div><dt>Provider airports</dt><dd>{backup.providerAirportCount}</dd></div>
                  <div><dt>Checksum</dt><dd>{shortChecksum(backup.checksum)}</dd></div>
                  <div><dt>Device</dt><dd>{backup.deviceId ?? 'Not set'}</dd></div>
                  <div><dt>Exported</dt><dd>{backup.exportedAt ? formatDateTime(backup.exportedAt) : 'Not set'}</dd></div>
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
  trips,
  tripMetadata,
  providerAirports,
  appMetadata,
  cloud,
  onImported,
  onExportBackup,
  onMergeBackup,
  onReplaceBackup,
  onRepairData,
}: {
  flights: FlightLogEntry[]
  trips: TripGroup[]
  tripMetadata: TripMetadata[]
  providerAirports: ProviderAirportSnapshot[]
  appMetadata: AppMetadata[]
  cloud: CloudBackupControls
  onImported: () => Promise<void>
  onExportBackup: () => Promise<void>
  onMergeBackup: (preview: BackupImportPreview) => Promise<void>
  onReplaceBackup: (preview: BackupImportPreview) => Promise<void>
  onRepairData: () => Promise<void>
}) {
  const [preview, setPreview] = useState<{ valid: FlightLogEntry[]; errors: string[] }>({ valid: [], errors: [] })
  const [backupPreview, setBackupPreview] = useState<BackupImportPreview | undefined>()
  const [backupMessage, setBackupMessage] = useState('')
  const health = analyzeDataHealth(flights)
  const lastBackupAt = appMetadataValue(appMetadata, 'lastBackupAt')
  const lastImportAt = appMetadataValue(appMetadata, 'lastImportAt')
  async function handleFile(file: File) {
    const text = await file.text()
    setPreview(file.name.endsWith('.json') ? parseFlightsJson(text) : parseFlightsCsv(text))
  }
  async function handleBackupFile(file: File) {
    setBackupMessage('')
    try {
      const backup = parseFullBackupJson(await file.text())
      setBackupPreview(previewBackupImport(backup, flights))
    } catch (error) {
      setBackupPreview(undefined)
      setBackupMessage(error instanceof Error ? error.message : 'Unable to read backup file')
    }
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
        <StatCard icon={Map} label="Trips" value={String(trips.length)} />
        <StatCard icon={Gauge} label="Trip metadata" value={String(tripMetadata.length)} />
        <StatCard icon={Globe2} label="Provider airports" value={String(providerAirports.length)} />
        <StatCard icon={CalendarDays} label="Schema version" value={`v${LOCAL_SCHEMA_VERSION}`} />
        <StatCard icon={Download} label="Last backup" value={lastBackupAt ? formatDateTime(lastBackupAt) : 'Never'} />
        <StatCard icon={Import} label="Last import" value={lastImportAt ? formatDateTime(lastImportAt) : 'Never'} />
      </section>
      <CloudBackupSection cloud={cloud} appMetadata={appMetadata} />
      <section className="two-columns">
        <article className="panel">
          <h3>Full backup</h3>
          <p className="muted">Exports flights, trip metadata, provider airports, app metadata, schema version, and export time.</p>
          <div className="actions"><button type="button" onClick={() => void onExportBackup()}><Download aria-hidden="true" /> Export full backup</button></div>
        </article>
        <article className="panel">
          <h3>Restore backup</h3>
          <p className="muted">Preview a full backup before merging or replacing local data.</p>
          <label className="file-drop"><Upload aria-hidden="true" /><span>Choose backup JSON</span><input type="file" accept=".json,application/json" onChange={(event) => event.target.files?.[0] && void handleBackupFile(event.target.files[0])} /></label>
        </article>
      </section>
      {backupMessage && <p className="notice">{backupMessage}</p>}
      {backupPreview && (
        <section className="panel">
          <h3>Backup import preview</h3>
          <dl className="meta-grid">
            <div><dt>Flights to add</dt><dd>{backupPreview.flightsToAdd}</dd></div>
            <div><dt>Existing flights</dt><dd>{backupPreview.existingFlights}</dd></div>
            <div><dt>Likely duplicates</dt><dd>{backupPreview.duplicateFlights}</dd></div>
            <div><dt>Trip metadata</dt><dd>{backupPreview.tripMetadata}</dd></div>
            <div><dt>Provider airports</dt><dd>{backupPreview.providerAirports}</dd></div>
            <div><dt>Exported</dt><dd>{formatDateTime(backupPreview.backup.exportedAt)}</dd></div>
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
        </dl>
        <div className="actions"><button type="button" className="secondary" disabled={health.repairableAirportSnapshotCount === 0} onClick={() => void onRepairData()}>Re-resolve airport snapshots</button></div>
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

function App() {
  const [route, setRoute] = useState<AppRoute>(routeFromHash)
  const [flights, setFlights] = useState<FlightLogEntry[]>([])
  const [editing, setEditing] = useState<FlightLogEntry | undefined>()
  const [showForm, setShowForm] = useState(false)
  const [toast, setToast] = useState('')
  const [airportVersion, setAirportVersion] = useState(0)
  const [airportDatasetLabel, setAirportDatasetLabel] = useState(`${airportCount()} airport fallback loaded`)
  const [providerAirportState, setProviderAirportState] = useState<ProviderAirportSnapshot[]>([])
  const [tripMetadata, setTripMetadataState] = useState<TripMetadata[]>([])
  const [appMetadata, setAppMetadataState] = useState<AppMetadata[]>([])
  const [authSession, setAuthSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [authMessage, setAuthMessage] = useState('')
  const [cloudBackups, setCloudBackups] = useState<CloudBackupSummary[]>([])
  const [cloudBusy, setCloudBusy] = useState(false)
  const [cloudMessage, setCloudMessage] = useState('')
  const [cloudPreview, setCloudPreview] = useState<{ snapshot: CloudBackupSnapshot; preview: BackupImportPreview } | undefined>()
  const [currentBackupChecksum, setCurrentBackupChecksum] = useState<string | undefined>()
  const trips = useMemo(() => groupFlightsIntoTrips(flights, tripMetadata), [flights, tripMetadata])
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
    setFlights(await getFlights())
  }

  async function loadTripMetadata() {
    setTripMetadataState(await getTripMetadata())
  }

  async function loadAppMetadata() {
    setAppMetadataState(await getAllAppMetadata())
  }

  async function refreshProviderAirports() {
    const airports = await getProviderAirports()
    setProviderAirports(airports)
    setProviderAirportState(airports)
    setAirportVersion((version) => version + 1)
  }

  async function reloadLocalData() {
    await Promise.all([loadFlights(), refreshProviderAirports(), loadTripMetadata(), loadAppMetadata()])
  }

  async function buildCurrentFullBackup(exportedAt = new Date().toISOString()) {
    return createFullBackup({
      flights: await getFlights(),
      tripMetadata: await getTripMetadata(),
      providerAirports: await getProviderAirports(),
      appMetadata: await getAllAppMetadata(),
      exportedAt,
    })
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
    void getFlights().then((loadedFlights) => {
      if (mounted) setFlights(loadedFlights)
    })
    void getProviderAirports().then((airports) => {
      if (!mounted) return
      setProviderAirports(airports)
      setProviderAirportState(airports)
      setAirportVersion((version) => version + 1)
    })
    void migrateLegacyTripNames(legacyTripNamesFromLocalStorage()).then((metadata) => {
      if (mounted) setTripMetadataState(metadata)
    })
    void getAllAppMetadata().then((metadata) => {
      if (mounted) setAppMetadataState(metadata)
    })
    void loadGeneratedAirports()
      .then((count) => {
        if (!mounted) return
        setAirportDatasetLabel(`${count.toLocaleString()} airports loaded`)
        setAirportVersion((version) => version + 1)
      })
      .catch(() => {
        if (mounted) setAirportDatasetLabel(`${airportCount().toLocaleString()} airport fallback loaded`)
      })
    const onHashChange = () => setRoute(routeFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => {
      mounted = false
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let mounted = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return
      if (error) setAuthMessage(error.message)
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
    let cancelled = false
    const backup = createFullBackup({
      flights,
      tripMetadata,
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
  }, [flights, tripMetadata, providerAirportState, appMetadata])

  function navigate(next: Page) {
    window.location.hash = `/${next}`
    setRoute({ page: next })
  }

  function navigateToFlight(id: string) {
    window.location.hash = `/flights/${encodeURIComponent(id)}`
    setRoute({ page: 'flight-detail', flightId: id })
  }

  function navigateToTrip(id: string) {
    window.location.hash = `/trips/${encodeURIComponent(id)}`
    setRoute({ page: 'trip-detail', tripId: id })
  }

  function openQuickAdd() {
    setEditing(undefined)
    setShowForm(true)
  }

  async function handleDelete(id: string) {
    await deleteFlight(id)
    await loadFlights()
    if (route.page === 'flight-detail' && route.flightId === id) navigate('flights')
  }

  async function handleRefresh(flight: FlightLogEntry) {
    try {
      if (!canRefreshLiveStatus(flight.lastFetchedAt)) {
        setToast('Refresh available in a few minutes.')
        return
      }
      const liveStatus = await fetchLiveStatus(flight.flightNumber, flight.date, { dateRole: flight.lookupDateRole ?? 'Departure' })
      const fetchedAt = new Date().toISOString()
      await saveFlight(enrichFlightWithLiveStatus(flight, liveStatus, fetchedAt, flight.lookupDateRole ?? 'Departure'))
      await cacheProviderAirports(liveStatus)
      setToast(`Updated just now: ${flight.flightNumber} is ${liveStatus.status}`)
      await loadFlights()
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Unable to refresh live status')
    }
  }

  async function addDemoFlights() {
    await bulkSaveFlights(sampleFlights)
    await loadFlights()
    setToast('Demo flights loaded.')
  }

  async function handleSavedFlight(savedFlightId?: string) {
    await loadFlights()
    if (savedFlightId) navigateToFlight(savedFlightId)
  }

  async function handleTripMetadataUpdate(tripId: string, patch: Partial<TripMetadata>) {
    await saveTripMetadata({ id: tripId, ...patch })
    await loadTripMetadata()
  }

  async function handleExportFullBackup() {
    const now = new Date().toISOString()
    const appMetadataForBackup = [
      ...(await getAllAppMetadata()).filter((item) => item.key !== 'lastBackupAt'),
      { key: 'lastBackupAt', value: now, updatedAt: now },
    ]
    const backup = createFullBackup({
      flights: await getFlights(),
      tripMetadata: await getTripMetadata(),
      providerAirports: await getProviderAirports(),
      appMetadata: appMetadataForBackup,
      exportedAt: now,
    })
    downloadFile(`flightlog-backup-${now.slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json')
    await setAppMetadata('lastBackupAt', now)
    await loadAppMetadata()
    setToast('Full backup exported.')
  }

  async function handleMergeBackup(preview: BackupImportPreview) {
    const now = new Date().toISOString()
    if (preview.mergeFlights.length > 0) await bulkSaveFlights(preview.mergeFlights)
    await saveProviderAirports(preview.backup.providerAirports)
    await bulkSaveTripMetadata(preview.backup.tripMetadata)
    await bulkSetAppMetadata([
      ...importableAppMetadata(preview.backup.appMetadata),
      { key: 'lastImportAt', value: now, updatedAt: now },
    ])
    await reloadLocalData()
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
    setToast(`Restored ${preview.backup.flights.length} flights from backup.`)
  }

  async function handleRepairData() {
    await bulkSaveFlights(repairFlightsFromAirportDataset(flights))
    await loadFlights()
    setAirportVersion((version) => version + 1)
    setToast('Airport snapshots re-resolved where local data was available.')
  }

  async function handleGoogleSignIn() {
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
    if (error) setAuthMessage(error.message)
  }

  async function handleEmailSignIn(email: string) {
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
    setAuthMessage(error ? error.message : 'Check your email for a FlightLog magic link.')
  }

  async function handleSignOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    setAuthMessage(error ? error.message : 'Signed out. Local data was not deleted.')
  }

  async function handleCloudUpload(label: string) {
    setCloudBusy(true)
    setCloudMessage('')
    try {
      const now = new Date().toISOString()
      const backup = await buildCurrentFullBackup(now)
      const uploaded = await createCloudBackupSnapshot({
        client: supabase,
        userId: authSession?.user.id,
        backup,
        label,
        deviceId: localDeviceId(),
        appVersion: 'v1.6',
      })
      await bulkSetAppMetadata([
        { key: 'lastCloudBackupAt', value: uploaded.createdAt, updatedAt: now },
        { key: 'lastCloudBackupChecksum', value: uploaded.checksum ?? await computeBackupChecksum(backup), updatedAt: now },
        { key: 'lastCloudBackupId', value: uploaded.id, updatedAt: now },
      ])
      await Promise.all([loadAppMetadata(), loadCloudBackups()])
      setCloudMessage('Cloud backup uploaded.')
      setToast('Cloud backup uploaded.')
    } catch (error) {
      setCloudMessage(cloudBackupErrorMessage(error, 'Unable to upload cloud backup.'))
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleCloudPreview(id: string) {
    setCloudBusy(true)
    setCloudMessage('')
    try {
      const snapshot = await getCloudBackup(supabase, id)
      setCloudPreview({ snapshot, preview: previewBackupImport(snapshot.backup, flights) })
    } catch (error) {
      setCloudMessage(cloudBackupErrorMessage(error, 'Unable to preview cloud backup.'))
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleCloudRestore(id: string, mode: 'merge' | 'replace') {
    const replacing = mode === 'replace'
    if (replacing && flights.length > 0 && !window.confirm('Replace all local FlightLog data with this cloud backup?')) return
    setCloudBusy(true)
    setCloudMessage('')
    try {
      const restore = await restoreCloudBackup({ client: supabase, id, existingFlights: flights, mode })
      if (restore.mode === 'merge') await handleMergeBackup(restore.preview)
      else await handleReplaceBackup(restore.preview)
      const now = new Date().toISOString()
      await setAppMetadata('lastCloudRestoreAt', now)
      await reloadLocalData()
      setCloudPreview(undefined)
      setCloudMessage(restore.mode === 'merge' ? 'Cloud backup merged into local data.' : 'Local data replaced from cloud backup.')
    } catch (error) {
      setCloudMessage(cloudBackupErrorMessage(error, 'Unable to restore cloud backup.'))
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleCloudDownload(id: string) {
    setCloudBusy(true)
    setCloudMessage('')
    try {
      const snapshot = await getCloudBackup(supabase, id)
      downloadFile(`flightlog-cloud-backup-${snapshot.createdAt.slice(0, 10)}.json`, JSON.stringify(snapshot.backup, null, 2), 'application/json')
    } catch (error) {
      setCloudMessage(cloudBackupErrorMessage(error, 'Unable to download cloud backup.'))
    } finally {
      setCloudBusy(false)
    }
  }

  async function handleCloudDelete(id: string) {
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
    if (!window.confirm('Delete all cloud backups for this signed-in account? Local data will not be deleted.')) return
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
    if (!window.confirm('Delete older cloud backups and keep the latest 10?')) return
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
    await setAppMetadata('cloudBackupReminderEnabled', enabled ? 'true' : 'false')
    await loadAppMetadata()
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
    onUpload: handleCloudUpload,
    onRefresh: () => loadCloudBackups(),
    onPreview: handleCloudPreview,
    onRestore: handleCloudRestore,
    onDownload: handleCloudDownload,
    onDelete: handleCloudDelete,
    onDeleteAll: handleCloudDeleteAll,
    onKeepLatest: handleCloudKeepLatest,
    onClearPreview: () => setCloudPreview(undefined),
  }

  return (
    <div className="app-shell">
      <header>
        <button type="button" className="brand" onClick={() => navigate('dashboard')}><Plane aria-hidden="true" /><span>FlightLog</span></button>
        <nav aria-label="Primary navigation">{navItems.map((item) => <button key={item.page} type="button" className={navPage(route) === item.page ? 'active' : ''} onClick={() => navigate(item.page)}>{item.label}</button>)}</nav>
        <button type="button" onClick={openQuickAdd}><Plus aria-hidden="true" /> Add flight</button>
      </header>
      {toast && <div className="toast" role="status"><span>{toast}</span><button type="button" onClick={() => setToast('')}>Dismiss</button></div>}
      {showForm && <FlightForm editing={editing} onCancel={() => { setShowForm(false); setEditing(undefined) }} onSaved={handleSavedFlight} onProviderAirportsSaved={cacheProviderAirports} />}
      {route.page === 'dashboard' && <Dashboard flights={flights} airportDatasetLabel={airportDatasetLabel} appMetadata={appMetadata} cloudRestorePrompt={showCloudRestorePrompt && latestCloudBackup ? { latestLabel: `${latestCloudBackup.label || 'Cloud backup'} from ${formatDateTime(latestCloudBackup.createdAt)}`, onRestoreLatest: () => handleCloudRestore(latestCloudBackup.id, 'replace'), onChooseBackup: () => navigate('backup'), onStartFresh: handleDismissCloudRestorePrompt } : undefined} onAddDemo={addDemoFlights} onQuickAdd={openQuickAdd} onOpenFlight={(flight) => navigateToFlight(flight.id)} onRefresh={handleRefresh} />}
      {route.page === 'flights' && <FlightsPage flights={flights} airportVersion={airportVersion} onOpen={(flight) => navigateToFlight(flight.id)} onEdit={(flight) => { setEditing(flight); setShowForm(true) }} onDelete={handleDelete} onRefresh={handleRefresh} onQuickAdd={openQuickAdd} />}
      {route.page === 'flight-detail' && <FlightDetailPage flight={currentFlight} airportVersion={airportVersion} onBack={() => navigate('flights')} onEdit={(flight) => { setEditing(flight); setShowForm(true) }} onDelete={handleDelete} onRefresh={handleRefresh} />}
      {route.page === 'trips' && <TripsPage trips={trips} onOpen={(trip) => navigateToTrip(trip.id)} onUpdate={(tripId, patch) => void handleTripMetadataUpdate(tripId, patch)} />}
      {route.page === 'trip-detail' && <TripDetailPage trip={currentTrip} onBack={() => navigate('trips')} onOpenFlight={(flight) => navigateToFlight(flight.id)} onUpdate={(tripId, patch) => void handleTripMetadataUpdate(tripId, patch)} />}
      {route.page === 'map' && <MapPage flights={flights} airportVersion={airportVersion} />}
      {route.page === 'passport' && <PassportPage flights={flights} trips={trips} />}
      {route.page === 'backup' && <BackupCenterPage flights={flights} trips={trips} tripMetadata={tripMetadata} providerAirports={providerAirportState} appMetadata={appMetadata} cloud={cloudControls} onImported={reloadLocalData} onExportBackup={handleExportFullBackup} onMergeBackup={handleMergeBackup} onReplaceBackup={handleReplaceBackup} onRepairData={handleRepairData} />}
      {route.page === 'account' && <AccountPage configured={isSupabaseConfigured} authLoading={authLoading} session={authSession} authMessage={authMessage} appMetadata={appMetadata} cloudBackups={cloudBackups} showRestorePrompt={showCloudRestorePrompt} latestCloudBackup={latestCloudBackup} onGoogleSignIn={handleGoogleSignIn} onEmailSignIn={handleEmailSignIn} onSignOut={handleSignOut} onNavigateBackup={() => navigate('backup')} onRestoreLatest={() => latestCloudBackup ? handleCloudRestore(latestCloudBackup.id, 'replace') : Promise.resolve()} onDismissRestorePrompt={handleDismissCloudRestorePrompt} onSetCloudReminder={handleSetCloudReminder} onDeleteAllCloudBackups={handleCloudDeleteAll} />}
      <nav className="bottom-nav" aria-label="Mobile navigation">
        <button type="button" className={navPage(route) === 'dashboard' ? 'active' : ''} onClick={() => navigate('dashboard')}>Home</button>
        <button type="button" className={navPage(route) === 'flights' ? 'active' : ''} onClick={() => navigate('flights')}>Flights</button>
        <button type="button" className={navPage(route) === 'trips' ? 'active' : ''} onClick={() => navigate('trips')}>Trips</button>
        <button type="button" className={navPage(route) === 'backup' ? 'active' : ''} onClick={() => navigate('backup')}>Backup</button>
        <button type="button" className="bottom-add" onClick={openQuickAdd}><Plus aria-hidden="true" /> Add</button>
      </nav>
      <footer><strong>FlightLog</strong><span>personal flight passport</span><span>data stored locally in your browser</span></footer>
    </div>
  )
}

export default App
