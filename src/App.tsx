import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Download,
  Gauge,
  Globe2,
  Import,
  Map,
  Plane,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { bulkSaveFlights, deleteFlight, getFlights, getProviderAirports, providerAirportSnapshotsFromLiveStatus, saveFlight, saveProviderAirports } from './db'
import { sampleFlights } from './sampleData'
import type { FlightLiveAirport, FlightLiveStatus, FlightLogEntry, FlightPurpose, FlightSource, FlightWithComputed, LookupDateRole, ProviderAirportSnapshot } from './types'
import { airportCount, formatAirportOption, hasKnownAirport, loadGeneratedAirports, normalizeIata, searchAirports, setProviderAirports } from './utils/airports'
import { csvColumns, flightFromInput, flightsToCsv, parseFlightsCsv, parseFlightsJson, validateFlightInput } from './utils/csv'
import { formatDate, formatDateTime, formatDistance, formatDuration } from './utils/dates'
import { computeFlight, routeKey } from './utils/flights'
import { canRefreshLiveStatus, fetchLiveStatus, normalizeFlightNumber } from './utils/liveStatus'
import { aggregateStats } from './utils/stats'
import './App.css'

type Page = 'dashboard' | 'flights' | 'map' | 'passport' | 'import'
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
  { page: 'map', label: 'Map' },
  { page: 'passport', label: 'Passport' },
  { page: 'import', label: 'Import/Export' },
]

