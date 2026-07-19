import { ProviderError } from './error.js'

export function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function cleanNumber(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

export function stripUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== ''))
}

export function normalizeFlightNumber(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

/**
 * Maps a failed provider HTTP response to a ProviderError with a status code and
 * message the Worker can pass straight through to the frontend. Shared by every
 * adapter so a new provider gets consistent quota/auth/outage handling for free.
 */
export async function providerErrorFromResponse(response, notFoundMessage = 'No flight found.') {
  if (response.status === 204 || response.status === 404) {
    return new ProviderError(404, notFoundMessage)
  }
  if (response.status === 429) {
    return new ProviderError(429, 'API quota or rate limit reached.')
  }
  if (response.status === 401 || response.status === 403) {
    return new ProviderError(502, 'API key or subscription problem.')
  }
  if (response.status >= 500) {
    return new ProviderError(502, 'Aviation data provider unavailable.')
  }

  let providerMessage = ''
  try {
    const body = await response.json()
    providerMessage = typeof body?.message === 'string' ? body.message : ''
  } catch {
    providerMessage = ''
  }
  return new ProviderError(502, providerMessage || 'Unable to fetch flight status.')
}
