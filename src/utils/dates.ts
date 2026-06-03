export function durationMinutes(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return undefined
  return Math.round((endMs - startMs) / 60000)
}

export function formatDistance(km: number): string {
  return `${Math.round(km).toLocaleString()} km`
}

export function formatDuration(minutes?: number): string {
  if (minutes === undefined) return 'Not set'
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m`
  return `${hours}h ${mins.toString().padStart(2, '0')}m`
}

export function formatDate(value?: string): string {
  if (!value) return 'Not set'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

export function formatDateTime(value?: string): string {
  if (!value) return 'Not set'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
