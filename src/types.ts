export type FlightPurpose = 'personal' | 'work' | 'school' | 'other'
export type FlightSource = 'manual' | 'live-import' | 'mock-live' | 'aerodatabox'
export type LookupDateRole = 'Departure' | 'Arrival'
export type TripType = 'personal' | 'work' | 'school' | 'other'
export type LiveStatus =
  | 'scheduled'
  | 'active'
  | 'landed'
  | 'cancelled'
  | 'diverted'
  | 'unknown'

export interface FlightLiveAirline {
  name?: string
  iata?: string
  icao?: string
}

export interface FlightLiveAirport {
  iata?: string
  icao?: string
  name?: string
  city?: string
  country?: string
  countryCode?: string
  lat?: number
  lon?: number
  timezone?: string
  timeZone?: string
}

export interface FlightLiveTimes {
  scheduledDeparture?: string
  estimatedDeparture?: string
  actualDeparture?: string
  scheduledArrival?: string
  estimatedArrival?: string
  actualArrival?: string
  scheduledDepartureLocal?: string
  estimatedDepartureLocal?: string
  actualDepartureLocal?: string
  scheduledArrivalLocal?: string
  estimatedArrivalLocal?: string
  actualArrivalLocal?: string
  scheduledDepartureUtc?: string
  estimatedDepartureUtc?: string
  actualDepartureUtc?: string
  scheduledArrivalUtc?: string
  estimatedArrivalUtc?: string
  actualArrivalUtc?: string
}

export interface FlightLiveTerminalGate {
  departureTerminal?: string
  departureGate?: string
  arrivalTerminal?: string
  arrivalGate?: string
  baggageClaim?: string
}

export interface FlightLiveAircraft {
  type?: string
  registration?: string
}

export interface FlightLiveStatus {
  status: LiveStatus
  flightNumber?: string
  airline?: FlightLiveAirline
  origin?: FlightLiveAirport
  destination?: FlightLiveAirport
  times?: FlightLiveTimes
  terminalGate?: FlightLiveTerminalGate
  aircraft?: FlightLiveAircraft
  provider?: string
  rawProviderStatus?: string
  providerFlightId?: string
  providerUpdatedAt?: string
  providerFetchedAt?: string
  warnings?: string[]
  originTimeZone?: string
  destinationTimeZone?: string

  airlineName?: string
  airlineIata?: string
  airlineIcao?: string
  departureAirport?: FlightLiveAirport
  arrivalAirport?: FlightLiveAirport
  scheduledDeparture?: string
  estimatedDeparture?: string
  actualDeparture?: string
  scheduledArrival?: string
  estimatedArrival?: string
  actualArrival?: string
  scheduledDepartureLocal?: string
  estimatedDepartureLocal?: string
  actualDepartureLocal?: string
  scheduledArrivalLocal?: string
  estimatedArrivalLocal?: string
  actualArrivalLocal?: string
  scheduledDepartureUtc?: string
  estimatedDepartureUtc?: string
  actualDepartureUtc?: string
  scheduledArrivalUtc?: string
  estimatedArrivalUtc?: string
  actualArrivalUtc?: string
  departureTerminal?: string
  departureGate?: string
  arrivalTerminal?: string
  arrivalGate?: string
  baggageClaim?: string
  aircraftType?: string
  aircraftRegistration?: string
  warning?: string
}

export interface ProviderAirportSnapshot {
  iata: string
  icao?: string
  name?: string
  city?: string
  country?: string
  countryCode?: string
  countryName?: string
  lat?: number
  lon?: number
  timezone?: string
  timeZone?: string
  source?: string
  updatedAt?: string
}

export interface TripMetadata {
  id: string
  name?: string
  notes?: string
  type: TripType
  isFavorite: boolean
  createdAt: string
  updatedAt: string
}

export interface AppMetadata {
  key: string
  value: string
  updatedAt: string
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
  scheduledDepartureLocal?: string
  estimatedDepartureLocal?: string
  actualDepartureLocal?: string
  scheduledArrivalLocal?: string
  estimatedArrivalLocal?: string
  actualArrivalLocal?: string
  scheduledDepartureUtc?: string
  estimatedDepartureUtc?: string
  actualDepartureUtc?: string
  scheduledArrivalUtc?: string
  estimatedArrivalUtc?: string
  actualArrivalUtc?: string
  originTimeZone?: string
  destinationTimeZone?: string
  aircraftType?: string
  aircraftRegistration?: string
  cabin?: string
  seat?: string
  purpose: FlightPurpose
  notes?: string
  source: FlightSource
  liveStatus?: FlightLiveStatus
  lastFetchedAt?: string
  providerFlightId?: string
  providerFetchedAt?: string
  airlineIata?: string
  airlineIcao?: string
  originAirportSnapshot?: ProviderAirportSnapshot
  destinationAirportSnapshot?: ProviderAirportSnapshot
  providerWarnings?: string[]
  lookupDateRole?: LookupDateRole
  createdAt: string
  updatedAt: string
}

export interface Airport {
  iata: string
  icao?: string
  name: string
  city: string
  country: string
  countryCode?: string
  countryName?: string
  lat?: number
  lon?: number
  timezone?: string
  timeZone?: string
  type?: string
  scheduledService?: boolean
  source?: 'curated' | 'generated' | 'provider'
}

export interface FlightWithComputed extends FlightLogEntry {
  distanceKm: number
  durationMinutes?: number
  originAirport?: Airport
  destinationAirport?: Airport
  hasRouteCoordinates: boolean
}

export interface ImportPreview {
  valid: FlightLogEntry[]
  errors: string[]
}