function pageFromHash(): Page {
  const hash = window.location.hash.replace('#/', '')
  return navItems.some((item) => item.page === hash) ? (hash as Page) : 'dashboard'
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
    timezone: airport?.timezone,
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
    scheduledDeparture: form.scheduledDeparture || liveStatus.scheduledDeparture || liveStatus.times?.scheduledDeparture || '',
    scheduledArrival: form.scheduledArrival || liveStatus.scheduledArrival || liveStatus.times?.scheduledArrival || '',
    actualDeparture: form.actualDeparture || liveStatus.actualDeparture || liveStatus.times?.actualDeparture || '',
    actualArrival: form.actualArrival || liveStatus.actualArrival || liveStatus.times?.actualArrival || '',
    source: sourceFromLiveStatus(liveStatus),
  }
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
    scheduledDeparture: flight.scheduledDeparture || liveStatus.scheduledDeparture || liveStatus.times?.scheduledDeparture,
    scheduledArrival: flight.scheduledArrival || liveStatus.scheduledArrival || liveStatus.times?.scheduledArrival,
    actualDeparture: flight.actualDeparture || liveStatus.actualDeparture || liveStatus.times?.actualDeparture,
    actualArrival: flight.actualArrival || liveStatus.actualArrival || liveStatus.times?.actualArrival,
    aircraftType: flight.aircraftType || liveStatus.aircraftType || liveStatus.aircraft?.type,
    aircraftRegistration: flight.aircraftRegistration || liveStatus.aircraftRegistration || liveStatus.aircraft?.registration,
    source,
    liveStatus,
    lastFetchedAt: fetchedAt,
    providerFetchedAt: fetchedAt,
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
  const warnings = liveStatusWarnings(liveStatus)
  return (
    <article className="lookup-preview">
      <div className="flight-main">
        <div>
          <p className="eyebrow">{liveStatus.provider ?? 'Live lookup'}</p>
          <h3>{liveStatus.flightNumber} - {liveStatus.airlineName || liveStatus.airline?.name || 'Unknown airline'}</h3>
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
        <div><dt>Scheduled</dt><dd>{formatDateTime(liveStatus.scheduledDeparture || liveStatus.times?.scheduledDeparture)} - {formatDateTime(liveStatus.scheduledArrival || liveStatus.times?.scheduledArrival)}</dd></div>
        <div><dt>Estimated / actual</dt><dd>{formatDateTime(liveStatus.estimatedDeparture || liveStatus.actualDeparture || liveStatus.times?.estimatedDeparture || liveStatus.times?.actualDeparture)} - {formatDateTime(liveStatus.estimatedArrival || liveStatus.actualArrival || liveStatus.times?.estimatedArrival || liveStatus.times?.actualArrival)}</dd></div>
        <div><dt>Departure</dt><dd>{[liveStatus.departureTerminal || liveStatus.terminalGate?.departureTerminal, liveStatus.departureGate || liveStatus.terminalGate?.departureGate].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
        <div><dt>Arrival</dt><dd>{[liveStatus.arrivalTerminal || liveStatus.terminalGate?.arrivalTerminal, liveStatus.arrivalGate || liveStatus.terminalGate?.arrivalGate, liveStatus.baggageClaim || liveStatus.terminalGate?.baggageClaim].filter(Boolean).join(' / ') || 'Not set'}</dd></div>
        <div><dt>Aircraft</dt><dd>{[liveStatus.aircraftType || liveStatus.aircraft?.type, liveStatus.aircraftRegistration || liveStatus.aircraft?.registration].filter(Boolean).join(' - ') || 'Not set'}</dd></div>
        <div><dt>Fetched</dt><dd>{formatDateTime(fetchedAt)}</dd></div>
      </dl>
      {warnings.map((warning) => <p className="notice warning" key={warning}>{warning}</p>)}
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
  onSaved: () => Promise<void>
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
      await saveFlight(flightFromLookup(lookupStatus, lookup.date, lookupFetchedAt || new Date().toISOString(), lookup.dateRole))
      await onProviderAirportsSaved(lookupStatus)
      await onSaved()
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
    await saveFlight(flightToSave)
    if (fetchedLiveStatus) await onProviderAirportsSaved(fetchedLiveStatus)
    await onSaved()
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
        await saveFlight(enrichFlightWithLiveStatus(flightFromInput(nextForm, editing), liveStatus, nextFetchedAt, 'Departure'))
        await onSaved()
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

function Dashboard({ flights, airportDatasetLabel, onAddDemo, onQuickAdd }: { flights: FlightLogEntry[]; airportDatasetLabel: string; onAddDemo: () => Promise<void>; onQuickAdd: () => void }) {
  const stats = aggregateStats(flights)
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
    </main>
  )
}

function FlightCard({ flight, onEdit, onDelete, onRefresh }: { flight: FlightWithComputed; onEdit: (flight: FlightLogEntry) => void; onDelete: (id: string) => Promise<void>; onRefresh: (flight: FlightLogEntry) => Promise<void> }) {
  const liveStatusLabel = flight.liveStatus?.status ?? 'manual'
  const providerLabel = flight.liveStatus?.provider ? ` via ${flight.liveStatus.provider}` : ''
  const lastFetchedLabel = flight.lastFetchedAt ? `Last fetched ${formatDateTime(flight.lastFetchedAt)}` : 'Not fetched'
  const warnings = flight.providerWarnings ?? flight.liveStatus?.warnings ?? (flight.liveStatus?.warning ? [flight.liveStatus.warning] : [])
  return (
    <article className="flight-card">
      <div className="flight-main"><div><p className="eyebrow">{formatDate(flight.date)}</p><h3>{flight.flightNumber} - {flight.airline}</h3></div><span className={`status ${flight.liveStatus?.status ?? 'unknown'}`}>{liveStatusLabel}{providerLabel}</span></div>
      <div className="route-line"><strong>{flight.origin}</strong><span>{flight.originAirport?.city || flight.originAirport?.name}</span><ArrowRight aria-hidden="true" /><strong>{flight.destination}</strong><span>{flight.destinationAirport?.city || flight.destinationAirport?.name}</span></div>
      <dl className="meta-grid">
        <div><dt>Distance</dt><dd>{flight.hasRouteCoordinates ? formatDistance(flight.distanceKm) : 'Unavailable'}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(flight.durationMinutes)}</dd></div>
        <div><dt>Aircraft</dt><dd>{flight.aircraftType || 'Not set'}</dd></div>
        <div><dt>Cabin / seat</dt><dd>{[flight.cabin, flight.seat].filter(Boolean).join(' - ') || 'Not set'}</dd></div>
      </dl>
      {flight.liveStatus && <p className="notice">Gate {flight.liveStatus.departureGate ?? flight.liveStatus.terminalGate?.departureGate ?? 'TBD'} - Arrival {formatDateTime(flight.liveStatus.estimatedArrival ?? flight.liveStatus.actualArrival ?? flight.liveStatus.times?.estimatedArrival ?? flight.liveStatus.times?.actualArrival)} - {lastFetchedLabel}</p>}
      {warnings.map((warning) => <p className="notice warning" key={warning}>{warning}</p>)}
      <div className="actions">
        <button type="button" className="ghost" onClick={() => onEdit(flight)}>Edit</button>
        <button type="button" className="ghost danger" onClick={() => onDelete(flight.id)}><Trash2 aria-hidden="true" /> Delete</button>
        <button type="button" className="secondary" disabled={!canRefreshLiveStatus(flight.lastFetchedAt)} onClick={() => onRefresh(flight)}><RefreshCw aria-hidden="true" /> Refresh live status</button>
      </div>
    </article>
  )
}

