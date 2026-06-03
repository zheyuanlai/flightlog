export type FlightPurpose = 'personal' | 'work' | 'school' | 'other'
export type FlightSource = 'manual' | 'live-import'
export type LiveStatus =
  | 'scheduled'
  | 'active'
  | 'landed'
  | 'cancelled'
  | 'diverted'
  | 'unknown'

export interface FlightLiveStatus {
  status: LiveStatus
  scheduledDeparture?: string
  estimatedDeparture?: string
  actualDeparture?: string
  scheduledArrival?: string
  estimatedArrival?: string
  actualArrival?: string
  departureTerminal?: string
  departureGate?: string
  arrivalTerminal?: string
  arrivalGate?: string
  baggageClaim?: string
  aircraftType?: string
  aircraftRegistration?: string
  provider?: string
  rawProviderStatus?: string
}

export interface FlightLogEntry {
  id: string
  date: string
  flightNumber: string
  airline: string
  origin: string
  destination: string
  scheduledDeparture?: string
  scheduledArrival?: string
  actualDeparture?: string
  actualArrival?: string
  aircraftType?: string
  aircraftRegistration?: string
  cabin?: string
  seat?: string
  purpose: FlightPurpose
  notes?: string
  source: FlightSource
  liveStatus?: FlightLiveStatus
  lastFetchedAt?: string
  createdAt: string
  updatedAt: string
}

export interface Airport {
  iata: string
  icao: string
  name: string
  city: string
  country: string
  lat: number
  lon: number
  timezone: string
}

export interface FlightWithComputed extends FlightLogEntry {
  distanceKm: number
  durationMinutes?: number
}

export interface ImportPreview {
  valid: FlightLogEntry[]
  errors: string[]
}
