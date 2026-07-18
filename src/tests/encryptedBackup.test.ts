import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PBKDF2_ITERATIONS,
  ENCRYPTED_BACKUP_FORMAT,
  UNSUPPORTED_PARAMS_MESSAGE,
  WRONG_PASSPHRASE_MESSAGE,
  decryptBackupEnvelope,
  encryptBackupJson,
  isEncryptedBackupEnvelope,
  parseEncryptedBackupJson,
  validateBackupPassphrase,
} from '../utils/encryptedBackup'

const FAST_ITERATIONS = 1000
const PASSPHRASE = 'correct horse battery staple'
const PLAIN = JSON.stringify({ app: 'FlightLog', flights: [{ id: 'f1', flightNumber: 'SQ38' }] })

describe('encrypted backups', () => {
  it('round-trips backup JSON through encrypt and decrypt', async () => {
    const envelope = await encryptBackupJson(PLAIN, PASSPHRASE, { iterations: FAST_ITERATIONS, hint: 'usual one' })
    expect(envelope.format).toBe(ENCRYPTED_BACKUP_FORMAT)
    expect(envelope.hint).toBe('usual one')
    expect(envelope.payload).not.toContain('SQ38')
    const decrypted = await decryptBackupEnvelope(envelope, PASSPHRASE)
    expect(decrypted).toBe(PLAIN)
  })

  it('rejects a wrong passphrase with a friendly message', async () => {
    const envelope = await encryptBackupJson(PLAIN, PASSPHRASE, { iterations: FAST_ITERATIONS })
    await expect(decryptBackupEnvelope(envelope, 'not the passphrase')).rejects.toThrow(WRONG_PASSPHRASE_MESSAGE)
  })

  it('rejects a tampered payload', async () => {
    const envelope = await encryptBackupJson(PLAIN, PASSPHRASE, { iterations: FAST_ITERATIONS })
    const bytes = [...atob(envelope.payload)]
    bytes[5] = String.fromCharCode(bytes[5].charCodeAt(0) ^ 0xff)
    const tampered = { ...envelope, payload: btoa(bytes.join('')) }
    await expect(decryptBackupEnvelope(tampered, PASSPHRASE)).rejects.toThrow(WRONG_PASSPHRASE_MESSAGE)
  })

  it('refuses envelopes from a newer format version', async () => {
    const envelope = await encryptBackupJson(PLAIN, PASSPHRASE, { iterations: FAST_ITERATIONS })
    await expect(decryptBackupEnvelope({ ...envelope, version: 99 }, PASSPHRASE)).rejects.toThrow(/newer FlightLog version/)
  })

  it('rejects tampered header metadata via AEAD binding', async () => {
    const envelope = await encryptBackupJson(PLAIN, PASSPHRASE, { iterations: FAST_ITERATIONS, hint: 'real hint' })
    await expect(decryptBackupEnvelope({ ...envelope, hint: 'attacker hint' }, PASSPHRASE)).rejects.toThrow(WRONG_PASSPHRASE_MESSAGE)
    await expect(decryptBackupEnvelope({ ...envelope, createdAt: '1999-01-01T00:00:00Z' }, PASSPHRASE)).rejects.toThrow(WRONG_PASSPHRASE_MESSAGE)
  })

  it('rejects out-of-range iteration counts without deriving a key', async () => {
    const envelope = await encryptBackupJson(PLAIN, PASSPHRASE, { iterations: FAST_ITERATIONS })
    const started = Date.now()
    await expect(decryptBackupEnvelope({ ...envelope, kdf: { ...envelope.kdf, iterations: 4_000_000_000 } }, PASSPHRASE)).rejects.toThrow(UNSUPPORTED_PARAMS_MESSAGE)
    await expect(decryptBackupEnvelope({ ...envelope, kdf: { ...envelope.kdf, iterations: 0 } }, PASSPHRASE)).rejects.toThrow(UNSUPPORTED_PARAMS_MESSAGE)
    await expect(decryptBackupEnvelope({ ...envelope, kdf: { ...envelope.kdf, iterations: 1.5 } }, PASSPHRASE)).rejects.toThrow(UNSUPPORTED_PARAMS_MESSAGE)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('rejects unexpected algorithm declarations explicitly', async () => {
    const envelope = await encryptBackupJson(PLAIN, PASSPHRASE, { iterations: FAST_ITERATIONS })
    await expect(decryptBackupEnvelope({ ...envelope, cipher: { ...envelope.cipher, name: 'AES-CBC' as 'AES-GCM' } }, PASSPHRASE)).rejects.toThrow(UNSUPPORTED_PARAMS_MESSAGE)
    await expect(decryptBackupEnvelope({ ...envelope, kdf: { ...envelope.kdf, hash: 'SHA-512' as 'SHA-256' } }, PASSPHRASE)).rejects.toThrow(UNSUPPORTED_PARAMS_MESSAGE)
  })

  it('rejects envelopes with malformed header field types', async () => {
    const envelope = await encryptBackupJson(PLAIN, PASSPHRASE, { iterations: FAST_ITERATIONS })
    expect(isEncryptedBackupEnvelope({ ...envelope, createdAt: 123 })).toBe(false)
    expect(isEncryptedBackupEnvelope({ ...envelope, hint: 42 })).toBe(false)
  })

  it('uses a fresh salt and IV for every export', async () => {
    const first = await encryptBackupJson(PLAIN, PASSPHRASE, { iterations: FAST_ITERATIONS })
    const second = await encryptBackupJson(PLAIN, PASSPHRASE, { iterations: FAST_ITERATIONS })
    expect(first.kdf.salt).not.toBe(second.kdf.salt)
    expect(first.cipher.iv).not.toBe(second.cipher.iv)
    expect(first.payload).not.toBe(second.payload)
  })

  it('defaults to a strong iteration count', async () => {
    const envelope = await encryptBackupJson(PLAIN, PASSPHRASE)
    expect(envelope.kdf.iterations).toBe(DEFAULT_PBKDF2_ITERATIONS)
    const decrypted = await decryptBackupEnvelope(envelope, PASSPHRASE)
    expect(decrypted).toBe(PLAIN)
  })

  it('validates passphrases', () => {
    expect(validateBackupPassphrase('short')).toMatch(/at least 8/)
    expect(validateBackupPassphrase(PASSPHRASE, 'different')).toMatch(/do not match/)
    expect(validateBackupPassphrase(PASSPHRASE, PASSPHRASE)).toBeUndefined()
  })

  it('rejects encryption with a too-short passphrase', async () => {
    await expect(encryptBackupJson(PLAIN, 'short', { iterations: FAST_ITERATIONS })).rejects.toThrow(/at least 8/)
  })

  it('detects encrypted envelopes when parsing', async () => {
    const envelope = await encryptBackupJson(PLAIN, PASSPHRASE, { iterations: FAST_ITERATIONS })
    expect(parseEncryptedBackupJson(JSON.stringify(envelope))?.format).toBe(ENCRYPTED_BACKUP_FORMAT)
    expect(parseEncryptedBackupJson(PLAIN)).toBeUndefined()
    expect(parseEncryptedBackupJson('not json')).toBeUndefined()
    expect(isEncryptedBackupEnvelope({ format: ENCRYPTED_BACKUP_FORMAT })).toBe(false)
  })
})
