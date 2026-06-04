import type { SyncMetadata } from '../types'

export type SyncStatusKind =
  | 'local-only'
  | 'signed-out'
  | 'not-compared'
  | 'in-sync'
  | 'local-changes'
  | 'cloud-changes'
  | 'conflicts'
  | 'deletions'
  | 'error'

export interface SyncStatusSnapshot {
  kind: SyncStatusKind
  label: string
  detail: string
  conflictCount: number
  tombstoneCount: number
  lastCompared?: string
  lastPush?: string
  lastPull?: string
}

interface ComparisonLike {
  localOnly: unknown[]
  remoteOnly: unknown[]
  conflicts: unknown[]
  tombstonesToPush?: unknown[]
  tombstonesToPull?: unknown[]
  deleteConflicts?: unknown[]
}

export function syncStatusSnapshot(input: {
  configured: boolean
  signedIn: boolean
  syncMetadata: SyncMetadata
  comparison?: ComparisonLike
  error?: string
}): SyncStatusSnapshot {
  const conflictCount = input.comparison?.conflicts.length ?? input.syncMetadata.lastConflictCount ?? 0
  const comparisonTombstones = input.comparison
    ? (input.comparison.tombstonesToPush?.length ?? 0) + (input.comparison.tombstonesToPull?.length ?? 0) + (input.comparison.deleteConflicts?.length ?? 0)
    : undefined
  const tombstoneCount = comparisonTombstones ?? input.syncMetadata.lastTombstoneCount ?? 0

  if (input.error || input.syncMetadata.lastSyncError) {
    return base('error', 'Sync error', input.error ?? input.syncMetadata.lastSyncError ?? 'Review Sync for details.', input, conflictCount, tombstoneCount)
  }
  if (!input.configured) return base('local-only', 'Local only', 'Cloud sync is not configured.', input, conflictCount, tombstoneCount)
  if (!input.signedIn) return base('signed-out', 'Signed out', 'Sign in to compare local and cloud records.', input, conflictCount, tombstoneCount)
  if (!input.comparison && !input.syncMetadata.lastCloudCompareAt) return base('not-compared', 'Not compared', 'Run Compare before syncing.', input, conflictCount, tombstoneCount)
  if (conflictCount > 0) return base('conflicts', 'Conflicts need review', `${conflictCount} conflict${conflictCount === 1 ? '' : 's'} found.`, input, conflictCount, tombstoneCount)
  if (tombstoneCount > 0) return base('deletions', 'Deletions pending', `${tombstoneCount} tombstone${tombstoneCount === 1 ? '' : 's'} need review.`, input, conflictCount, tombstoneCount)
  if ((input.comparison?.localOnly.length ?? 0) > 0) return base('local-changes', 'Local changes pending', 'Local records are ready to push.', input, conflictCount, tombstoneCount)
  if ((input.comparison?.remoteOnly.length ?? 0) > 0) return base('cloud-changes', 'Cloud changes available', 'Cloud records are ready to pull.', input, conflictCount, tombstoneCount)
  if (input.comparison) return base('in-sync', 'In sync', 'Local and cloud records match.', input, conflictCount, tombstoneCount)
  return base('not-compared', 'Not compared', 'Run Compare to refresh sync status.', input, conflictCount, tombstoneCount)
}

function base(
  kind: SyncStatusKind,
  label: string,
  detail: string,
  input: { syncMetadata: SyncMetadata },
  conflictCount: number,
  tombstoneCount: number,
): SyncStatusSnapshot {
  return {
    kind,
    label,
    detail,
    conflictCount,
    tombstoneCount,
    lastCompared: input.syncMetadata.lastCloudCompareAt,
    lastPush: input.syncMetadata.lastCloudPushAt,
    lastPull: input.syncMetadata.lastCloudPullAt,
  }
}
