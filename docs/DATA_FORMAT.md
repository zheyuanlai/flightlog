# FlightLog Data Format

FlightLog is local-first: your data lives in this browser's IndexedDB, and the only way it
travels anywhere else is a file you export or a backup you explicitly create. This document is
the authoritative, standalone reference for every shape that data takes — on disk (IndexedDB)
and in transit (backup/share files) — so that FlightLog's data stays readable and migratable for
years, independent of the app's own code. If you're building a tool against FlightLog's export
format, or auditing what a backup file actually contains, this is the doc to read.

It supersedes the scattered format notes previously spread across `README.md`; those sections
now link here instead of repeating the field lists.

## 1. Independent version numbers

FlightLog has **multiple separate schema-version constants**. They are not derived from each
other, and there's no code path or test that requires any of them to move in lockstep — they
version different things on purpose:

| Constant | Where | Current value | Versions |
| --- | --- | --- | --- |
| `LOCAL_SCHEMA_VERSION` | `src/db.ts` | 4 | The Dexie/IndexedDB table+index schema on this device |
| `FLIGHTLOG_BACKUP_SCHEMA_VERSION` | `src/utils/backup.ts` | 4 | The `FlightLogBackup` JSON interchange format |
| `ARCHIVE_SCHEMA_VERSION` | `src/utils/archive.ts` | 1 | The `ArchivePayload` extra fields layered on top of `FlightLogBackup` (§4) |

The first two currently happen to both equal 4 — that's coincidence, not a contract. A future
release could bump any one of these without the others (e.g. adding a new Dexie index without
changing what a backup file contains, or adding a new backup field that's derived/recomputed
rather than stored). `ARCHIVE_SCHEMA_VERSION` starts independently at 1, the same way
`ENCRYPTED_BACKUP_VERSION` (§4) does.

## 2. IndexedDB schema (on-device storage)

Database name: `flightlog`. Managed by Dexie, versioned additively — every `.version(n)` call to
date only adds tables or adds indexed fields to existing tables; **no version has ever used a
Dexie `.upgrade()` callback**, so there is no data-transforming migration step at the storage
layer today. Existing rows are left untouched when a new version adds an index; Dexie just starts
indexing that field going forward.

| Version | Change |
| --- | --- |
| 1 | `flights` table: `id, date, flightNumber, airline, origin, destination, updatedAt` |
| 2 | `flights` gains `source, providerFetchedAt` indexes. New `providerAirports: 'iata, countryCode, source, updatedAt'` |
| 3 | New `tripMetadata: 'id, type, isFavorite, updatedAt'` and `appMetadata: 'key, updatedAt'` |
| 4 (current) | `flights` gains `deletedAt, restoredAt` indexes. `providerAirports`/`tripMetadata` gain `deletedAt`. New `syncEvents: 'id, eventType, createdAt, deviceId'` |

Current tables (index string is what's indexed for queries; every field on the row type is
stored regardless of whether it's indexed):

| Table | Indexed fields | Row shape |
| --- | --- | --- |
| `flights` | `id, date, flightNumber, airline, origin, destination, updatedAt, deletedAt, restoredAt, source, providerFetchedAt` | `FlightLogEntry` (§3) |
| `providerAirports` | `iata, countryCode, source, updatedAt, deletedAt` | `ProviderAirportSnapshot` |
| `tripMetadata` | `id, type, isFavorite, updatedAt, deletedAt` | `TripMetadata` (§3) |
| `appMetadata` | `key, updatedAt` | `AppMetadata` — a schemaless key/value bag; `AppSettings` and `SyncMetadata` are stored as JSON strings under fixed keys here, so they ride along without their own Dexie schema |
| `syncEvents` | `id, eventType, createdAt, deviceId` | `SyncEventLog` — local audit log of sync operations |

## 3. Core record shapes

### `FlightLogEntry` (`src/types.ts`)

One logged flight. Extends `TombstoneMetadata` (soft-delete fields, all optional):
`deletedAt`, `deletedByDeviceId`, `deleteReason`, `restoredAt`, `tombstoneVersion`,
`lastOperation`.

Required: `id` (string, UUID), `date`, `flightNumber`, `airline`, `origin`, `destination`,
`purpose` (`personal | work | school | other`), `source` (`manual | live-import | mock-live |
aerodatabox`), `createdAt`, `updatedAt` (ISO 8601 timestamps).

Everything else is optional and additive: a bare scheduled/actual departure/arrival (4 fields —
no bare `estimatedDeparture`/`estimatedArrival`), a fuller scheduled/estimated/actual
departure/arrival set (6 fields each) duplicated across the two timezone-qualified
representations `...Local` and `...Utc`, `originTimeZone`/`destinationTimeZone`,
`aircraftType`/`aircraftRegistration`, `cabin`/`seat`, `notes`, `liveStatus` (a nested
`FlightLiveStatus` snapshot from the last live lookup), `lastFetchedAt`, `providerFlightId`,
`providerFetchedAt`, `airlineIata`/`airlineIcao`, `originAirportSnapshot`/
`destinationAirportSnapshot`, `providerWarnings`, `lookupDateRole`, `completionDismissedAt`.

**Not part of this shape, but present at runtime**: `FlightWithComputed` (used by trip grouping
and the UI) adds `distanceKm`, `durationMinutes`, `originAirport`, `destinationAirport`,
`hasRouteCoordinates` — these are computed fresh from the stored fields every time (great-circle
distance, resolved airport lookups), never persisted, and must be stripped before treating an
object as a genuine `FlightLogEntry` (see the `v4.2` trip-share export, which does exactly this).

### `TripMetadata` (`src/types.ts`)

User-editable metadata for a trip (name, notes, favorite flag, manual flight membership). Also
extends `TombstoneMetadata`. Required: `id`, `type` (`TripType`), `isFavorite`, `createdAt`,
`updatedAt`. Optional: `name`, `notes`, `isManual`, `flightIds` (only meaningful when
`isManual: true` — see below), `packingChecklist` (`ChecklistItem[]`, added v4.1).

A trip that isn't explicitly manual is a *computed* grouping (flights within 3 days of each
other on connected routes) — `TripMetadata` only needs to exist for a computed trip if the user
has set a name, note, favorite, or checklist on it; otherwise it's derived purely from the
flights and has no stored row.

