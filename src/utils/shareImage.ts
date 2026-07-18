import type { ShareCardData } from './shareCards'

export const SHARE_CARD_WIDTH = 1080
export const SHARE_CARD_HEIGHT = 1350

export type MeasureText = (text: string) => number

const FONT_STACK = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

export function wrapTextLines(text: string, maxWidth: number, measure: MeasureText, maxLines = 0): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  const push = (line: string) => {
    if (line) lines.push(line)
  }
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (measure(candidate) <= maxWidth) {
      current = candidate
      continue
    }
    push(current)
    if (measure(word) <= maxWidth) {
      current = word
      continue
    }
    let fragment = ''
    for (const char of word) {
      if (measure(fragment + char) > maxWidth && fragment) {
        push(fragment)
        fragment = char
      } else {
        fragment += char
      }
    }
    current = fragment
  }
  push(current)
  if (maxLines > 0 && lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    let chars = [...kept[maxLines - 1]]
    while (chars.length > 0 && measure(`${chars.join('')}…`) > maxWidth) {
      chars = chars.slice(0, -1)
    }
    kept[maxLines - 1] = `${chars.join('')}…`
    return kept
  }
  return lines
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

export function shareCardFileName(data: ShareCardData): string {
  const parts = ['flightlog', data.kind, slugify(data.title), slugify(data.date)].filter(Boolean)
  return `${parts.join('-')}.png`
}

interface DrawCursor {
  ctx: CanvasRenderingContext2D
  y: number
  left: number
  width: number
}

