import type { FlightLogEntry } from '../types'
import { airlineDisplayName } from './airlines'
import { routeKey } from './flights'
import { ON_TIME_THRESHOLD_MINUTES, airlinePunctuality, airportDeparturePunctuality, formatDelayLabel, routePunctuality, type PunctualityStat } from './insights'

export type DelaySignalKey = 'route' | 'airline' | 'originAirport' | 'inboundAircraft'

export interface DelaySignal {
  key: DelaySignalKey
  label: string
  weight: number
  sampleSize?: number
  delayProbability: number
  averageDelayMinutes: number
  explanation: string
}

export interface DelayBand {
  lowMinutes: number
  highMinutes: number
}

export type DelayConfidence = 'low' | 'medium' | 'high'

export interface DelayPrediction {
  hasSignal: boolean
  delayProbability: number
  expectedDelayMinutes: number
  band: DelayBand
  confidence: DelayConfidence
  signals: DelaySignal[]
  summary: string
}

export interface PredictDelayOptions {
  /** Minutes the inbound aircraft is currently running late (negative/zero if on time). Omit when unavailable. */
  inboundDelayMinutes?: number
}

const ROUTE_BASE_WEIGHT = 3
const AIRLINE_BASE_WEIGHT = 1.5
const AIRPORT_BASE_WEIGHT = 1
const INBOUND_BASE_WEIGHT = 4
const FULL_CONFIDENCE_SAMPLE_SIZE = 8
const INBOUND_SATURATION_MINUTES = 60
const HIGH_CONFIDENCE_SAMPLE_SIZE = 10
const MEDIUM_CONFIDENCE_SAMPLE_SIZE = 3

function sampleWeight(sampleSize: number): number {
  return Math.min(sampleSize, FULL_CONFIDENCE_SAMPLE_SIZE) / FULL_CONFIDENCE_SAMPLE_SIZE
}

function historySignal(key: DelaySignalKey, label: string, baseWeight: number, stat: PunctualityStat | undefined, describe: (stat: PunctualityStat) => string): DelaySignal | undefined {
  if (!stat || stat.flights === 0) return undefined
  return {
    key,
    label,
    weight: baseWeight * sampleWeight(stat.flights),
    sampleSize: stat.flights,
    delayProbability: 1 - stat.onTimePercent / 100,
    averageDelayMinutes: stat.averageDelayMinutes,
    explanation: describe(stat),
  }
}

function timesLabel(count: number): string {
  return `${count} time${count === 1 ? '' : 's'}`
}

function inboundSignal(minutes: number): DelaySignal {
  const delayProbability = Math.max(0, Math.min(1, minutes / INBOUND_SATURATION_MINUTES))
  return {
    key: 'inboundAircraft',
    label: 'Inbound aircraft',
    weight: INBOUND_BASE_WEIGHT,
    delayProbability,
    averageDelayMinutes: minutes,
    explanation: `Inbound aircraft is currently ${formatDelayLabel(minutes)}.`,
  }
}

/**
 * A transparent, on-device heuristic: weights the upcoming flight's own route,
 * airline, and origin-airport delay history (more measured flights = more
 * weight per signal, capped) plus an optional live inbound-aircraft signal.
 * Degrades gracefully to hasSignal: false when there's no history for any of
 * these and no inbound signal was supplied, rather than guessing.
 */
export function predictDelay(flights: FlightLogEntry[], flight: FlightLogEntry, options: PredictDelayOptions = {}): DelayPrediction {
  const history = flights.filter((item) => item.id !== flight.id && !item.deletedAt)
  const signals: DelaySignal[] = []

  const route = routeKey(flight)
  const routeStat = routePunctuality(history, 'departure').find((stat) => stat.key === route)
  const routeSig = historySignal('route', route, ROUTE_BASE_WEIGHT, routeStat, (stat) =>
    `Your ${route} history: delayed ${timesLabel(stat.flights - stat.onTimeCount)} out of ${stat.flights}, avg ${formatDelayLabel(stat.averageDelayMinutes)}.`)
  if (routeSig) signals.push(routeSig)

  const airlineLabel = airlineDisplayName(flight.airline) || flight.airline
  const airlineStat = airlinePunctuality(history, 'departure').find((stat) => stat.key === airlineLabel)
  const airlineSig = historySignal('airline', airlineLabel, AIRLINE_BASE_WEIGHT, airlineStat, (stat) =>
    `${airlineLabel} history: delayed ${timesLabel(stat.flights - stat.onTimeCount)} out of ${stat.flights}, avg ${formatDelayLabel(stat.averageDelayMinutes)}.`)
  if (airlineSig) signals.push(airlineSig)

  const airportStat = airportDeparturePunctuality(history).find((stat) => stat.key === flight.origin)
  const airportSig = historySignal('originAirport', flight.origin, AIRPORT_BASE_WEIGHT, airportStat, (stat) =>
    `${flight.origin} departures: delayed ${timesLabel(stat.flights - stat.onTimeCount)} out of ${stat.flights}, avg ${formatDelayLabel(stat.averageDelayMinutes)}.`)
  if (airportSig) signals.push(airportSig)

  if (options.inboundDelayMinutes !== undefined && Number.isFinite(options.inboundDelayMinutes)) signals.push(inboundSignal(options.inboundDelayMinutes))

  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0)
  if (totalWeight === 0) {
    return {
      hasSignal: false,
      delayProbability: 0,
      expectedDelayMinutes: 0,
      band: { lowMinutes: 0, highMinutes: 0 },
      confidence: 'low',
      signals: [],
      summary: 'Not enough history yet to predict this flight.',
    }
  }

  const delayProbability = signals.reduce((sum, signal) => sum + signal.delayProbability * signal.weight, 0) / totalWeight
  const expectedDelayMinutes = Math.round(signals.reduce((sum, signal) => sum + signal.averageDelayMinutes * signal.weight, 0) / totalWeight)

  const historySampleSize = signals.reduce((sum, signal) => sum + (signal.sampleSize ?? 0), 0)
  const hasInboundSignal = signals.some((signal) => signal.key === 'inboundAircraft')
  let confidence: DelayConfidence = historySampleSize >= HIGH_CONFIDENCE_SAMPLE_SIZE ? 'high' : historySampleSize >= MEDIUM_CONFIDENCE_SAMPLE_SIZE ? 'medium' : 'low'
  if (hasInboundSignal && confidence === 'low') confidence = 'medium'
  else if (hasInboundSignal && confidence === 'medium') confidence = 'high'

  const spread = confidence === 'high' ? 15 : confidence === 'medium' ? 25 : 40
  const band: DelayBand = {
    lowMinutes: expectedDelayMinutes - spread,
    highMinutes: expectedDelayMinutes + spread,
  }

  const percent = Math.round(delayProbability * 100)
  const summary = `${percent}% chance of a delay beyond ${ON_TIME_THRESHOLD_MINUTES} minutes, typically around ${formatDelayLabel(expectedDelayMinutes)}.`

  return { hasSignal: true, delayProbability, expectedDelayMinutes, band, confidence, signals, summary }
}
