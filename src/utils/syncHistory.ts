import type { SyncEventLog, SyncEventType } from '../types'
import { redactDiagnosticsValue } from './diagnostics'

const SAFE_ERROR_LIMIT = 280

export function safeErrorMessage(error: unknown, fallback = 'Sync operation failed.'): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : typeof error === 'object' && error && 'message' in error && typeof error.message === 'string'
        ? error.message
        : fallback
  return message.slice(0, SAFE_ERROR_LIMIT)
}

export function redactedSummary(summary: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!summary) return undefined
  const redacted = redactDiagnosticsValue(summary)
  return redacted && typeof redacted === 'object' && !Array.isArray(redacted) ? redacted as Record<string, unknown> : undefined
}

export function createSyncEvent(input: {
  eventType: SyncEventType
  deviceId?: string
  summary?: Record<string, unknown>
  error?: unknown
  now?: string
}): SyncEventLog {
  const now = input.now ?? new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    eventType: input.eventType,
    createdAt: now,
    deviceId: input.deviceId,
    summary: redactedSummary(input.summary),
    safeError: input.error ? safeErrorMessage(input.error) : undefined,
  }
}

export function syncHistorySummaryLabel(event: SyncEventLog): string {
  const counts = event.summary
  if (!counts) return event.safeError ?? event.eventType
  const parts = ['pushed', 'pulled', 'conflicts', 'tombstones']
    .map((key) => typeof counts[key] === 'number' ? `${counts[key]} ${key}` : undefined)
    .filter(Boolean)
  return parts.join(', ') || event.safeError || event.eventType
}
