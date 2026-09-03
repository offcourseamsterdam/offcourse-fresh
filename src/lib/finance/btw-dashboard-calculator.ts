import type { SupabaseClient } from '@supabase/supabase-js'
import { quarterFromDate, monthFromDate } from '@/lib/quarters'
import { aggregateBtwDashboard, type BtwSourceQuarterInput, type QuarterBtwDashboard, type BtwDashboardTotals } from '@/lib/finance/btw-dashboard'
import { aggregateVatStripeSummary } from '@/lib/finance/vat-stripe-summary'
import { aggregateBoatLocalSummary } from '@/lib/finance/boatlocal-summary'
import { aggregateZettleSummary } from '@/lib/finance/zettle-sales'
import { aggregateWithlocalsSummary } from '@/lib/finance/withlocals-summary'
import { aggregateClickAndBoatSummary } from '@/lib/finance/clickandboat-summary'
import { aggregateGetYourGuideSummary } from '@/lib/finance/getyourguide-summary'
import { aggregateViatorSummary } from '@/lib/finance/viator-summary'
import { aggregateGetMyBoatSummary } from '@/lib/finance/getmyboat-summary'
import { aggregateBarqoSummary } from '@/lib/finance/barqo-summary'
import { aggregateRevolutSummary } from '@/lib/finance/revolut-summary'
import { aggregateFareHarborPayoutSummary } from '@/lib/finance/fareharbor-payout-summary'

export interface BtwDashboardCalculated {
  quarters: QuarterBtwDashboard[]
  totals: BtwDashboardTotals
  months: QuarterBtwDashboard[]
}

