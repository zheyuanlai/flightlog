import { DateTime } from 'luxon'
import type { Airport, FlightLogEntry, PassportGoals } from '../types'
import { airportFromSnapshot, hasCoordinates, lookupAirport, normalizeIata } from './airports'
import { haversineDistanceKm } from './distance'

export type Continent = 'Africa' | 'Asia' | 'Europe' | 'North America' | 'South America' | 'Oceania' | 'Antarctica'

export const CONTINENTS: Continent[] = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica']

/** One lap around the Earth at the equator, in kilometres. */
export const EARTH_CIRCUMFERENCE_KM = 40075

/** ISO 3166-1 alpha-2 country codes grouped by continent (best-effort; sovereign + common territories). */
const CONTINENT_COUNTRY_CODES: Record<Continent, string[]> = {
  Africa: ['DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD', 'KM', 'CG', 'CD', 'CI', 'DJ', 'EG', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'YT', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RE', 'RW', 'SH', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG', 'EH', 'ZM', 'ZW'],
  Asia: ['AF', 'AM', 'AZ', 'BH', 'BD', 'BT', 'BN', 'KH', 'CN', 'CY', 'GE', 'HK', 'IN', 'ID', 'IR', 'IQ', 'IL', 'JP', 'JO', 'KZ', 'KW', 'KG', 'LA', 'LB', 'MO', 'MY', 'MV', 'MN', 'MM', 'NP', 'KP', 'OM', 'PK', 'PS', 'PH', 'QA', 'SA', 'SG', 'KR', 'LK', 'SY', 'TW', 'TJ', 'TH', 'TL', 'TR', 'TM', 'AE', 'UZ', 'VN', 'YE'],
  Europe: ['AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FO', 'FI', 'FR', 'DE', 'GI', 'GR', 'GG', 'HU', 'IS', 'IE', 'IM', 'IT', 'JE', 'XK', 'LV', 'LI', 'LT', 'LU', 'MT', 'MD', 'MC', 'ME', 'NL', 'MK', 'NO', 'PL', 'PT', 'RO', 'RU', 'SM', 'RS', 'SK', 'SI', 'ES', 'SE', 'CH', 'UA', 'GB', 'VA', 'AX', 'SJ'],
  'North America': ['AI', 'AG', 'AW', 'BS', 'BB', 'BZ', 'BM', 'BQ', 'VG', 'CA', 'KY', 'CR', 'CU', 'CW', 'DM', 'DO', 'SV', 'GL', 'GD', 'GP', 'GT', 'HT', 'HN', 'JM', 'MQ', 'MX', 'MS', 'NI', 'PA', 'PR', 'BL', 'KN', 'LC', 'MF', 'PM', 'VC', 'SX', 'TT', 'TC', 'US', 'VI'],
  'South America': ['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'FK', 'GF', 'GY', 'PY', 'PE', 'SR', 'UY', 'VE'],
  Oceania: ['AS', 'AU', 'CK', 'FJ', 'PF', 'GU', 'KI', 'MH', 'FM', 'NR', 'NC', 'NZ', 'NU', 'NF', 'MP', 'PW', 'PG', 'PN', 'WS', 'SB', 'TK', 'TO', 'TV', 'VU', 'WF'],
  Antarctica: ['AQ', 'BV', 'GS', 'TF', 'HM'],
}

const COUNTRY_CODE_TO_CONTINENT: Map<string, Continent> = (() => {
  const map = new Map<string, Continent>()
  for (const continent of CONTINENTS) {
    for (const code of CONTINENT_COUNTRY_CODES[continent]) map.set(code, continent)
  }
  return map
})()

export function continentForCountryCode(code?: string): Continent | undefined {
  if (!code) return undefined
  return COUNTRY_CODE_TO_CONTINENT.get(code.trim().toUpperCase())
}

/** True when the two latitudes are on opposite sides of the equator. */
export function crossesEquator(latA: number, latB: number): boolean {
  return (latA > 0 && latB < 0) || (latA < 0 && latB > 0)
}

/** True when the shortest-path arc between two longitudes crosses the antimeridian. */
export function crossesDateLine(lonA: number, lonB: number): boolean {
  return Math.abs(lonA - lonB) > 180
}

interface LocalMoment {
  date: string
  hour: number
}

function localMoment(iso?: string): LocalMoment | undefined {
  if (!iso) return undefined
  // Require an actual clock time. A date-only value (no "T HH:MM") has genuinely
  // unknown times — Luxon would report midnight — and must never be treated as a
  // red-eye, keeping the function conservative as documented.
  if (!/T\d{2}:\d{2}/.test(iso)) return undefined
  const dt = DateTime.fromISO(iso, { setZone: true })
  if (!dt.isValid) return undefined
  const date = dt.toISODate()
  if (!date) return undefined
  return { date, hour: dt.hour }
}

/**
 * A red-eye is an overnight flight: it crosses local midnight into a later
 * calendar date and either departs late in the evening/night or lands in the
 * early morning. Requires local departure and arrival times, so it is
 * conservative — an unknown-time flight is never counted.
 */
export function isRedEye(flight: FlightLogEntry): boolean {
  const departure = localMoment(flight.actualDepartureLocal ?? flight.scheduledDepartureLocal)
  const arrival = localMoment(flight.actualArrivalLocal ?? flight.scheduledArrivalLocal)
  if (!departure || !arrival) return false
  if (arrival.date <= departure.date) return false
  return departure.hour >= 20 || departure.hour <= 4 || arrival.hour <= 9
}

export type AirportLookup = (iata: string) => Airport | undefined

function resolveEndpoint(flight: FlightLogEntry, role: 'origin' | 'destination', lookup: AirportLookup): Airport | undefined {
  const code = role === 'origin' ? flight.origin : flight.destination
  return lookup(normalizeIata(code ?? ''))
    ?? airportFromSnapshot(role === 'origin' ? flight.originAirportSnapshot : flight.destinationAirportSnapshot)
}

interface CountryAccumulator {
  keys: Set<string>
  names: Map<string, string>
  continents: Map<string, Continent>
  nameToKey: Map<string, string>
}

function newCountryAccumulator(): CountryAccumulator {
  return { keys: new Set(), names: new Map(), continents: new Map(), nameToKey: new Map() }
}

/**
 * Record a country visit under a single canonical key, collapsing the two ways the
 * same country can appear: an ISO-2 country code, or a bare country name (a provider
 * snapshot or curated entry with no code). A country first seen code-less is migrated
 * onto its code once any coded airport of that country is seen, so a country is never
 * counted twice. Returns the canonical key, or undefined if unidentifiable.
 */
function registerCountry(acc: CountryAccumulator, airport: Airport): string | undefined {
  const code = airport.countryCode?.trim().toUpperCase()
  const name = (airport.countryName || airport.country || '').trim()
  const nameKey = name.toLowerCase()

  if (code) {
    const existing = nameKey ? acc.nameToKey.get(nameKey) : undefined
    if (existing && existing !== code && existing.startsWith('name:')) {
      // Fold an earlier code-less entry for this name onto the canonical code.
      acc.keys.delete(existing)
      const priorName = acc.names.get(existing)
      acc.names.delete(existing)
      if (priorName && !acc.names.has(code)) acc.names.set(code, priorName)
      const priorContinent = acc.continents.get(existing)
      acc.continents.delete(existing)
      if (priorContinent && !acc.continents.has(code)) acc.continents.set(code, priorContinent)
    }
    acc.keys.add(code)
    if (!acc.names.has(code)) acc.names.set(code, name || code)
    if (nameKey) acc.nameToKey.set(nameKey, code)
    return code
  }

  if (nameKey) {
    // Reuse an existing key for this name — which may already be a canonical code.
    const existing = acc.nameToKey.get(nameKey)
    if (existing) return existing
    const key = `name:${nameKey}`
    acc.keys.add(key)
    if (!acc.names.has(key)) acc.names.set(key, name)
    acc.nameToKey.set(nameKey, key)
    return key
  }

  return undefined
}

interface Metrics {
  flights: number
  distanceKm: number
  countries: CountryAccumulator
  continents: Set<Continent>
  airports: Set<string>
  airlines: Set<string>
  aircraftTypes: Set<string>
  redEyes: number
  equatorCrossings: number
  dateLineCrossings: number
  north: boolean
  south: boolean
  east: boolean
  west: boolean
  maxFlightKm: number
  years: Set<number>
}

function freshMetrics(): Metrics {
  return {
    flights: 0,
    distanceKm: 0,
    countries: newCountryAccumulator(),
    continents: new Set(),
    airports: new Set(),
    airlines: new Set(),
    aircraftTypes: new Set(),
    redEyes: 0,
    equatorCrossings: 0,
    dateLineCrossings: 0,
    north: false,
    south: false,
    east: false,
    west: false,
    maxFlightKm: 0,
    years: new Set(),
  }
}

function applyFlight(metrics: Metrics, flight: FlightLogEntry, lookup: AirportLookup): void {
  if (flight.deletedAt) return
  metrics.flights += 1

  const originCode = normalizeIata(flight.origin ?? '')
  const destinationCode = normalizeIata(flight.destination ?? '')
  if (/^[A-Z]{3}$/.test(originCode)) metrics.airports.add(originCode)
  if (/^[A-Z]{3}$/.test(destinationCode)) metrics.airports.add(destinationCode)

  const airline = flight.airline?.trim()
  if (airline) metrics.airlines.add(airline)
  const aircraft = flight.aircraftType?.trim()
  if (aircraft) metrics.aircraftTypes.add(aircraft)

  const year = Number(flight.date?.slice(0, 4))
  if (Number.isInteger(year) && year > 1900 && year < 3000) metrics.years.add(year)

  const origin = resolveEndpoint(flight, 'origin', lookup)
  const destination = resolveEndpoint(flight, 'destination', lookup)
  for (const airport of [origin, destination]) {
    if (!airport) continue
    const countryKey = registerCountry(metrics.countries, airport)
    if (countryKey) {
      const continent = continentForCountryCode(airport.countryCode)
      if (continent) {
        metrics.continents.add(continent)
        metrics.countries.continents.set(countryKey, continent)
      }
    }
    if (hasCoordinates(airport)) {
      if (airport.lat > 0) metrics.north = true
      else if (airport.lat < 0) metrics.south = true
      if (airport.lon > 0) metrics.east = true
      else if (airport.lon < 0) metrics.west = true
    }
  }

  if (origin && destination && hasCoordinates(origin) && hasCoordinates(destination)) {
    const km = haversineDistanceKm(origin, destination)
    metrics.distanceKm += km
    if (km > metrics.maxFlightKm) metrics.maxFlightKm = km
    if (crossesEquator(origin.lat, destination.lat)) metrics.equatorCrossings += 1
    if (crossesDateLine(origin.lon, destination.lon)) metrics.dateLineCrossings += 1
  }

  if (isRedEye(flight)) metrics.redEyes += 1
}

/** Longest run of consecutive calendar years that each contain at least one flight. */
export function longestConsecutiveYears(years: Iterable<number>): number {
  const sorted = [...new Set(years)].sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  let longest = 1
  let current = 1
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] === sorted[index - 1] + 1) {
      current += 1
      if (current > longest) longest = current
    } else {
      current = 1
    }
  }
  return longest
}

