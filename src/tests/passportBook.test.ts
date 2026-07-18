import { describe, expect, it } from 'vitest'
import type { VisitedCountry } from '../utils/achievements'
import {
  buildStampPages,
  hashString,
  stampCode,
  stampInkColor,
  stampRotationDeg,
} from '../utils/passportBook'

const country = (over: Partial<VisitedCountry> & { name: string }): VisitedCountry => ({ key: over.key ?? over.name, ...over })

describe('deterministic stamp visuals', () => {
  it('hashes strings stably and distinctly', () => {
    expect(hashString('SG')).toBe(hashString('SG'))
    expect(hashString('SG')).not.toBe(hashString('US'))
  })

  it('keeps rotations stable and within range', () => {
    const angle = stampRotationDeg('SG')
    expect(angle).toBe(stampRotationDeg('SG'))
    expect(angle).toBeGreaterThanOrEqual(-12)
    expect(angle).toBeLessThanOrEqual(12)
  })

  it('colours by continent, falling back deterministically', () => {
    expect(stampInkColor(country({ key: 'JP', name: 'Japan', continent: 'Asia' }))).toBe('#b91c1c')
    const fallback = stampInkColor(country({ key: 'name:atlantis', name: 'Atlantis' }))
    expect(fallback).toBe(stampInkColor(country({ key: 'name:atlantis', name: 'Atlantis' })))
    expect(fallback).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('derives a short code from ISO-2 keys or name initials', () => {
    expect(stampCode(country({ key: 'US', name: 'United States' }))).toBe('US')
    expect(stampCode(country({ key: 'name:south africa', name: 'South Africa' }))).toBe('SA')
    expect(stampCode(country({ key: 'name:brazil', name: 'Brazil' }))).toBe('B')
  })
})

describe('buildStampPages', () => {
  const countries: VisitedCountry[] = [
    country({ key: 'US', name: 'United States', continent: 'North America' }),
    country({ key: 'CA', name: 'Canada', continent: 'North America' }),
    country({ key: 'JP', name: 'Japan', continent: 'Asia' }),
    country({ key: 'SG', name: 'Singapore', continent: 'Asia' }),
    country({ key: 'FR', name: 'France', continent: 'Europe' }),
    country({ key: 'name:atlantis', name: 'Atlantis' }),
  ]

  it('groups countries by continent in canonical order, with continent-less last', () => {
    const pages = buildStampPages(countries, { perPage: 9 })
    expect(pages.map((page) => page.title)).toEqual(['Asia', 'Europe', 'North America', 'Other'])
    const asia = pages.find((page) => page.title === 'Asia')!
    expect(asia.stamps.map((stamp) => stamp.country)).toEqual(['Japan', 'Singapore'])
    expect(asia.continent).toBe('Asia')
    const other = pages.find((page) => page.title === 'Other')!
    expect(other.continent).toBeUndefined()
    expect(other.stamps[0].code).toBe('A')
  })

  it('paginates a continent block across multiple pages', () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      country({ key: `A${index}`, name: `Aland ${index}`, continent: 'Europe' }),
    )
    const pages = buildStampPages(many, { perPage: 2 })
    expect(pages).toHaveLength(3)
    expect(pages.map((page) => page.index)).toEqual([0, 1, 2])
    expect(pages[0].stamps).toHaveLength(2)
    expect(pages[2].stamps).toHaveLength(1)
  })

  it('returns no pages for an empty history', () => {
    expect(buildStampPages([])).toEqual([])
  })
})
