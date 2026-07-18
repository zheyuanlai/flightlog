import { describe, expect, it } from 'vitest'
import type { Airport, FlightLogEntry } from '../types'
import {
  buildAchievements,
  buildPassportSummary,
  computeGoalProgress,
  continentForCountryCode,
  crossesDateLine,
  crossesEquator,
  isRedEye,
  longestConsecutiveYears,
  passportScore,
} from '../utils/achievements'

const AIRPORTS: Record<string, Airport> = {
  SIN: { iata: 'SIN', name: 'Singapore Changi', city: 'Singapore', country: 'Singapore', countryCode: 'SG', lat: 1.35, lon: 103.99 },
  LAX: { iata: 'LAX', name: 'Los Angeles Intl', city: 'Los Angeles', country: 'United States', countryCode: 'US', lat: 33.94, lon: -118.41 },
  SYD: { iata: 'SYD', name: 'Sydney Kingsford Smith', city: 'Sydney', country: 'Australia', countryCode: 'AU', lat: -33.95, lon: 151.18 },
  JNB: { iata: 'JNB', name: 'OR Tambo', city: 'Johannesburg', country: 'South Africa', countryCode: 'ZA', lat: -26.13, lon: 28.24 },
  LHR: { iata: 'LHR', name: 'London Heathrow', city: 'London', country: 'United Kingdom', countryCode: 'GB', lat: 51.47, lon: -0.46 },
  GRU: { iata: 'GRU', name: 'São Paulo Guarulhos', city: 'São Paulo', country: 'Brazil', countryCode: 'BR', lat: -23.43, lon: -46.47 },
  NRT: { iata: 'NRT', name: 'Tokyo Narita', city: 'Tokyo', country: 'Japan', countryCode: 'JP', lat: 35.76, lon: 140.39 },
}

const lookup = (iata: string): Airport | undefined => AIRPORTS[iata]

function flight(overrides: Partial<FlightLogEntry> = {}): FlightLogEntry {
  return {
    id: 'achievement-flight',
    date: '2020-01-05',
    flightNumber: 'SQ38',
    airline: 'Singapore Airlines',
    origin: 'SIN',
    destination: 'LAX',
    purpose: 'personal',
    source: 'manual',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  }
}

// A well-travelled history spanning six continents and six consecutive years.
const worldTour: FlightLogEntry[] = [
  flight({ id: 't1', origin: 'SIN', destination: 'LAX', airline: 'Singapore Airlines', date: '2020-01-05' }),
  flight({ id: 't2', origin: 'LAX', destination: 'SYD', airline: 'Qantas', date: '2021-02-10' }),
  flight({ id: 't3', origin: 'SYD', destination: 'JNB', airline: 'Qantas', date: '2022-03-15' }),
  flight({ id: 't4', origin: 'JNB', destination: 'LHR', airline: 'British Airways', date: '2023-04-20' }),
  flight({ id: 't5', origin: 'LHR', destination: 'GRU', airline: 'British Airways', date: '2024-05-25' }),
  flight({ id: 't6', origin: 'GRU', destination: 'SIN', airline: 'Singapore Airlines', date: '2025-06-30' }),
]

describe('continent lookup', () => {
  it('maps ISO-2 country codes to continents', () => {
    expect(continentForCountryCode('SG')).toBe('Asia')
    expect(continentForCountryCode('us')).toBe('North America')
    expect(continentForCountryCode('BR')).toBe('South America')
    expect(continentForCountryCode('AU')).toBe('Oceania')
    expect(continentForCountryCode('za')).toBe('Africa')
    expect(continentForCountryCode('GB')).toBe('Europe')
    expect(continentForCountryCode('AQ')).toBe('Antarctica')
    expect(continentForCountryCode('ZZ')).toBeUndefined()
    expect(continentForCountryCode(undefined)).toBeUndefined()
  })
})

describe('geo crossings', () => {
  it('detects equator crossings from opposite latitudes', () => {
    expect(crossesEquator(1.35, -33.95)).toBe(true)
    expect(crossesEquator(33.94, 51.47)).toBe(false)
    expect(crossesEquator(0, -33.95)).toBe(false)
  })

  it('detects date-line crossings on the short arc', () => {
    expect(crossesDateLine(103.99, -118.41)).toBe(true)
    expect(crossesDateLine(-0.46, -46.47)).toBe(false)
    expect(crossesDateLine(-118.41, 151.18)).toBe(true)
  })
})

describe('red-eye detection', () => {
  it('flags overnight flights that cross local midnight', () => {
    expect(isRedEye(flight({ scheduledDepartureLocal: '2026-06-02T23:30', scheduledArrivalLocal: '2026-06-03T06:15' }))).toBe(true)
    expect(isRedEye(flight({ actualDepartureLocal: '2026-06-02T22:00', actualArrivalLocal: '2026-06-03T05:00' }))).toBe(true)
  })

  it('does not flag daytime or same-day flights, or flights missing local times', () => {
    expect(isRedEye(flight({ scheduledDepartureLocal: '2026-06-02T09:00', scheduledArrivalLocal: '2026-06-02T13:00' }))).toBe(false)
    expect(isRedEye(flight({ scheduledDepartureLocal: '2026-06-02T14:00', scheduledArrivalLocal: '2026-06-03T15:00' }))).toBe(false)
    expect(isRedEye(flight({}))).toBe(false)
  })
})

