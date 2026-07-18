import { describe, expect, it } from 'vitest'
import type { ShareCardData } from '../utils/shareCards'
import { shareCardFileName, wrapTextLines } from '../utils/shareImage'

const byLength = (value: string) => value.length

function card(overrides: Partial<ShareCardData> = {}): ShareCardData {
  return {
    brand: 'FlightLog',
    kind: 'flight',
    title: 'SQ38 · Singapore Airlines',
    subtitle: 'SIN to LAX',
    route: 'SIN-LAX',
    date: '2026-06-02',
    distance: '14,114 km',
    airports: ['SIN', 'LAX'],
    countries: ['Singapore', 'United States'],
    highlights: ['Depart 2026-06-02'],
    ...overrides,
  }
}

describe('share card image helpers', () => {
  it('wraps words to the available width', () => {
    expect(wrapTextLines('the quick brown fox jumps', 11, byLength)).toEqual(['the quick', 'brown fox', 'jumps'])
  })

  it('keeps short text on a single line', () => {
    expect(wrapTextLines('SIN-LAX', 20, byLength)).toEqual(['SIN-LAX'])
  })

  it('hard-breaks words longer than the width', () => {
    expect(wrapTextLines('ABCDEFGHIJ', 4, byLength)).toEqual(['ABCD', 'EFGH', 'IJ'])
  })

  it('truncates with an ellipsis when maxLines is exceeded', () => {
    const lines = wrapTextLines('one two three four five six seven', 9, byLength, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
  })

  it('handles empty text', () => {
    expect(wrapTextLines('', 10, byLength)).toEqual([])
  })

  it('builds a descriptive slugged file name', () => {
    expect(shareCardFileName(card())).toBe('flightlog-flight-sq38-singapore-airlines-2026-06-02.png')
    expect(shareCardFileName(card({ kind: 'year', title: '2026 travel summary', date: '2026' }))).toBe('flightlog-year-2026-travel-summary-2026.png')
  })

  it('drops empty slug parts from the file name', () => {
    expect(shareCardFileName(card({ title: '···', date: '' }))).toBe('flightlog-flight.png')
  })
})
