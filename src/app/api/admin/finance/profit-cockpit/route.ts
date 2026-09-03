import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeMonthlyCockpit, DEFAULT_BUDGET_SETTINGS, type CockpitBudgetSettings } from '@/lib/finance/profit-cockpit-calculator'
import { revolut } from '@/lib/revolut/client'

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

    // 5. Compute Monthly Cockpit & Totals
    const { months, totals } = computeMonthlyCockpit({
      year,
      bookings: bookingsData ?? [],
      shifts: (shiftsData as any) ?? [],
      catalog: catalogExtras ?? [],
      settings,
      currentDate: new Date(),
    })

    // 6. Cash & Receivables overview
    const revolutBalance = await revolut.getBalanceSummary()

    // Fetch open Stripe invoices amount
    const { data: openInvoices } = await supabase
      .from('bookings')
      .select('stripe_amount')
      .in('payment_status', ['stripe_invoice_sent', 'pending'])
      .not('stripe_invoice_id', 'is', null)

    const openInvoicesCents = (openInvoices || []).reduce((sum, i) => sum + (i.stripe_amount || 0), 0)

    // Current month free cash calculation
    const currentMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
    const currentMonthRow = months.find(m => m.month === currentMonthKey)

    // Unpaid/open operational liabilities for current month (estimated)
    const currentMonthLiabilitiesCents = (currentMonthRow?.skipperCostCents || 0) + (currentMonthRow?.cateringCostCents || 0)

    // Gereserveerde potjes YTD
    const totalPotsReservedCents = totals.totalMaintenanceReservedCents + totals.totalMarketingBudgetCents

    // Vrij beschikbare cash
    const effectiveBankCashCents = revolutBalance.configured
      ? revolutBalance.totalEurCents
      : (dbSettings?.revolut_manual_balance_cents || 3425000) // Fallback demo cash if not configured

    const freeAvailableCashCents = Math.max(0, effectiveBankCashCents + openInvoicesCents - currentMonthLiabilitiesCents - totalPotsReservedCents)

    return apiOk({
      year,
      months,
      totals,
      settings,
      cash: {
        revolut: revolutBalance,
        effectiveBankCashCents,
        openInvoicesCents,
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
