import { describe, it, expect } from 'vitest'
import { loadRecents, recordVisit, frecencyScore, topRecents, type KeyValueStorage } from './recents'
import type { PaletteItem } from './types'

function fakeStorage(): KeyValueStorage {
  const store = new Map<string, string>()
  return {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  }
}

const bookingA: PaletteItem = { id: 'a', kind: 'record', group: 'Bookings', title: 'A', href: '/a' }
const bookingB: PaletteItem = { id: 'b', kind: 'record', group: 'Bookings', title: 'B', href: '/b' }

describe('loadRecents / recordVisit', () => {
  it('starts empty', () => {
    expect(loadRecents(fakeStorage())).toEqual([])
  })
  it('records a new visit', () => {
    const s = fakeStorage()
    recordVisit(bookingA, 1000, s)
    const entries = loadRecents(s)
    expect(entries).toHaveLength(1)
    expect(entries[0].item.id).toBe('a')
    expect(entries[0].visits).toEqual([1000])
  })
  it('accumulates repeat visits to the same item newest-first, capped at 10', () => {
    const s = fakeStorage()
    for (let i = 0; i < 12; i++) recordVisit(bookingA, i, s)
    const entries = loadRecents(s)
    expect(entries).toHaveLength(1)
    expect(entries[0].visits).toHaveLength(10)
    expect(entries[0].visits[0]).toBe(11) // newest first
  })
  it('refreshes the item snapshot on repeat visit (title may have changed)', () => {
    const s = fakeStorage()
    recordVisit(bookingA, 1, s)
    recordVisit({ ...bookingA, title: 'Renamed' }, 2, s)
    expect(loadRecents(s)[0].item.title).toBe('Renamed')
  })
  it('never throws when storage is null (private browsing / blocked)', () => {
    expect(() => recordVisit(bookingA, 1, null)).not.toThrow()
    expect(loadRecents(null)).toEqual([])
  })
  it('never throws when storage.getItem returns malformed JSON', () => {
    const s: KeyValueStorage = { getItem: () => '{not json', setItem: () => {} }
    expect(loadRecents(s)).toEqual([])
  })
})

describe('frecencyScore', () => {
  it('scores a very recent single visit at 100', () => {
    const now = 10_000_000
    expect(frecencyScore({ item: bookingA, visits: [now - 1000] }, now)).toBe(100)
  })
  it('scores an old (90+ day) visit at 0', () => {
    const now = 200 * 24 * 3_600_000
    expect(frecencyScore({ item: bookingA, visits: [0] }, now)).toBe(0)
  })
  it('averages across multiple visits at different ages', () => {
    const now = 10_000_000
    const recent = now - 1000 // 100 pts
    const old = now - 40 * 24 * 3_600_000 // > 30d, <= 90d -> 10 pts
    expect(frecencyScore({ item: bookingA, visits: [recent, old] }, now)).toBe(55)
  })
  it('scores an item with no recorded visits at 0', () => {
    expect(frecencyScore({ item: bookingA, visits: [] })).toBe(0)
  })
})

describe('topRecents', () => {
  it('orders by frecency score, best first, capped at limit', () => {
    const s = fakeStorage()
    const now = 10_000_000
    recordVisit(bookingA, now - 40 * 24 * 3_600_000, s) // old, low score
    recordVisit(bookingB, now - 1000, s) // recent, high score
    const top = topRecents(1, now, s)
    expect(top).toHaveLength(1)
    expect(top[0].item.id).toBe('b')
  })
})