export async function computeBtwDashboard(supabase: SupabaseClient): Promise<BtwDashboardCalculated> {
  // Stripe (website bookings)
  const { data: bookingRows, error: bookingsErr } = await supabase
    .from('bookings')
    .select('created_at, stripe_amount, base_vat_amount_cents, extras_vat_amount_cents, total_vat_amount_cents, stripe_fee_cents')
    .or('stripe_payment_intent_id.not.is.null,and(booking_source.eq.stripe_invoice,payment_status.eq.paid)')
    .neq('payment_status', 'refunded')
  if (bookingsErr) throw new Error(bookingsErr.message)

  const stripeByQuarter = aggregateVatStripeSummary(bookingRows ?? [])
  const stripeByMonth = aggregateVatStripeSummary(bookingRows ?? [], monthFromDate)
  const toStripeRows = (qs: typeof stripeByQuarter.quarters): BtwSourceQuarterInput[] =>
    qs.map(q => ({ quarter: q.quarter, vat9OwedCents: q.vat9Cents, vat21OwedCents: q.vat21Cents }))

  // BoatLocal
  const { data: boatlocalRows, error: boatlocalErr } = await supabase
    .from('boatlocal_payout_batches')
    .select('issue_date, operator_payout_cents, vat_9_in_payout_cents, vat_21_cents, boatlocal_payout_lines(count)')
  if (boatlocalErr) throw new Error(boatlocalErr.message)

  const boatlocalBatches = (boatlocalRows ?? []).map(b => ({
    issueDate: b.issue_date,
    operatorPayoutCents: b.operator_payout_cents,
    vat9InPayoutCents: b.vat_9_in_payout_cents,
    vat21Cents: b.vat_21_cents,
    lineCount: b.boatlocal_payout_lines?.[0]?.count ?? 0,
  }))
  const boatlocalByQuarter = aggregateBoatLocalSummary(boatlocalBatches)
  const boatlocalByMonth = aggregateBoatLocalSummary(boatlocalBatches, monthFromDate)
  const toBoatlocalRows = (qs: typeof boatlocalByQuarter.quarters): BtwSourceQuarterInput[] =>
    qs.map(q => ({ quarter: q.quarter, vat9OwedCents: q.vat9InPayoutCents, vat21DeductibleCents: q.vat21Cents }))

  // Zettle
  const { data: zettleRows, error: zettleErr } = await supabase
    .from('zettle_monthly_sales')
    .select('month, total_incl_vat_cents, total_vat_cents, vat9_vat_cents, vat21_vat_cents, card_gross_cents, card_surcharge_cents, card_net_cents, cash_zettle_cents, cash_counted_cents')
  if (zettleErr) throw new Error(zettleErr.message)

  const zettleSummary = aggregateZettleSummary(
    (zettleRows ?? []).map(z => ({
      month: z.month,
      totalInclVatCents: z.total_incl_vat_cents,
      totalExclVatCents: null,
      saleCount: null,
      vat9ExclCents: null,
      vat9VatCents: z.vat9_vat_cents,
      vat9InclCents: null,
      vat21ExclCents: null,
      vat21VatCents: z.vat21_vat_cents,
      vat21InclCents: null,
      totalVatCents: z.total_vat_cents,
      cardGrossCents: z.card_gross_cents,
      cardSurchargeCents: z.card_surcharge_cents,
      cardNetCents: z.card_net_cents,
      cashZettleCents: z.cash_zettle_cents,
      cashCountedCents: z.cash_counted_cents,
    }))
  )
  const zettleQuarterRows: BtwSourceQuarterInput[] = zettleSummary.quarters.map(q => ({
    quarter: q.quarter, vat9OwedCents: q.vat9VatCents, vat21OwedCents: q.vat21VatCents,
  }))
  const zettleMonthRows: BtwSourceQuarterInput[] = (zettleRows ?? []).map(z => ({
    quarter: z.month.slice(0, 7), vat9OwedCents: z.vat9_vat_cents ?? 0, vat21OwedCents: z.vat21_vat_cents ?? 0,
  }))

  // Withlocals
  const { data: withlocalsRows, error: withlocalsErr } = await supabase
    .from('withlocals_bookings')
    .select('trip_at, tour_name, tour_price_cents, revenue_vat_rate, service_fee_ex_cents, service_fee_vat_cents, net_payout_cents')
    .not('trip_at', 'is', null)
  if (withlocalsErr) throw new Error(withlocalsErr.message)

  const withlocalsSummary = aggregateWithlocalsSummary(
    (withlocalsRows ?? []).map(w => ({
      tripAt: w.trip_at,
      tourName: w.tour_name,
      tourPriceCents: w.tour_price_cents,
      revenueVatRate: w.revenue_vat_rate,
      serviceFeeExCents: w.service_fee_ex_cents,
      serviceFeeVatCents: w.service_fee_vat_cents,
      netPayoutCents: w.net_payout_cents,
    }))
  )
  const withlocalsByQuarter = new Map<string, { vat9: number; vat21: number }>()
  for (const m of withlocalsSummary.months) {
    const q = quarterFromDate(`${m.month}-01`)
    const agg = withlocalsByQuarter.get(q) ?? { vat9: 0, vat21: 0 }
    agg.vat9 += m.revenueVatCents
    agg.vat21 += m.commissionVatCents
    withlocalsByQuarter.set(q, agg)
  }
  const withlocalsQuarterRows: BtwSourceQuarterInput[] = [...withlocalsByQuarter.entries()].map(([quarter, v]) => ({
    quarter, vat9OwedCents: v.vat9, vat21DeductibleCents: v.vat21,
  }))
  const withlocalsMonthRows: BtwSourceQuarterInput[] = withlocalsSummary.months.map(m => ({
    quarter: m.month, vat9OwedCents: m.revenueVatCents, vat21DeductibleCents: m.commissionVatCents,
  }))

  // Click & Boat
  const { data: clickandboatRows, error: clickandboatErr } = await supabase
    .from('clickandboat_bookings')
    .select('charter_start_date, gross_amount_cents, net_amount_cents, revenue_vat_rate')
  if (clickandboatErr) throw new Error(clickandboatErr.message)

  const clickandboatBookings = (clickandboatRows ?? []).map(c => ({
    charterStartDate: c.charter_start_date,
    grossAmountCents: c.gross_amount_cents,
    netAmountCents: c.net_amount_cents,
    revenueVatRate: c.revenue_vat_rate,
  }))
  const clickandboatByQuarter = aggregateClickAndBoatSummary(clickandboatBookings)
  const clickandboatByMonth = aggregateClickAndBoatSummary(clickandboatBookings, monthFromDate)
  const toClickAndBoatRows = (qs: typeof clickandboatByQuarter.quarters): BtwSourceQuarterInput[] =>
    qs.map(q => ({ quarter: q.quarter, vat9OwedCents: q.revenueVatCents }))

  // GetYourGuide
  const { data: getyourguideRows, error: getyourguideErr } = await supabase
    .from('getyourguide_payments')
    .select('payment_run_date, amount_cents')
  if (getyourguideErr) throw new Error(getyourguideErr.message)

  const getyourguidePayments = (getyourguideRows ?? []).map(p => ({
    paymentRunDate: p.payment_run_date,
    amountCents: p.amount_cents,
    revenueVatRate: null,
  }))
  const getyourguideByQuarter = aggregateGetYourGuideSummary(getyourguidePayments)
  const getyourguideByMonth = aggregateGetYourGuideSummary(getyourguidePayments, monthFromDate)
  const toGetYourGuideRows = (qs: typeof getyourguideByQuarter.quarters): BtwSourceQuarterInput[] =>
    qs.map(q => ({ quarter: q.quarter, vat9OwedCents: q.revenueVatCents }))

  // Viator
  const { data: viatorRows, error: viatorErr } = await supabase
    .from('viator_payment_batches')
    .select('advice_date, total_amount_cents, viator_payment_lines(count)')
  if (viatorErr) throw new Error(viatorErr.message)

  const viatorBatches = (viatorRows ?? []).map(b => ({
    adviceDate: b.advice_date,
    totalAmountCents: b.total_amount_cents,
    lineCount: b.viator_payment_lines?.[0]?.count ?? 0,
    revenueVatRate: null,
  }))
  const viatorByQuarter = aggregateViatorSummary(viatorBatches)
  const viatorByMonth = aggregateViatorSummary(viatorBatches, monthFromDate)
  const toViatorRows = (qs: typeof viatorByQuarter.quarters): BtwSourceQuarterInput[] =>
    qs.map(q => ({ quarter: q.quarter, vat9OwedCents: q.revenueVatCents }))

  // GetMyBoat
  const { data: getmyboatRows, error: getmyboatErr } = await supabase
    .from('getmyboat_bookings')
    .select('charter_date, net_amount_cents, revenue_vat_rate')
  if (getmyboatErr) throw new Error(getmyboatErr.message)

  const getmyboatBookings = (getmyboatRows ?? []).map(b => ({
    charterDate: b.charter_date,
    netAmountCents: b.net_amount_cents,
    revenueVatRate: b.revenue_vat_rate,
  }))
  const getmyboatByQuarter = aggregateGetMyBoatSummary(getmyboatBookings)
  const getmyboatByMonth = aggregateGetMyBoatSummary(getmyboatBookings, monthFromDate)
  const toGetMyBoatRows = (qs: typeof getmyboatByQuarter.quarters): BtwSourceQuarterInput[] =>
    qs.map(q => ({ quarter: q.quarter, vat9OwedCents: q.revenueVatCents }))

  // Barqo
  const { data: barqoRows, error: barqoErr } = await supabase
    .from('barqo_bookings')
    .select('trip_date, price_cents, net_payout_cents, revenue_vat_rate')
  if (barqoErr) throw new Error(barqoErr.message)

  const barqoBookings = (barqoRows ?? []).map(b => ({
    tripDate: b.trip_date,
    priceCents: b.price_cents,
    netPayoutCents: b.net_payout_cents,
    revenueVatRate: b.revenue_vat_rate,
  }))
  const barqoByQuarter = aggregateBarqoSummary(barqoBookings)
  const barqoByMonth = aggregateBarqoSummary(barqoBookings, monthFromDate)
  const toBarqoRows = (qs: typeof barqoByQuarter.quarters): BtwSourceQuarterInput[] =>
    qs.map(q => ({ quarter: q.quarter, vat9OwedCents: q.revenueVatCents, vat21DeductibleCents: q.commissionVatCents }))

  // Revolut
  const { data: revolutRows, error: revolutErr } = await supabase
    .from('revolut_transactions')
    .select('payout_date, original_amount_cents, vat9_gross_cents, vat21_gross_cents')
  if (revolutErr) throw new Error(revolutErr.message)

  const revolutTransactions = (revolutRows ?? []).map(t => ({
    payoutDate: t.payout_date,
    originalAmountCents: t.original_amount_cents,
    vat9GrossCents: t.vat9_gross_cents,
    vat21GrossCents: t.vat21_gross_cents,
  }))
  const revolutByQuarter = aggregateRevolutSummary(revolutTransactions)
  const revolutByMonth = aggregateRevolutSummary(revolutTransactions, monthFromDate)
  const toRevolutRows = (qs: typeof revolutByQuarter.quarters): BtwSourceQuarterInput[] =>
    qs.map(q => ({ quarter: q.quarter, vat9OwedCents: q.vat9VatCents, vat21OwedCents: q.vat21VatCents }))

  // FareHarbor
  const { data: fareharborRows, error: fareharborErr } = await supabase
    .from('fareharbor_payouts')
    .select('bank_payout_date, gross_cents, net_cents, vat9_cents, vat21_cents')
  if (fareharborErr) throw new Error(fareharborErr.message)

  const fareharborPayouts = (fareharborRows ?? []).map(p => ({
    bankPayoutDate: p.bank_payout_date,
    grossCents: p.gross_cents,
    netCents: p.net_cents,
    vat9Cents: p.vat9_cents,
    vat21Cents: p.vat21_cents,
  }))
  const fareharborByQuarter = aggregateFareHarborPayoutSummary(fareharborPayouts)
  const fareharborByMonth = aggregateFareHarborPayoutSummary(fareharborPayouts, monthFromDate)
  const toFareHarborRows = (qs: typeof fareharborByQuarter.quarters): BtwSourceQuarterInput[] =>
    qs.map(q => ({ quarter: q.quarter, vat9OwedCents: q.vat9Cents, vat21OwedCents: q.vat21Cents }))

  const byQuarter = aggregateBtwDashboard({
    stripe: toStripeRows(stripeByQuarter.quarters),
    boatlocal: toBoatlocalRows(boatlocalByQuarter.quarters),
    zettle: zettleQuarterRows,
    withlocals: withlocalsQuarterRows,
    clickandboat: toClickAndBoatRows(clickandboatByQuarter.quarters),
    getyourguide: toGetYourGuideRows(getyourguideByQuarter.quarters),
    viator: toViatorRows(viatorByQuarter.quarters),
    getmyboat: toGetMyBoatRows(getmyboatByQuarter.quarters),
    barqo: toBarqoRows(barqoByQuarter.quarters),
    revolut: toRevolutRows(revolutByQuarter.quarters),
    fareharbor: toFareHarborRows(fareharborByQuarter.quarters),
  })
  const byMonth = aggregateBtwDashboard({
    stripe: toStripeRows(stripeByMonth.quarters),
    boatlocal: toBoatlocalRows(boatlocalByMonth.quarters),
    zettle: zettleMonthRows,
    withlocals: withlocalsMonthRows,
    clickandboat: toClickAndBoatRows(clickandboatByMonth.quarters),
    getyourguide: toGetYourGuideRows(getyourguideByMonth.quarters),
    viator: toViatorRows(viatorByMonth.quarters),
    getmyboat: toGetMyBoatRows(getmyboatByMonth.quarters),
    barqo: toBarqoRows(barqoByMonth.quarters),
    revolut: toRevolutRows(revolutByMonth.quarters),
    fareharbor: toFareHarborRows(fareharborByMonth.quarters),
  })

  return {
    quarters: byQuarter.quarters,
    totals: byQuarter.totals,
    months: byMonth.quarters,
  }
}
