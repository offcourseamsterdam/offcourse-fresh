import { describe, it, expect } from 'vitest'
import { rankItems } from './rank'
import type { PaletteItem } from './types'

const navBoats: PaletteItem = {
  id: 'nav-boats', kind: 'nav', group: 'Go to', title: 'Boats',
  href: '/admin/boats', keywords: ['diana', 'curacao', 'fleet'],
}
const navPlanning: PaletteItem = {
  id: 'nav-planning', kind: 'nav', group: 'Go to', title: 'Planning', href: '/admin/planning',
}
const bookingDiana: PaletteItem = {
  id: 'booking-1', kind: 'record', group: 'Bookings', title: 'Diana de Vries',
  subtitle: 'Private Hidden Gems · 12 Sep', href: '/admin/bookings?booking=1',
}
const bookingWeak: PaletteItem = {
  id: 'booking-2', kind: 'record', group: 'Bookings', title: 'Someone Else',
  subtitle: 'mentions diana in passing', href: '/admin/bookings?booking=2',
}

describe('rankItems', () => {
  it('a strong record match beats a weak nav-keyword match — the Diana case', () => {
    const results = rankItems('diana', [navBoats, bookingDiana])
    expect(results[0].item.id).toBe('booking-1')
  })
  it('an exact one-word nav hit beats a merely substring record match', () => {
    const results = rankItems('planning', [navPlanning, bookingWeak])
    expect(results[0].item.id).toBe('nav-planning')
  })
  it('drops items that do not match at all', () => {
    const results = rankItems('zzzznotreal', [navBoats, bookingDiana])
    expect(results).toHaveLength(0)
  })
  it('caps results per group', () => {
    const manyBookings: PaletteItem[] = Array.from({ length: 8 }, (_, i) => ({
      id: `b${i}`, kind: 'record', group: 'Bookings', title: 'Diana de Vries', href: `/x/${i}`,
    }))
    const results = rankItems('diana', manyBookings, { maxPerGroup: 5 })
    expect(results).toHaveLength(5)
  })
  it('boosts a recent item over an otherwise-equal one', () => {
    const a: PaletteItem = { id: 'a', kind: 'record', group: 'Bookings', title: 'Diana A', href: '/a' }
    const b: PaletteItem = { id: 'b', kind: 'record', group: 'Bookings', title: 'Diana B', href: '/b' }
    const results = rankItems('diana', [a, b], { recentIds: new Set(['b']) })
    expect(results[0].item.id).toBe('b')
  })
  it('returns nothing for items with no query match, even with recents set', () => {
    const results = rankItems('nomatch', [navBoats], { recentIds: new Set(['nav-boats']) })
    expect(results).toHaveLength(0)
  })
})
