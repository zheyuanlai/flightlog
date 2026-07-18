import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import type { FlightLogEntry } from '../types'
import { buildAirportStatusUrl, fetchAirportStatus, normalizeAirportStatus } from '../utils/airportStatus'
import { refreshRecommendation } from '../utils/refreshCadence'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'depth-flight',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    scheduledDepartureUtc: '2026-06-02T12:00:00Z',
    scheduledArrivalUtc: '2026-06-03T02:30:00Z',
    originTimeZone: 'Asia/Singapore',
    destinationTimeZone: 'America/Los_Angeles',
    purpose: 'personal',
    source: 'aerodatabox',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('airport status client', () => {
  it('builds the proxy URL', () => {
    expect(buildAirportStatusUrl('https://worker.example/', 'sin', 6)).toBe('https://worker.example/airport-status?iata=SIN&hours=6')
  })

  it('returns deterministic mock data in mock mode', async () => {
    const status = await fetchAirportStatus('SIN', { liveDataMode: 'mock' })
    expect(status.airport).toBe('SIN')
    expect(status.departures.onTimePercent).toBe(75)
    expect(status.provider).toBe('mock')
  })

  it('rejects invalid airport codes and disabled mode', async () => {
    await expect(fetchAirportStatus('ZZZZ', { liveDataMode: 'mock' })).rejects.toThrow(/valid 3-letter/)
    await expect(fetchAirportStatus('SIN', { liveDataMode: 'disabled' })).rejects.toThrow(/disabled/)
  })

  it('fetches and normalizes a real proxy response via an injected fetcher', async () => {
    const fetcher = async () => new Response(JSON.stringify({
      airport: 'SIN',
      departures: { total: 10, onTime: 8, delayed: 2, cancelled: 0, avgDelayMinutes: 12, onTimePercent: 80 },
      arrivals: { total: 9, onTime: 9, delayed: 0, cancelled: 0, avgDelayMinutes: 3, onTimePercent: 100 },
      sample: [{ flightNumber: 'SQ38', direction: 'departure', status: 'on-time', otherAirport: 'LAX' }],
      provider: 'AeroDataBox',
    }), { status: 200 })
    const status = await fetchAirportStatus('SIN', { liveDataMode: 'real', baseUrl: 'https://worker.example', fetcher: fetcher as unknown as typeof fetch })
    expect(status.arrivals.onTimePercent).toBe(100)
    expect(status.sample[0].otherAirport).toBe('LAX')
  })

  it('surfaces a proxy error body', async () => {
    const fetcher = async () => new Response(JSON.stringify({ error: 'API quota or rate limit reached.' }), { status: 429 })
    await expect(fetchAirportStatus('SIN', { liveDataMode: 'real', baseUrl: 'https://worker.example', fetcher: fetcher as unknown as typeof fetch })).rejects.toThrow(/quota/)
  })

  it('normalizes a malformed payload without throwing', () => {
    const status = normalizeAirportStatus({ airport: 'SIN', departures: null, sample: 'nope' }, 'SIN')
    expect(status.departures.total).toBe(0)
    expect(status.sample).toEqual([])
  })

  it('sanitizes sample entries so only primitives reach the renderer', () => {
    const status = normalizeAirportStatus({
      airport: 'SIN',
      sample: [
        { direction: 'departure', status: { code: 1 }, flightNumber: { x: 1 }, delayMinutes: 'later' },
        { direction: 'arrival', status: 'delayed', flightNumber: 'BA11', delayMinutes: 20, otherAirport: 'LHR' },
        null,
        42,
      ],
    }, 'SIN')
    expect(status.sample).toHaveLength(2)
    // Non-primitive status/flightNumber coerced to safe defaults / dropped.
    expect(status.sample[0]).toEqual({ direction: 'departure', status: 'on-time' })
    expect(status.sample[1]).toEqual({ direction: 'arrival', status: 'delayed', flightNumber: 'BA11', delayMinutes: 20, otherAirport: 'LHR' })
    for (const item of status.sample) {
      for (const val of Object.values(item)) {
        expect(typeof val === 'string' || typeof val === 'number').toBe(true)
      }
    }
  })
})

describe('refresh cadence', () => {
  it('recommends a tight cadence en route and flags a refresh when stale', () => {
    const enRoute = flight({ lastFetchedAt: '2026-06-02T19:00:00Z' })
    const now = DateTime.fromISO('2026-06-02T19:15:00Z') // 15m stale, en route, interval 10m
    const rec = refreshRecommendation(enRoute, now)
    expect(rec.urgency).toBe('now')
    expect(rec.suggestedIntervalMinutes).toBe(10)
  })

  it('says current when recently refreshed', () => {
    const enRoute = flight({ lastFetchedAt: '2026-06-02T19:13:00Z' })
    const rec = refreshRecommendation(enRoute, DateTime.fromISO('2026-06-02T19:15:00Z')) // 2m old
    expect(rec.urgency).toBe('later')
    expect(rec.label).toBe('Status is current')
  })

  it('uses an hourly cadence during check-in', () => {
    const rec = refreshRecommendation(flight(), DateTime.fromISO('2026-06-01T20:00:00Z')) // check-in window
    expect(rec.suggestedIntervalMinutes).toBe(60)
  })

  it('does not nudge for scheduled, completed, or landed-with-arrival flights', () => {
    expect(refreshRecommendation(flight(), DateTime.fromISO('2026-05-28T00:00:00Z')).urgency).toBe('none')
    expect(refreshRecommendation(flight(), DateTime.fromISO('2026-06-10T00:00:00Z')).urgency).toBe('none')
    const landedWithArrival = flight({ liveStatus: { status: 'landed' }, actualArrivalUtc: '2026-06-03T02:25:00Z' })
    expect(refreshRecommendation(landedWithArrival, DateTime.fromISO('2026-06-03T03:00:00Z')).urgency).toBe('none')
  })

  it('nudges a landed flight that is still missing an actual arrival', () => {
    const landed = flight({ liveStatus: { status: 'landed' }, lastFetchedAt: '2026-06-03T02:00:00Z' })
    const rec = refreshRecommendation(landed, DateTime.fromISO('2026-06-03T03:00:00Z'))
    expect(rec.urgency).toBe('now')
  })
})