### `AppMetadata` (`src/types.ts`)

`{ key: string, value: string, updatedAt: string }`. `value` is itself a JSON string for most
keys (`settings`, `syncMetadata`). Two different fixed key-sets treat certain keys specially, for
two different purposes — do not conflate them:

- **Import-exclusion** (`nonImportableMetadataKeys` in `src/App.tsx`, 7 keys): `lastBackupAt`,
  `lastImportAt`, `lastCloudBackupAt`, `lastCloudBackupChecksum`, `lastCloudBackupId`,
  `lastCloudRestoreAt`, `cloudRestorePromptDismissedAt` are stripped from a full-backup
  merge/restore before it's applied, so importing a backup never clobbers the receiving device's
  own backup/import bookkeeping. Notably, `syncMetadata` is **not** in this list — restoring a
  full backup *does* overwrite the receiving device's sync metadata (device ID, last-sync
  timestamps).
- **Checksum comparison** (`VOLATILE_METADATA_KEYS` in `src/lib/cloudBackup.ts`, 8 keys): the
  same 7 keys above, plus `syncMetadata`, are excluded when computing/comparing a backup's
  checksum, so two backups that differ only in device-local bookkeeping still compare as
  identical.

## 4. Interchange formats (files that leave the device)

### `FlightLogBackup` — full backup (`src/utils/backup.ts`)

```ts
{
  app: 'FlightLog'
  schemaVersion: number        // FLIGHTLOG_BACKUP_SCHEMA_VERSION, currently 4
  exportedAt: string           // ISO 8601
  flights: FlightLogEntry[]
  tripMetadata: TripMetadata[]
  providerAirports: ProviderAirportSnapshot[]
  appMetadata: AppMetadata[]
}
```

This is what "Export full backup" in Backup Center produces, what a cloud backup row stores
(alongside a plain `schema_version` summary column), and — with three extra fields layered on
top — what a v4.2 trip-share file is (§5).

### `EncryptedBackupEnvelope` — the encryption wrapper (`src/utils/encryptedBackup.ts`)

```ts
{
  app: 'FlightLog'
  format: 'flightlog-encrypted-backup'
  version: number               // ENCRYPTED_BACKUP_VERSION, currently 1
  createdAt: string
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: number, salt: string }
  cipher: { name: 'AES-GCM', iv: string }
  payload: string                // base64 ciphertext; decrypts to a FlightLogBackup JSON string
  hint?: string                  // stored unencrypted, shown to help the user recall their passphrase
}
```

This only versions the *envelope* — decrypting it hands you a plain `FlightLogBackup` JSON
string, which then goes through the same parse path as an unencrypted backup and inherits its
compatibility behavior (§6).

### `TripShareFile` — one shared trip (`src/utils/tripShare.ts`, v4.2)

```ts
FlightLogBackup & {
  shareFormat: 'flightlog-trip-share'
  shareTripName: string
  shareChecksum: string          // SHA-256 over the file's full canonicalized JSON, including shareTripName
}
```

Deliberately just a `FlightLogBackup` (scoped to one trip's flights, with local/device-only
fields like `deletedByDeviceId`, `lastFetchedAt`, and `liveStatus` provider bookkeeping stripped)
plus three marker fields — so it round-trips through the exact same
`parseFullBackupJson`/`previewBackupImport` pipeline a full backup does, unchanged. Code
consuming trip-share-specific behavior detects it via `isTripShareFile`/
`detectAndVerifyTripShare` rather than a different parser.

