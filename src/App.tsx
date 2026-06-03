import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  ArrowRight,
  CalendarDays,
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
import { bulkSaveFlights, deleteFlight, getFlights, saveFlight } from './db'
import { sampleFlights } from './sampleData'
import type { FlightLogEntry, FlightPurpose, FlightSource, FlightWithComputed } from './types'
import { lookupAirport, normalizeIata, searchAirports } from './utils/airports'
import { csvColumns, flightFromInput, flightsToCsv, parseFlightsCsv, parseFlightsJson, validateFlightInput } from './utils/csv'
import { formatDate, formatDateTime, formatDistance, formatDuration } from './utils/dates'
import { computeFlight, routeKey } from './utils/flights'
import { canRefreshLiveStatus, fetchLiveStatus } from './utils/liveStatus'
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
          <option key={airport.iata} value={airport.iata}>
            {airport.city}, {airport.country} - {airport.name}
          </option>
        ))}
      </datalist>
    </label>
  )
}

function FlightForm({ editing, onCancel, onSaved }: { editing?: FlightLogEntry; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<FlightFormState>(() => formFromFlight(editing))
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const errors = validateFlightInput(form)
  const computedPreview = errors.length === 0 ? computeFlight(flightFromInput(form, editing)) : undefined

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (errors.length > 0) {
      setMessage(errors.join('. '))
      return
    }
    await saveFlight(flightFromInput(form, editing))
    await onSaved()
    onCancel()
  }

  async function handleFetchLive() {
    setBusy(true)
    setMessage('')
    try {
      const liveStatus = await fetchLiveStatus(form.flightNumber, form.date)
      setForm((current) => ({
        ...current,
        aircraftType: current.aircraftType || liveStatus.aircraftType || '',
        aircraftRegistration: current.aircraftRegistration || liveStatus.aircraftRegistration || '',
        scheduledDeparture: current.scheduledDeparture || liveStatus.scheduledDeparture || '',
        scheduledArrival: current.scheduledArrival || liveStatus.scheduledArrival || '',
        actualDeparture: current.actualDeparture || liveStatus.actualDeparture || '',
        actualArrival: current.actualArrival || liveStatus.actualArrival || '',
        source: 'live-import',
      }))
      if (editing) {
        await saveFlight({ ...flightFromInput(form, editing), liveStatus, lastFetchedAt: new Date().toISOString(), source: 'live-import' })
        await onSaved()
      }
      setMessage(`Live status loaded: ${liveStatus.status}`)
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
          <label>Source<select value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value as FlightSource })}><option value="manual">Manual</option><option value="live-import">Live import</option></select></label>
          <label className="wide">Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} /></label>
        </div>
        <div className="form-summary">
          <span>{computedPreview ? `${form.origin} to ${form.destination}` : 'Route preview'}</span>
          <strong>{computedPreview ? formatDistance(computedPreview.distanceKm) : 'Validate airports to calculate distance'}</strong>
          <span>{computedPreview ? formatDuration(computedPreview.durationMinutes) : 'Duration appears when times are set'}</span>
        </div>
        {message && <p className="notice">{message}</p>}
        <div className="actions">
          <button type="button" className="secondary" onClick={handleFetchLive} disabled={busy || !form.flightNumber || !form.date}><RefreshCw aria-hidden="true" /> Fetch live flight data</button>
          <button type="submit"><Plane aria-hidden="true" /> Save flight</button>
        </div>
      </form>
    </section>
  )
}

