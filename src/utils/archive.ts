import type { FlightLogEntry } from '../types'
import type { Achievement } from './achievements'
import { computeBackupChecksum } from '../lib/cloudBackup'
import type { FlightLogBackup } from './backup'

export const ARCHIVE_FORMAT = 'flightlog-lifetime-archive'
export const ARCHIVE_SCHEMA_VERSION = 1
export const ARCHIVE_PAYLOAD_ELEMENT_ID = 'flightlog-archive-payload'

/** The number of most-recent years that get a rendered "wrapped" summary
 * image in a lifetime archive; older years still get a full text table of
 * their flights, just no image, keeping archive size bounded for a
 * long-history user without ever dropping data. */
export const DEFAULT_WRAPPED_IMAGE_YEAR_COUNT = 5

export interface ArchiveSummarySnapshot {
  totalFlights: number
  countryCount: number
  totalDistanceKm: number
  years: string[]
  firstFlightDate?: string
  lastFlightDate?: string
}

/**
 * A lifetime archive is a FlightLogBackup plus extra marker/snapshot fields --
 * the same "extend, don't replace" pattern TripShareFile already established
 * (see tripShare.ts). It round-trips through the existing
 * parseFullBackupJson/previewBackupImport pipeline unchanged; archiveSummary
 * and archiveAchievements are a frozen point-in-time snapshot for the benefit
 * of a future reader who has no app to recompute them from the raw flights.
 */
export interface ArchivePayload extends FlightLogBackup {
  archiveFormat: typeof ARCHIVE_FORMAT
  archiveVersion: number
  archiveGeneratedAt: string
  archiveChecksum: string
  archiveSummary: ArchiveSummarySnapshot
  archiveAchievements: Achievement[]
}

export async function buildArchivePayload(input: {
  backup: FlightLogBackup
  summary: ArchiveSummarySnapshot
  achievements: Achievement[]
  now?: string
}): Promise<ArchivePayload> {
  const unsigned: Omit<ArchivePayload, 'archiveChecksum'> = {
    ...input.backup,
    archiveFormat: ARCHIVE_FORMAT,
    archiveVersion: ARCHIVE_SCHEMA_VERSION,
    archiveGeneratedAt: input.now ?? new Date().toISOString(),
    archiveSummary: input.summary,
    archiveAchievements: input.achievements.filter((achievement) => achievement.earned),
  }
  const archiveChecksum = await computeBackupChecksum(unsigned as unknown as FlightLogBackup)
  return { ...unsigned, archiveChecksum }
}

export function isArchivePayload(value: unknown): value is ArchivePayload {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.archiveFormat === ARCHIVE_FORMAT && Array.isArray(record.flights) && typeof record.archiveSummary === 'object' && record.archiveSummary !== null
}

/**
 * Recomputes the checksum over the payload's full content and compares it to
 * the stored one, to detect corruption or hand-editing. A malformed payload
 * simply fails verification rather than throwing.
 */
export async function verifyArchiveChecksum(payload: ArchivePayload): Promise<boolean> {
  const { archiveChecksum, ...unsigned } = payload
  try {
    return (await computeBackupChecksum(unsigned as unknown as FlightLogBackup)) === archiveChecksum
  } catch {
    return false
  }
}

export interface ArchiveDetection {
  checksumValid: boolean
  generatedAt: string
  flightCount: number
  summary: ArchiveSummarySnapshot
}

/** Parses arbitrary imported JSON text and, only if it's a lifetime archive payload, verifies its checksum. Returns undefined for a plain full backup, a trip share, invalid JSON, or any other malformed/archive-shaped-but-incomplete input -- never throws. */
export async function detectAndVerifyArchive(json: string): Promise<ArchiveDetection | undefined> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!isArchivePayload(parsed)) return undefined
  try {
    return {
      checksumValid: await verifyArchiveChecksum(parsed),
      generatedAt: parsed.archiveGeneratedAt,
      flightCount: parsed.flights.length,
      summary: parsed.archiveSummary,
    }
  } catch {
    return undefined
  }
}

/**
 * The existing backup-import file handler expects plain JSON text. A lifetime
 * archive is an .html file with that same JSON embedded in a
 * <script type="application/json"> tag -- this extracts it so the rest of the
 * import pipeline (detectAndVerifyArchive, parseFullBackupJson, ...) never
 * needs to know whether the file on disk was .json or .html.
 */
const ARCHIVE_PAYLOAD_SCRIPT_PATTERN = new RegExp(`<script[^>]*id=["']${ARCHIVE_PAYLOAD_ELEMENT_ID}["'][^>]*>([\\s\\S]*?)</script>`, 'i')

export function resolveImportableJsonText(rawText: string): string {
  const trimmed = rawText.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return rawText
  // A regex extraction (rather than a full DOMParser) keeps this working
  // identically in any JS environment (no DOM required) and is safe here
  // specifically because embedJson() guarantees the payload never contains a
  // literal "</script" that could terminate the match early.
  const match = rawText.match(ARCHIVE_PAYLOAD_SCRIPT_PATTERN)
  return match ? match[1] : rawText
}

export interface ArchiveSizeEstimate {
  jsonBytes: number
  estimatedImageBytes: number
  estimatedTotalBytes: number
  heavy: boolean
}

const HEAVY_ARCHIVE_BYTES = 8 * 1024 * 1024
// Rough, stable per-unit estimates of each PNG's raw (pre-base64) size
// (measured against representative rendered output) -- good enough to warn a
// heavy user before they export, not meant to be exact.
const BYTES_PER_FLIGHT_JSON = 900
const RAW_BYTES_PER_STAMP_IMAGE = 60_000
const RAW_BYTES_PER_WRAPPED_IMAGE = 90_000
// Every image is embedded as a base64 data: URI (blobToDataUri in
// archiveRender.ts), not a raw binary blob -- base64 inflates size by 4/3.
const BASE64_INFLATION_FACTOR = 4 / 3

export function estimateArchiveSize(input: {
  flightCount: number
  stampPageCount: number
  wrappedImageCount: number
  scale?: 1 | 2
}): ArchiveSizeEstimate {
  const scale = input.scale ?? 1
  const scaleFactor = scale * scale
  const jsonBytes = input.flightCount * BYTES_PER_FLIGHT_JSON
  const rawImageBytes = input.stampPageCount * RAW_BYTES_PER_STAMP_IMAGE * scaleFactor + input.wrappedImageCount * RAW_BYTES_PER_WRAPPED_IMAGE * scaleFactor
  const estimatedImageBytes = Math.round(rawImageBytes * BASE64_INFLATION_FACTOR)
  const estimatedTotalBytes = jsonBytes + estimatedImageBytes
  return { jsonBytes, estimatedImageBytes, estimatedTotalBytes, heavy: estimatedTotalBytes > HEAVY_ARCHIVE_BYTES }
}

export function buildArchiveSummarySnapshot(flights: FlightLogEntry[], input: { countryCount: number; totalDistanceKm: number }): ArchiveSummarySnapshot {
  const active = flights.filter((flight) => !flight.deletedAt)
  const dates = active.map((flight) => flight.date).filter(Boolean).sort()
  const years = [...new Set(dates.map((date) => date.slice(0, 4)))].sort()
  return {
    totalFlights: active.length,
    countryCount: input.countryCount,
    totalDistanceKm: input.totalDistanceKm,
    years,
    firstFlightDate: dates[0],
    lastFlightDate: dates[dates.length - 1],
  }
}
