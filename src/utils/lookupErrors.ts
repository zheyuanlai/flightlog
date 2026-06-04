import { isNetworkError } from './offline'

export type LookupErrorKind = 'not-found' | 'worker-unavailable' | 'quota' | 'timezone' | 'offline' | 'generic'

export interface LookupErrorCopy {
  kind: LookupErrorKind
  title: string
  detail: string
}

export function lookupErrorCopy(error: unknown, online = true): LookupErrorCopy {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unable to look up this flight.'
  const lower = raw.toLowerCase()
  if (!online || isNetworkError(raw)) {
    return {
      kind: 'offline',
      title: 'Live lookup is unavailable offline',
      detail: 'Local pages still work. Try the lookup again when you are online, or add the flight manually.',
    }
  }
  if (lower.includes('no flight') || lower.includes('not found') || lower.includes('404')) {
    return {
      kind: 'not-found',
      title: 'No flight found',
      detail: 'Check the flight number, date, and date role. You can still add the flight manually.',
    }
  }
  if (lower.includes('quota') || lower.includes('subscription') || lower.includes('429') || lower.includes('rapidapi')) {
    return {
      kind: 'quota',
      title: 'Live lookup limit reached',
      detail: 'The flight data provider did not accept the request. Existing local data is unaffected.',
    }
  }
  if (lower.includes('timezone') || lower.includes('time zone')) {
    return {
      kind: 'timezone',
      title: 'Timezone unavailable',
      detail: 'The provider did not return enough timezone data. Review the preview before saving.',
    }
  }
  if (lower.includes('worker') || lower.includes('unavailable') || lower.includes('500') || lower.includes('502') || lower.includes('503')) {
    return {
      kind: 'worker-unavailable',
      title: 'Live lookup service unavailable',
      detail: 'The Worker could not complete the lookup. Local data and manual entry are still available.',
    }
  }
  return {
    kind: 'generic',
    title: 'Unable to look up this flight',
    detail: raw,
  }
}
