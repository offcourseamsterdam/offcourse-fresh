import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/scheduling/upsell-proposals — the "upsell review
 * environment" (Beer, 2026-08-24: "in the payroll tab we have an upsell
 * review environment where we can check that upsell and assign it
 * properly"). Every still-pending upsell_bonus proposal drafted by
 * upsell-bonus-drafter.ts from a captain's Slack DM, oldest first (first
 * reported, first reviewed) — not scoped to the Payroll tab's month filter,
 * since an unconfirmed item doesn't have a settled date yet.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('agent_proposals')
      .select('id, payload, reasoning, created_at')
      .eq('kind', 'upsell_bonus')
      .eq('status', 'shadow')
      .order('created_at', { ascending: true })
    if (error) return apiError(error.message)

    return apiOk({ proposals: data ?? [] })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
