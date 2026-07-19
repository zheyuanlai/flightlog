import { describe, expect, it } from 'vitest'
import type { ShareCardData } from '../utils/shareCards'
import { buildCardHash, decodeShareCardParams, encodeShareCardParams } from '../utils/embedCard'

const DATA: ShareCardData = {
  brand: 'FlightLog',
  kind: 'flight',
  title: 'SQ38 · Singapore Airlines',
  subtitle: 'SIN to LAX',
  route: 'SIN-LAX',
  date: '2026-06-02',
  distance: '14,102 km',
  airports: ['SIN', 'LAX'],
  countries: ['Singapore', 'United States'],
  highlights: ['Depart 8:00 PM', 'Arrive 6:15 PM', 'Status scheduled'],
  notes: 'window seat, business trip',
}

describe('embeddable share card params', () => {
  it('round-trips a full ShareCardData through encode and decode', () => {
    const query = encodeShareCardParams(DATA)
    expect(decodeShareCardParams(query)).toEqual(DATA)
  })

  it('round-trips through the full #/card hash', () => {
    const hash = buildCardHash(DATA)
    expect(hash.startsWith('#/card?')).toBe(true)
    const query = hash.slice('#/card?'.length)
    expect(decodeShareCardParams(query)).toEqual(DATA)
  })

  it('omits empty array/notes fields rather than encoding empty strings', () => {
    const minimal: ShareCardData = { ...DATA, airports: [], countries: [], highlights: [], notes: undefined }
    const query = encodeShareCardParams(minimal)
    expect(query).not.toContain('airports=')
    expect(query).not.toContain('notes=')
    expect(decodeShareCardParams(query)).toEqual(minimal)
  })

  it('defaults an unrecognized or missing kind to "flight"', () => {
    const query = new URLSearchParams({ title: 'X', route: 'SIN-LAX', kind: 'bogus' }).toString()
    expect(decodeShareCardParams(query)?.kind).toBe('flight')
  })

  it('returns undefined when required fields (title, route) are missing', () => {
    expect(decodeShareCardParams('subtitle=only')).toBeUndefined()
    expect(decodeShareCardParams('title=Only+title')).toBeUndefined()
    expect(decodeShareCardParams('')).toBeUndefined()
  })

  it('clamps oversized field values so a crafted link cannot bloat the DOM', () => {
    const huge = 'A'.repeat(10_000)
    const query = new URLSearchParams({ title: huge, route: huge, notes: huge }).toString()
    const decoded = decodeShareCardParams(query)
    expect(decoded?.title.length).toBeLessThanOrEqual(300)
    expect(decoded?.route.length).toBeLessThanOrEqual(300)
    expect(decoded?.notes?.length).toBeLessThanOrEqual(300)
  })

  it('caps the number of items parsed from a delimited list field', () => {
    const manyHighlights = Array.from({ length: 5000 }, (_, index) => `h${index}`).join('|')
    const query = new URLSearchParams({ title: 'X', route: 'SIN-LAX', highlights: manyHighlights }).toString()
    const decoded = decodeShareCardParams(query)
    expect(decoded?.highlights.length).toBeLessThanOrEqual(12)
  })
})