export interface VisitedCountry {
  key: string
  name: string
  continent?: Continent
}

export interface PassportSummary {
  totalFlights: number
  totalDistanceKm: number
  countries: string[]
  countryList: VisitedCountry[]
  countryCount: number
  continents: Continent[]
  airports: string[]
  airlines: string[]
  aircraftTypes: string[]
  redEyes: number
  equatorCrossings: number
  dateLineCrossings: number
  hemispheres: { north: boolean; south: boolean; east: boolean; west: boolean }
  longestYearStreak: number
  earthLaps: number
}

function summarize(metrics: Metrics): PassportSummary {
  const countryList: VisitedCountry[] = [...metrics.countries.names.entries()]
    .map(([key, name]) => ({ key, name, continent: metrics.countries.continents.get(key) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const countries = countryList.map((country) => country.name)
  const continents = CONTINENTS.filter((continent) => metrics.continents.has(continent))
  return {
    totalFlights: metrics.flights,
    totalDistanceKm: Math.round(metrics.distanceKm),
    countries,
    countryList,
    countryCount: metrics.countries.keys.size,
    continents,
    airports: [...metrics.airports].sort(),
    airlines: [...metrics.airlines].sort((a, b) => a.localeCompare(b)),
    aircraftTypes: [...metrics.aircraftTypes].sort((a, b) => a.localeCompare(b)),
    redEyes: metrics.redEyes,
    equatorCrossings: metrics.equatorCrossings,
    dateLineCrossings: metrics.dateLineCrossings,
    hemispheres: { north: metrics.north, south: metrics.south, east: metrics.east, west: metrics.west },
    longestYearStreak: longestConsecutiveYears(metrics.years),
    earthLaps: Math.round((metrics.distanceKm / EARTH_CIRCUMFERENCE_KM) * 10) / 10,
  }
}

export function buildPassportSummary(flights: FlightLogEntry[], lookup: AirportLookup = lookupAirport): PassportSummary {
  const metrics = freshMetrics()
  for (const flight of flights) applyFlight(metrics, flight, lookup)
  return summarize(metrics)
}

export type AchievementCategory = 'reach' | 'distance' | 'frequency' | 'special'
export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum'

export interface Achievement {
  id: string
  category: AchievementCategory
  tier: AchievementTier
  title: string
  description: string
  icon: string
  target: number
  progress: number
  earned: boolean
  earnedDate?: string
}

interface AchievementDef {
  id: string
  category: AchievementCategory
  tier: AchievementTier
  title: string
  description: string
  icon: string
  target: number
  metric: (metrics: Metrics) => number
}

const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { id: 'first-flight', category: 'frequency', tier: 'bronze', title: 'Wheels Up', description: 'Log your first flight.', icon: '🛫', target: 1, metric: (m) => m.flights },
  { id: 'frequent-10', category: 'frequency', tier: 'bronze', title: 'Frequent Flyer', description: 'Log 10 flights.', icon: '✈️', target: 10, metric: (m) => m.flights },
  { id: 'frequent-50', category: 'frequency', tier: 'silver', title: 'Jet Setter', description: 'Log 50 flights.', icon: '🛬', target: 50, metric: (m) => m.flights },
  { id: 'frequent-100', category: 'frequency', tier: 'gold', title: 'Mile-High Regular', description: 'Log 100 flights.', icon: '🎖️', target: 100, metric: (m) => m.flights },
  { id: 'frequent-500', category: 'frequency', tier: 'platinum', title: 'Century Club', description: 'Log 500 flights.', icon: '👑', target: 500, metric: (m) => m.flights },
  { id: 'airports-25', category: 'reach', tier: 'bronze', title: 'Airport Collector', description: 'Visit 25 unique airports.', icon: '🛄', target: 25, metric: (m) => m.airports.size },
  { id: 'airports-50', category: 'reach', tier: 'silver', title: 'Terminal Velocity', description: 'Visit 50 unique airports.', icon: '🧳', target: 50, metric: (m) => m.airports.size },
  { id: 'countries-5', category: 'reach', tier: 'bronze', title: 'Passport Stamped', description: 'Visit 5 countries.', icon: '🛂', target: 5, metric: (m) => m.countries.keys.size },
  { id: 'countries-15', category: 'reach', tier: 'silver', title: 'Globe Trotter', description: 'Visit 15 countries.', icon: '🌍', target: 15, metric: (m) => m.countries.keys.size },
  { id: 'countries-30', category: 'reach', tier: 'gold', title: 'Border Runner', description: 'Visit 30 countries.', icon: '🗺️', target: 30, metric: (m) => m.countries.keys.size },
  { id: 'continents-3', category: 'reach', tier: 'bronze', title: 'Three Continents', description: 'Set foot on 3 continents.', icon: '🧭', target: 3, metric: (m) => m.continents.size },
  { id: 'continents-5', category: 'reach', tier: 'silver', title: 'Five Continents', description: 'Set foot on 5 continents.', icon: '🌐', target: 5, metric: (m) => m.continents.size },
  { id: 'continents-7', category: 'reach', tier: 'platinum', title: 'Seven Continents', description: 'Set foot on all 7 continents.', icon: '🏆', target: 7, metric: (m) => m.continents.size },
  { id: 'longhaul', category: 'distance', tier: 'gold', title: 'Ultra Long-Haul', description: 'Fly a single leg of 10,000 km or more.', icon: '🌏', target: 10000, metric: (m) => m.maxFlightKm },
  { id: 'earth-lap-1', category: 'distance', tier: 'silver', title: 'Around the World', description: 'Fly one lap of the Earth (40,075 km).', icon: '🔄', target: EARTH_CIRCUMFERENCE_KM, metric: (m) => m.distanceKm },
  { id: 'earth-lap-5', category: 'distance', tier: 'platinum', title: 'Five Laps', description: 'Fly five laps of the Earth.', icon: '💫', target: EARTH_CIRCUMFERENCE_KM * 5, metric: (m) => m.distanceKm },
  { id: 'equator', category: 'special', tier: 'silver', title: 'Equator Crosser', description: 'Cross the equator on a flight.', icon: '🟰', target: 1, metric: (m) => m.equatorCrossings },
  { id: 'dateline', category: 'special', tier: 'silver', title: 'Date-Line Jumper', description: 'Cross the international date line.', icon: '🕛', target: 1, metric: (m) => m.dateLineCrossings },
  { id: 'both-hemispheres', category: 'special', tier: 'gold', title: 'Both Hemispheres', description: 'Visit both the northern and southern hemispheres.', icon: '🌗', target: 1, metric: (m) => (m.north && m.south ? 1 : 0) },
  { id: 'red-eye-1', category: 'special', tier: 'bronze', title: 'Red-Eye', description: 'Survive an overnight flight.', icon: '🌙', target: 1, metric: (m) => m.redEyes },
  { id: 'red-eye-10', category: 'special', tier: 'gold', title: 'Night Owl', description: 'Fly 10 overnight red-eyes.', icon: '🦉', target: 10, metric: (m) => m.redEyes },
  { id: 'streak-3', category: 'special', tier: 'silver', title: 'On a Streak', description: 'Fly in 3 consecutive years.', icon: '🔥', target: 3, metric: (m) => longestConsecutiveYears(m.years) },
]

export function buildAchievements(flights: FlightLogEntry[], lookup: AirportLookup = lookupAirport): Achievement[] {
  const active = flights.filter((flight) => !flight.deletedAt)
  const ordered = [...active].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    return (a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : 1
  })
  const metrics = freshMetrics()
  const earnedDates = new Map<string, string>()
  for (const flight of ordered) {
    applyFlight(metrics, flight, lookup)
    for (const def of ACHIEVEMENT_DEFS) {
      if (!earnedDates.has(def.id) && def.metric(metrics) >= def.target) {
        earnedDates.set(def.id, flight.date)
      }
    }
  }
  return ACHIEVEMENT_DEFS.map((def) => {
    const value = def.metric(metrics)
    return {
      id: def.id,
      category: def.category,
      tier: def.tier,
      title: def.title,
      description: def.description,
      icon: def.icon,
      target: def.target,
      progress: Math.min(value, def.target),
      earned: value >= def.target,
      earnedDate: earnedDates.get(def.id),
    }
  })
}

/**
 * A 0-100 "explorer score" from breadth of travel. Free, local-only, and
 * capped at 100 — it rewards variety over raw flight count.
 */
export function passportScore(input: { flights: number; airports: number; countries: number; airlines: number; trips: number }): number {
  return Math.min(100, Math.round(
    input.flights * 1.5 +
    input.airports * 2 +
    input.countries * 3 +
    input.airlines * 1.5 +
    input.trips * 2,
  ))
}

export interface GoalProgress {
  id: 'flightsPerYear' | 'countriesPerYear' | 'airportsPerYear'
  label: string
  target: number
  current: number
  percent: number
  met: boolean
}

/**
 * Progress toward the user's per-year goals for a given calendar year.
 * Only goals with a positive target are returned; a target of 0 means "off".
 */
export function computeGoalProgress(flights: FlightLogEntry[], goals: PassportGoals, year: number, lookup: AirportLookup = lookupAirport): GoalProgress[] {
  const inYear = flights.filter((flight) => !flight.deletedAt && Number(flight.date?.slice(0, 4)) === year)
  const countries = newCountryAccumulator()
  const airportKeys = new Set<string>()
  for (const flight of inYear) {
    for (const role of ['origin', 'destination'] as const) {
      const code = normalizeIata(role === 'origin' ? flight.origin ?? '' : flight.destination ?? '')
      if (/^[A-Z]{3}$/.test(code)) airportKeys.add(code)
      const airport = resolveEndpoint(flight, role, lookup)
      if (airport) registerCountry(countries, airport)
    }
  }
  const rows: Array<{ id: GoalProgress['id']; label: string; target?: number; current: number }> = [
    { id: 'flightsPerYear', label: 'Flights', target: goals.flightsPerYear, current: inYear.length },
    { id: 'countriesPerYear', label: 'Countries', target: goals.countriesPerYear, current: countries.keys.size },
    { id: 'airportsPerYear', label: 'Airports', target: goals.airportsPerYear, current: airportKeys.size },
  ]
  return rows
    .filter((row): row is { id: GoalProgress['id']; label: string; target: number; current: number } => typeof row.target === 'number' && row.target > 0)
    .map((row) => ({
      id: row.id,
      label: row.label,
      target: row.target,
      current: row.current,
      percent: Math.min(100, Math.round((row.current / row.target) * 100)),
      met: row.current >= row.target,
    }))
}
