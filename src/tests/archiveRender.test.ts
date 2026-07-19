import { describe, expect, it } from 'vitest'
import type { Achievement } from '../utils/achievements'
import type { FlightLogEntry } from '../types'
import { ARCHIVE_PAYLOAD_ELEMENT_ID } from '../utils/archive'
import { assembleArchiveHtml, buildFlightLogRows, embedJson, escapeHtml, type ArchiveHtmlInput } from '../utils/archiveRender'

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

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'archive-render-flight',
    date: '2026-06-02',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    purpose: 'personal',
    source: 'manual',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

function baseInput(overrides: Partial<ArchiveHtmlInput> = {}): ArchiveHtmlInput {
  return {
    generatedAtLabel: '2026-07-19',
    appVersionLabel: 'FlightLog v5.3',
    totalFlights: 3,
    countryCount: 2,
    continentCount: 1,
    totalDistanceLabel: '500 km',
    earthLaps: 0.1,
    achievements: [achievement()],
    stampSections: [],
    wrappedYears: [],
    trips: [],
    flightRows: [],
    ...overrides,
  }
}

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'q'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;')
  })
})

describe('embedJson', () => {
  it('escapes a literal </script sequence so it cannot close the surrounding tag, while staying valid JSON (\\/ is a legal JSON escape for /)', () => {
    const value = { notes: 'nice trip </script><script>alert(1)</script>' }
    const encoded = embedJson(value)
    expect(encoded).not.toContain('</script>')
    expect(encoded).toContain('<\\/script>')
    // JSON.parse understands \/ as / natively, so this reconstructs the exact
    // original value -- the same thing a browser's <script> textContent + a
    // real JSON.parse call would do when reading this back.
    expect(JSON.parse(encoded)).toEqual(value)
  })

  it('handles case-insensitive and multiple occurrences', () => {
    const encoded = embedJson({ a: '</SCRIPT>', b: '</Script>' })
    expect(encoded.toLowerCase()).not.toContain('</script>')
  })

  it('preserves the original casing of a matched </script variant on round-trip, instead of silently down-casing it', () => {
    // A fixed-case replacement (rather than a case-preserving one) would
    // corrupt any non-lowercase match -- round-tripping through JSON.parse
    // must reproduce the exact original string, or a legitimate archive
    // would fail its own checksum verification on re-import.
    const value = { notes: 'saw a sign that said </SCRIPT> and </Script> weirdly' }
    const encoded = embedJson(value)
    expect(JSON.parse(encoded)).toEqual(value)
  })
})

