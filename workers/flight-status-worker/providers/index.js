import { aeroDataBoxAdapter } from './aerodatabox.js'

export const DEFAULT_PROVIDER = 'aerodatabox'

// A null-prototype object: bracket access never walks the prototype chain, so a
// FLIGHTLOG_PROVIDER value like "constructor" or "__proto__" can't resolve to an
// inherited Object.prototype member instead of falling through to the default.
const PROVIDER_ADAPTERS = Object.assign(Object.create(null), {
  aerodatabox: aeroDataBoxAdapter,
})

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
