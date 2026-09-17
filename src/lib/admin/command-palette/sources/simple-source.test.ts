import { describe, it, expect } from 'vitest'
import { simpleSource } from './simple-source'
import { fakeSupabase } from './test-helpers'
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake builder isn't a real AdminSupabase; casting is the point of the fake.
const asSupabase = (s: unknown) => s as any

const viatorSource = simpleSource({
  table: 'viator_payment_lines',
  columns: ['viator_reference', 'vendor_reference', 'tour_grade_title'],
  group: 'Finance',
  scope: 'finance',
  nameKeywords: ['viator'],
  toItem: row => ({
    id: `viator:${row.id}`,
    kind: 'record',
    group: 'Finance',
    title: String(row.viator_reference),
    subtitle: String(row.tour_grade_title),
    href: '/admin/finance?tab=viator',
  }),
})

const rows = [
  { id: '1', viator_reference: 'VR-100', vendor_reference: 'ABC', tour_grade_title: 'Canal Cruise', created_at: '2026-01-01' },
  { id: '2', viator_reference: 'VR-200', vendor_reference: 'XYZ', tour_grade_title: 'Sunset Tour', created_at: '2026-03-01' },
]

describe('simpleSource', () => {
  it('filters rows by the query text across the configured columns', async () => {
    const supabase = fakeSupabase({ viator_payment_lines: rows })
    const results = await viatorSource.search(asSupabase(supabase), 'VR-100')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('VR-100')
  })
  it('returns nothing when the query matches no column', async () => {
    const supabase = fakeSupabase({ viator_payment_lines: rows })
    const results = await viatorSource.search(asSupabase(supabase), 'zzzznotreal')
    expect(results).toHaveLength(0)
  })
  it('when the query is a name keyword, skips the text filter and returns the most recent rows instead', async () => {
    const supabase = fakeSupabase({ viator_payment_lines: rows })
    const results = await viatorSource.search(asSupabase(supabase), 'viator')
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('VR-200') // newest created_at first
  })
  it('name-keyword match is case- and whitespace-insensitive', async () => {
    const supabase = fakeSupabase({ viator_payment_lines: rows })
    const results = await viatorSource.search(asSupabase(supabase), '  Viator  ')
    expect(results).toHaveLength(2)
  })
  it('respects the configured limit', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: String(i), viator_reference: `VR-${i}`, created_at: String(i) }))
    const capped = simpleSource({
      table: 'viator_payment_lines', columns: ['viator_reference'], group: 'Finance', limit: 3, nameKeywords: ['viator'],
      toItem: row => ({ id: String(row.id), kind: 'record', group: 'Finance', title: String(row.viator_reference), href: '/x' }),
    })
    const results = await capped.search(asSupabase(fakeSupabase({ viator_payment_lines: many })), 'viator')
    expect(results).toHaveLength(3)
  })
  it('returns an empty array (not a throw) when the query errors', async () => {
    const supabase = fakeSupabase({}, { viator_payment_lines: { error: 'boom' } })
    const results = await viatorSource.search(asSupabase(supabase), 'anything')
    expect(results).toEqual([])
  })
  it('returns nothing (not every row) for a query that is only special characters', async () => {
    // ",," / "((" escape down to an empty pattern — ilikePattern returns null for exactly
    // this reason, so simpleSource must treat that as "no match", never as "%%" (match everything).
    const supabase = fakeSupabase({ viator_payment_lines: rows })
    expect(await viatorSource.search(asSupabase(supabase), ',,')).toEqual([])
    expect(await viatorSource.search(asSupabase(supabase), '((')).toEqual([])
    expect(await viatorSource.search(asSupabase(supabase), '%%')).toEqual([])
  })
  it('selects only the configured + extra columns, plus id/created_at — not *', async () => {
    const supabase = fakeSupabase({ viator_payment_lines: rows })
    const withExtra = simpleSource({
      table: 'viator_payment_lines',
      columns: ['viator_reference'],
      extraSelectColumns: ['gross_currency'],
      group: 'Finance',
      toItem: row => ({ id: String(row.id), kind: 'record', group: 'Finance', title: String(row.viator_reference), href: '/x' }),
    })
    await withExtra.search(asSupabase(supabase), 'VR-100')
    expect(supabase.selectCalls).toHaveLength(1)
    const selected = supabase.selectCalls[0].split(',')
    expect(selected).toEqual(expect.arrayContaining(['id', 'created_at', 'viator_reference', 'gross_currency']))
    expect(selected).not.toContain('*')
  })
})
