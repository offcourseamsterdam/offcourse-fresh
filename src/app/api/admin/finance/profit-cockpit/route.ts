import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeMonthlyCockpit, DEFAULT_BUDGET_SETTINGS, type CockpitBudgetSettings } from '@/lib/finance/profit-cockpit-calculator'
import { revolut } from '@/lib/revolut/client'
import { getStripe } from '@/lib/stripe/server'

export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const { searchParams } = request.nextUrl
    const currentYear = new Date().getFullYear()
    const yearParam = searchParams.get('year')
    const year = yearParam ? parseInt(yearParam, 10) : currentYear

    const supabase = createAdminClient()

    // 1. Fetch budget settings if saved in DB
    let settings = { ...DEFAULT_BUDGET_SETTINGS }
    const { data: dbSettings } = await supabase
      .from('finance_budget_settings')
      .select('*')
      .eq('id', 'default')
      .single()

    if (dbSettings) {
      settings = {
        maintenancePct: Number(dbSettings.maintenance_pct) || DEFAULT_BUDGET_SETTINGS.maintenancePct,
        marketingPct: Number(dbSettings.marketing_pct) || DEFAULT_BUDGET_SETTINGS.marketingPct,
        profitFirstProfitPct: Number((dbSettings as any).profit_first_profit_pct) || DEFAULT_BUDGET_SETTINGS.profitFirstProfitPct,
        ownerSalaryMonthlyCents: (dbSettings as any).owner_salary_monthly_cents ?? DEFAULT_BUDGET_SETTINGS.ownerSalaryMonthlyCents,
        ownerSalaryPct: Number((dbSettings as any).owner_salary_pct) || DEFAULT_BUDGET_SETTINGS.ownerSalaryPct,
        boatCount: (dbSettings as any).boat_count ?? DEFAULT_BUDGET_SETTINGS.boatCount,
        berthFeePerBoatYearlyCents: (dbSettings as any).berth_fee_per_boat_yearly_cents ?? DEFAULT_BUDGET_SETTINGS.berthFeePerBoatYearlyCents,
        otherFixedCostsMonthlyCents: (dbSettings as any).other_fixed_costs_monthly_cents ?? DEFAULT_BUDGET_SETTINGS.otherFixedCostsMonthlyCents,
        zettleCogsPct: Number((dbSettings as any).zettle_cogs_pct) || DEFAULT_BUDGET_SETTINGS.zettleCogsPct,
        loanName: (dbSettings as any).loan_name ?? DEFAULT_BUDGET_SETTINGS.loanName,
        loanPrincipalTotalCents: (dbSettings as any).loan_principal_total_cents ?? DEFAULT_BUDGET_SETTINGS.loanPrincipalTotalCents,
        loanMonthlyPrincipalCents: (dbSettings as any).loan_monthly_principal_cents ?? DEFAULT_BUDGET_SETTINGS.loanMonthlyPrincipalCents,
        loanMonthlyInterestCents: (dbSettings as any).loan_monthly_interest_cents ?? DEFAULT_BUDGET_SETTINGS.loanMonthlyInterestCents,
        loanInterestRatePct: Number((dbSettings as any).loan_interest_rate_pct) || DEFAULT_BUDGET_SETTINGS.loanInterestRatePct,
        loanTargetPayoffYear: (dbSettings as any).loan_target_payoff_year ?? DEFAULT_BUDGET_SETTINGS.loanTargetPayoffYear,
        loans: (dbSettings as any).loans && Array.isArray((dbSettings as any).loans) && (dbSettings as any).loans.length > 0
          ? (dbSettings as any).loans
          : DEFAULT_BUDGET_SETTINGS.loans,
        alfCategories: (dbSettings as any).alf_categories && Array.isArray((dbSettings as any).alf_categories) && (dbSettings as any).alf_categories.length > 0
          ? (dbSettings as any).alf_categories
          : DEFAULT_BUDGET_SETTINGS.alfCategories,
        marketingScenarioSpendCents: (dbSettings as any).marketing_scenario_spend_cents ?? DEFAULT_BUDGET_SETTINGS.marketingScenarioSpendCents,
        fixedCostItems: (dbSettings as any).fixed_cost_items && Array.isArray((dbSettings as any).fixed_cost_items) && (dbSettings as any).fixed_cost_items.length > 0
          ? (dbSettings as any).fixed_cost_items
          : DEFAULT_BUDGET_SETTINGS.fixedCostItems,
        fixedCostsMonthlyCents: dbSettings.fixed_costs_monthly_cents ?? DEFAULT_BUDGET_SETTINGS.fixedCostsMonthlyCents,
        winterBufferTargetCents: dbSettings.winter_buffer_target_cents ?? DEFAULT_BUDGET_SETTINGS.winterBufferTargetCents,
        defaultMonthlyRevenueTargetCents: dbSettings.default_monthly_revenue_target_cents ?? DEFAULT_BUDGET_SETTINGS.defaultMonthlyRevenueTargetCents,
        targetSkipperRatioPct: Number(dbSettings.target_skipper_ratio_pct) || DEFAULT_BUDGET_SETTINGS.targetSkipperRatioPct,
        targetCateringMarginPct: Number(dbSettings.target_catering_margin_pct) || DEFAULT_BUDGET_SETTINGS.targetCateringMarginPct,
        defaultSkipperHourlyRateCents: dbSettings.default_skipper_hourly_rate_cents ?? DEFAULT_BUDGET_SETTINGS.defaultSkipperHourlyRateCents,
      }
    }

    // 2. Fetch catalog extras for cost lookup
    const { data: catalogExtras } = await supabase
      .from('extras')
      .select('id, name, category, price_value, cost_price_value')

    // 3. Fetch bookings for the year
    const fromDate = `${year}-01-01`
    const toDate = `${year}-12-31`
    const { data: bookingsData, error: bError } = await supabase
      .from('bookings')
      .select('id, booking_date, status, booking_source, stripe_amount, base_amount_cents, extras_amount_cents, commission_amount_cents, guest_count, extras_selected')
      .gte('booking_date', fromDate)
      .lte('booking_date', toDate)

    if (bError) return apiError(bError.message)

    // 4. Fetch shifts with staff rates
    const { data: shiftsData, error: sError } = await supabase
      .from('shifts')
      .select(`
        id,
        date,
        start_at,
        end_at,
        staff_id,
        booking_id,
        status,
        staff:staff_id (
          hourly_rate_cents
        )
      `)
      .gte('date', fromDate)
      .lte('date', toDate)

    if (sError) return apiError(sError.message)

    // 5. Fetch Zettle onboard sales for the year
    const { data: zettleData } = await supabase
      .from('zettle_monthly_sales')
      .select('month, total_incl_vat_cents, total_excl_vat_cents, card_gross_cents, cash_zettle_cents, vat9_vat_cents, vat21_vat_cents, total_vat_cents')
      .gte('month', fromDate)
      .lte('month', toDate)

    // 6. Compute Monthly Cockpit & Totals
    const { months, totals } = computeMonthlyCockpit({
      year,
      bookings: bookingsData ?? [],
      shifts: (shiftsData as any) ?? [],
      zettleMonths: (zettleData as any) ?? [],
      catalog: catalogExtras ?? [],
      settings,
      currentDate: new Date(),
    })

    // 6. Cash & Receivables overview
    const revolutBalance = await revolut.getBalanceSummary()

    // Fetch all open receivables: direct bookings + invoices
    const { data: openBookings } = await supabase
      .from('bookings')
      .select('id, stripe_amount, base_amount_cents, extras_amount_cents, payment_status, booking_source, stripe_invoice_id')
      .neq('status', 'cancelled')
      .in('payment_status', [
        'pending',
        'stripe_invoice_sent',
        'partner_invoice_pending',
        'awaiting_payment',
        'needs_reconciliation',
      ])

    let openInvoicesCents = 0 // B2B facturen & partner invoices
    let openDirectBookingsCents = 0 // Directe website/walk-in boekingen

    for (const b of (openBookings || [])) {
      const amount = (typeof b.stripe_amount === 'number' && b.stripe_amount > 0)
        ? b.stripe_amount
        : ((b.base_amount_cents || 0) + (b.extras_amount_cents || 0))

      if (amount <= 0) continue

      if (b.stripe_invoice_id || b.payment_status === 'stripe_invoice_sent' || b.payment_status === 'partner_invoice_pending') {
        openInvoicesCents += amount
      } else {
        openDirectBookingsCents += amount
      }
    }

    // 7. Live Stripe balance (Direct bookings collected online, awaiting payout to Revolut)
    let stripeBalance = {
      configured: false,
      availableEurCents: 0,
      pendingEurCents: 0,
      totalEurCents: 0,
    }
    try {
      const stripe = getStripe()
      const bal = await stripe.balance.retrieve()
      const avail = (bal.available || []).find(a => a.currency === 'eur')?.amount || 0
      const pending = (bal.pending || []).find(p => p.currency === 'eur')?.amount || 0
      stripeBalance = {
        configured: true,
        availableEurCents: avail,
        pendingEurCents: pending,
        totalEurCents: avail + pending,
      }
    } catch (sErr) {
      console.warn('[profit-cockpit] Could not fetch live Stripe balance:', sErr)
    }

    const totalReceivablesCents = openInvoicesCents + openDirectBookingsCents + stripeBalance.totalEurCents

    // Current month free cash calculation
    const currentMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
    const currentMonthRow = months.find(m => m.month === currentMonthKey)

    // Unpaid/open operational liabilities for current month (estimated)
    const currentMonthLiabilitiesCents = (currentMonthRow?.skipperCostCents || 0) + (currentMonthRow?.cateringCostCents || 0)

    // Gereserveerde potjes YTD
    const totalPotsReservedCents = totals.totalMaintenanceReservedCents + totals.totalMarketingBudgetCents

    // Vrij beschikbare cash (inclusief Stripe directe boekingen & te ontvangen facturen)
    const effectiveBankCashCents = revolutBalance.configured
      ? revolutBalance.totalEurCents
      : (dbSettings?.revolut_manual_balance_cents || 3425000) // Fallback demo cash if not configured

    const freeAvailableCashCents = Math.max(
      0,
      effectiveBankCashCents + stripeBalance.totalEurCents + openInvoicesCents + openDirectBookingsCents - currentMonthLiabilitiesCents - totalPotsReservedCents
    )

    return apiOk({
      year,
      months,
      totals,
      settings,
      cash: {
        revolut: revolutBalance,
        stripe: stripeBalance,
        effectiveBankCashCents,
        openInvoicesCents,
        openDirectBookingsCents,
        totalReceivablesCents,
        currentMonthLiabilitiesCents,
        totalPotsReservedCents,
        freeAvailableCashCents,
      },
    })
  } catch (err: any) {
    console.error('[profit-cockpit] GET error:', err)
    return apiError(err.message || 'Server error computing profit cockpit')
  }
}
