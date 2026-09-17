import { ilikePattern } from '../ilike'
import type { PaletteItem, PaletteScope } from '../types'
import type { AdminSupabase, SearchSource } from './types'

/** A source's own row shape is whatever columns it selects — kept loose here since ~10 different tables share this factory. */
export type SourceRow = Record<string, unknown>

export interface SimpleSourceConfig {
  table: string
  /** Columns OR-ilike'd against the query text. */
  columns: string[]
  group: string
  scope?: PaletteScope
  /**
   * Columns `toItem` reads beyond `columns` and the always-included `id`/
   * `created_at` (an amount, currency, or date shown in the subtitle but not
   * itself searched) — keeps the query to only what's actually used instead
   * of `select('*')` over tables that can carry 10-20+ reconciliation columns.
   */
  extraSelectColumns?: string[]
  /**
   * When the query text (trimmed, lowercased) exactly equals one of these,
   * skip the text filter and return this source's most recent rows instead —
   * this is what makes typing "viator" surface recent Viator records even
   * though the literal word "viator" doesn't appear in any of that table's
   * columns.
   */
  nameKeywords?: string[]
  limit?: number
  toItem: (row: SourceRow) => PaletteItem
}

const DEFAULT_LIMIT = 5

/** A source that OR-ilikes a fixed set of columns on one table — the shape most finance sources fit. */
export function simpleSource(cfg: SimpleSourceConfig): SearchSource {
  const selectColumns = [...new Set(['id', 'created_at', ...cfg.columns, ...(cfg.extraSelectColumns ?? [])])].join(',')

  return {
    group: cfg.group,
    scope: cfg.scope,
    async search(supabase: AdminSupabase, query: string): Promise<PaletteItem[]> {
      const q = query.trim().toLowerCase()
      const isNameMatch = cfg.nameKeywords?.includes(q) ?? false

      let builder = supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cfg.table is a runtime string shared by ~13 different table configs, not a literal Supabase can check.
        .from(cfg.table as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- selectColumns is built at runtime per-source, so it can't be checked against any one table's literal column-name union.
        .select(selectColumns as any)
        .order('created_at', { ascending: false })
        .limit(cfg.limit ?? DEFAULT_LIMIT)

      if (!isNameMatch) {
        const pattern = ilikePattern(q)
        // A query that's only special characters (",," "((") escapes down to
        // nothing — ilikePattern returns null rather than the always-matching
        // "%%", and that means no column here can match it, not "match everything".
        if (pattern === null) return []
        builder = builder.or(cfg.columns.map(c => `${c}.ilike.${pattern}`).join(','))
      }

      const { data, error } = await builder
      if (error || !data) return []
      // Supabase can't fully type-check a runtime-built select-column string against any one
      // of the ~13 tables this factory serves, so it falls back to a Row | GenericStringError
      // union — real column names were verified against src/lib/supabase/types.ts by hand.
      return (data as unknown as SourceRow[]).map(cfg.toItem)
    },
  }
}
