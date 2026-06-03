import type { FlightLogEntry, FlightLiveStatus } from '../types'
import { normalizeFlightNumber } from './liveStatus'

export interface AirlineMetadata {
  name: string
  iata?: string
  icao?: string
  country?: string
  website?: string
  checkInUrl?: string
}

const airlines: AirlineMetadata[] = [
  { name: 'Singapore Airlines', iata: 'SQ', icao: 'SIA', country: 'Singapore', website: 'https://www.singaporeair.com/', checkInUrl: 'https://www.singaporeair.com/checkin' },
  { name: 'United Airlines', iata: 'UA', icao: 'UAL', country: 'United States', website: 'https://www.united.com/', checkInUrl: 'https://www.united.com/checkin' },
  { name: 'Delta Air Lines', iata: 'DL', icao: 'DAL', country: 'United States', website: 'https://www.delta.com/', checkInUrl: 'https://www.delta.com/checkin' },
  { name: 'American Airlines', iata: 'AA', icao: 'AAL', country: 'United States', website: 'https://www.aa.com/', checkInUrl: 'https://www.aa.com/reservation/flightCheckInViewReservationsAccess.do' },
  { name: 'British Airways', iata: 'BA', icao: 'BAW', country: 'United Kingdom', website: 'https://www.britishairways.com/', checkInUrl: 'https://www.britishairways.com/travel/olcilandingpageauthreq/public/en_us' },
  { name: 'Qantas', iata: 'QF', icao: 'QFA', country: 'Australia', website: 'https://www.qantas.com/', checkInUrl: 'https://www.qantas.com/checkin' },
  { name: 'Lufthansa', iata: 'LH', icao: 'DLH', country: 'Germany', website: 'https://www.lufthansa.com/', checkInUrl: 'https://www.lufthansa.com/check-in' },
  { name: 'Air France', iata: 'AF', icao: 'AFR', country: 'France', website: 'https://www.airfrance.com/', checkInUrl: 'https://www.airfrance.com/check-in' },
  { name: 'KLM', iata: 'KL', icao: 'KLM', country: 'Netherlands', website: 'https://www.klm.com/', checkInUrl: 'https://www.klm.com/check-in' },
  { name: 'Emirates', iata: 'EK', icao: 'UAE', country: 'United Arab Emirates', website: 'https://www.emirates.com/', checkInUrl: 'https://www.emirates.com/manage-booking/online-check-in/' },
  { name: 'Cathay Pacific', iata: 'CX', icao: 'CPA', country: 'Hong Kong', website: 'https://www.cathaypacific.com/', checkInUrl: 'https://www.cathaypacific.com/check-in' },
  { name: 'Japan Airlines', iata: 'JL', icao: 'JAL', country: 'Japan', website: 'https://www.jal.com/', checkInUrl: 'https://www.jal.co.jp/jp/en/inter/checkin/' },
  { name: 'All Nippon Airways', iata: 'NH', icao: 'ANA', country: 'Japan', website: 'https://www.ana.co.jp/', checkInUrl: 'https://www.ana.co.jp/en/us/travel-information/online-check-in/' },
  { name: 'Southwest Airlines', iata: 'WN', icao: 'SWA', country: 'United States', website: 'https://www.southwest.com/', checkInUrl: 'https://www.southwest.com/air/check-in/' },
]

const byIata = new Map(airlines.flatMap((airline) => airline.iata ? [[airline.iata, airline] as const] : []))
const byIcao = new Map(airlines.flatMap((airline) => airline.icao ? [[airline.icao, airline] as const] : []))

function normalizeName(value?: string): string {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? ''
}

export function lookupAirline(input: { name?: string; iata?: string; icao?: string; flightNumber?: string }): AirlineMetadata | undefined {
  const iata = input.iata?.trim().toUpperCase()
  const icao = input.icao?.trim().toUpperCase()
  const flightPrefix = normalizeFlightNumber(input.flightNumber ?? '').match(/^[A-Z]+/)?.[0]
  return (iata ? byIata.get(iata) : undefined)
    ?? (flightPrefix ? byIata.get(flightPrefix) : undefined)
    ?? (icao ? byIcao.get(icao) : undefined)
    ?? airlines.find((airline) => normalizeName(airline.name) === normalizeName(input.name))
}

export function airlineForFlight(flight: FlightLogEntry): AirlineMetadata | undefined {
  return lookupAirline({
    name: flight.airline,
    iata: flight.airlineIata ?? flight.liveStatus?.airlineIata ?? flight.liveStatus?.airline?.iata,
    icao: flight.airlineIcao ?? flight.liveStatus?.airlineIcao ?? flight.liveStatus?.airline?.icao,
    flightNumber: flight.flightNumber,
  })
}

export function airlineForLiveStatus(liveStatus: FlightLiveStatus): AirlineMetadata | undefined {
  return lookupAirline({
    name: liveStatus.airlineName ?? liveStatus.airline?.name,
    iata: liveStatus.airlineIata ?? liveStatus.airline?.iata,
    icao: liveStatus.airlineIcao ?? liveStatus.airline?.icao,
    flightNumber: liveStatus.flightNumber,
  })
}

export function airlineSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${query} airline official website`)}`
}

export function airlineDisplayName(flightOrName: FlightLogEntry | string): string {
  if (typeof flightOrName === 'string') return lookupAirline({ name: flightOrName, iata: flightOrName })?.name ?? flightOrName
  return airlineForFlight(flightOrName)?.name ?? flightOrName.airline
}