### `ArchivePayload` — the lifetime archive's embedded data (`src/utils/archive.ts`, v5.3)

```ts
FlightLogBackup & {
  archiveFormat: 'flightlog-lifetime-archive'
  archiveVersion: number          // ARCHIVE_SCHEMA_VERSION, currently 1
  archiveGeneratedAt: string
  archiveChecksum: string         // SHA-256 over the canonicalized JSON (via the same computeBackupChecksum
                                   // used for a trip share -- exportedAt and volatile appMetadata keys are
                                   // normalized before hashing, same as there; detects corruption/hand-editing,
                                   // not a cryptographic signature -- there's no secret key)
  archiveSummary: { totalFlights: number; countryCount: number; totalDistanceKm: number; years: string[]; firstFlightDate?: string; lastFlightDate?: string }
  archiveAchievements: Achievement[]  // earned achievements only, frozen at export time
}
```

The same "extend `FlightLogBackup`, don't replace it" pattern `TripShareFile` established —
unlike a trip share, `ArchivePayload` is full-fidelity (all flights, not scoped to one trip; not
field-stripped), so it round-trips through `parseFullBackupJson`/`previewBackupImport` exactly
like a plain full backup, and both merge and replace are offered on import (a trip share only
offers merge, since it's intentionally partial). `archiveSummary`/`archiveAchievements` are a
frozen point-in-time snapshot, included so a future reader with no app to recompute stats from
the raw flights still sees the numbers that were true when the archive was made.

This JSON is never written to disk on its own — it's embedded inside a lifetime archive `.html`
file (a single self-contained page with the data + a human-readable rendering of it: lifetime
stats, achievements, and passport stamp pages, no external stylesheet/script/network reference)
in a `<script type="application/json" id="flightlog-archive-payload">` tag. Importing an archive
extracts that tag's contents back out (`resolveImportableJsonText`) before handing the text to the
exact same parser a plain `.json` backup file uses — the app's import code never needs to know
whether a given file was a `.json` backup or an `.html` archive.

## 5. The migration guarantee

**A backup or trip-share file made by any past version of FlightLog will still import
successfully in a newer version.** Concretely:

- `parseFullBackupJson` defaults a missing/non-numeric `schemaVersion` to `1` and reads only the
  five known top-level fields — anything else present in the JSON (older or newer) is ignored,
  never causes a parse failure.
- `previewBackupImport` only emits a **non-blocking warning** if `backup.schemaVersion` is newer
  than what this app version knows about (`FLIGHTLOG_BACKUP_SCHEMA_VERSION`); it still imports
  the data. There is no lower-bound check either — a schema-1 backup from FlightLog's very first
  release imports the same way a current one does.
- Fields introduced by a later schema version that are absent from an older backup simply stay
  `undefined` after import — every consumer of `FlightLogEntry`/`TripMetadata` already treats
  those fields as optional, so nothing crashes or requires a bespoke upcasting step today.

This is a **structural** guarantee (nothing is ever schema-rejected), not a **content**
guarantee — an old backup doesn't retroactively gain data that didn't exist when it was made
(e.g. a v1 backup won't have tombstone fields). `src/tests/utils.test.ts` includes regression
tests locking in that a `schemaVersion: 1` backup, a backup missing `schemaVersion` entirely, and
a hypothetical future `schemaVersion` all parse and import without error, so a future code
change can't silently break this without a test failing.

The one place that is **fail-closed by design**, not lenient: `EncryptedBackupEnvelope`. If
`envelope.version` is newer than this app build's `ENCRYPTED_BACKUP_VERSION`, decryption is
refused outright with a clear "created by a newer FlightLog version" error, and any
unrecognized KDF/cipher parameters are rejected the same way. This is intentional — silently
attempting to decrypt with assumptions that may not hold is a bad tradeoff for encrypted data,
where a soft warning isn't a safe substitute for correctness.

## 6. What is *not* covered by a version number

- **Live-provider response shapes** (`FlightLiveStatus`, `AirportStatus`, `AircraftLookup`,
  returned by the Cloudflare Worker) are normalized to a stable internal shape at the Worker
  boundary (see `workers/flight-status-worker/README.md`) before they ever reach stored data —
  they are not part of this document's versioning, since a provider's raw response format is
  outside FlightLog's control.
- **CSV import** (`src/utils/importers.ts`) accepts a documented column-header convention (see
  `README.md`'s "CSV Import Format" section) but isn't itself a versioned format — it's a
  best-effort import path with column auto-detection, not a round-trip export target.

## 7. Practical guidance for anyone reading old data

If you're writing a script against exported FlightLog JSON years from now: read `schemaVersion`,
but don't reject a file because the number is unfamiliar — every field is optional except the
ones listed as required in §3, and unknown extra top-level fields are safe to ignore. That's the
same rule FlightLog's own parser follows.
