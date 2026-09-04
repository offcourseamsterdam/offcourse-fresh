import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { loadCockpit } from '@/lib/finance/cockpit/load-cockpit'
import { horizonSchema, parseQuery } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/finance/cockpit/overview?horizon=30d|3m|12m
 *
 * The computed cash cockpit (buckets, financial space, status, "why" lines).
 * `horizon` overrides the stored planning horizon for this response only.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const horizon = parseQuery(request, 'horizon', horizonSchema.optional(), undefined)
  if (!horizon.ok) return horizon.response

  try {
    return apiOk(await loadCockpit({ horizon: horizon.data }))
  } catch (err) {
    console.error('[finance/cockpit/overview]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load cockpit', 500)
  }
}
