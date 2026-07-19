export interface ProviderCapabilities {
  provider: string
  mode: string
  supportsFlightStatus: boolean
  supportsAirportStatus: boolean
}

export interface FetchProviderCapabilitiesOptions {
  baseUrl?: string
  fetcher?: typeof fetch
}

// Fails open: every deployment supports both features until the Worker says
// otherwise. This is also what a pre-v3.2 Worker (no /capabilities route) looks
// like from here, so an un-redeployed Worker keeps working exactly as before.
export const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  provider: 'unknown',
  mode: 'unknown',
  supportsFlightStatus: true,
  supportsAirportStatus: true,
}

export function buildCapabilitiesUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/capabilities`
}

export function normalizeProviderCapabilities(value: unknown): ProviderCapabilities {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    provider: typeof record.provider === 'string' && record.provider ? record.provider : DEFAULT_PROVIDER_CAPABILITIES.provider,
    mode: typeof record.mode === 'string' && record.mode ? record.mode : DEFAULT_PROVIDER_CAPABILITIES.mode,
    supportsFlightStatus: typeof record.supportsFlightStatus === 'boolean' ? record.supportsFlightStatus : DEFAULT_PROVIDER_CAPABILITIES.supportsFlightStatus,
    supportsAirportStatus: typeof record.supportsAirportStatus === 'boolean' ? record.supportsAirportStatus : DEFAULT_PROVIDER_CAPABILITIES.supportsAirportStatus,
  }
}

/**
 * Asks the flight-status Worker what this deployment can do, so the app can hide
 * (not just error on) a feature a fork's provider adapter doesn't implement.
 * Never throws: any failure — no base URL, offline, older Worker with no
 * /capabilities route — resolves to the fail-open defaults above.
 */
export async function fetchProviderCapabilities(options: FetchProviderCapabilitiesOptions = {}): Promise<ProviderCapabilities> {
  const baseUrl = options.baseUrl ?? import.meta.env.VITE_FLIGHTLOG_API_BASE_URL
  if (!baseUrl) return DEFAULT_PROVIDER_CAPABILITIES
  const fetcher = options.fetcher ?? fetch
  try {
    const response = await fetcher(buildCapabilitiesUrl(baseUrl))
    if (!response.ok) return DEFAULT_PROVIDER_CAPABILITIES
    return normalizeProviderCapabilities(await response.json())
  } catch {
    return DEFAULT_PROVIDER_CAPABILITIES
  }
}
