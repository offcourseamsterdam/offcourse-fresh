import { describe, it, expect } from 'vitest'
import { runSearch } from './run-search'
import type { SearchSource } from './sources/types'
import type { PaletteItem } from './types'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeSupabase = {} as any

function item(id: string): PaletteItem {
  return { id, kind: 'record', group: 'Test', href: '/x', title: id }
}

function okSource(group: string, items: PaletteItem[]): SearchSource {
  return { group, async search() { return items } }
}
function throwingSource(group: string): SearchSource {
  return { group, async search() { throw new Error('boom') } }
}
function slowSource(group: string, delayMs: number, items: PaletteItem[]): SearchSource {
  return { group, async search() { await new Promise(r => setTimeout(r, delayMs)); return items } }
}

describe('runSearch', () => {
  it('returns nothing for a query shorter than the minimum, without calling any source', async () => {
    let called = false
    const source = okSource('A', [item('a')])
    source.search = async () => { called = true; return [item('a')] }
    const result = await runSearch(fakeSupabase, 'x', null, { sources: [source] })
    expect(result.items).toEqual([])
    expect(called).toBe(false)
  })

  it('merges results from every applicable source', async () => {
    const result = await runSearch(fakeSupabase, 'diana', null, {
      sources: [okSource('A', [item('a1')]), okSource('B', [item('b1')])],
    })
    expect(result.items.map(i => i.id).sort()).toEqual(['a1', 'b1'])
    expect(result.failedGroups).toEqual([])
  })

  it('one source throwing does not blank the others (Promise.allSettled, not Promise.all)', async () => {
    const result = await runSearch(fakeSupabase, 'diana', null, {
      sources: [okSource('Good', [item('ok')]), throwingSource('Bad')],
    })
    expect(result.items.map(i => i.id)).toEqual(['ok'])
    expect(result.failedGroups).toEqual(['Bad'])
  })

  it('a source slower than the timeout is treated as failed, others still return in time', async () => {
    const result = await runSearch(fakeSupabase, 'diana', null, {
      sources: [okSource('Fast', [item('fast')]), slowSource('Slow', 50, [item('slow')])],
      timeoutMs: 10,
    })
    expect(result.items.map(i => i.id)).toEqual(['fast'])
    expect(result.failedGroups).toEqual(['Slow'])
  })

  it('filters to only the sources matching a given scope', async () => {
    const result = await runSearch(fakeSupabase, 'diana', 'bookings', {
      sources: [
        { group: 'Bookings', scope: 'bookings', async search() { return [item('b')] } },
        { group: 'Finance', scope: 'finance', async search() { return [item('f')] } },
      ],
    })
    expect(result.items.map(i => i.id)).toEqual(['b'])
  })

  it('an unscoped source (e.g. cruises) only runs for unscoped queries', async () => {
    const cruises: SearchSource = { group: 'Cruises', async search() { return [item('c')] } }
    const scoped = await runSearch(fakeSupabase, 'diana', 'bookings', { sources: [cruises] })
    expect(scoped.items).toEqual([])
    const unscoped = await runSearch(fakeSupabase, 'diana', null, { sources: [cruises] })
    expect(unscoped.items.map(i => i.id)).toEqual(['c'])
  })
})
