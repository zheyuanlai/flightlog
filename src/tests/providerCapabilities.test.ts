import { describe, expect, it } from 'vitest'
import { buildCapabilitiesUrl, DEFAULT_PROVIDER_CAPABILITIES, fetchProviderCapabilities, normalizeProviderCapabilities } from '../utils/providerCapabilities'

describe('provider capabilities client', () => {
  it('builds the capabilities URL', () => {
    expect(buildCapabilitiesUrl('https://worker.example/')).toBe('https://worker.example/capabilities')
    expect(buildCapabilitiesUrl('https://worker.example')).toBe('https://worker.example/capabilities')
  })

  it('fails open to full capabilities when no base URL is configured', async () => {
    expect(await fetchProviderCapabilities({ baseUrl: '' })).toEqual(DEFAULT_PROVIDER_CAPABILITIES)
  })

  it('fails open when the fetch throws (offline, no /capabilities route on an older Worker, etc.)', async () => {
    const fetcher = async () => { throw new Error('network down') }
    const result = await fetchProviderCapabilities({ baseUrl: 'https://worker.example', fetcher: fetcher as unknown as typeof fetch })
    expect(result).toEqual(DEFAULT_PROVIDER_CAPABILITIES)
  })

  it('fails open on a non-2xx response', async () => {
    const fetcher = async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    const result = await fetchProviderCapabilities({ baseUrl: 'https://worker.example', fetcher: fetcher as unknown as typeof fetch })
    expect(result).toEqual(DEFAULT_PROVIDER_CAPABILITIES)
  })

  it('fetches and normalizes a real capabilities response', async () => {
    const fetcher = async () => new Response(JSON.stringify({ provider: 'aerodatabox', mode: 'real', supportsFlightStatus: true, supportsAirportStatus: false, supportsAircraftHistory: true }), { status: 200 })
    const result = await fetchProviderCapabilities({ baseUrl: 'https://worker.example', fetcher: fetcher as unknown as typeof fetch })
    expect(result).toEqual({ provider: 'aerodatabox', mode: 'real', supportsFlightStatus: true, supportsAirportStatus: false, supportsAircraftHistory: true })
  })

  it('normalizes a malformed payload to the fail-open/fail-closed defaults', () => {
    expect(normalizeProviderCapabilities(null)).toEqual(DEFAULT_PROVIDER_CAPABILITIES)
    expect(normalizeProviderCapabilities({ supportsAirportStatus: 'nope' })).toEqual(DEFAULT_PROVIDER_CAPABILITIES)
    expect(normalizeProviderCapabilities({ provider: 'flightaware', supportsFlightStatus: false })).toEqual({
      provider: 'flightaware', mode: 'unknown', supportsFlightStatus: false, supportsAirportStatus: true, supportsAircraftHistory: false,
    })
  })

  it('defaults supportsAircraftHistory to false (fail-closed) when a redeployed-but-older Worker omits the new field', () => {
    expect(normalizeProviderCapabilities({ provider: 'aerodatabox', mode: 'real', supportsFlightStatus: true, supportsAirportStatus: true })).toEqual({
      provider: 'aerodatabox', mode: 'real', supportsFlightStatus: true, supportsAirportStatus: true, supportsAircraftHistory: false,
    })
  })
})
