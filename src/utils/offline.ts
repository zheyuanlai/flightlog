export function initialOnlineStatus(navigatorLike: Pick<Navigator, 'onLine'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return navigatorLike?.onLine ?? true
}

export function offlineActionMessage(action: string): string {
  return `Offline mode: ${action} is unavailable. Local FlightLog data is still available.`
}

export function isNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const lower = message.toLowerCase()
  return lower.includes('failed to fetch') || lower.includes('network') || lower.includes('offline')
}
