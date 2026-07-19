import { decryptBackupEnvelope, encryptBackupJson, isEncryptedBackupEnvelope, WRONG_PASSPHRASE_MESSAGE, type EncryptedBackupEnvelope } from './encryptedBackup'

/** A sealed sync record's passphrase was missing, wrong, or the envelope was tampered with. Distinct from other decrypt failures (e.g. an incompatible future version) so callers can specifically re-prompt for a passphrase. */
export class SealedSyncPassphraseError extends Error {
  constructor(message = WRONG_PASSPHRASE_MESSAGE) {
    super(message)
    this.name = 'SealedSyncPassphraseError'
  }
}

/**
 * Encrypts a single sync record's content for upload. Reuses the same PBKDF2 +
 * AES-GCM envelope as encrypted backups, so no new crypto primitives or on-disk
 * format are introduced — just called once per record instead of once per backup.
 */
export async function sealSyncRecord(record: unknown, passphrase: string, options: { iterations?: number } = {}): Promise<EncryptedBackupEnvelope> {
  return encryptBackupJson(JSON.stringify(record), passphrase, options)
}

/** Decrypts a sealed sync record envelope back into its original value. */
export async function unsealSyncRecord<T = unknown>(envelope: EncryptedBackupEnvelope, passphrase: string): Promise<T> {
  try {
    return JSON.parse(await decryptBackupEnvelope(envelope, passphrase)) as T
  } catch (error) {
    if (error instanceof Error && error.message === WRONG_PASSPHRASE_MESSAGE) throw new SealedSyncPassphraseError()
    throw error
  }
}

export function isSealedSyncRecord(value: unknown): value is EncryptedBackupEnvelope {
  return isEncryptedBackupEnvelope(value)
}
