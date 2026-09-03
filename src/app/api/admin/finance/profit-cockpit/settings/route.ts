import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { withRoute } from '@/lib/api/with-route'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

export const POST = withRoute(async (request: NextRequest) => {
  const denied = await requireAdmin()
  if (denied) return denied

  const body = await request.json()
  const supabase = createAdminClient()

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (typeof body.maintenancePct === 'number') patch.maintenance_pct = body.maintenancePct
  if (typeof body.marketingPct === 'number') patch.marketing_pct = body.marketingPct
  if (typeof body.defaultMonthlyRevenueTargetCents === 'number') patch.default_monthly_revenue_target_cents = body.defaultMonthlyRevenueTargetCents
  if (typeof body.winterBufferTargetCents === 'number') patch.winter_buffer_target_cents = body.winterBufferTargetCents
  if (typeof body.targetSkipperRatioPct === 'number') patch.target_skipper_ratio_pct = body.targetSkipperRatioPct
  if (typeof body.targetCateringMarginPct === 'number') patch.target_catering_margin_pct = body.targetCateringMarginPct
  if (typeof body.defaultSkipperHourlyRateCents === 'number') patch.default_skipper_hourly_rate_cents = body.defaultSkipperHourlyRateCents
  if (typeof body.revolutManualBalanceCents === 'number') patch.revolut_manual_balance_cents = body.revolutManualBalanceCents

  const { data, error } = await supabase
    .from('finance_budget_settings')
    .upsert({ id: 'default', ...patch })
    .select()
    .single()

  if (error) return apiError(error.message)
  return apiOk({ settings: data })
})
