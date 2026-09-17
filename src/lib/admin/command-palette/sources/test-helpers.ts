/**
 * A minimal fake of the slice of the Supabase query builder these source
 * adapters use (`.from().select().order().limit().eq().in().or()`, then
 * awaited) — enough to unit-test each adapter's query-building and
 * row-mapping without a real database. NOT a general Supabase mock; keep it
 * in this folder.
 */
export type FakeRow = Record<string, unknown>

interface FakeTableOptions {
  /** When set, `.from(table)` resolves to `{ data: null, error: { message } }` instead of rows. */
  error?: string
}

type OrClause =
  | { kind: 'ilike'; col: string; pattern: string }
  | { kind: 'in'; col: string; values: string[] }

/** Splits "a.ilike.%x%,b.in.(1,2)" on top-level commas only — a naive split would also
 *  break the commas inside `in.(...)`. */
function splitTopLevel(expr: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of expr) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) parts.push(current)
  return parts
}

function parseOrClause(raw: string): OrClause | null {
  if (raw.includes('.ilike.')) {
    const [col, patternWithWildcards] = raw.split('.ilike.')
    return { kind: 'ilike', col, pattern: patternWithWildcards.slice(1, -1).toLowerCase() }
  }
  if (raw.includes('.in.')) {
    const [col, group] = raw.split('.in.')
    const values = group.slice(1, -1).split(',').map(v => v.trim())
    return { kind: 'in', col, values }
  }
  return null
}

export function fakeSupabase(
  tables: Record<string, FakeRow[]>,
  errors: Record<string, FakeTableOptions> = {},
) {
  /** Every `.select(...)` argument passed, across every `.from()` call, in order — lets a
   *  test assert exactly what columns a source asked for instead of always fetching everything. */
  const selectCalls: string[] = []

  return {
    selectCalls,
    from(table: string) {
      const rows = tables[table] ?? []
      const forcedError = errors[table]?.error
      let orClauses: OrClause[] = []
      const eqFilters: Array<[string, unknown]> = []
      const inFilters: Array<[string, unknown[]]> = []
      let orderCol: string | null = null
      let orderAsc = true
      let limitN = Infinity

      const builder = {
        select(cols?: string) { selectCalls.push(cols ?? '*'); return builder },
        order(col: string, opts?: { ascending?: boolean }) {
          orderCol = col
          orderAsc = opts?.ascending ?? true
          return builder
        },
        limit(n: number) { limitN = n; return builder },
        eq(col: string, value: unknown) { eqFilters.push([col, value]); return builder },
        in(col: string, values: unknown[]) { inFilters.push([col, values]); return builder },
        or(expr: string) {
          orClauses = splitTopLevel(expr).map(parseOrClause).filter((c): c is OrClause => c !== null)
          return builder
        },
        then(resolve: (v: { data: FakeRow[] | null; error: { message: string } | null }) => unknown) {
          if (forcedError) {
            return Promise.resolve(resolve({ data: null, error: { message: forcedError } })).then(() => undefined)
          }
          let result = [...rows]
          for (const [col, value] of eqFilters) {
            result = result.filter(row => row[col] === value)
          }
          for (const [col, values] of inFilters) {
            result = result.filter(row => values.includes(row[col]))
          }
          if (orClauses.length > 0) {
            result = result.filter(row =>
              orClauses.some(clause => {
                if (clause.kind === 'ilike') {
                  return String(row[clause.col] ?? '').toLowerCase().includes(clause.pattern)
                }
                return clause.values.includes(String(row[clause.col] ?? ''))
              })
            )
          }
          if (orderCol) {
            result.sort((a, b) => {
              const av = String(a[orderCol as string] ?? '')
              const bv = String(b[orderCol as string] ?? '')
              const cmp = av < bv ? -1 : av > bv ? 1 : 0
              return orderAsc ? cmp : -cmp
            })
          }
          result = result.slice(0, limitN)
          return Promise.resolve(resolve({ data: result, error: null })).then(() => undefined)
        },
      }
      return builder
    },
  }
}
