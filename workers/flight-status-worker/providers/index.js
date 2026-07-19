import { aeroDataBoxAdapter } from './aerodatabox.js'

export const DEFAULT_PROVIDER = 'aerodatabox'

const PROVIDER_ADAPTERS = {
  aerodatabox: aeroDataBoxAdapter,
}

export function listProviders() {
  return Object.keys(PROVIDER_ADAPTERS)
}

/**
 * Picks the adapter for this deployment from FLIGHTLOG_PROVIDER (case-insensitive).
 * An unset or unrecognized value falls back to the default adapter rather than
 * failing closed, so a misconfigured fork still serves mock/real AeroDataBox data.
 */
export function resolveProvider(env = {}) {
  const requested = String(env.FLIGHTLOG_PROVIDER ?? '').trim().toLowerCase()
  return PROVIDER_ADAPTERS[requested] ?? PROVIDER_ADAPTERS[DEFAULT_PROVIDER]
}
