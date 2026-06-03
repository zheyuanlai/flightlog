import { describe, expect, it } from 'vitest'
import {
  buildAeroDataBoxUrl,
  mapAeroDataBoxStatus,
  normalizeAeroDataBoxFlight,
  normalizeFlightNumber,
  selectBestFlight,
  validateFlightStatusRequest,
} from './index.js'

const fixtureFlight = {
  number: 'SQ38',
  status: 'EnRoute',
  departure: {
    airport: {
      iata: 'SFO',
      icao: 'KSFO',
      name: 'San Francisco International Airport',
    },
    scheduledTime: { local: '2026-06-02T20:45:00', utc: '2026-06-03T03:45:00Z' },
    revisedTime: { local: '2026-06-02T20:55:00', utc: '2026-06-03T03:55:00Z' },
    terminal: '1',
    gate: 'A12',
  },
  arrival: {
    airport: {
      iata: 'SIN',
      icao: 'WSSS',
      name: 'Singapore Changi Airport',
    },
    scheduledTime: { local: '2026-06-04T06:15:00', utc: '2026-06-03T22:15:00Z' },
    revisedTime: { local: '2026-06-04T06:05:00', utc: '2026-06-03T22:05:00Z' },
    terminal: '3',
    gate: 'B8',
    baggageBelt: '42',
  },
  aircraft: {
    model: 'Airbus A350-900',
    reg: '9V-SGA',
  },
  airline: {
    name: 'Singapore Airlines',
    iata: 'SQ',
    icao: 'SIA',
  },
}

describe('flight status worker helpers', () => {
  it('normalizes and validates flight status query input', () => {
    const url = new URL('https://worker.example/flight-status?flightNumber= sq 38 &date=2026-06-02')
    expect(normalizeFlightNumber(' sq 38 ')).toBe('SQ38')
    expect(validateFlightStatusRequest(url)).toEqual({ flightNumber: 'SQ38', date: '2026-06-02' })
  })

  it('rejects invalid dates before calling the provider', () => {
    const url = new URL('https://worker.example/flight-status?flightNumber=SQ38&date=2026-02-31')
    expect(validateFlightStatusRequest(url)).toEqual({ error: 'date must be a valid calendar date' })
  })

  it('builds the documented AeroDataBox endpoint without flight plan params', () => {
    const url = buildAeroDataBoxUrl('SQ38', '2026-06-02')
    expect(url.toString()).toBe('https://aerodatabox.p.rapidapi.com/flights/number/SQ38/2026-06-02?dateLocalRole=Departure')
    expect(url.searchParams.has('withFlightPlan')).toBe(false)
  })

  it('maps AeroDataBox statuses into frontend statuses', () => {
    expect(mapAeroDataBoxStatus('Expected')).toBe('scheduled')
    expect(mapAeroDataBoxStatus('EnRoute')).toBe('active')
    expect(mapAeroDataBoxStatus('Arrived')).toBe('landed')
    expect(mapAeroDataBoxStatus('Canceled')).toBe('cancelled')
    expect(mapAeroDataBoxStatus('Diverted')).toBe('diverted')
  })

  it('selects the exact flight number and scheduled departure date first', () => {
    const otherDate = {
      ...fixtureFlight,
      departure: {
        ...fixtureFlight.departure,
        scheduledTime: { local: '2026-06-01T20:45:00' },
      },
    }
    const { flight, warning } = selectBestFlight([otherDate, fixtureFlight], 'SQ38', '2026-06-02')
    expect(flight).toBe(fixtureFlight)
    expect(warning).toBeUndefined()
  })

  it('normalizes AeroDataBox flight data into the frontend shape', () => {
    expect(normalizeAeroDataBoxFlight(fixtureFlight)).toEqual({
      status: 'active',
      airlineName: 'Singapore Airlines',
      airlineIata: 'SQ',
      airlineIcao: 'SIA',
      flightNumber: 'SQ38',
      departureAirport: { iata: 'SFO', icao: 'KSFO', name: 'San Francisco International Airport' },
      arrivalAirport: { iata: 'SIN', icao: 'WSSS', name: 'Singapore Changi Airport' },
      scheduledDeparture: '2026-06-02T20:45:00',
      estimatedDeparture: '2026-06-02T20:55:00',
      actualDeparture: undefined,
      scheduledArrival: '2026-06-04T06:15:00',
      estimatedArrival: '2026-06-04T06:05:00',
      actualArrival: undefined,
      departureTerminal: '1',
      departureGate: 'A12',
      arrivalTerminal: '3',
      arrivalGate: 'B8',
      baggageClaim: '42',
      aircraftType: 'Airbus A350-900',
      aircraftRegistration: '9V-SGA',
      provider: 'AeroDataBox',
      rawProviderStatus: 'EnRoute',
      warning: undefined,
    })
  })
})