function Dashboard({ flights, onAddDemo }: { flights: FlightLogEntry[]; onAddDemo: () => Promise<void> }) {
  const stats = aggregateStats(flights)
  return (
    <main className="page">
      <section className="hero-shell">
        <div>
          <p className="eyebrow">FlightLog</p>
          <h1>Your personal flight passport.</h1>
          <p>Log flights manually, keep your data in this browser, export anytime, and map the routes that shaped your travel history.</p>
        </div>
        <div className="route-stamp" aria-hidden="true"><span>{stats.mostRecentFlight?.origin ?? 'SFO'}</span><ArrowRight /><span>{stats.mostRecentFlight?.destination ?? 'SIN'}</span></div>
      </section>
      {flights.length === 0 ? (
        <section className="empty-state"><Plane aria-hidden="true" /><h2>No flights logged yet</h2><p>Add your first route manually or load demo flights to explore the app.</p><button type="button" onClick={onAddDemo}><Plus aria-hidden="true" /> Load demo flights</button></section>
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
  const origin = lookupAirport(flight.origin)
  const destination = lookupAirport(flight.destination)
  return (
    <article className="flight-card">
      <div className="flight-main"><div><p className="eyebrow">{formatDate(flight.date)}</p><h3>{flight.flightNumber} - {flight.airline}</h3></div><span className={`status ${flight.liveStatus?.status ?? 'unknown'}`}>{flight.liveStatus?.status ?? 'manual'}</span></div>
      <div className="route-line"><strong>{flight.origin}</strong><span>{origin?.city}</span><ArrowRight aria-hidden="true" /><strong>{flight.destination}</strong><span>{destination?.city}</span></div>
      <dl className="meta-grid">
        <div><dt>Distance</dt><dd>{formatDistance(flight.distanceKm)}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(flight.durationMinutes)}</dd></div>
        <div><dt>Aircraft</dt><dd>{flight.aircraftType || 'Not set'}</dd></div>
        <div><dt>Cabin / seat</dt><dd>{[flight.cabin, flight.seat].filter(Boolean).join(' - ') || 'Not set'}</dd></div>
      </dl>
      {flight.liveStatus && <p className="notice">Gate {flight.liveStatus.departureGate ?? 'TBD'} - Arrival {formatDateTime(flight.liveStatus.estimatedArrival ?? flight.liveStatus.actualArrival)}</p>}
      <div className="actions">
        <button type="button" className="ghost" onClick={() => onEdit(flight)}>Edit</button>
        <button type="button" className="ghost danger" onClick={() => onDelete(flight.id)}><Trash2 aria-hidden="true" /> Delete</button>
        <button type="button" className="secondary" disabled={!canRefreshLiveStatus(flight.lastFetchedAt)} onClick={() => onRefresh(flight)}><RefreshCw aria-hidden="true" /> Refresh live status</button>
      </div>
    </article>
  )
}

function FlightsPage({ flights, onEdit, onDelete, onRefresh }: { flights: FlightLogEntry[]; onEdit: (flight: FlightLogEntry) => void; onDelete: (id: string) => Promise<void>; onRefresh: (flight: FlightLogEntry) => Promise<void> }) {
  const [query, setQuery] = useState('')
  const computed = useMemo(() => flights.map(computeFlight), [flights])
  const filtered = computed.filter((flight) => {
    const origin = lookupAirport(flight.origin)
    const destination = lookupAirport(flight.destination)
    return [flight.flightNumber, flight.airline, flight.origin, flight.destination, origin?.country, destination?.country, flight.date.slice(0, 4)].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase())
  })
  return (
    <main className="page">
      <div className="section-heading"><div><p className="eyebrow">Manifest</p><h2>Flights</h2></div><label className="search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search airport, airline, year, country..." /></label></div>
      <div className="stack">{filtered.map((flight) => <FlightCard key={flight.id} flight={flight} onEdit={onEdit} onDelete={onDelete} onRefresh={onRefresh} />)}{filtered.length === 0 && <p className="empty-inline">No matching flights.</p>}</div>
    </main>
  )
}

function MapPage({ flights }: { flights: FlightLogEntry[] }) {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const leafletRef = useRef<L.Map | null>(null)
  const computed = useMemo(() => flights.map(computeFlight), [flights])

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
    const bounds: L.LatLngExpression[] = []
    const markerIcon = L.divIcon({ className: 'airport-marker', html: '<span></span>', iconSize: [16, 16] })
    for (const flight of computed) {
      const origin = lookupAirport(flight.origin)
      const destination = lookupAirport(flight.destination)
      if (!origin || !destination) continue
      const points: L.LatLngExpression[] = [[origin.lat, origin.lon], [destination.lat, destination.lon]]
      bounds.push(...points)
      L.polyline(points, { color: '#0f766e', weight: 3, opacity: 0.75 }).bindPopup(`${flight.flightNumber}: ${flight.origin} to ${flight.destination}`).addTo(layer)
      for (const airport of [origin, destination]) L.marker([airport.lat, airport.lon], { icon: markerIcon }).bindPopup(`<strong>${airport.iata}</strong><br>${airport.name}<br>${airport.city}, ${airport.country}`).addTo(layer)
    }
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [28, 28] })
    return () => {
      layer.remove()
    }
  }, [computed])

  return <main className="page"><div className="section-heading"><div><p className="eyebrow">Route atlas</p><h2>Map</h2></div></div>{flights.length === 0 ? <p className="empty-inline">Log a flight to draw your first route.</p> : <div className="map-frame" ref={mapRef} />}</main>
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
        <article className="panel"><h3>Import</h3><p className="muted">CSV columns: {csvColumns.join(', ')}</p><label className="file-drop"><Upload aria-hidden="true" /><span>Choose CSV or JSON</span><input type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => event.target.files?.[0] && void handleFile(event.target.files[0])} /></label></article>
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

  async function loadFlights() {
    setFlights(await getFlights())
  }

  useEffect(() => {
    void loadFlights()
    const onHashChange = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function navigate(next: Page) {
    window.location.hash = `/${next}`
    setPage(next)
  }

  async function handleDelete(id: string) {
    await deleteFlight(id)
    await loadFlights()
  }

  async function handleRefresh(flight: FlightLogEntry) {
    try {
      const liveStatus = await fetchLiveStatus(flight.flightNumber, flight.date)
      await saveFlight({ ...flight, liveStatus, lastFetchedAt: new Date().toISOString(), source: 'live-import' })
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
        <button type="button" onClick={() => { setEditing(undefined); setShowForm(true) }}><Plus aria-hidden="true" /> Add flight</button>
      </header>
      {toast && <div className="toast" role="status"><span>{toast}</span><button type="button" onClick={() => setToast('')}>Dismiss</button></div>}
      {showForm && <FlightForm editing={editing} onCancel={() => { setShowForm(false); setEditing(undefined) }} onSaved={loadFlights} />}
      {page === 'dashboard' && <Dashboard flights={flights} onAddDemo={addDemoFlights} />}
      {page === 'flights' && <FlightsPage flights={flights} onEdit={(flight) => { setEditing(flight); setShowForm(true) }} onDelete={handleDelete} onRefresh={handleRefresh} />}
      {page === 'map' && <MapPage flights={flights} />}
      {page === 'passport' && <PassportPage flights={flights} />}
      {page === 'import' && <ImportExportPage flights={flights} onImported={loadFlights} />}
      <footer><strong>FlightLog</strong><span>personal flight passport</span><span>data stored locally in your browser</span></footer>
    </div>
  )
}

export default App
