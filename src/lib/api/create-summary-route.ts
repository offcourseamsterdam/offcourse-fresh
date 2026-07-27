import { NextRequest, NextResponse } from 'next/server'
import { apiOk, apiError } from './response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/supabase/types'

type TableName = keyof Database['public']['Tables']

/**
 * Config for one `GET /api/admin/finance/<source>/summary` route.
 *
 * `Row` is the raw shape Supabase returns for `columns` (snake_case, matching
 * the DB schema). `Mapped` is the camelCase shape the existing
 * `aggregate*Summary` pure function in `src/lib/finance/*.ts` expects.
 */
export interface SummaryRouteConfig<Row, Mapped, Summary> {
  /** Supabase table to query. */
  table: TableName
  /** The exact `.select()` column string used today — copy it verbatim. */
  columns: string
  /** Per-row snake_case -> camelCase transform (can also inject constants, e.g. a hardcoded VAT-rate default). */
  map: (row: Row) => Mapped
  /** The existing `aggregate*Summary` pure function this source already has tests for. */
  aggregate: (rows: Mapped[]) => Summary
}

/**
 * Factory for the admin finance "summary" routes.
 *
 * These `.../summary/route.ts` handlers were ~99% identical boilerplate:
 * check admin auth, fetch rows from one table, rename snake_case columns to
 * camelCase, hand them to a source-specific `aggregate*Summary` function, and
 * wrap the result/errors in the standard `{ok,data}` response shape. This
 * factory is that shared skeleton — each route becomes a single call with
 * its own table/columns/map/aggregate, instead of a copy-pasted handler.
 *
 * The HTTP contract (status codes, `{ok,data}` / `{ok:false,error}` shapes,
 * auth-denied passthrough, thrown-exception recovery) is unchanged from the
 * original per-route try/catch — this is a pure deduplication, not a
 * behavior change.
 *
 * Sources that don't fit this shape (extra filters, or a per-row shape that's
 * more than a rename — currently `withlocals` and `zettle`) keep their own
 * bespoke route file and are NOT migrated to this factory.
 */
export function createSummaryRoute<Row, Mapped, Summary>(
  config: SummaryRouteConfig<Row, Mapped, Summary>
): { GET: (req: NextRequest) => Promise<NextResponse> } {
  return {
    GET: async (_req: NextRequest): Promise<NextResponse> => {
      const denied = await requireAdmin()
      if (denied) return denied
      try {
        const supabase = createAdminClient()

        const { data, error } = await supabase.from(config.table).select(config.columns)

        if (error) return apiError(error.message)

        const rows = ((data ?? []) as unknown as Row[]).map(config.map)

        return apiOk(config.aggregate(rows))
      } catch (err) {
        return apiError(err instanceof Error ? err.message : 'Unknown error')
      }
    },
  }
}
