import type { ShareCardData } from './shareCards'

const ARRAY_DELIMITER = '|'
const MAX_FIELD_LENGTH = 300
const MAX_LIST_ITEMS = 12

function clamp(value: string): string {
  return value.slice(0, MAX_FIELD_LENGTH)
}

/** Serializes a ShareCardData into URL query params, for a self-contained embeddable view. */
export function encodeShareCardParams(data: ShareCardData): string {
  const params = new URLSearchParams()
  params.set('kind', data.kind)
  params.set('title', data.title)
  params.set('subtitle', data.subtitle)
  params.set('route', data.route)
  params.set('date', data.date)
  params.set('distance', data.distance)
  if (data.airports.length > 0) params.set('airports', data.airports.join(ARRAY_DELIMITER))
  if (data.countries.length > 0) params.set('countries', data.countries.join(ARRAY_DELIMITER))
  if (data.highlights.length > 0) params.set('highlights', data.highlights.join(ARRAY_DELIMITER))
  if (data.notes) params.set('notes', data.notes)
  return params.toString()
}

function splitList(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? '')
    .split(ARRAY_DELIMITER)
    .slice(0, MAX_LIST_ITEMS)
    .map((value) => clamp(value.trim()))
    .filter(Boolean)
}

/**
 * Decodes a ShareCardData back out of URL query params. Returns undefined when
 * the minimum viable fields (title, route) are missing, so the embeddable card
 * view can show an empty state instead of a broken-looking card.
 */
export function decodeShareCardParams(query: string): ShareCardData | undefined {
  const params = new URLSearchParams(query)
  const title = params.get('title')
  const route = params.get('route')
  if (!title || !route) return undefined
  const kindRaw = params.get('kind')
  const kind: ShareCardData['kind'] = kindRaw === 'trip' || kindRaw === 'year' ? kindRaw : 'flight'
  return {
    brand: 'FlightLog',
    kind,
    title: clamp(title),
    subtitle: clamp(params.get('subtitle') ?? ''),
    route: clamp(route),
    date: clamp(params.get('date') ?? ''),
    distance: clamp(params.get('distance') ?? ''),
    airports: splitList(params, 'airports'),
    countries: splitList(params, 'countries'),
    highlights: splitList(params, 'highlights'),
    notes: params.get('notes') ? clamp(params.get('notes') ?? '') : undefined,
  }
}

/** Builds the `#/card?...` deep-link hash for a share card, e.g. for a QR code or a link. */
export function buildCardHash(data: ShareCardData): string {
  return `#/card?${encodeShareCardParams(data)}`
}