describe('assembleArchiveHtml', () => {
  it('is a single self-contained document: no external stylesheet, script src, or network reference', () => {
    const html = assembleArchiveHtml(baseInput())
    expect(html).not.toMatch(/<link[^>]*rel=["']stylesheet["']/i)
    expect(html).not.toMatch(/<script[^>]+src=/i)
    expect(html).not.toMatch(/https?:\/\//)
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })

  it('embeds the payload script tag with the documented element id when a payload is provided', () => {
    const withPayload = assembleArchiveHtml(baseInput({ payload: { archiveFormat: 'flightlog-lifetime-archive', flights: [] } }))
    expect(withPayload).toContain(`id="${ARCHIVE_PAYLOAD_ELEMENT_ID}"`)
    expect(withPayload).toContain('flightlog-lifetime-archive')
  })

  it('omits the payload section entirely when no payload is given (the print path)', () => {
    const withoutPayload = assembleArchiveHtml(baseInput())
    expect(withoutPayload).not.toContain(`id="${ARCHIVE_PAYLOAD_ELEMENT_ID}"`)
    expect(withoutPayload).not.toContain('<script type="application/json"')
  })

  it('escapes untrusted free-text fields (trip names, flight notes surface via routes) so they cannot break out of markup', () => {
    const html = assembleArchiveHtml(baseInput({
      trips: [{ name: '<img src=x onerror=alert(1)>', routeSummary: 'SIN -> LAX', dateRange: '2026-06-02 to 2026-06-02', flightCount: 1 }],
    }))
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('renders every achievement, including locked ones with a progress indicator', () => {
    const html = assembleArchiveHtml(baseInput({
      achievements: [achievement({ id: 'earned', earned: true, earnedDate: '2026-01-01' }), achievement({ id: 'locked', earned: false, progress: 3, target: 10, earnedDate: undefined })],
    }))
    expect(html).toContain('Earned 2026-01-01')
    expect(html).toContain('3/10')
  })

  it('formats large locked-achievement progress/target numbers with thousands separators, matching the live Passport page', () => {
    const html = assembleArchiveHtml(baseInput({
      achievements: [achievement({ id: 'earth-lap-5', earned: false, progress: 184023, target: 200375, earnedDate: undefined })],
    }))
    expect(html).toContain('184,023/200,375')
    expect(html).not.toContain('184023/200375')
  })

  it('escapes the achievement icon like every other interpolated field', () => {
    const html = assembleArchiveHtml(baseInput({
      achievements: [achievement({ icon: '<img src=x onerror=alert(1)>' })],
    }))
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('renders a stamp image with alt text and a text list of countries -- never image-only', () => {
    const html = assembleArchiveHtml(baseInput({
      stampSections: [{ title: 'Asia', dataUri: 'data:image/png;base64,AAA', countries: [{ key: 'JP', name: 'Japan' }, { key: 'SG', name: 'Singapore' }] }],
    }))
    expect(html).toContain('data:image/png;base64,AAA')
    expect(html).toContain('alt="Passport stamps: Asia"')
    expect(html).toContain('Japan, Singapore')
  })

  it('shows a text table for a wrapped year even when no image was rendered for it', () => {
    const html = assembleArchiveHtml(baseInput({ wrappedYears: [{ year: '2019', flightCount: 4, distanceLabel: '4,000 km' }] }))
    expect(html).not.toContain('<img class="wrapped-img"')
    expect(html).toContain('2019')
    expect(html).toContain('4 flights')
  })

  it('lists every flight in the full flight log table', () => {
    const html = assembleArchiveHtml(baseInput({
      flightRows: [{ date: '2026-06-02', flightNumber: 'SQ38', airline: 'Singapore Airlines', route: 'SIN-LAX', distanceLabel: '13,600 km' }],
    }))
    expect(html).toContain('SQ38')
    expect(html).toContain('Singapore Airlines')
    expect(html).toContain('SIN-LAX')
  })

  it('shows a plain-language empty state instead of an empty table when there are no trips or flights', () => {
    const html = assembleArchiveHtml(baseInput({ trips: [], flightRows: [] }))
    expect(html).toContain('No trips recorded.')
    expect(html).toContain('No flights logged.')
  })

  it('includes a print button that calls window.print with no other script logic', () => {
    const html = assembleArchiveHtml(baseInput())
    expect(html).toContain('onclick="window.print()"')
  })
})

describe('buildFlightLogRows', () => {
  it('shows a formatted distance for a flight with resolvable route coordinates', () => {
    const rows = buildFlightLogRows([flight()], 'kilometers')
    expect(rows).toHaveLength(1)
    expect(rows[0].distanceLabel).toMatch(/km$/)
    expect(rows[0].distanceLabel).not.toBe('0 km')
  })

  it('shows "Distance unavailable" rather than a misleading "0 km" for a flight with unresolvable airports', () => {
    const rows = buildFlightLogRows([flight({ origin: 'ZZZ', destination: 'ZZY' })], 'kilometers')
    expect(rows[0].distanceLabel).toBe('Distance unavailable')
  })

  it('sorts by the same local-departure date it displays, not the raw stored date field', () => {
    // flight.date deliberately disagrees with its local departure instant --
    // an overnight/red-eye flight, or a manually edited date/time.
    const early = flight({ id: 'early', date: '2026-01-01', scheduledDepartureUtc: '2026-06-10T23:00:00Z', originTimeZone: 'Asia/Singapore' })
    const late = flight({ id: 'late', date: '2026-12-31', scheduledDepartureUtc: '2026-06-01T01:00:00Z', originTimeZone: 'Asia/Singapore' })
    const rows = buildFlightLogRows([early, late], 'kilometers')
    // Singapore is UTC+8, so early's local departure is 2026-06-11 and late's
    // is 2026-06-01 -- descending order puts "early" first despite its
    // flight.date field being chronologically first.
    expect(rows.map((row) => row.date)).toEqual(['2026-06-11', '2026-06-01'])
    expect(rows[0].date >= rows[1].date).toBe(true)
  })

  it('respects the requested distance unit', () => {
    const km = buildFlightLogRows([flight()], 'kilometers')
    const miles = buildFlightLogRows([flight()], 'miles')
    expect(km[0].distanceLabel).toMatch(/km$/)
    expect(miles[0].distanceLabel).toMatch(/mi$/)
  })
})
