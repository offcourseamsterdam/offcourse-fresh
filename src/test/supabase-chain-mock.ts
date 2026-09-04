/**
 * A chainable, awaitable stand-in for the Supabase query builder, for route
 * tests that mock '@/lib/supabase/admin'.
 *
 * Every builder method records itself and returns the builder; awaiting the
 * builder calls your resolver with the recorded query so you can answer per
 * table / operation. Recorded queries are kept for assertions.
 *
 *   const db = createSupabaseChainMock(q => {
 *     if (q.table === 'finance_goals' && has(q, 'insert')) return { data: { id: 'g1' } }
 *     return { data: null }
 *   })
 *   createAdminClient.mockReturnValue(db.client)
 *   ...
 *   expect(opArg(db.queries, 'finance_events', 'insert')).toMatchObject({ event_type: 'goal_created' })
 */

import { vi } from 'vitest'

export interface RecordedOp { method: string; args: unknown[] }
export interface RecordedQuery { table: string; ops: RecordedOp[] }
export interface QueryResult { data?: unknown; error?: { message: string } | null; count?: number | null }
export type QueryResolver = (q: RecordedQuery) => QueryResult | Promise<QueryResult>

const CHAIN_METHODS = [
  'select', 'insert', 'update', 'delete', 'upsert',
  'eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'not', 'or', 'filter', 'match',
  'order', 'limit', 'range', 'maybeSingle', 'single',
] as const

export function createSupabaseChainMock(resolver: QueryResolver) {
  const queries: RecordedQuery[] = []
  const from = vi.fn((table: string) => {
    const q: RecordedQuery = { table, ops: [] }
    queries.push(q)
    const builder: Record<string, unknown> = {}
    for (const m of CHAIN_METHODS) {
      builder[m] = (...args: unknown[]) => {
        q.ops.push({ method: m, args })
        return builder
      }
    }
    builder.then = (onFulfilled?: (v: QueryResult) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => resolver(q))
        .then(r => ({ data: null, error: null, ...r }))
        .then(onFulfilled, onRejected)
    return builder
  })
  return { client: { from } as unknown as import('@supabase/supabase-js').SupabaseClient<import('@/lib/supabase/types').Database>, from, queries }
}

export function has(q: RecordedQuery, method: string): boolean {
  return q.ops.some(o => o.method === method)
}

export function op(q: RecordedQuery, method: string): RecordedOp | undefined {
  return q.ops.find(o => o.method === method)
}

/** All recorded queries on `table` that include `method`. */
export function queriesFor(queries: RecordedQuery[], table: string, method: string): RecordedQuery[] {
  return queries.filter(q => q.table === table && has(q, method))
}

/** First argument of the first `method` op on the first matching query — e.g. the inserted row. */
export function opArg(queries: RecordedQuery[], table: string, method: string, index = 0): unknown {
  const q = queriesFor(queries, table, method)[index]
  return q ? op(q, method)?.args[0] : undefined
}
