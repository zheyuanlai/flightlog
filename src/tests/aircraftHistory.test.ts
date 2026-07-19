import { describe, expect, it } from 'vitest'
import { buildAircraftHistoryUrl, fetchAircraftLookup, mockAircraftLookup, normalizeAircraftLookup, normalizeRegistration } from '../utils/aircraftHistory'

describe('normalizeRegistration', () => {
  it('trims and uppercases', () => {
    expect(normalizeRegistration(' 9v-sga ')).toBe('9V-SGA')
  })
})

describe('buildAircraftHistoryUrl', () => {
  it('builds the query URL regardless of a trailing slash on the base', () => {
    expect(buildAircraftHistoryUrl('https://worker.example/', '9v-sga')).toBe('https://worker.example/aircraft-history?registration=9V-SGA')
    expect(buildAircraftHistoryUrl('https://worker.example', '9V-SGA')).toBe('https://worker.example/aircraft-history?registration=9V-SGA')
  })
})

describe('fetchAircraftLookup', () => {
  it('rejects an empty registration without making a network call', async () => {
    await expect(fetchAircraftLookup('   ')).rejects.toThrow('Enter an aircraft registration.')
  })

  it('throws when live data is disabled in Settings', async () => {
    await expect(fetchAircraftLookup('9V-SGA', { liveDataMode: 'disabled' })).rejects.toThrow('Live data is disabled in Settings.')
  })

  it('returns deterministic mock data without a network call when useMock is set', async () => {
    const result = await fetchAircraftLookup('9V-SGA', { useMock: true })
    expect(result).toEqual(mockAircraftLookup('9V-SGA'))
  })

  it('throws when no base URL is configured and mock is not requested', async () => {
    await expect(fetchAircraftLookup('9V-SGA', { baseUrl: '' })).rejects.toThrow('live data proxy is not configured')
  })

  it('fetches and normalizes a real response', async () => {
    const fetcher = async () => new Response(JSON.stringify({ registration: '9V-SGA', type: 'Airbus A350-900', ageYears: 5.2 }), { status: 200 })
    const result = await fetchAircraftLookup('9v-sga', { baseUrl: 'https://worker.example', fetcher: fetcher as unknown as typeof fetch })
    expect(result.registration).toBe('9V-SGA')
    expect(result.type).toBe('Airbus A350-900')
    expect(result.ageYears).toBe(5.2)
  })

  it('surfaces the provider error message from a non-2xx response', async () => {
    const fetcher = async () => new Response(JSON.stringify({ error: 'No aircraft found for this registration.' }), { status: 404 })
    await expect(fetchAircraftLookup('ZZ-NONE', { baseUrl: 'https://worker.example', fetcher: fetcher as unknown as typeof fetch }))
      .rejects.toThrow('No aircraft found for this registration.')
  })

  it('surfaces a network failure as a friendly message', async () => {
    const fetcher = async () => { throw new Error('network down') }
    await expect(fetchAircraftLookup('9V-SGA', { baseUrl: 'https://worker.example', fetcher: fetcher as unknown as typeof fetch }))
      .rejects.toThrow('Aircraft lookup is unavailable right now.')
  })
})

describe('normalizeAircraftLookup', () => {
  it('falls back to the requested registration when the payload omits one', () => {
    expect(normalizeAircraftLookup({}, '9v-sga').registration).toBe('9V-SGA')
  })

  it('drops non-string warnings entries and ignores a malformed payload', () => {
    const result = normalizeAircraftLookup({ warnings: ['ok', 42, null] }, '9V-SGA')
    expect(result.warnings).toEqual(['ok'])
    expect(normalizeAircraftLookup(null, '9V-SGA').registration).toBe('9V-SGA')
  })
})
