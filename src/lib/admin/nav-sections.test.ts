import { describe, it, expect } from 'vitest'
import { navSections, SECTION_BY_LABEL, isNavItemActive, stripLocale, type NavItem } from './nav-sections'

const item = (href: string, extra: Partial<NavItem> = {}): NavItem => ({ href, label: href, icon: 'x', ...extra })

describe('stripLocale', () => {
  it('removes the leading locale segment', () => {
    expect(stripLocale('/en/admin/bookings', 'en')).toBe('/admin/bookings')
  })
  it('returns "/" for the bare locale root', () => {
    expect(stripLocale('/nl', 'nl')).toBe('/')
  })
  it('does not strip a segment that merely starts with the locale', () => {
    expect(stripLocale('/english/admin', 'en')).toBe('/english/admin')
  })
  it('leaves an unprefixed path alone', () => {
    expect(stripLocale('/admin/finance', 'en')).toBe('/admin/finance')
  })
})

describe('isNavItemActive', () => {
  it('matches the exact page', () => {
    expect(isNavItemActive(item('/admin/bookings'), '/admin/bookings')).toBe(true)
  })
  it('matches sub-pages (detail routes)', () => {
    expect(isNavItemActive(item('/admin/cruises'), '/admin/cruises/42')).toBe(true)
  })
  it('does not match a sibling route that shares a prefix', () => {
    expect(isNavItemActive(item('/admin/partners'), '/admin/partners-archive')).toBe(false)
  })
  it('only matches the portal-root dashboard exactly — not every admin page', () => {
    const dashboard = item('/admin')
    expect(isNavItemActive(dashboard, '/admin')).toBe(true)
    expect(isNavItemActive(dashboard, '/admin/bookings')).toBe(false)
  })
  it('uses activePrefix so every finance sub-page lights up Finance', () => {
    const finance = item('/admin/finance/overview', { activePrefix: '/admin/finance' })
    expect(isNavItemActive(finance, '/admin/finance/overview')).toBe(true)
    expect(isNavItemActive(finance, '/admin/finance/inbox')).toBe(true)
    expect(isNavItemActive(finance, '/admin/finance')).toBe(true)
    expect(isNavItemActive(finance, '/admin/statistics')).toBe(false)
  })
})

describe('navSections', () => {
  const allItems = navSections.flatMap(s => s.items)

  it('marks at most one nav item active for any real admin route', () => {
    for (const path of ['/admin', '/admin/bookings', '/admin/finance/scenarios', '/admin/inbox', '/admin/cruises/7']) {
      const active = allItems.filter(i => !i.comingSoon && isNavItemActive(i, path))
      expect(active.length, path).toBe(1)
    }
  })
  it('gives every section a color, an ink and a lookup entry', () => {
    for (const s of navSections) {
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(s.ink).toMatch(/^#[0-9a-f]{6}$/i)
      expect(SECTION_BY_LABEL[s.label]).toBe(s)
    }
  })
  it('has no duplicate hrefs', () => {
    const hrefs = allItems.map(i => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})
