import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { todayISO } from '@/lib/finance/cockpit/dates'
import {
  loadPartnerCommissionInputs,
  partnerCommissionObligations,
} from '@/lib/finance/cockpit/derived/partner-commissions'
import { upsertDerivedObligation } from '@/lib/finance/cockpit/derived/sync'
import { derivedConfirmKeysSchema, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/finance/cockpit/obligations/derived/partner-commissions
 * Returns proposed obligations for unpaid quarterly partner affiliate commissions.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const inputs = await loadPartnerCommissionInputs(supabase)
    const proposals = partnerCommissionObligations(inputs, { today: todayISO() })
    return apiOk({ proposals })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/partner-commissions GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not compute partner commission obligations', 500)
  }
}

/**
 * POST /api/admin/finance/cockpit/obligations/derived/partner-commissions {keys: string[]}
 * Confirms one or more proposed partner commissions into finance_obligations rows.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, derivedConfirmKeysSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const inputs = await loadPartnerCommissionInputs(supabase)
    const proposals = partnerCommissionObligations(inputs, { today: todayISO() })
    const proposalsByKey = new Map(proposals.map(p => [p.key, p]))

    const created: Array<{ key: string; id: string }> = []
    const updated: Array<{ key: string; id: string }> = []
    const skipped: Array<{ key: string; reason: string }> = []

    for (const key of parsed.data.keys) {
      const proposal = proposalsByKey.get(key)
      if (!proposal) {
        skipped.push({ key, reason: 'Onbekende of niet meer geldige sleutel' })
        continue
      }

      const r = await upsertDerivedObligation(
        supabase,
        {
          key,
          title: proposal.title,
          kind: 'contract',
          amountCents: proposal.amountCents,
          dueDate: proposal.dueDate,
          notes: `Partnercommissie over ${proposal.bookingCount} boeking(en), automatisch berekend uit kasboek`,
        },
        'user',
      )
      if (r.status === 'created') created.push({ key: r.sourceKey, id: r.id! })
      else if (r.status === 'updated') updated.push({ key: r.sourceKey, id: r.id! })
      else skipped.push({ key: r.sourceKey, reason: r.reason! })
    }

    return apiOk({ created, updated, skipped })
  } catch (err) {
    console.error('[finance/cockpit/obligations/derived/partner-commissions POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not confirm partner commission obligations', 500)
  }
}
