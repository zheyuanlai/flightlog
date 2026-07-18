import type { Continent, VisitedCountry } from './achievements'
import { CONTINENTS } from './achievements'

export const PASSPORT_PAGE_WIDTH = 1080
export const PASSPORT_PAGE_HEIGHT = 1350
const FONT_STACK = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

/** Deterministic 32-bit string hash (FNV-1a). Stable across renders — no randomness. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** A stable slight rotation for a stamp, in degrees within [-12, 12]. */
export function stampRotationDeg(seed: string): number {
  return (hashString(seed) % 25) - 12
}

const CONTINENT_INK: Record<Continent, string> = {
  Africa: '#b45309',
  Asia: '#b91c1c',
  Europe: '#1d4ed8',
  'North America': '#047857',
  'South America': '#7c3aed',
  Oceania: '#0e7490',
  Antarctica: '#334155',
}

const FALLBACK_INKS = ['#9f1239', '#3730a3', '#065f46', '#92400e', '#5b21b6', '#155e75']

/** A stable ink colour for a stamp — by continent when known, else hashed from a palette. */
export function stampInkColor(country: VisitedCountry): string {
  if (country.continent) return CONTINENT_INK[country.continent]
  return FALLBACK_INKS[hashString(country.key) % FALLBACK_INKS.length]
}

/** The short code shown large on a stamp: an ISO-2 key, else initials of the name. */
export function stampCode(country: VisitedCountry): string {
  if (/^[A-Z]{2}$/.test(country.key)) return country.key
  const initials = country.name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3)
  return initials || country.name.slice(0, 2).toUpperCase()
}

export interface StampVisual {
  key: string
  code: string
  country: string
  angleDeg: number
  color: string
}

export interface StampPage {
  index: number
  title: string
  continent?: Continent
  stamps: StampVisual[]
}

export interface BuildStampPagesOptions {
  perPage?: number
}

function toVisual(country: VisitedCountry): StampVisual {
  return {
    key: country.key,
    code: stampCode(country),
    country: country.name,
    angleDeg: stampRotationDeg(country.key),
    color: stampInkColor(country),
  }
}

/**
 * Group visited countries into paginated passport pages, one continent block at a
 * time (in canonical continent order, with continent-less countries last). Pure and
 * deterministic so the DOM book view and the Canvas export render identically.
 */
export function buildStampPages(countries: VisitedCountry[], options: BuildStampPagesOptions = {}): StampPage[] {
  const perPage = Math.max(1, options.perPage ?? 9)
  const groups = new Map<string, VisitedCountry[]>()
  for (const country of countries) {
    const key = country.continent ?? 'Other'
    const list = groups.get(key) ?? []
    list.push(country)
    groups.set(key, list)
  }
  const orderedKeys: string[] = [
    ...CONTINENTS.filter((continent) => groups.has(continent)),
    ...(groups.has('Other') ? ['Other'] : []),
  ]
  const pages: StampPage[] = []
  let index = 0
  for (const key of orderedKeys) {
    const sorted = groups.get(key)!.slice().sort((a, b) => a.name.localeCompare(b.name))
    for (let start = 0; start < sorted.length; start += perPage) {
      pages.push({
        index: index++,
        title: key,
        continent: key === 'Other' ? undefined : (key as Continent),
        stamps: sorted.slice(start, start + perPage).map(toVisual),
      })
    }
  }
  return pages
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

/** Draw a single inked passport stamp centred at (cx, cy). */
export function drawPassportStamp(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, stamp: StampVisual): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((stamp.angleDeg * Math.PI) / 180)
  ctx.globalAlpha = 0.9
  ctx.strokeStyle = stamp.color
  ctx.fillStyle = stamp.color
  ctx.lineWidth = Math.max(3, size * 0.03)

  const half = size / 2
  roundedRect(ctx, -half, -half * 0.72, size, size * 0.72, size * 0.1)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, -half * 0.36 + size * 0.02, size * 0.28, 0, Math.PI * 2)
  ctx.lineWidth = Math.max(2, size * 0.02)
  ctx.stroke()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 ${Math.round(size * 0.26)}px ${FONT_STACK}`
  ctx.fillText(stamp.code, 0, -half * 0.34 + size * 0.02)
  ctx.font = `600 ${Math.round(size * 0.1)}px ${FONT_STACK}`
  const name = stamp.country.length > 18 ? `${stamp.country.slice(0, 17)}…` : stamp.country
  ctx.fillText(name.toUpperCase(), 0, half * 0.12)
  ctx.restore()
}

export interface DrawPassportPageOptions {
  totalPages?: number
  subtitle?: string
}

export function drawPassportPage(ctx: CanvasRenderingContext2D, page: StampPage, options: DrawPassportPageOptions = {}): void {
  ctx.fillStyle = '#f4ecd8'
  ctx.fillRect(0, 0, PASSPORT_PAGE_WIDTH, PASSPORT_PAGE_HEIGHT)
  ctx.strokeStyle = 'rgba(120, 90, 40, 0.28)'
  ctx.lineWidth = 4
  ctx.strokeRect(40, 40, PASSPORT_PAGE_WIDTH - 80, PASSPORT_PAGE_HEIGHT - 80)

  ctx.fillStyle = '#5b4626'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 34px ${FONT_STACK}`
  ctx.fillText('✈  FLIGHTLOG PASSPORT', 80, 118)
  ctx.font = `800 72px ${FONT_STACK}`
  ctx.fillStyle = '#3f2f18'
  ctx.fillText(page.title.toUpperCase(), 80, 210)
  if (options.subtitle) {
    ctx.font = `500 30px ${FONT_STACK}`
    ctx.fillStyle = '#6b5836'
    ctx.fillText(options.subtitle, 80, 256)
  }

  const columns = 3
  const marginX = 120
  const gridTop = 320
  const cellWidth = (PASSPORT_PAGE_WIDTH - marginX * 2) / columns
  const cellHeight = 250
  const stampSize = Math.min(cellWidth, cellHeight) * 0.78
  page.stamps.forEach((stamp, position) => {
    const column = position % columns
    const row = Math.floor(position / columns)
    const cx = marginX + cellWidth * (column + 0.5)
    const cy = gridTop + cellHeight * (row + 0.5)
    drawPassportStamp(ctx, cx, cy, stampSize, stamp)
  })

  ctx.fillStyle = '#6b5836'
  ctx.textAlign = 'center'
  ctx.font = `500 28px ${FONT_STACK}`
  const pageLabel = options.totalPages ? `Page ${page.index + 1} of ${options.totalPages}` : `Page ${page.index + 1}`
  ctx.fillText(pageLabel, PASSPORT_PAGE_WIDTH / 2, PASSPORT_PAGE_HEIGHT - 70)
}

export async function renderPassportPagePng(page: StampPage, options: DrawPassportPageOptions = {}): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = PASSPORT_PAGE_WIDTH
  canvas.height = PASSPORT_PAGE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Passport export is unavailable because Canvas 2D is not supported in this browser.')
  drawPassportPage(ctx, page, options)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Passport export failed in this browser.'))
    }, 'image/png')
  })
}

export async function downloadPassportPagePng(page: StampPage, options: DrawPassportPageOptions = {}): Promise<void> {
  const blob = await renderPassportPagePng(page, options)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `flightlog-passport-${page.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${page.index + 1}.png`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
