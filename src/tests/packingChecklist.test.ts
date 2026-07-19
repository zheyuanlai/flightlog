import { describe, expect, it } from 'vitest'
import { addChecklistItem, defaultChecklistItems, removeChecklistItem, toggleChecklistItem } from '../utils/packingChecklist'

describe('defaultChecklistItems', () => {
  it('returns a non-empty, all-undone checklist per trip type', () => {
    for (const type of ['personal', 'work', 'school', 'other'] as const) {
      const items = defaultChecklistItems(type)
      expect(items.length).toBeGreaterThan(0)
      expect(items.every((item) => item.done === false)).toBe(true)
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
    }
  })

  it('gives work and personal trips different default items', () => {
    const work = defaultChecklistItems('work').map((item) => item.text)
    const personal = defaultChecklistItems('personal').map((item) => item.text)
    expect(work).not.toEqual(personal)
  })
})

describe('toggleChecklistItem', () => {
  it('flips only the matching item\'s done state', () => {
    const items = [{ id: 'a', text: 'Passport', done: false }, { id: 'b', text: 'Charger', done: false }]
    const toggled = toggleChecklistItem(items, 'a')
    expect(toggled.find((item) => item.id === 'a')?.done).toBe(true)
    expect(toggled.find((item) => item.id === 'b')?.done).toBe(false)
    expect(toggleChecklistItem(toggled, 'a').find((item) => item.id === 'a')?.done).toBe(false)
  })
})

describe('addChecklistItem', () => {
  it('appends a trimmed item', () => {
    const items = addChecklistItem([], '  Sunglasses  ')
    expect(items).toEqual([{ id: expect.any(String), text: 'Sunglasses', done: false }])
  })

  it('ignores blank input', () => {
    expect(addChecklistItem([], '   ')).toEqual([])
  })
})

describe('removeChecklistItem', () => {
  it('removes only the matching item', () => {
    const items = [{ id: 'a', text: 'Passport', done: false }, { id: 'b', text: 'Charger', done: false }]
    expect(removeChecklistItem(items, 'a')).toEqual([{ id: 'b', text: 'Charger', done: false }])
  })
})
