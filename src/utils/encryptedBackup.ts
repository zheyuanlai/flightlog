export const ENCRYPTED_BACKUP_FORMAT = 'flightlog-encrypted-backup'
export const ENCRYPTED_BACKUP_VERSION = 1
export const DEFAULT_PBKDF2_ITERATIONS = 600_000
export const MAX_PBKDF2_ITERATIONS = 5_000_000
export const MIN_PASSPHRASE_LENGTH = 8

export interface EncryptedBackupEnvelope {
  app: 'FlightLog'
  format: typeof ENCRYPTED_BACKUP_FORMAT
  version: number
  createdAt: string
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  cipher: { name: 'AES-GCM'; iv: string }
  payload: string
  hint?: string
}

export const WRONG_PASSPHRASE_MESSAGE = 'Could not decrypt this backup. The passphrase is wrong or the file was modified.'
export const UNSUPPORTED_PARAMS_MESSAGE = 'This encrypted backup uses unsupported encryption parameters. It may be corrupted or from an incompatible app.'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function envelopeAdditionalData(envelope: Pick<EncryptedBackupEnvelope, 'app' | 'format' | 'version' | 'createdAt' | 'kdf' | 'cipher' | 'hint'>): Uint8Array {
  // Deterministic header encoding bound to the ciphertext as AES-GCM
  // additionalData, so tampering with any header field fails decryption.
  return new TextEncoder().encode(JSON.stringify([
    envelope.app,
    envelope.format,
    envelope.version,
    envelope.createdAt,
    envelope.kdf.name,
    envelope.kdf.hash,
    envelope.kdf.iterations,
    envelope.kdf.salt,
    envelope.cipher.name,
    envelope.cipher.iv,
    envelope.hint ?? null,
  ]))
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const keyMaterial = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function validateBackupPassphrase(passphrase: string, confirmation?: string): string | undefined {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) return `Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`
  if (confirmation !== undefined && passphrase !== confirmation) return 'Passphrase and confirmation do not match.'
  return undefined
}

export async function encryptBackupJson(
  plainJson: string,
  passphrase: string,
  options: { iterations?: number; hint?: string; now?: string } = {},
): Promise<EncryptedBackupEnvelope> {
  const validationError = validateBackupPassphrase(passphrase)
  if (validationError) throw new Error(validationError)
  const iterations = Math.min(MAX_PBKDF2_ITERATIONS, Math.max(1, Math.floor(options.iterations ?? DEFAULT_PBKDF2_ITERATIONS)))
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const header: Omit<EncryptedBackupEnvelope, 'payload'> = {
    app: 'FlightLog',
    format: ENCRYPTED_BACKUP_FORMAT,
    version: ENCRYPTED_BACKUP_VERSION,
    createdAt: options.now ?? new Date().toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(salt) },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
    hint: options.hint?.trim() || undefined,
  }
  const key = await deriveAesKey(passphrase, salt, iterations)
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: envelopeAdditionalData(header) as BufferSource },
    key,
    new TextEncoder().encode(plainJson),
  )
  return {
    ...header,
    payload: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

export async function decryptBackupEnvelope(envelope: EncryptedBackupEnvelope, passphrase: string): Promise<string> {
  if (envelope.version > ENCRYPTED_BACKUP_VERSION) {
    throw new Error('This encrypted backup was created by a newer FlightLog version. Update the app to restore it.')
  }
  const iterations = envelope.kdf.iterations
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS) {
    throw new Error(UNSUPPORTED_PARAMS_MESSAGE)
  }
  if (envelope.kdf.name !== 'PBKDF2' || envelope.kdf.hash !== 'SHA-256' || envelope.cipher.name !== 'AES-GCM') {
    throw new Error(UNSUPPORTED_PARAMS_MESSAGE)
  }
  try {
    const key = await deriveAesKey(passphrase, base64ToBytes(envelope.kdf.salt), iterations)
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(envelope.cipher.iv) as BufferSource, additionalData: envelopeAdditionalData(envelope) as BufferSource },
      key,
      base64ToBytes(envelope.payload) as BufferSource,
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    throw new Error(WRONG_PASSPHRASE_MESSAGE)
  }
}

export function isEncryptedBackupEnvelope(value: unknown): value is EncryptedBackupEnvelope {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<EncryptedBackupEnvelope>
  return candidate.format === ENCRYPTED_BACKUP_FORMAT
    && typeof candidate.version === 'number'
    && typeof candidate.payload === 'string'
    && typeof candidate.createdAt === 'string'
    && (candidate.hint === undefined || typeof candidate.hint === 'string')
    && typeof candidate.kdf === 'object' && candidate.kdf !== null && typeof candidate.kdf.salt === 'string' && typeof candidate.kdf.iterations === 'number'
    && typeof candidate.cipher === 'object' && candidate.cipher !== null && typeof candidate.cipher.iv === 'string'
}

export function parseEncryptedBackupJson(text: string): EncryptedBackupEnvelope | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return isEncryptedBackupEnvelope(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
