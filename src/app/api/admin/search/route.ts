import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { runSearch } from '@/lib/admin/command-palette/run-search'
import { parseQuery } from '@/lib/admin/command-palette/parse-query'
import type { PaletteScope } from '@/lib/admin/command-palette/types'

export const dynamic = 'force-dynamic'

const VALID_SCOPES: PaletteScope[] = ['bookings', 'chats', 'finance', 'partners']

function isValidScope(value: string | null): value is PaletteScope {
  return value !== null && (VALID_SCOPES as string[]).includes(value)
}

/**
 * GET /api/admin/search?q=<text>&types=<bookings|chats|finance|partners>
 *
 * Backs the Cmd+K command palette's server-side results (nav/tab entries
 * are matched client-side, instantly, and never hit this route — see
 * src/lib/admin/command-palette/nav-items.ts). Fans out to every source
 * adapter in src/lib/admin/command-palette/sources/ in parallel; see
 * run-search.ts for why a slow or broken source can't blank the response.
 *
 * `q` may itself carry a "b "/"c "/"f "/"p " scope prefix (typed straight
 * into the palette) — `types` is the same thing as an explicit param, for
 * any other caller of this route. An explicit `types` wins if both are set.
 */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const p = new URL(req.url).searchParams
    const parsed = parseQuery(p.get('q') ?? '')
    const typesParam = p.get('types')
    const scope = isValidScope(typesParam) ? typesParam : parsed.scope

    const supabase = createAdminClient()
    const { items, failedGroups } = await runSearch(supabase, parsed.text, scope)
    return apiOk({ items, failedGroups })
  } catch (err) {
    return apiError((err as Error).message, 500)
  }
}
