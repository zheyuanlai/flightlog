import { describe, expect, it } from 'vitest'
import {
  buildAeroDataBoxUrl,
  mapAeroDataBoxStatus,
  normalizeAeroDataBoxFlight,
  normalizeFlightNumber,
  selectBestFlight,
  validateFlightStatusRequest,
} from './index.js'

describe('flight status worker utilities', () => {
  it('normalizes flight numbers and validates query params', () => {
    expect(normalizeFlightNumber(' sq 38 ')).toBe('SQ38')
    const input = validateFlightStatusRequest(new URL('https://worker.test/flight-status?flightNumber=SQ%2038&date=2026-06-02&dateRole=Arrival'))
    expect(input).toEqual({ flightNumber: 'SQ38', date: '2026-06-02', dateRole: 'Arrival' })
  })

  it('rejects invalid dates and date roles before calling the provider', () => {
    expect(validateFlightStatusRequest(new URL('https://worker.test/flight-status?flightNumber=SQ38&date=2026-02-31'))).toEqual({ error: 'date must be a valid calendar date' })
    expect(validateFlightStatusRequest(new URL('https://worker.test/flight-status?flightNumber=SQ38&date=2026-06-02&dateRole=Boarding'))).toEqual({ error: 'dateRole must be Departure or Arrival' })
  })

  it('builds the AeroDataBox specific-date endpoint without flight plan', () => {
    const url = buildAeroDataBoxUrl('SQ38', '2026-06-02', 'Departure')
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

  it('selects an exact flight/date match and warns on ambiguity', () => {
    const flights = [
      { number: 'SQ38', departure: { scheduledTime: { local: '2026-06-01T20:00' } } },
      { number: 'SQ38', departure: { scheduledTime: { local: '2026-06-02T20:00' } } },
      { number: 'SQ38', departure: { scheduledTime: { local: '2026-06-02T21:00' } } },
    ]
    const selected = selectBestFlight(flights, 'SQ38', '2026-06-02', 'Departure')
    expect(selected.flight).toBe(flights[1])
    expect(selected.warnings[0]).toContain('2 matching flights')
  })

  it('normalizes AeroDataBox responses into nested and flat fields', () => {
    const normalized = normalizeAeroDataBoxFlight({
      number: 'SQ 38',
      status: 'Arrived',
      airline: { name: 'Singapore Airlines', iata: 'SQ', icao: 'SIA' },
      departure: {
        airport: { iata: 'SIN', icao: 'WSSS', name: 'Singapore Changi Airport', municipalityName: 'Singapore', countryCode: 'SG', countryName: 'Singapore', location: { lat: 1.3644, lon: 103.9915 } },
        scheduledTime: { local: '2026-06-02T20:45' },
        terminal: '3',
        gate: 'A12',
      },
      arrival: {
        airport: { iata: 'LAX', icao: 'KLAX', name: 'Los Angeles International Airport', municipalityName: 'Los Angeles', countryCode: 'US', countryName: 'United States', location: { lat: 33.9425, lon: -118.4081 } },
        scheduledTime: { local: '2026-06-02T21:55' },
        baggageBelt: '4',
      },
      aircraft: { model: 'Airbus A350-900', reg: '9V-SGA' },
    }, ['provider warning'])

    expect(mapAeroDataBoxStatus('Arrived')).toBe('landed')
    expect(normalized.flightNumber).toBe('SQ38')
    expect(normalized.status).toBe('landed')
    expect(normalized.airline.name).toBe('Singapore Airlines')
    expect(normalized.origin.city).toBe('Singapore')
    expect(normalized.destination.country).toBe('United States')
    expect(normalized.departureAirport.iata).toBe('SIN')
    expect(normalized.aircraftType).toBe('Airbus A350-900')
    expect(normalized.warnings).toEqual(['provider warning'])
  })
})
