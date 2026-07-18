import { describe, expect, it } from 'vitest'
import { detectColumnMapping, importDelimitedFlights } from '../utils/importers'

describe('column mapping detection', () => {
  it('maps Flighty-style headers', () => {
    const mapping = detectColumnMapping(['Date', 'Airline', 'Flight', 'From', 'To', 'Aircraft Type Name', 'Tail Number', 'Seat', 'Cabin Class', 'Notes'])
    expect(mapping.date).toBe('Date')
    expect(mapping.flightNumber).toBe('Flight')
    expect(mapping.origin).toBe('From')
    expect(mapping.destination).toBe('To')
    expect(mapping.aircraftType).toBe('Aircraft Type Name')
    expect(mapping.aircraftRegistration).toBe('Tail Number')
    expect(mapping.cabin).toBe('Cabin Class')
  })

  it('maps myFlightradar24-style headers', () => {
    const mapping = detectColumnMapping(['Date', 'Flight number', 'From', 'To', 'Airline', 'Aircraft', 'Registration', 'Seat number', 'Seat type', 'Note'])
    expect(mapping.flightNumber).toBe('Flight number')
    expect(mapping.airline).toBe('Airline')
    expect(mapping.aircraftType).toBe('Aircraft')
    expect(mapping.seat).toBe('Seat number')
    expect(mapping.cabin).toBe('Seat type')
    expect(mapping.notes).toBe('Note')
  })

  it('does not reuse a source column for two fields', () => {
    const mapping = detectColumnMapping(['Date', 'Flight', 'Airline', 'From', 'To'])
    const usedColumns = Object.values(mapping)
    expect(new Set(usedColumns).size).toBe(usedColumns.length)
  })
})

describe('delimited import', () => {
  const flightyCsv = [
    'Date,Airline,Flight,From,To,Aircraft Type Name,Tail Number,Seat,Cabin Class,Notes',
    '2026-06-02,Singapore Airlines,SQ 38,SIN,LAX,Airbus A350-900,9V-SGA,11A,Business,Great flight',
    'Jun 9 2026,United Airlines,UA 60,SFO,NRT,Boeing 777-300ER,N2846U,32K,Economy,',
  ].join('\n')

  it('imports rows, coercing dates and normalizing flight numbers', () => {
    const result = importDelimitedFlights(flightyCsv, { preset: 'flighty', source: 'manual' })
    expect(result.errors).toEqual([])
    expect(result.valid).toHaveLength(2)
    expect(result.valid[0].flightNumber).toBe('SQ38')
    expect(result.valid[0].origin).toBe('SIN')
    expect(result.valid[0].cabin).toBe('Business')
    expect(result.valid[1].date).toBe('2026-06-09') // coerced from "Jun 9 2026"
    expect(result.valid[1].flightNumber).toBe('UA60')
  })

  it('reports rows with unparseable dates or invalid airports without dropping the rest', () => {
    const csv = [
      'Date,Airline,Flight,From,To',
      'not-a-date,Delta,DL1,ATL,LAX',
      '2026-06-02,Delta,DL2,ZZ,LAX',
      '2026-06-02,Delta,DL3,ATL,JFK',
    ].join('\n')
    const result = importDelimitedFlights(csv)
    expect(result.valid).toHaveLength(1)
    expect(result.valid[0].flightNumber).toBe('DL3')
    expect(result.errors.some((error) => error.includes('could not parse date'))).toBe(true)
    expect(result.errors.some((error) => error.includes('IATA'))).toBe(true)
  })

  it('fails clearly when a required column is missing', () => {
    const csv = ['When,Flight,From,To', '2026-06-02,DL1,ATL,LAX'].join('\n')
    const result = importDelimitedFlights(csv)
    expect(result.valid).toHaveLength(0)
    expect(result.unmappedRequired).toContain('airline')
    expect(result.errors.some((error) => error.includes('Airline'))).toBe(true)
  })

  it('combines a row date with myFlightradar24-style bare Dep/Arr time columns', () => {
    const csv = [
      'Date,Flight number,From,To,Airline,Dep time,Arr time',
      '2026-06-02,SQ38,SIN,LAX,Singapore Airlines,14:05,08:30',
    ].join('\n')
    const result = importDelimitedFlights(csv, { preset: 'flightradar24' })
    expect(result.errors).toEqual([])
    expect(result.valid[0].scheduledDeparture).toBe('2026-06-02T14:05')
    expect(result.valid[0].scheduledArrival).toBe('2026-06-02T08:30')
  })

  it('rejects impossible ISO dates instead of importing them verbatim', () => {
    const csv = ['Date,Airline,Flight,From,To', '2026-02-30,Delta,DL1,ATL,LAX'].join('\n')
    const result = importDelimitedFlights(csv)
    expect(result.valid).toHaveLength(0)
    expect(result.errors.some((error) => error.includes('could not parse date'))).toBe(true)
  })

  it('parses 2-digit-year and dd-MMM-yyyy dates', () => {
    const csv = ['Date,Airline,Flight,From,To', '06/02/26,Delta,DL1,ATL,LAX', '04-Jun-2026,Delta,DL2,ATL,JFK'].join('\n')
    const result = importDelimitedFlights(csv)
    expect(result.valid).toHaveLength(2)
    expect(result.valid[0].date).toBe('2026-06-02')
    expect(result.valid[1].date).toBe('2026-06-04')
  })

  it('warns when slash dates are ambiguous', () => {
    const csv = ['Date,Airline,Flight,From,To', '03/04/2026,Delta,DL1,ATL,LAX'].join('\n')
    const result = importDelimitedFlights(csv)
    expect(result.valid[0].date).toBe('2026-03-04') // US M/D default
    expect(result.warnings.some((warning) => warning.includes('ambiguous'))).toBe(true)
  })

  it('honors an explicit manual mapping', () => {
    const csv = ['When,Carrier Name,Nbr,Dep,Arr', '2026-06-02,Delta,DL1,ATL,LAX'].join('\n')
    const mapping = { date: 'When', airline: 'Carrier Name', flightNumber: 'Nbr', origin: 'Dep', destination: 'Arr' }
    const result = importDelimitedFlights(csv, { mapping })
    expect(result.valid).toHaveLength(1)
    expect(result.valid[0].airline).toBe('Delta')
    expect(result.valid[0].origin).toBe('ATL')
  })
})
