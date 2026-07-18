export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

export function foldIcsLine(line: string): string {
  const limit = 74
  if (line.length <= limit) return line
  const parts: string[] = []
  let remaining = line
  while (remaining.length > limit) {
    parts.push(remaining.slice(0, limit))
    remaining = remaining.slice(limit)
  }
  parts.push(remaining)
  return parts.map((part, index) => index === 0 ? part : ` ${part}`).join('\r\n')
}

export function utcToIcsDate(value: string): string {
  return value.replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace('+0000', 'Z')
}

export interface IcsEventFields {
  uid: string
  dtstamp: string
  dtstart: string
  dtend: string
  summary: string
  location: string
  description: string
  url?: string
}

function veventLines(fields: IcsEventFields): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(fields.uid)}`,
    `DTSTAMP:${utcToIcsDate(fields.dtstamp)}`,
    `DTSTART:${utcToIcsDate(fields.dtstart)}`,
    `DTEND:${utcToIcsDate(fields.dtend)}`,
    `SUMMARY:${escapeIcsText(fields.summary)}`,
    `LOCATION:${escapeIcsText(fields.location)}`,
    `DESCRIPTION:${escapeIcsText(fields.description)}`,
    ...(fields.url ? [`URL:${escapeIcsText(fields.url)}`] : []),
    'END:VEVENT',
  ]
}

export function buildIcsCalendar(events: IcsEventFields[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FlightLog//FlightLog//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events.flatMap(veventLines),
    'END:VCALENDAR',
  ]
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}

export function buildIcsEvent(fields: IcsEventFields): string {
  return buildIcsCalendar([fields])
}
