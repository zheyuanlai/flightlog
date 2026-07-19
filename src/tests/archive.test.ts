import { describe, expect, it } from 'vitest'
import type { FlightLogEntry } from '../types'
import { createFullBackup } from '../utils/backup'
import type { Achievement } from '../utils/achievements'
import {
  ARCHIVE_FORMAT,
  ARCHIVE_PAYLOAD_ELEMENT_ID,
  buildArchivePayload,
  buildArchiveSummarySnapshot,
  detectAndVerifyArchive,
  estimateArchiveSize,
  isArchivePayload,
  resolveImportableJsonText,
  verifyArchiveChecksum,
} from '../utils/archive'

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'archive-flight',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    purpose: 'personal',
    source: 'aerodatabox',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

function achievement(overrides: Partial<Achievement> = {}): Achievement {
  return {
    id: 'first-flight',
    category: 'frequency',
    tier: 'bronze',
    title: 'Wheels Up',
    description: 'Log your first flight.',
    icon: '🛫',
    target: 1,
    progress: 1,
    earned: true,
    earnedDate: '2026-06-02',
    ...overrides,
  }
}

describe('buildArchivePayload / verifyArchiveChecksum', () => {
  it('produces a payload that extends FlightLogBackup and verifies its own checksum', async () => {
    const backup = createFullBackup({ flights: [flight()], tripMetadata: [], providerAirports: [], appMetadata: [] })
    const summary = buildArchiveSummarySnapshot(backup.flights, { countryCount: 1, totalDistanceKm: 100 })
    const payload = await buildArchivePayload({ backup, summary, achievements: [achievement()], now: '2026-06-03T00:00:00.000Z' })

    expect(payload.archiveFormat).toBe(ARCHIVE_FORMAT)
    expect(payload.flights).toEqual([flight()])
    expect(isArchivePayload(payload)).toBe(true)
    expect(await verifyArchiveChecksum(payload)).toBe(true)
  })

  it('only embeds earned achievements', async () => {
    const backup = createFullBackup({ flights: [], tripMetadata: [], providerAirports: [], appMetadata: [] })
    const summary = buildArchiveSummarySnapshot([], { countryCount: 0, totalDistanceKm: 0 })
    const payload = await buildArchivePayload({
      backup,
      summary,
      achievements: [achievement({ id: 'earned', earned: true }), achievement({ id: 'locked', earned: false, earnedDate: undefined })],
    })
    expect(payload.archiveAchievements.map((item) => item.id)).toEqual(['earned'])
  })

  it('detects tampering: editing any field after signing fails verification', async () => {
    const backup = createFullBackup({ flights: [flight()], tripMetadata: [], providerAirports: [], appMetadata: [] })
    const summary = buildArchiveSummarySnapshot(backup.flights, { countryCount: 1, totalDistanceKm: 100 })
    const payload = await buildArchivePayload({ backup, summary, achievements: [] })
    const tampered = { ...payload, flights: [flight({ flightNumber: 'AA100' })] }
    expect(await verifyArchiveChecksum(tampered)).toBe(false)
  })

  it('fails closed (does not throw) on a malformed payload', async () => {
    const malformed = { archiveFormat: ARCHIVE_FORMAT, archiveChecksum: 'x', flights: 'not-an-array' } as never
    expect(await verifyArchiveChecksum(malformed)).toBe(false)
  })
})

describe('isArchivePayload / detectAndVerifyArchive', () => {
  it('rejects a plain backup and a trip-share file', async () => {
    const backup = createFullBackup({ flights: [flight()], tripMetadata: [], providerAirports: [], appMetadata: [] })
    expect(isArchivePayload(backup)).toBe(false)
    expect(await detectAndVerifyArchive(JSON.stringify(backup))).toBeUndefined()
    expect(await detectAndVerifyArchive(JSON.stringify({ ...backup, shareFormat: 'flightlog-trip-share' }))).toBeUndefined()
  })

  it('returns undefined for invalid JSON rather than throwing', async () => {
    expect(await detectAndVerifyArchive('{not json')).toBeUndefined()
  })

  it('detects and verifies a genuine archive payload round-tripped through JSON', async () => {
    const backup = createFullBackup({ flights: [flight()], tripMetadata: [], providerAirports: [], appMetadata: [] })
    const summary = buildArchiveSummarySnapshot(backup.flights, { countryCount: 1, totalDistanceKm: 100 })
    const payload = await buildArchivePayload({ backup, summary, achievements: [] })
    const detection = await detectAndVerifyArchive(JSON.stringify(payload))
    expect(detection).toEqual({ checksumValid: true, generatedAt: payload.archiveGeneratedAt, flightCount: 1, summary })
  })

  it('fails closed (returns undefined, never throws) on an archive-shaped payload missing flights or archiveSummary', async () => {
    await expect(detectAndVerifyArchive(JSON.stringify({ archiveFormat: ARCHIVE_FORMAT }))).resolves.toBeUndefined()
    await expect(detectAndVerifyArchive(JSON.stringify({ archiveFormat: ARCHIVE_FORMAT, flights: 'not-an-array', archiveSummary: {} }))).resolves.toBeUndefined()
    await expect(detectAndVerifyArchive(JSON.stringify({ archiveFormat: ARCHIVE_FORMAT, flights: [] }))).resolves.toBeUndefined()
    expect(isArchivePayload({ archiveFormat: ARCHIVE_FORMAT })).toBe(false)
    expect(isArchivePayload({ archiveFormat: ARCHIVE_FORMAT, flights: [], archiveSummary: {} })).toBe(true)
  })
})

