import type { ChecklistItem, TripType } from '../types'

const DEFAULT_CHECKLISTS: Record<TripType, string[]> = {
  personal: ['Passport / ID', 'Travel adapter', 'Phone charger', 'Medications', 'Weather-appropriate clothing'],
  work: ['Passport / ID', 'Laptop + charger', 'Business cards', 'Presentation materials', 'Travel adapter'],
  school: ['Passport / ID', 'Student ID', 'Study materials', 'Laptop + charger', 'Travel adapter'],
  other: ['Passport / ID', 'Phone charger', 'Travel adapter'],
}

export function defaultChecklistItems(type: TripType): ChecklistItem[] {
  return DEFAULT_CHECKLISTS[type].map((text) => ({ id: crypto.randomUUID(), text, done: false }))
}

export function toggleChecklistItem(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.map((item) => (item.id === id ? { ...item, done: !item.done } : item))
}

export function addChecklistItem(items: ChecklistItem[], text: string): ChecklistItem[] {
  const trimmed = text.trim()
  if (!trimmed) return items
  return [...items, { id: crypto.randomUUID(), text: trimmed, done: false }]
}

export function removeChecklistItem(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.filter((item) => item.id !== id)
}
