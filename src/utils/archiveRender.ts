import type { DistanceUnit, FlightLogEntry } from '../types'
import type { TripGroup } from './trips'
import type { Achievement } from './achievements'
import type { PassportSummary, VisitedCountry } from './achievements'
import type { FlightStats } from './stats'
import type { FlightLogBackup } from './backup'
import { buildStampPages, renderPassportPagePng } from './passportBook'
import { yearlyPassportShareCardData } from './shareCards'
import { renderShareCardPng } from './shareImage'
import { formatDistance } from './dates'
import { getFlightDepartureLocalDate } from './flightTime'
import { computeFlight, routeKey } from './flights'
import { ARCHIVE_PAYLOAD_ELEMENT_ID, DEFAULT_WRAPPED_IMAGE_YEAR_COUNT, buildArchivePayload, buildArchiveSummarySnapshot, estimateArchiveSize, type ArchivePayload, type ArchiveSizeEstimate } from './archive'

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** JSON-encodes a value for safe embedding inside an inline <script> tag -- a
 * literal "</script" substring in the JSON (e.g. from a flight's notes field)
 * would otherwise prematurely close the tag and break, or inject into, the
 * surrounding HTML. */
export function embedJson(value: unknown): string {
  // A case-preserving replacer -- a fixed-case replacement string would
  // down-case any "</SCRIPT"-style match, corrupting the round-tripped value
  // and failing its own checksum on re-import even though nothing was
  // tampered with.
  return JSON.stringify(value).replace(/<\/script/gi, (match) => `<\\${match.slice(1)}`)
}

interface ArchiveStampSection {
  title: string
  dataUri: string
  countries: VisitedCountry[]
}

interface ArchiveWrappedYear {
  year: string
  dataUri?: string
  flightCount: number
  distanceLabel: string
}

interface ArchiveTripRow {
  name: string
  routeSummary: string
  dateRange: string
  flightCount: number
}

interface ArchiveFlightRow {
  date: string
  flightNumber: string
  airline: string
  route: string
  distanceLabel: string
}

export interface ArchiveHtmlInput {
  generatedAtLabel: string
  appVersionLabel: string
  totalFlights: number
  countryCount: number
  continentCount: number
  totalDistanceLabel: string
  earthLaps: number
  achievements: Achievement[]
  stampSections: ArchiveStampSection[]
  wrappedYears: ArchiveWrappedYear[]
  trips: ArchiveTripRow[]
  flightRows: ArchiveFlightRow[]
  payload?: unknown
}

const ARCHIVE_STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; background: #f8fafc; }
  main { max-width: 900px; margin: 0 auto; padding: 32px 24px 64px; }
  section { margin: 0 0 40px; }
  h1, h2, h3 { color: #0f172a; }
  .cover { text-align: center; padding: 48px 24px; border-radius: 16px; background: linear-gradient(160deg, #0f172a, #0b3b36); color: #f8fafc; }
  .cover .eyebrow { letter-spacing: 3px; text-transform: uppercase; font-size: 13px; color: #5eead4; margin: 0 0 8px; }
  .cover h1 { font-size: 40px; margin: 0 0 8px; }
  .cover .count { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 20px; color: #99f6e4; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
  .stat-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
  .stat-card .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }
  .stat-card .value { font-size: 22px; font-weight: 700; color: #0f172a; }
  .achievement-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  .achievement-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; background: #fff; }
  .achievement-card .icon { font-size: 20px; }
  .achievement-card .earned-date { color: #0f766e; font-size: 12px; font-weight: 600; }
  .page-break { page-break-inside: avoid; break-inside: avoid; margin-bottom: 40px; }
  .stamp-img, .wrapped-img { max-width: 100%; height: auto; border-radius: 12px; border: 1px solid #e2e8f0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  .muted { color: #64748b; font-size: 13px; }
  .payload-section { background: #f1f5f9; border-radius: 10px; padding: 16px; }
  .no-print button { font: inherit; padding: 10px 18px; border-radius: 8px; border: none; background: #0f766e; color: #fff; cursor: pointer; }
  @media print {
    body { background: #fff; }
    .no-print { display: none !important; }
    .cover { background: #0f172a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    main { max-width: none; padding: 0 12px; }
  }
`

function statCard(label: string, value: string): string {
  return `<div class="stat-card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`
}

function achievementCard(achievement: Achievement): string {
  const earnedDate = achievement.earned && achievement.earnedDate
    ? `<div class="earned-date">Earned ${escapeHtml(achievement.earnedDate)}</div>`
    : `<div class="muted">${achievement.progress.toLocaleString()}/${achievement.target.toLocaleString()}</div>`
  return `<div class="achievement-card"><span class="icon">${escapeHtml(achievement.icon)}</span> <strong>${escapeHtml(achievement.title)}</strong><div class="muted">${escapeHtml(achievement.description)}</div>${earnedDate}</div>`
}

function stampSectionHtml(section: ArchiveStampSection): string {
  const countryList = section.countries.map((country) => escapeHtml(country.name)).join(', ')
  return `<section class="page-break"><h3>${escapeHtml(section.title)}</h3><img class="stamp-img" alt="Passport stamps: ${escapeHtml(section.title)}" src="${section.dataUri}"><p class="muted">${countryList}</p></section>`
}

function wrappedYearHtml(year: ArchiveWrappedYear): string {
  const image = year.dataUri ? `<img class="wrapped-img" alt="${escapeHtml(year.year)} travel summary" src="${year.dataUri}">` : ''
  return `<section class="page-break"><h3>${escapeHtml(year.year)}</h3>${image}<p class="muted">${year.flightCount} flight${year.flightCount === 1 ? '' : 's'} · ${escapeHtml(year.distanceLabel)}</p></section>`
}

function tripsTableHtml(trips: ArchiveTripRow[]): string {
  if (trips.length === 0) return '<p class="muted">No trips recorded.</p>'
  const rows = trips.map((trip) => `<tr><td>${escapeHtml(trip.name)}</td><td>${escapeHtml(trip.dateRange)}</td><td>${escapeHtml(trip.routeSummary)}</td><td>${trip.flightCount}</td></tr>`).join('')
  return `<table><thead><tr><th>Trip</th><th>Dates</th><th>Route</th><th>Flights</th></tr></thead><tbody>${rows}</tbody></table>`
}

function flightLogTableHtml(rows: ArchiveFlightRow[]): string {
  if (rows.length === 0) return '<p class="muted">No flights logged.</p>'
  const body = rows.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.flightNumber)}</td><td>${escapeHtml(row.airline)}</td><td>${escapeHtml(row.route)}</td><td>${escapeHtml(row.distanceLabel)}</td></tr>`).join('')
  return `<table><thead><tr><th>Date</th><th>Flight</th><th>Airline</th><th>Route</th><th>Distance</th></tr></thead><tbody>${body}</tbody></table>`
}

/**
 * Pure HTML assembly -- no DOM/Canvas access, so it's directly unit-testable
 * with stub data-URI strings. This is the one function that must never
 * depend on anything but its own arguments: it is the entire visual and
 * structural contract of a file meant to still open correctly decades from
 * now, with no app, no network, and no external stylesheet or script.
 */
export function assembleArchiveHtml(input: ArchiveHtmlInput): string {
  const payloadSection = input.payload !== undefined
    ? `<section class="no-print payload-section"><h3>Raw data</h3><p class="muted">The exact data used to generate this page is embedded below as JSON. Opening this file's "Restore backup" flow in a FlightLog app (any version) reads it directly -- no need to copy or edit anything.</p><script type="application/json" id="${ARCHIVE_PAYLOAD_ELEMENT_ID}">${embedJson(input.payload)}</script></section>`
    : ''
  return `<!doctype html>
<html lang="en" data-flightlog-archive="1">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FlightLog Lifetime Archive — ${escapeHtml(input.generatedAtLabel)}</title>
<style>${ARCHIVE_STYLE}</style>
</head>
<body>
<main>
  <section class="cover">
    <p class="eyebrow">Digital passport · lifetime archive</p>
    <h1>FlightLog Lifetime Archive</h1>
    <p class="count">${input.totalFlights} flights logged</p>
    <p class="muted" style="color:#cbd5e1">Generated ${escapeHtml(input.generatedAtLabel)} by ${escapeHtml(input.appVersionLabel)}</p>
  </section>

  <section>
    <h2>Lifetime stats</h2>
    <div class="stats-grid">
      ${statCard('Flights', String(input.totalFlights))}
      ${statCard('Countries', String(input.countryCount))}
      ${statCard('Continents', `${input.continentCount}/7`)}
      ${statCard('Distance flown', input.totalDistanceLabel)}
      ${statCard('Around the world', `${input.earthLaps.toFixed(1)}×`)}
      ${statCard('Achievements earned', `${input.achievements.filter((achievement) => achievement.earned).length}/${input.achievements.length}`)}
    </div>
  </section>

  <section>
    <h2>Achievements</h2>
    <div class="achievement-grid">${input.achievements.map(achievementCard).join('')}</div>
  </section>

  <section>
    <h2>Passport stamps</h2>
    ${input.stampSections.map(stampSectionHtml).join('')}
  </section>

  <section>
    <h2>Year by year</h2>
    ${input.wrappedYears.map(wrappedYearHtml).join('')}
  </section>

  <section>
    <h2>Trips</h2>
    ${tripsTableHtml(input.trips)}
  </section>

  <section>
    <h2>Full flight log</h2>
    ${flightLogTableHtml(input.flightRows)}
  </section>

  ${payloadSection}

  <section class="no-print" style="text-align:center">
    <button type="button" onclick="window.print()">Print or save as PDF</button>
  </section>
</main>
</body>
</html>`
}

export interface ArchiveRenderInput {
  activeFlights: FlightLogEntry[]
  trips: TripGroup[]
  summary: PassportSummary
  stats: FlightStats
  achievements: Achievement[]
  distanceUnit: DistanceUnit
  appVersionLabel: string
  /** Full-fidelity backup (including tombstones) to embed for round-trip
   * re-import. Omit (or set includePayload: false) for an ephemeral render,
   * e.g. printing, where the checksum/JSON-embedding cost isn't worth paying. */
  backup?: FlightLogBackup
  includePayload?: boolean
  includeAllWrappedYears?: boolean
  scale?: 1 | 2
  now?: string
}

export interface ArchiveRenderResult {
  html: string
  sizeEstimate: ArchiveSizeEstimate
  payload?: ArchivePayload
}

async function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read rendered image.'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Pure -- no DOM/Canvas access -- so directly unit-testable. Sorts and
 * formats the full flight log for the archive's "Full flight log" table: the
 * sort key and the displayed date are the same local-departure-derived value
 * (rather than the raw, possibly-stale flight.date field, which can disagree
 * with it for e.g. an overnight flight or a manually edited time), and a
 * flight with no resolvable route coordinates shows "Distance unavailable"
 * rather than a misleadingly precise-looking "0 km" -- the same convention
 * flightShareCardData (shareCards.ts) and the live Flight Detail page use for
 * this exact case.
 */
export function buildFlightLogRows(flights: FlightLogEntry[], distanceUnit: DistanceUnit): ArchiveFlightRow[] {
  return flights
    .map((flight) => ({ flight, localDate: getFlightDepartureLocalDate(flight), computed: computeFlight(flight) }))
    .sort((a, b) => (a.localDate < b.localDate ? 1 : a.localDate > b.localDate ? -1 : 0))
    .map(({ flight, localDate, computed }) => ({
      date: localDate,
      flightNumber: flight.flightNumber,
      airline: flight.airline || flight.liveStatus?.airline?.name || '',
      route: routeKey(flight),
      distanceLabel: computed.hasRouteCoordinates ? formatDistance(computed.distanceKm, distanceUnit) : 'Distance unavailable',
    }))
}

/**
 * The one DOM/Canvas-touching function in this module: orchestrates
 * rendering every stamp page and "wrapped" year card to a PNG (reusing
 * passportBook.ts/shareImage.ts's existing, tested drawing functions
 * unmodified), converts them to data: URIs (so the result is a single
 * self-contained file with no blob: URLs that die when the tab closes), and
 * hands everything to the pure assembleArchiveHtml.
 */
export async function renderLifetimeArchive(input: ArchiveRenderInput): Promise<ArchiveRenderResult> {
  const scale = input.scale ?? 1
  const stampPages = buildStampPages(input.summary.countryList)
  const stampSections = await Promise.all(stampPages.map(async (page) => ({
    title: page.continent ?? page.title,
    dataUri: await blobToDataUri(await renderPassportPagePng(page, { totalPages: stampPages.length, scale })),
    countries: page.stamps.map((stamp) => input.summary.countryList.find((country) => country.key === stamp.key)).filter((country): country is VisitedCountry => Boolean(country)),
  })))

  const years = [...input.stats.yearly].sort((a, b) => b.year.localeCompare(a.year))
  const imageYearCount = input.includeAllWrappedYears ? years.length : DEFAULT_WRAPPED_IMAGE_YEAR_COUNT
  const wrappedYears = await Promise.all(years.map(async (year, index) => {
    const shouldRenderImage = index < imageYearCount
    const dataUri = shouldRenderImage
      ? await blobToDataUri(await renderShareCardPng(yearlyPassportShareCardData(input.activeFlights, year.year, { distanceUnit: input.distanceUnit }), { scale }))
      : undefined
    return { year: year.year, dataUri, flightCount: year.flights, distanceLabel: formatDistance(year.distanceKm, input.distanceUnit) }
  }))

  const tripRows = input.trips.map((trip) => ({
    name: trip.name,
    routeSummary: trip.routeSummary,
    dateRange: `${trip.startDate} to ${trip.endDate}`,
    flightCount: trip.flights.length,
  }))

  const flightRows = buildFlightLogRows(input.activeFlights, input.distanceUnit)

  const includePayload = input.includePayload !== false && Boolean(input.backup)
  const archiveSummary = buildArchiveSummarySnapshot(input.activeFlights, { countryCount: input.summary.countryCount, totalDistanceKm: input.summary.totalDistanceKm })
  const payload = includePayload && input.backup
    ? await buildArchivePayload({ backup: input.backup, summary: archiveSummary, achievements: input.achievements, now: input.now })
    : undefined

  const sizeEstimate = estimateArchiveSize({
    flightCount: includePayload ? input.activeFlights.length : 0,
    stampPageCount: stampPages.length,
    wrappedImageCount: wrappedYears.filter((year) => year.dataUri).length,
    scale,
  })

  const generatedAtLabel = new Date(input.now ?? new Date().toISOString()).toISOString().slice(0, 10)
  const html = assembleArchiveHtml({
    generatedAtLabel,
    appVersionLabel: input.appVersionLabel,
    totalFlights: input.summary.totalFlights,
    countryCount: input.summary.countryCount,
    continentCount: input.summary.continents.length,
    totalDistanceLabel: formatDistance(input.summary.totalDistanceKm, input.distanceUnit),
    earthLaps: input.summary.earthLaps,
    achievements: input.achievements,
    stampSections,
    wrappedYears,
    trips: tripRows,
    flightRows,
    payload,
  })

  return { html, sizeEstimate, payload }
}