describe('resolveImportableJsonText', () => {
  it('passes plain JSON text through unchanged', () => {
    expect(resolveImportableJsonText('{"a":1}')).toBe('{"a":1}')
    expect(resolveImportableJsonText('  [1,2,3]')).toBe('  [1,2,3]')
  })

  it('extracts the embedded payload script from an archive HTML document', () => {
    const html = `<!doctype html><html><body><script type="application/json" id="${ARCHIVE_PAYLOAD_ELEMENT_ID}">{"archiveFormat":"${ARCHIVE_FORMAT}"}</script></body></html>`
    expect(resolveImportableJsonText(html)).toBe(`{"archiveFormat":"${ARCHIVE_FORMAT}"}`)
  })

  it('falls back to the raw text when the HTML has no payload element', () => {
    const html = '<!doctype html><html><body><p>no payload here</p></body></html>'
    expect(resolveImportableJsonText(html)).toBe(html)
  })
})

describe('estimateArchiveSize', () => {
  it('grows with flight count, stamp pages, and wrapped images', () => {
    const small = estimateArchiveSize({ flightCount: 10, stampPageCount: 1, wrappedImageCount: 1 })
    const large = estimateArchiveSize({ flightCount: 5000, stampPageCount: 50, wrappedImageCount: 50 })
    expect(large.estimatedTotalBytes).toBeGreaterThan(small.estimatedTotalBytes)
    expect(small.heavy).toBe(false)
    expect(large.heavy).toBe(true)
  })

  it('scale multiplies image bytes but not JSON bytes', () => {
    const scale1 = estimateArchiveSize({ flightCount: 100, stampPageCount: 5, wrappedImageCount: 5, scale: 1 })
    const scale2 = estimateArchiveSize({ flightCount: 100, stampPageCount: 5, wrappedImageCount: 5, scale: 2 })
    expect(scale2.jsonBytes).toBe(scale1.jsonBytes)
    expect(scale2.estimatedImageBytes).toBeGreaterThan(scale1.estimatedImageBytes)
  })

  it('accounts for base64 inflation, since every image is embedded as a base64 data: URI, not a raw binary blob', () => {
    // Every image goes through blobToDataUri (base64), which inflates size by
    // ~4/3 -- the estimate must reflect the bytes that actually land in the
    // .html file, not the raw pre-encoding PNG size.
    const estimate = estimateArchiveSize({ flightCount: 0, stampPageCount: 1, wrappedImageCount: 0 })
    // A raw-byte-only estimate (no base64 factor) would be a round number
    // like 60,000; the base64-inflated estimate should exceed it.
    expect(estimate.estimatedImageBytes).toBeGreaterThan(60_000)
  })
})

describe('buildArchiveSummarySnapshot', () => {
  it('ignores deleted flights and computes first/last dates and years', () => {
    const flights = [
      flight({ id: 'a', date: '2024-01-01' }),
      flight({ id: 'b', date: '2025-06-15' }),
      flight({ id: 'c', date: '2020-01-01', deletedAt: '2026-01-01T00:00:00Z' }),
    ]
    const snapshot = buildArchiveSummarySnapshot(flights, { countryCount: 3, totalDistanceKm: 500 })
    expect(snapshot.totalFlights).toBe(2)
    expect(snapshot.years).toEqual(['2024', '2025'])
    expect(snapshot.firstFlightDate).toBe('2024-01-01')
    expect(snapshot.lastFlightDate).toBe('2025-06-15')
  })

  it('does not crash on a flight with a missing/nullish date (e.g. from a lenient older backup)', () => {
    const flights = [
      flight({ id: 'a', date: '2024-01-01' }),
      flight({ id: 'b', date: undefined as unknown as string }),
    ]
    expect(() => buildArchiveSummarySnapshot(flights, { countryCount: 1, totalDistanceKm: 100 })).not.toThrow()
    const snapshot = buildArchiveSummarySnapshot(flights, { countryCount: 1, totalDistanceKm: 100 })
    expect(snapshot.years).toEqual(['2024'])
  })
})