describe('longestConsecutiveYears', () => {
  it('finds the longest consecutive run', () => {
    expect(longestConsecutiveYears([2020, 2021, 2023, 2024, 2025])).toBe(3)
    expect(longestConsecutiveYears([2020])).toBe(1)
    expect(longestConsecutiveYears([2025, 2020, 2021, 2022])).toBe(3)
    expect(longestConsecutiveYears([])).toBe(0)
  })
})

describe('buildPassportSummary', () => {
  it('aggregates reach, hemispheres, crossings and streaks across a world tour', () => {
    const summary = buildPassportSummary(worldTour, lookup)
    expect(summary.totalFlights).toBe(6)
    expect(summary.airports).toEqual(['GRU', 'JNB', 'LAX', 'LHR', 'SIN', 'SYD'])
    expect(summary.countryCount).toBe(6)
    expect(summary.countries).toContain('Brazil')
    expect(summary.continents).toEqual(['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania'])
    expect(summary.hemispheres).toEqual({ north: true, south: true, east: true, west: true })
    expect(summary.equatorCrossings).toBe(4)
    expect(summary.dateLineCrossings).toBe(2)
    expect(summary.longestYearStreak).toBe(6)
    expect(summary.totalDistanceKm).toBeGreaterThan(60000)
    expect(summary.earthLaps).toBeGreaterThanOrEqual(1)
  })

  it('ignores deleted flights and handles an empty history', () => {
    const summary = buildPassportSummary([flight({ id: 'x', deletedAt: '2025-01-01T00:00:00Z' })], lookup)
    expect(summary.totalFlights).toBe(0)
    expect(buildPassportSummary([], lookup).continents).toEqual([])
  })
})

describe('buildAchievements', () => {
  it('marks earned milestones and records the earning date', () => {
    const achievements = buildAchievements(worldTour, lookup)
    const byId = new Map(achievements.map((a) => [a.id, a]))
    expect(byId.get('first-flight')?.earned).toBe(true)
    expect(byId.get('countries-5')?.earned).toBe(true)
    expect(byId.get('continents-5')?.earned).toBe(true)
    expect(byId.get('continents-7')?.earned).toBe(false)
    expect(byId.get('both-hemispheres')?.earned).toBe(true)
    expect(byId.get('equator')?.earned).toBe(true)
    expect(byId.get('dateline')?.earned).toBe(true)
    expect(byId.get('longhaul')?.earned).toBe(true)
    expect(byId.get('earth-lap-1')?.earned).toBe(true)
    expect(byId.get('earth-lap-5')?.earned).toBe(false)
    expect(byId.get('streak-3')?.earned).toBe(true)
    expect(byId.get('frequent-10')?.earned).toBe(false)
    // Fifth continent (Europe) is reached on the JNB→LHR leg.
    expect(byId.get('continents-5')?.earnedDate).toBe('2023-04-20')
    expect(byId.get('continents-3')?.earnedDate).toBe('2021-02-10')
    // Unearned achievements report clamped progress and no earning date.
    expect(byId.get('frequent-10')?.progress).toBe(6)
    expect(byId.get('frequent-10')?.earnedDate).toBeUndefined()
  })

  it('counts red-eyes toward the night milestones', () => {
    const redEyes = Array.from({ length: 3 }, (_, index) =>
      flight({ id: `r${index}`, scheduledDepartureLocal: '2026-06-02T23:30', scheduledArrivalLocal: '2026-06-03T06:00' }),
    )
    const byId = new Map(buildAchievements(redEyes, lookup).map((a) => [a.id, a]))
    expect(byId.get('red-eye-1')?.earned).toBe(true)
    expect(byId.get('red-eye-10')?.earned).toBe(false)
    expect(byId.get('red-eye-10')?.progress).toBe(3)
  })
})

describe('passportScore', () => {
  it('rewards breadth and caps at 100', () => {
    expect(passportScore({ flights: 0, airports: 0, countries: 0, airlines: 0, trips: 0 })).toBe(0)
    expect(passportScore({ flights: 4, airports: 3, countries: 2, airlines: 2, trips: 1 })).toBe(23)
    expect(passportScore({ flights: 100, airports: 100, countries: 100, airlines: 100, trips: 100 })).toBe(100)
  })
})

describe('computeGoalProgress', () => {
  it('reports per-year progress for goals with a positive target', () => {
    const history = [
      flight({ id: 'g1', origin: 'SIN', destination: 'LAX', date: '2025-01-05' }),
      flight({ id: 'g2', origin: 'LAX', destination: 'SYD', date: '2025-03-05' }),
      flight({ id: 'g3', origin: 'SIN', destination: 'NRT', date: '2024-11-05' }),
    ]
    const progress = computeGoalProgress(history, { flightsPerYear: 4, countriesPerYear: 2, airportsPerYear: 0 }, 2025, lookup)
    const byId = new Map(progress.map((p) => [p.id, p]))
    expect(byId.has('airportsPerYear')).toBe(false) // target 0 -> omitted
    expect(byId.get('flightsPerYear')).toMatchObject({ current: 2, target: 4, percent: 50, met: false })
    expect(byId.get('countriesPerYear')).toMatchObject({ current: 3, met: true }) // SG, US, AU
  })

  it('returns nothing when no goals are set', () => {
    expect(computeGoalProgress(worldTour, {}, 2025, lookup)).toEqual([])
  })
})
