import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { buildNavItems } from './nav-items'

const APP_ADMIN_DIR = path.resolve(__dirname, '../../../app/[locale]/admin')

describe('buildNavItems', () => {
  const items = buildNavItems()

  it('produces at least one item', () => {
    expect(items.length).toBeGreaterThan(0)
  })

  it('has no duplicate ids', () => {
    const ids = items.map(i => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every plain-path href (no query string) points at a real page.tsx on disk — guards against a dead link when a route moves', () => {
    const plainPathItems = items.filter(i => !i.href.includes('?'))
    expect(plainPathItems.length).toBeGreaterThan(0)
    for (const item of plainPathItems) {
      const relative = item.href.replace(/^\/admin\/?/, '')
      const pageFile = path.join(APP_ADMIN_DIR, relative, 'page.tsx')
      expect(existsSync(pageFile), `${item.href} -> ${pageFile}`).toBe(true)
    }
  })

  it('every query-string href (Kasboek tabs) points at the finance page', () => {
    const tabItems = items.filter(i => i.href.startsWith('/admin/finance?tab='))
    expect(tabItems.length).toBeGreaterThan(5)
    expect(existsSync(path.join(APP_ADMIN_DIR, 'finance', 'page.tsx'))).toBe(true)
  })

  it('includes a Kasboek Viator tab entry with "viator" as a keyword', () => {
    const viator = items.find(i => i.href === '/admin/finance?tab=viator')
    expect(viator?.keywords).toContain('viator')
  })

  it('includes Boats with real boat names as keywords (a boat can share a name with a guest)', () => {
    const boats = items.find(i => i.href === '/admin/boats')
    expect(boats?.keywords).toContain('diana')
  })

  it('excludes coming-soon sidebar items — there is nowhere for the palette to send you', () => {
    const customers = items.find(i => i.href === '/admin/customers')
    expect(customers).toBeUndefined()
  })
})