function font(weight: number, size: number, italic = false): string {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT_STACK}`
}

function drawLines(cursor: DrawCursor, lines: string[], size: number, lineHeight: number, color: string, weight: number, options: { letterSpacing?: number; italic?: boolean } = {}): void {
  const { ctx } = cursor
  ctx.font = font(weight, size, options.italic)
  ctx.fillStyle = color
  for (const line of lines) {
    cursor.y += lineHeight
    if (options.letterSpacing) {
      let x = cursor.left
      for (const char of line) {
        ctx.fillText(char, x, cursor.y)
        x += ctx.measureText(char).width + options.letterSpacing
      }
    } else {
      ctx.fillText(line, cursor.left, cursor.y)
    }
  }
}

function wrapWithFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number, maxLines: number, options: { italic?: boolean; letterSpacing?: number } = {}): string[] {
  ctx.font = font(weight, size, options.italic)
  const spacing = options.letterSpacing ?? 0
  const measure = spacing > 0
    ? (value: string) => ctx.measureText(value).width + spacing * [...value].length
    : (value: string) => ctx.measureText(value).width
  return wrapTextLines(text, maxWidth, measure, maxLines)
}

function drawDivider(cursor: DrawCursor): void {
  cursor.y += 44
  cursor.ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
  cursor.ctx.lineWidth = 2
  cursor.ctx.beginPath()
  cursor.ctx.moveTo(cursor.left, cursor.y)
  cursor.ctx.lineTo(cursor.left + cursor.width, cursor.y)
  cursor.ctx.stroke()
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, SHARE_CARD_HEIGHT)
  gradient.addColorStop(0, '#0f172a')
  gradient.addColorStop(1, '#0b3b36')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT)

  ctx.save()
  ctx.strokeStyle = 'rgba(94, 234, 212, 0.14)'
  ctx.lineWidth = 3
  ctx.setLineDash([2, 18])
  ctx.beginPath()
  ctx.moveTo(-40, 380)
  ctx.quadraticCurveTo(SHARE_CARD_WIDTH * 0.55, 40, SHARE_CARD_WIDTH + 60, 300)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-60, SHARE_CARD_HEIGHT - 160)
  ctx.quadraticCurveTo(SHARE_CARD_WIDTH * 0.4, SHARE_CARD_HEIGHT - 420, SHARE_CARD_WIDTH + 80, SHARE_CARD_HEIGHT - 240)
  ctx.stroke()
  ctx.restore()
}

const KIND_LABELS: Record<ShareCardData['kind'], string> = {
  flight: 'FLIGHT',
  trip: 'TRIP',
  year: 'YEAR IN REVIEW',
}

export function drawShareCard(ctx: CanvasRenderingContext2D, data: ShareCardData): void {
  const left = 88
  const width = SHARE_CARD_WIDTH - left * 2
  const cursor: DrawCursor = { ctx, y: 60, left, width }
  ctx.textBaseline = 'alphabetic'

  drawBackground(ctx)

  ctx.font = font(700, 46)
  ctx.fillStyle = '#5eead4'
  ctx.fillText('✈', left, 124)
  ctx.fillText('FlightLog', left + 64, 124)
  cursor.y = 140

  cursor.y += 36
  drawLines(cursor, [KIND_LABELS[data.kind]], 30, 38, '#99f6e4', 600, { letterSpacing: 6 })

  const titleLines = wrapWithFont(ctx, data.title, 700, 72, width, 2)
  cursor.y += 16
  drawLines(cursor, titleLines, 72, 84, '#f8fafc', 700)

  const subtitleLines = wrapWithFont(ctx, data.subtitle, 400, 36, width, 1)
  cursor.y += 8
  drawLines(cursor, subtitleLines, 36, 48, '#cbd5e1', 400)

  const routeLines = wrapWithFont(ctx, data.route || 'Route unavailable', 700, 54, width, 2, { letterSpacing: 2 })
  cursor.y += 24
  drawLines(cursor, routeLines, 54, 68, '#5eead4', 700, { letterSpacing: 2 })

  drawDivider(cursor)

  const contentBottom = SHARE_CARD_HEIGHT - 170
  const stats: Array<[string, string]> = [
    ['DATE', data.date || 'Not set'],
    ['DISTANCE', data.distance || 'Not set'],
    ['AIRPORTS', data.airports.slice(0, 6).join(' · ') || 'Not set'],
    ['COUNTRIES', data.countries.slice(0, 5).join(' · ') || 'Not set'],
  ]
  const wrapStats = (maxLines: number) => stats.map(([label, value]) => ({ label, lines: wrapWithFont(ctx, value, 600, 40, width, maxLines) }))
  const statsHeight = (entries: Array<{ lines: string[] }>) => entries.reduce((sum, entry) => sum + 62 + 50 * entry.lines.length, 0)
  let statEntries = wrapStats(2)
  if (cursor.y + statsHeight(statEntries) > contentBottom) statEntries = wrapStats(1)
  for (const entry of statEntries) {
    cursor.y += 26
    drawLines(cursor, [entry.label], 26, 32, '#94a3b8', 600, { letterSpacing: 4 })
    cursor.y += 4
    drawLines(cursor, entry.lines, 40, 50, '#f8fafc', 600)
  }

  const highlights = data.highlights.slice(0, 4)
  if (highlights.length > 0 && cursor.y + 44 + 12 + 40 <= contentBottom) {
    drawDivider(cursor)
    cursor.y += 6
    for (const highlight of highlights) {
      if (cursor.y + 12 + 40 > contentBottom) break
      const highlightLines = wrapWithFont(ctx, `•  ${highlight}`, 400, 32, width, 1)
      cursor.y += 12
      drawLines(cursor, highlightLines, 32, 40, '#ccfbf1', 400)
    }
  }

  if (data.notes) {
    const availableNoteLines = Math.floor((contentBottom - cursor.y - 44 - 18) / 42)
    if (availableNoteLines >= 1) {
      drawDivider(cursor)
      const noteLines = wrapWithFont(ctx, `“${data.notes}”`, 400, 30, width, Math.min(4, availableNoteLines), { italic: true })
      cursor.y += 18
      drawLines(cursor, noteLines, 30, 42, '#cbd5e1', 400, { italic: true })
    }
  }

  ctx.font = font(600, 30)
  ctx.fillStyle = '#5eead4'
  ctx.fillText('Logged with FlightLog', left, SHARE_CARD_HEIGHT - 96)
  ctx.font = font(400, 26)
  ctx.fillStyle = '#94a3b8'
  ctx.fillText('local-first personal flight passport', left, SHARE_CARD_HEIGHT - 56)
}

export async function renderShareCardPng(data: ShareCardData): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = SHARE_CARD_WIDTH
  canvas.height = SHARE_CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('PNG export is unavailable because Canvas 2D is not supported in this browser.')
  drawShareCard(ctx, data)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PNG export failed in this browser.'))
    }, 'image/png')
  })
}

export async function downloadShareCardPng(data: ShareCardData): Promise<void> {
  const blob = await renderShareCardPng(data)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = shareCardFileName(data)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // WebKit resolves blob: navigations asynchronously; revoking on the same
  // tick can abort the download, so defer cleanup.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
