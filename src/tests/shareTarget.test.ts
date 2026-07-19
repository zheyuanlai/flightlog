import { describe, expect, it } from 'vitest'
import { buildQuickAddHashFromSharedText, extractDateFromText, extractFlightNumberFromText } from '../utils/shareTarget'

describe('extractFlightNumberFromText', () => {
  it('extracts a flight number from casual text', () => {
    expect(extractFlightNumberFromText('Your flight SQ38 is confirmed')).toBe('SQ38')
    expect(extractFlightNumberFromText('SQ 38 departs at 8pm')).toBe('SQ38')
    expect(extractFlightNumberFromText('flight: UA1234')).toBe('UA1234')
  })

  it('handles digit-leading IATA codes', () => {
    expect(extractFlightNumberFromText('boarding 9W101 now')).toBe('9W101')
    expect(extractFlightNumberFromText('gate for 5J42 is B12')).toBe('5J42')
  })

  it('is case-insensitive and normalizes to uppercase', () => {
    expect(extractFlightNumberFromText('sq38 boarding soon')).toBe('SQ38')
  })

  it('returns undefined for text without a flight-number-shaped token', () => {
    expect(extractFlightNumberFromText('see you at the airport soon')).toBeUndefined()
    expect(extractFlightNumberFromText('order ABC123 shipped')).toBeUndefined()
    expect(extractFlightNumberFromText('')).toBeUndefined()
  })
})

describe('extractDateFromText', () => {
  it('extracts an ISO date if present', () => {
    expect(extractDateFromText('SQ38 on 2026-06-02')).toBe('2026-06-02')
  })

  it('returns undefined without one', () => {
    expect(extractDateFromText('SQ38 tomorrow')).toBeUndefined()
  })
})

describe('buildQuickAddHashFromSharedText', () => {
  it('builds a Quick Add hash with flight and date when both are found', () => {
    expect(buildQuickAddHashFromSharedText({ text: 'SQ38 on 2026-06-02' })).toBe('#/add?flight=SQ38&date=2026-06-02')
  })

  it('combines title and text before searching', () => {
    expect(buildQuickAddHashFromSharedText({ title: 'Boarding pass', text: 'UA1234', url: 'https://example.com' })).toBe('#/add?flight=UA1234')
  })

  it('ignores flight-number-shaped tokens that only appear in the url field', () => {
    expect(buildQuickAddHashFromSharedText({ title: 'Deal of the day', url: 'https://shop.example.com/track?ref=AB1234' })).toBe('#/add')
  })

  it('falls back to a bare Quick Add hash when nothing is extractable', () => {
    expect(buildQuickAddHashFromSharedText({ text: 'just a note' })).toBe('#/add')
    expect(buildQuickAddHashFromSharedText({})).toBe('#/add')
  })
})
