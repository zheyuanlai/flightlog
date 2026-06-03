import { DateTime } from 'luxon'

export function durationMinutes(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined
  const startTime = DateTime.fromISO(start.trim().replace(' ', 'T'), { zone: 'UTC', setZone: /(?:Z|[+-]\d{2}:?\d{2})$/i.test(start) })
  const endTime = DateTime.fromISO(end.trim().replace(' ', 'T'), { zone: 'UTC', setZone: /(?:Z|[+-]\d{2}:?\d{2})$/i.test(end) })
  if (!startTime.isValid || !endTime.isValid || endTime < startTime) return undefined
  return Math.round(endTime.diff(startTime, 'minutes').minutes)
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
  const date = DateTime.fromISO(value, { zone: 'UTC' })
  if (!date.isValid) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(date.toJSDate())
}

export function formatDateTime(value?: string): string {
  if (!value) return 'Not set'
  const date = DateTime.fromISO(value.trim().replace(' ', 'T'), { setZone: true })
  if (!date.isValid) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date.toUTC().toJSDate())
}
