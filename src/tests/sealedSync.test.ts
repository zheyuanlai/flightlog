import { describe, expect, it } from 'vitest'
import { isSealedSyncRecord, sealSyncRecord, SealedSyncPassphraseError, unsealSyncRecord } from '../utils/sealedSync'

const FAST_ITERATIONS = 1000
const PASSPHRASE = 'correct horse battery staple'
const RECORD = { id: 'f1', flightNumber: 'SQ38', origin: 'SIN', destination: 'LAX', notes: 'business trip' }

describe('sealed sync records', () => {
  it('round-trips an arbitrary record value through seal and unseal', async () => {
    const envelope = await sealSyncRecord(RECORD, PASSPHRASE, { iterations: FAST_ITERATIONS })
    expect(envelope.payload).not.toContain('SQ38')
    expect(envelope.payload).not.toContain('business trip')
    const unsealed = await unsealSyncRecord(envelope, PASSPHRASE)
    expect(unsealed).toEqual(RECORD)
  })

  it('round-trips arrays and primitives, not just objects', async () => {
    const arrayEnvelope = await sealSyncRecord([1, 2, 3], PASSPHRASE, { iterations: FAST_ITERATIONS })
    expect(await unsealSyncRecord(arrayEnvelope, PASSPHRASE)).toEqual([1, 2, 3])
  })

  it('throws SealedSyncPassphraseError on a wrong passphrase', async () => {
    const envelope = await sealSyncRecord(RECORD, PASSPHRASE, { iterations: FAST_ITERATIONS })
    await expect(unsealSyncRecord(envelope, 'wrong passphrase entirely')).rejects.toBeInstanceOf(SealedSyncPassphraseError)
  })

  it('throws SealedSyncPassphraseError on a tampered payload', async () => {
    const envelope = await sealSyncRecord(RECORD, PASSPHRASE, { iterations: FAST_ITERATIONS })
    const tampered = { ...envelope, payload: envelope.payload.slice(0, -4) + (envelope.payload.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA') }
    await expect(unsealSyncRecord(tampered, PASSPHRASE)).rejects.toBeInstanceOf(SealedSyncPassphraseError)
  })

  it('identifies a sealed envelope and rejects plain records', async () => {
    const envelope = await sealSyncRecord(RECORD, PASSPHRASE, { iterations: FAST_ITERATIONS })
    expect(isSealedSyncRecord(envelope)).toBe(true)
    expect(isSealedSyncRecord(RECORD)).toBe(false)
    expect(isSealedSyncRecord(undefined)).toBe(false)
  })
})