function FlightsPage({ flights, airportVersion, onEdit, onDelete, onRefresh, onQuickAdd }: { flights: FlightLogEntry[]; airportVersion: number; onEdit: (flight: FlightLogEntry) => void; onDelete: (id: string) => Promise<void>; onRefresh: (flight: FlightLogEntry) => Promise<void>; onQuickAdd: () => void }) {
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
      <div className="stack">{filtered.map((flight) => <FlightCard key={flight.id} flight={flight} onEdit={onEdit} onDelete={onDelete} onRefresh={onRefresh} />)}{filtered.length === 0 && <p className="empty-inline">No matching flights.</p>}</div>
    </main>
  )
}

function MapPage({ flights, airportVersion }: { flights: FlightLogEntry[]; airportVersion: number }) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const leafletRef = useRef<L.Map | null>(null)
  const computed = useMemo(() => {
    void airportVersion
    return flights.map(computeFlight)
  }, [flights, airportVersion])

  useEffect(() => {
    if (!mapRef.current) return
    const map = L.map(mapRef.current, { scrollWheelZoom: false }).setView([25, 0], 2)
    leafletRef.current = map
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map)
    return () => {
      map.remove()
      leafletRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = leafletRef.current
    if (!map) return
    const layer = L.layerGroup().addTo(map)
    const bounds: L.LatLngTuple[] = []
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
      const originPoint: L.LatLngTuple = [originAirport.lat, originAirport.lon]
      const destinationPoint: L.LatLngTuple = [destinationAirport.lat, destinationAirport.lon]
      const points: L.LatLngTuple[] = [originPoint, destinationPoint]
      bounds.push(...points)
      L.polyline(points, { color: '#0f766e', weight: 3, opacity: 0.75 }).bindPopup(`${flight.flightNumber}: ${flight.origin} to ${flight.destination}`).addTo(layer)
      L.marker(originPoint, { icon: markerIcon }).bindPopup(`<strong>${originAirport.iata}</strong><br>${originAirport.name}<br>${[originAirport.city, originAirport.country].filter(Boolean).join(', ')}`).addTo(layer)
      L.marker(destinationPoint, { icon: markerIcon }).bindPopup(`<strong>${destinationAirport.iata}</strong><br>${destinationAirport.name}<br>${[destinationAirport.city, destinationAirport.country].filter(Boolean).join(', ')}`).addTo(layer)
    }
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [28, 28] })
    return () => {
      layer.remove()
    }
  }, [computed])

  const mappedFlights = computed.filter((flight) => flight.hasRouteCoordinates).length
  return <main className="page"><div className="section-heading"><div><p className="eyebrow">Route atlas</p><h2>Map</h2></div></div>{flights.length === 0 ? <p className="empty-inline">Log a flight to draw your first route.</p> : <><div className="map-frame" ref={mapRef} />{mappedFlights < flights.length && <p className="notice warning">{flights.length - mappedFlights} flight route{flights.length - mappedFlights === 1 ? '' : 's'} saved without coordinates and cannot be mapped yet.</p>}</>}</main>
}

