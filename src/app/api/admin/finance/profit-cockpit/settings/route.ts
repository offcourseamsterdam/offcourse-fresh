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
  if (typeof body.profitFirstProfitPct === 'number') patch.profit_first_profit_pct = body.profitFirstProfitPct
  if (typeof body.ownerSalaryMonthlyCents === 'number') patch.owner_salary_monthly_cents = body.ownerSalaryMonthlyCents
  if (typeof body.ownerSalaryPct === 'number') patch.owner_salary_pct = body.ownerSalaryPct
  if (typeof body.boatCount === 'number') patch.boat_count = body.boatCount
  if (typeof body.berthFeePerBoatYearlyCents === 'number') patch.berth_fee_per_boat_yearly_cents = body.berthFeePerBoatYearlyCents
  if (typeof body.otherFixedCostsMonthlyCents === 'number') patch.other_fixed_costs_monthly_cents = body.otherFixedCostsMonthlyCents
  if (typeof body.zettleCogsPct === 'number') patch.zettle_cogs_pct = body.zettleCogsPct
  if (typeof body.loanName === 'string') patch.loan_name = body.loanName
  if (typeof body.loanPrincipalTotalCents === 'number') patch.loan_principal_total_cents = body.loanPrincipalTotalCents
  if (typeof body.loanMonthlyPrincipalCents === 'number') patch.loan_monthly_principal_cents = body.loanMonthlyPrincipalCents
  if (typeof body.loanMonthlyInterestCents === 'number') patch.loan_monthly_interest_cents = body.loanMonthlyInterestCents
  if (typeof body.loanInterestRatePct === 'number') patch.loan_interest_rate_pct = body.loanInterestRatePct
  if (typeof body.loanTargetPayoffYear === 'number') patch.loan_target_payoff_year = body.loanTargetPayoffYear
  if (typeof body.defaultMonthlyRevenueTargetCents === 'number') patch.default_monthly_revenue_target_cents = body.defaultMonthlyRevenueTargetCents
  if (typeof body.winterBufferTargetCents === 'number') patch.winter_buffer_target_cents = body.winterBufferTargetCents
  if (typeof body.targetSkipperRatioPct === 'number') patch.target_skipper_ratio_pct = body.targetSkipperRatioPct
  if (typeof body.targetCateringMarginPct === 'number') patch.target_catering_margin_pct = body.targetCateringMarginPct
  if (typeof body.defaultSkipperHourlyRateCents === 'number') patch.default_skipper_hourly_rate_cents = body.defaultSkipperHourlyRateCents
  if (typeof body.revolutManualBalanceCents === 'number') patch.revolut_manual_balance_cents = body.revolutManualBalanceCents
  if (Array.isArray(body.loans)) patch.loans = body.loans
  if (Array.isArray(body.alfCategories)) patch.alf_categories = body.alfCategories
  if (typeof body.marketingScenarioSpendCents === 'number') patch.marketing_scenario_spend_cents = body.marketingScenarioSpendCents
  if (Array.isArray(body.fixedCostItems)) patch.fixed_cost_items = body.fixedCostItems

  const { data, error } = await supabase
    .from('finance_budget_settings')
    .upsert({ id: 'default', ...patch })
    .select()
    .single()

  if (error) return apiError(error.message)
  return apiOk({ settings: data })
})
