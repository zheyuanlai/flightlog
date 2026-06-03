import Dexie, { type Table } from 'dexie'
import type { FlightLogEntry } from './types'

class FlightLogDatabase extends Dexie {
  flights!: Table<FlightLogEntry, string>

  constructor() {
    super('flightlog')
    this.version(1).stores({
      flights: 'id, date, flightNumber, airline, origin, destination, updatedAt',
    })
  }
}

export const db = new FlightLogDatabase()

export async function getFlights(): Promise<FlightLogEntry[]> {
  return db.flights.orderBy('date').reverse().toArray()
}

export async function saveFlight(
  flight: Omit<FlightLogEntry, 'id' | 'createdAt' | 'updatedAt'> &
    Partial<Pick<FlightLogEntry, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<string> {
  const now = new Date().toISOString()
  const id = flight.id ?? crypto.randomUUID()
  await db.flights.put({
    ...flight,
    id,
    createdAt: flight.createdAt ?? now,
    updatedAt: now,
  })
  return id
}

export async function deleteFlight(id: string): Promise<void> {
  await db.flights.delete(id)
}

export async function bulkSaveFlights(flights: FlightLogEntry[]): Promise<void> {
  await db.flights.bulkPut(flights)
}
