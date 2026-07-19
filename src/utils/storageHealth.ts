export type StorageIssueKind = 'unavailable' | 'load-error'

export interface StorageIssue {
  kind: StorageIssueKind
  message: string
}

/** Feature-detects IndexedDB itself, e.g. Safari private-mode historically restricts or disables it. */
export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

export function unavailableStorageIssue(): StorageIssue {
  return {
    kind: 'unavailable',
    message: "This browser is blocking local storage (common in private/incognito mode), so FlightLog can't load or save flights here. Leave private browsing, or use a browser that allows local storage.",
  }
}

export function loadErrorStorageIssue(error: unknown): StorageIssue {
  const detail = error instanceof Error ? error.message : undefined
  return {
    kind: 'load-error',
    message: detail ? `FlightLog couldn't load your flight data: ${detail}` : "FlightLog couldn't load your flight data from this device.",
  }
}
