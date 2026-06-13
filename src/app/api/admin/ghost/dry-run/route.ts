import { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { AUTONOMY_CEILING, levelRank } from '@/lib/ghost/agents'
import { dryRunBookingProposal } from '@/lib/ghost/dry-run'

/**
 * POST /api/admin/ghost/dry-run  { proposalId }
 * Re-run the FareHarbor validate check for a booking_proposal (verdicts go
 * stale — capacity can change). Read-only against FareHarbor: validates,
 * never creates, never emails. Returns the fresh verdict.
 *
 * This is the dry-run chokepoint. It deliberately only ever calls
 * dryRunBookingProposal (validate). There is no create path here — and the
 * autonomy ceiling for booking_proposal is pinned to 'dry_run', so a real
 * booking can never be reached through the Ghost.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { proposalId } = (await req.json().catch(() => ({}))) as { proposalId?: string }
    if (!proposalId) return apiError('proposalId is required', 400)

    // Defence in depth: the only kind this endpoint serves is booking_proposal,
    // whose ceiling is pinned to 'dry_run' — so nothing reachable here can ever
    // execute a real booking. (The invariant itself is covered by agent-runtime.test.ts.)
    if (levelRank(AUTONOMY_CEILING.booking_proposal) > levelRank('dry_run')) {
      return apiError('Safety ceiling violated', 500)
    }

    const verdict = await dryRunBookingProposal(proposalId)
    if (!verdict) return apiError('Not a booking proposal, or it no longer exists', 404)
    return apiOk({ verdict })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Dry-run failed')
  }
}