function ListPanel({ title, rows }: { title: string; rows: string[] }) {
  return <article className="panel"><h3>{title}</h3>{rows.length === 0 ? <p className="muted">No data yet.</p> : <ul>{rows.map((row) => <li key={row}>{row}</li>)}</ul>}</article>
}

function PassportPage({ flights }: { flights: FlightLogEntry[] }) {
  const stats = aggregateStats(flights)
  return (
    <main className="page passport">
      <div className="passport-cover"><p className="eyebrow">Digital passport</p><h2>Lifetime travel record</h2><div className="passport-number">{stats.totalFlights.toString().padStart(3, '0')} flights</div></div>
      <section className="stats-grid">
        <StatCard icon={Gauge} label="Flight time" value={formatDuration(stats.totalDurationMinutes)} />
        <StatCard icon={Map} label="Airports visited" value={String(stats.airportsVisited.length)} />
        <StatCard icon={Globe2} label="Countries visited" value={String(stats.countriesVisited.length)} />
        <StatCard icon={Plane} label="Aircraft types" value={String(stats.aircraftTypes.length)} />
        <StatCard icon={ArrowRight} label="Shortest route" value={stats.shortestFlight ? routeKey(stats.shortestFlight) : 'None'} />
        <StatCard icon={CalendarDays} label="Busiest year" value={stats.busiestYear ?? 'None'} />
      </section>
      <section className="three-columns"><ListPanel title="Yearly breakdown" rows={stats.yearly.map((row) => `${row.year}: ${row.flights} flights - ${formatDistance(row.distanceKm)}`)} /><ListPanel title="Top airports" rows={stats.topAirports.slice(0, 8).map((row) => `${row.code}: ${row.count} visits - ${row.label}`)} /><ListPanel title="Top airlines" rows={stats.topAirlines.slice(0, 8).map((row) => `${row.airline}: ${row.count}`)} /></section>
      <section className="three-columns"><ListPanel title="Top routes" rows={stats.topRoutes.slice(0, 8).map((row) => `${row.route}: ${row.count} - ${formatDistance(row.distanceKm)}`)} /><ListPanel title="Countries" rows={stats.countriesVisited} /><ListPanel title="Aircraft" rows={stats.aircraftTypes} /></section>
    </main>
  )
}

function ImportExportPage({ flights, onImported }: { flights: FlightLogEntry[]; onImported: () => Promise<void> }) {
  const [preview, setPreview] = useState<{ valid: FlightLogEntry[]; errors: string[] }>({ valid: [], errors: [] })
  async function handleFile(file: File) {
    const text = await file.text()
    setPreview(file.name.endsWith('.json') ? parseFlightsJson(text) : parseFlightsCsv(text))
  }
  async function savePreview() {
    await bulkSaveFlights(preview.valid)
    setPreview({ valid: [], errors: [] })
    await onImported()
  }
  return (
    <main className="page">
      <div className="section-heading"><div><p className="eyebrow">Portability</p><h2>Import and export</h2></div></div>
      <section className="two-columns">
        <article className="panel"><h3>Export</h3><p className="muted">Create a browser-local backup anytime.</p><div className="actions"><button type="button" onClick={() => downloadFile('flightlog.json', JSON.stringify({ flights }, null, 2), 'application/json')}><Download aria-hidden="true" /> Export JSON</button><button type="button" className="secondary" onClick={() => downloadFile('flightlog.csv', flightsToCsv(flights), 'text/csv')}><Download aria-hidden="true" /> Export CSV</button></div></article>
        <article className="panel"><h3>Import</h3><p className="muted">CSV core columns: {csvColumns.join(', ')}</p><label className="file-drop"><Upload aria-hidden="true" /><span>Choose CSV or JSON</span><input type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => event.target.files?.[0] && void handleFile(event.target.files[0])} /></label></article>
      </section>
      {(preview.errors.length > 0 || preview.valid.length > 0) && <section className="panel"><h3>Import preview</h3><p>{preview.valid.length} valid flights - {preview.errors.length} errors</p>{preview.errors.length > 0 && <ul className="errors">{preview.errors.map((error) => <li key={error}>{error}</li>)}</ul>}<button type="button" disabled={preview.valid.length === 0 || preview.errors.length > 0} onClick={savePreview}><Import aria-hidden="true" /> Save imported flights</button></section>}
      <section className="panel"><h3>Samples</h3><p><a href={`${import.meta.env.BASE_URL}samples/sample_flights.csv`}>Download sample CSV</a> - <a href={`${import.meta.env.BASE_URL}samples/sample_flights.json`}>Download sample JSON</a></p></section>
    </main>
  )
}

