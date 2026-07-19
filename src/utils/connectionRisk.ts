import { DateTime } from 'luxon'
import type { FlightLogEntry, FlightWithComputed } from '../types'
import { getBestArrivalTime, getBestDepartureTime } from './flightTime'
import { formatDelayLabel } from './insights'
import { predictDelay } from './predict'

export type ConnectionRiskLevel = 'low' | 'medium' | 'high'

export interface ConnectionRisk {
  fromFlight: FlightWithComputed
  toFlight: FlightWithComputed
  airport: string
  connectionMinutes: number
  riskAdjustedMinutes: number
  level: ConnectionRiskLevel
  explanation: string
}

const MAX_CONNECTION_GAP_MINUTES = 24 * 60
const TIGHT_MINUTES = 45
const COMFORTABLE_MINUTES = 90

function instantMs(time: { instantIso?: string } | undefined): number | undefined {
  if (!time?.instantIso) return undefined
  const dateTime = DateTime.fromISO(time.instantIso, { setZone: true }).toUTC()
  return dateTime.isValid ? dateTime.toMillis() : undefined
}

/**
 * Assesses the layover between two consecutive legs of a trip at a shared
 * airport, weighting the scheduled gap against the incoming leg's own delay
 * history (from predictDelay) rather than just the raw connection time.
 * Returns undefined when the two flights aren't a same-airport connection,
 * when timing can't be resolved, or when the gap is too long to be a
 * meaningful connection (the next leg of a multi-day trip, not a layover).
 */
export function assessConnection(fromFlight: FlightWithComputed, toFlight: FlightWithComputed, history: FlightLogEntry[]): ConnectionRisk | undefined {
  if (fromFlight.destination !== toFlight.origin) return undefined
  // A leg that flies straight back to fromFlight's own origin is a there-and-back
  // trip through that city (e.g. a same-day round trip), not a through-connection
  // -- a genuine connection continues on to a new destination.
  if (toFlight.destination === fromFlight.origin) return undefined
  const arrivalTime = getBestArrivalTime(fromFlight)
  const arrivalMs = instantMs(arrivalTime)
  const departureMs = instantMs(getBestDepartureTime(toFlight))
  if (arrivalMs === undefined || departureMs === undefined) return undefined

  const connectionMinutes = Math.round((departureMs - arrivalMs) / 60000)
  if (connectionMinutes < 0 || connectionMinutes > MAX_CONNECTION_GAP_MINUTES) return undefined

  // Once the incoming leg has actually landed, its arrival instant is already
  // ground truth — there's no remaining delay uncertainty left to subtract.
  const arrivalIsKnown = arrivalTime?.kind === 'actual'
  const prediction = arrivalIsKnown ? undefined : predictDelay(history, fromFlight)
  const delayBuffer = prediction?.hasSignal ? Math.max(0, prediction.expectedDelayMinutes) : 0
  const riskAdjustedMinutes = connectionMinutes - delayBuffer

  const level: ConnectionRiskLevel = riskAdjustedMinutes < TIGHT_MINUTES ? 'high' : riskAdjustedMinutes < COMFORTABLE_MINUTES ? 'medium' : 'low'

  const explanation = delayBuffer > 0
    ? `${connectionMinutes}m scheduled at ${fromFlight.destination}. ${fromFlight.flightNumber} has historically departed ${formatDelayLabel(prediction?.expectedDelayMinutes ?? 0)} on this route, leaving as little as ${Math.max(0, riskAdjustedMinutes)}m.`
    : `${connectionMinutes}m scheduled at ${fromFlight.destination}.`

  return { fromFlight, toFlight, airport: fromFlight.destination, connectionMinutes, riskAdjustedMinutes, level, explanation }
}

/** Assesses every consecutive same-airport connection in a trip's ordered flight list. */
export function tripConnectionRisks(flights: FlightWithComputed[], history: FlightLogEntry[]): ConnectionRisk[] {
  const risks: ConnectionRisk[] = []
  for (let index = 0; index < flights.length - 1; index += 1) {
    const risk = assessConnection(flights[index], flights[index + 1], history)
    if (risk) risks.push(risk)
  }
  return risks
}
