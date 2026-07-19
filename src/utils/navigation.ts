export type Page =
  | 'dashboard'
  | 'flights'
  | 'map'
  | 'passport'
  | 'trips'
  | 'backup'
  | 'account'
  | 'settings'
  | 'sync'
  | 'trash'
  | 'flight-detail'
  | 'trip-detail'
  | 'focus'
  | 'card'

export interface AppRoute {
  page: Page
  flightId?: string
  tripId?: string
}

export type NavGroup = 'home' | 'add' | 'flights' | 'trips' | 'more'

export const desktopNavItems: Array<{ page: Page; label: string }> = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'flights', label: 'Flights' },
  { page: 'trips', label: 'Trips' },
  { page: 'map', label: 'Map' },
  { page: 'passport', label: 'Passport' },
  { page: 'backup', label: 'Backup' },
  { page: 'sync', label: 'Sync' },
  { page: 'settings', label: 'Settings' },
]

export const moreNavItems: Array<{ page: Page; label: string }> = [
  { page: 'passport', label: 'Passport' },
  { page: 'map', label: 'Map' },
  { page: 'backup', label: 'Backup' },
  { page: 'sync', label: 'Sync' },
  { page: 'settings', label: 'Settings' },
  { page: 'trash', label: 'Trash' },
]

const topLevelPages = new Set<Page>([
  'dashboard',
  'flights',
  'map',
  'passport',
  'trips',
  'backup',
  'account',
  'settings',
  'sync',
  'trash',
])

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function routeFromHashValue(hashValue: string): AppRoute {
  const hash = hashValue.replace(/^#\/?/, '')
  const [pathPart] = hash.split('?')
  const [section, id] = pathPart.split('/')
  if (section === 'flights' && id) return { page: 'flight-detail', flightId: safeDecodeURIComponent(id) }
  if (section === 'trips' && id) return { page: 'trip-detail', tripId: safeDecodeURIComponent(id) }
  if (section === 'focus') return { page: 'focus', flightId: id ? safeDecodeURIComponent(id) : undefined }
  if (section === 'card') return { page: 'card' }
  if (section === 'import') return { page: 'backup' }
  if (section === 'account') return { page: 'account' }
  if (topLevelPages.has(section as Page)) return { page: section as Page }
  return { page: 'dashboard' }
}

export interface QuickAddParams {
  flightNumber?: string
  date?: string
  dateRole?: 'Departure' | 'Arrival'
}

/**
 * Parse a deep link like `#/add?flight=SQ38&date=2026-06-02` into Quick Add
 * prefill values. Returns undefined for any hash that is not an add deep link.
 */
export function parseQuickAddParams(hashValue: string): QuickAddParams | undefined {
  const hash = hashValue.replace(/^#\/?/, '')
  const [pathPart, queryPart] = hash.split('?')
  if (pathPart.split('/')[0] !== 'add') return undefined
  const params = new URLSearchParams(queryPart ?? '')
  const flightRaw = params.get('flight') ?? params.get('flightNumber') ?? undefined
  const dateRaw = params.get('date') ?? undefined
  const flightNumber = flightRaw ? flightRaw.trim().toUpperCase().replace(/\s+/g, '') : undefined
  const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw.trim()) ? dateRaw.trim() : undefined
  const roleRaw = params.get('dateRole')
  const dateRole = roleRaw === 'Arrival' ? 'Arrival' : roleRaw === 'Departure' ? 'Departure' : undefined
  return { flightNumber, date, dateRole }
}

export function navPage(route: AppRoute): Page {
  if (route.page === 'flight-detail') return 'flights'
  if (route.page === 'trip-detail') return 'trips'
  if (route.page === 'trash') return 'settings'
  if (route.page === 'focus' || route.page === 'card') return 'dashboard'
  return route.page
}

export function mobileNavGroup(route: AppRoute): NavGroup {
  const page = navPage(route)
  if (page === 'dashboard') return 'home'
  if (page === 'flights') return 'flights'
  if (page === 'trips') return 'trips'
  return 'more'
}