function App() {
  const [page, setPage] = useState<Page>(pageFromHash)
  const [flights, setFlights] = useState<FlightLogEntry[]>([])
  const [editing, setEditing] = useState<FlightLogEntry | undefined>()
  const [showForm, setShowForm] = useState(false)
  const [toast, setToast] = useState('')
  const [airportVersion, setAirportVersion] = useState(0)
  const [airportDatasetLabel, setAirportDatasetLabel] = useState(`${airportCount()} airport fallback loaded`)

  async function loadFlights() {
    setFlights(await getFlights())
  }

  async function refreshProviderAirports() {
    setProviderAirports(await getProviderAirports())
    setAirportVersion((version) => version + 1)
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
      setAirportVersion((version) => version + 1)
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
    const onHashChange = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => {
      mounted = false
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [])

  function navigate(next: Page) {
    window.location.hash = `/${next}`
    setPage(next)
  }

  function openQuickAdd() {
    setEditing(undefined)
    setShowForm(true)
  }

  async function handleDelete(id: string) {
    await deleteFlight(id)
    await loadFlights()
  }

  async function handleRefresh(flight: FlightLogEntry) {
    try {
      const liveStatus = await fetchLiveStatus(flight.flightNumber, flight.date, { dateRole: flight.lookupDateRole ?? 'Departure' })
      const fetchedAt = new Date().toISOString()
      await saveFlight(enrichFlightWithLiveStatus(flight, liveStatus, fetchedAt, flight.lookupDateRole ?? 'Departure'))
      await cacheProviderAirports(liveStatus)
      setToast(`Updated ${flight.flightNumber}: ${liveStatus.status}`)
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

  return (
    <div className="app-shell">
      <header>
        <button type="button" className="brand" onClick={() => navigate('dashboard')}><Plane aria-hidden="true" /><span>FlightLog</span></button>
        <nav aria-label="Primary navigation">{navItems.map((item) => <button key={item.page} type="button" className={page === item.page ? 'active' : ''} onClick={() => navigate(item.page)}>{item.label}</button>)}</nav>
        <button type="button" onClick={openQuickAdd}><Plus aria-hidden="true" /> Add flight</button>
      </header>
      {toast && <div className="toast" role="status"><span>{toast}</span><button type="button" onClick={() => setToast('')}>Dismiss</button></div>}
      {showForm && <FlightForm editing={editing} onCancel={() => { setShowForm(false); setEditing(undefined) }} onSaved={loadFlights} onProviderAirportsSaved={cacheProviderAirports} />}
      {page === 'dashboard' && <Dashboard flights={flights} airportDatasetLabel={airportDatasetLabel} onAddDemo={addDemoFlights} onQuickAdd={openQuickAdd} />}
      {page === 'flights' && <FlightsPage flights={flights} airportVersion={airportVersion} onEdit={(flight) => { setEditing(flight); setShowForm(true) }} onDelete={handleDelete} onRefresh={handleRefresh} onQuickAdd={openQuickAdd} />}
      {page === 'map' && <MapPage flights={flights} airportVersion={airportVersion} />}
      {page === 'passport' && <PassportPage flights={flights} />}
      {page === 'import' && <ImportExportPage flights={flights} onImported={loadFlights} />}
      <footer><strong>FlightLog</strong><span>personal flight passport</span><span>data stored locally in your browser</span></footer>
    </div>
  )
}

export default App
