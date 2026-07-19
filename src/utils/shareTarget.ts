import { normalizeFlightNumber } from './liveStatus'

// IATA airline codes are exactly two alphanumeric characters with at least one
// letter (e.g. "SQ", "9W", "B6") — never two digits. An optional space between
// the code and the number covers how people casually write it ("SQ 38").
const FLIGHT_NUMBER_PATTERN = /\b([A-Z][A-Z0-9]|[A-Z0-9][A-Z])\s?(\d{1,4})\b/i
const ISO_DATE_PATTERN = /\b(\d{4}-\d{2}-\d{2})\b/

export function extractFlightNumberFromText(text: string): string | undefined {
  const match = FLIGHT_NUMBER_PATTERN.exec(text)
  if (!match) return undefined
  return normalizeFlightNumber(`${match[1]}${match[2]}`)
}

export function extractDateFromText(text: string): string | undefined {
  const match = ISO_DATE_PATTERN.exec(text)
  return match?.[1]
}

/**
 * Builds a Quick Add deep-link hash from Web Share Target GET params (title,
 * text, url — the standard fields browsers append to a share_target action).
 * Always returns an `#/add` hash so sharing something FlightLog can't parse
 * still opens Quick Add for manual entry, rather than silently doing nothing.
 */
export function buildQuickAddHashFromSharedText(input: { title?: string; text?: string; url?: string }): string {
  // The url field is machine-generated (tracking params, product/model numbers
  // in path segments) and is the dominant source of false-positive flight
  // number matches, so only scan the human-authored title/text for one.
  const combined = [input.title, input.text].filter(Boolean).join(' ')
  const flightNumber = extractFlightNumberFromText(combined)
  const date = extractDateFromText(combined)
  if (!flightNumber) return '#/add'
  const params = new URLSearchParams({ flight: flightNumber })
  if (date) params.set('date', date)
  return `#/add?${params.toString()}`
}
