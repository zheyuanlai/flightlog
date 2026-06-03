import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const AIRPORTS_CSV = resolve('data/source/airports.csv')
const COUNTRIES_CSV = resolve('data/source/countries.csv')
const OUTPUT_JSON = resolve('public/data/airports.generated.json')

const typeRank = new Map([
  ['large_airport', 5],
  ['medium_airport', 4],
  ['small_airport', 3],
  ['heliport', 2],
  ['seaplane_base', 2],
  ['balloonport', 1],
  ['closed', 0],
])

function parseCsv(csv) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index]
    const next = csv[index + 1]
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        value += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(value)
      value = ''
    } else if (char === '\n') {
      row.push(value)
      rows.push(row)
      row = []
      value = ''
    } else if (char !== '\r') {
      value += char
    }
  }
  if (value || row.length > 0) {
    row.push(value)
    rows.push(row)
  }

  const [headers = [], ...data] = rows
  return data
    .filter((fields) => fields.some(Boolean))
    .map((fields) => Object.fromEntries(headers.map((header, index) => [header, fields[index] ?? ''])))
}

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cleanNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function hasCoordinates(airport) {
  return typeof airport.lat === 'number' && typeof airport.lon === 'number'
}

function airportScore(airport) {
  return [
    airport.scheduledService ? 1 : 0,
    typeRank.get(airport.type) ?? 0,
    airport.icao ? 1 : 0,
    hasCoordinates(airport) ? 1 : 0,
    airport.name.length,
  ]
}

function isBetterAirport(candidate, current) {
  const candidateScore = airportScore(candidate)
  const currentScore = airportScore(current)
  for (let index = 0; index < candidateScore.length; index += 1) {
    if (candidateScore[index] !== currentScore[index]) return candidateScore[index] > currentScore[index]
  }
  return candidate.iata.localeCompare(current.iata) < 0
}

const countryRows = parseCsv(await readFile(COUNTRIES_CSV, 'utf8'))
const countries = new Map(countryRows.map((row) => [row.code, clean(row.name) ?? row.code]))
const airportRows = parseCsv(await readFile(AIRPORTS_CSV, 'utf8'))
const deduped = new Map()

for (const row of airportRows) {
  const iata = clean(row.iata_code)?.toUpperCase()
  if (!iata || !/^[A-Z]{3}$/.test(iata)) continue
  const lat = cleanNumber(row.latitude_deg)
  const lon = cleanNumber(row.longitude_deg)
  const countryCode = clean(row.iso_country)?.toUpperCase()
  const airport = {
    iata,
    icao: clean(row.ident)?.toUpperCase(),
    name: clean(row.name) ?? iata,
    city: clean(row.municipality) ?? clean(row.name) ?? iata,
    countryCode,
    countryName: countryCode ? countries.get(countryCode) : undefined,
    country: (countryCode ? countries.get(countryCode) : undefined) ?? countryCode ?? '',
    lat,
    lon,
    timezone: clean(row.timezone),
    type: clean(row.type),
    scheduledService: clean(row.scheduled_service)?.toLowerCase() === 'yes',
  }
  const current = deduped.get(iata)
  if (!current || isBetterAirport(airport, current)) deduped.set(iata, airport)
}

const airports = [...deduped.values()].sort((a, b) => a.iata.localeCompare(b.iata))
await mkdir(dirname(OUTPUT_JSON), { recursive: true })
await writeFile(OUTPUT_JSON, `${JSON.stringify(airports)}\n`, 'utf8')
console.log(`Generated ${airports.length} airports -> ${OUTPUT_JSON}`)
