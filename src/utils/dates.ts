import { DateTime } from 'luxon'
import type { DateFormat, DistanceUnit, TimeFormat } from '../types'

export function durationMinutes(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined
  const startTime = DateTime.fromISO(start.trim().replace(' ', 'T'), { zone: 'UTC', setZone: /(?:Z|[+-]\d{2}:?\d{2})$/i.test(start) })
  const endTime = DateTime.fromISO(end.trim().replace(' ', 'T'), { zone: 'UTC', setZone: /(?:Z|[+-]\d{2}:?\d{2})$/i.test(end) })
  if (!startTime.isValid || !endTime.isValid || endTime < startTime) return undefined
  return Math.round(endTime.diff(startTime, 'minutes').minutes)
}

export function formatDistance(km: number, unit: DistanceUnit = 'kilometers'): string {
  if (unit === 'miles') return `${Math.round(km * 0.621371).toLocaleString()} mi`
  return `${Math.round(km).toLocaleString()} km`
}

export function formatDuration(minutes?: number): string {
  if (minutes === undefined) return 'Not set'
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m`
  return `${hours}h ${mins.toString().padStart(2, '0')}m`
}

function dateStyleOptions(dateFormat: DateFormat = 'medium'): Intl.DateTimeFormatOptions {
  if (dateFormat === 'compact') return { month: 'numeric', day: 'numeric', year: '2-digit' }
  if (dateFormat === 'iso') return { year: 'numeric', month: '2-digit', day: '2-digit' }
  return { dateStyle: 'medium' }
}

function timeStyleOptions(timeFormat: TimeFormat = 'system'): Intl.DateTimeFormatOptions {
  if (timeFormat === '12h') return { hour: 'numeric', minute: '2-digit', hour12: true }
  if (timeFormat === '24h') return { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  return { timeStyle: 'short' }
}

export function formatDate(value?: string, dateFormat: DateFormat = 'medium'): string {
  if (!value) return 'Not set'
  const date = DateTime.fromISO(value, { zone: 'UTC' })
  if (!date.isValid) return value
  if (dateFormat === 'iso') return date.toISODate() ?? value
  return new Intl.DateTimeFormat(undefined, { ...dateStyleOptions(dateFormat), timeZone: 'UTC' }).format(date.toJSDate())
}

export function formatDateTime(value?: string, options: { dateFormat?: DateFormat; timeFormat?: TimeFormat } = {}): string {
  if (!value) return 'Not set'
  const date = DateTime.fromISO(value.trim().replace(' ', 'T'), { setZone: true })
  if (!date.isValid) return value
  if (options.dateFormat === 'iso') {
    const utc = date.toUTC()
    const time = options.timeFormat === '12h' ? utc.toFormat('h:mm a') : utc.toFormat('HH:mm')
    return `${utc.toISODate()} ${time} UTC`
  }
  return new Intl.DateTimeFormat(undefined, {
    ...dateStyleOptions(options.dateFormat ?? 'medium'),
    ...timeStyleOptions(options.timeFormat ?? 'system'),
    timeZone: 'UTC',
  }).format(date.toUTC().toJSDate())
}
