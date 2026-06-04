export function isStandaloneDisplay(
  windowLike: Pick<Window, 'matchMedia'> & { navigator?: Navigator } | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  if (!windowLike) return false
  const standaloneMedia = windowLike.matchMedia?.('(display-mode: standalone)').matches
  const navigatorStandalone = Boolean((windowLike.navigator as Navigator & { standalone?: boolean } | undefined)?.standalone)
  return Boolean(standaloneMedia || navigatorStandalone)
}

export function installGuidance(platform = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const agent = platform.toLowerCase()
  if (/iphone|ipad|ipod/.test(agent)) return 'Open FlightLog in Safari, tap Share, then choose Add to Home Screen.'
  if (/chrome|chromium|edg\//.test(agent)) return 'Use the browser install button, or open the address-bar menu and choose Install FlightLog.'
  return 'Use your browser install or Add to Home Screen option to save FlightLog as a standalone app.'
}
