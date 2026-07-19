import { afterEach, describe, expect, it, vi } from 'vitest'
import { isIndexedDbAvailable, loadErrorStorageIssue, unavailableStorageIssue } from '../utils/storageHealth'

describe('isIndexedDbAvailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is true when indexedDB is present (jsdom itself has no IndexedDB implementation, so this is stubbed)', () => {
    vi.stubGlobal('indexedDB', {})
    expect(isIndexedDbAvailable()).toBe(true)
  })

  it('is false when indexedDB is undefined (e.g. jsdom, or a browser blocking it)', () => {
    vi.stubGlobal('indexedDB', undefined)
    expect(isIndexedDbAvailable()).toBe(false)
  })

  it('is false when accessing indexedDB itself throws (e.g. a locked-down context)', () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    expect(isIndexedDbAvailable()).toBe(false)
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined })
  })
})

describe('storage issue messages', () => {
  it('unavailableStorageIssue explains private-browsing without alarming "data lost" language', () => {
    const issue = unavailableStorageIssue()
    expect(issue.kind).toBe('unavailable')
    expect(issue.message).toMatch(/private/i)
  })

  it('loadErrorStorageIssue includes the underlying error message when available', () => {
    const issue = loadErrorStorageIssue(new Error('quota exceeded'))
    expect(issue.kind).toBe('load-error')
    expect(issue.message).toContain('quota exceeded')
  })

  it('loadErrorStorageIssue falls back to a generic message for a non-Error rejection', () => {
    const issue = loadErrorStorageIssue('some string rejection')
    expect(issue.message).not.toContain('some string rejection')
    expect(issue.message.length).toBeGreaterThan(0)
  })
})
