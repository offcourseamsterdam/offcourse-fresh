import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeBtwDashboard } from '@/lib/finance/btw-dashboard-calculator'

export interface ChannelStatusItem {
  key: string
  sourceKey: string
  label: string
  allTimeRevenueCents: number
  hasPreviousMonthData: boolean
  isArchived: boolean
}

export interface FinanceChannelStatusResponse {
  previousMonth: {
    key: string
    label: string
  }
  openInvoicesCount: number
  outstandingPartnersCount: number
  channels: ChannelStatusItem[]
}

const CHANNEL_METADATA: Record<string, { key: string; label: string; isArchived?: boolean }> = {
  stripe: { key: 'vat', label: 'Stripe (Website)' },
  fareharbor: { key: 'fareharbor', label: 'FareHarbor', isArchived: true },
  zettle: { key: 'zettle', label: 'Zettle' },
  withlocals: { key: 'withlocals', label: 'Withlocals' },
  getyourguide: { key: 'getyourguide', label: 'GetYourGuide' },
  viator: { key: 'viator', label: 'Viator' },
  boatlocal: { key: 'boatlocal', label: 'BoatLocal' },
  revolut: { key: 'revolut', label: 'Revolut' },
  clickandboat: { key: 'clickandboat', label: 'Click & Boat' },
  getmyboat: { key: 'getmyboat', label: 'GetMyBoat' },
  barqo: { key: 'barqo', label: 'Barqo' },
}

/**
 * GET /api/admin/finance/channel-status
 *
 * Returns operational status for Finance tabs:
 * - All-time revenue per sales channel (ordered descending)
 * - Reconciliation status for the most recent completed month (e.g. "Aug ✓")
 * - Count of open Stripe invoices
 * - Count of pending partner settlements
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied

  try {
    const supabase = createAdminClient()

    const [btwResult, openInvoicesRes, partnersRes] = await Promise.all([
      computeBtwDashboard(supabase),
      supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('payment_status', 'stripe_invoice_sent')
        .is('deleted_at', null),
      supabase
        .from('partner_settlements')
        .select('id', { count: 'exact', head: true })
        .is('settled_at', null),
    ])

    // Compute previous completed calendar month
    const now = new Date()
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`
    const prevMonthLabel = prevDate.toLocaleDateString('nl-NL', { month: 'short' })
    const prevMonthStart = `${prevMonthKey}-01`
    const prevMonthEnd = new Date(prevDate.getFullYear(), prevDate.getMonth() + 1, 0).toISOString().slice(0, 10)

    const prevMonthRow = btwResult.months.find(m => m.quarter === prevMonthKey)

    // Viator, BoatLocal, and GetYourGuide all report on a ~1-month lag: a
    // document dated early in month M actually covers month M-1's travel
    // (see the "CRITICAL" note in the finance-payout-sync skill, confirmed
    // 2026-09-03). computeBtwDashboard buckets these by document/payment
    // date on purpose (that's the correct basis for the BTW aangfte itself),
    // but that means this status check — "has month M's data arrived yet"
    // — needs the REAL period each document covers, not its send date, or
    // it reports a false "ontbreekt" for a month that's actually already
    // fully synced (confirmed 2026-09-10: this exact false negative).
    const [viatorCoverage, boatlocalCoverage, gygCoverage] = await Promise.all([
      supabase
        .from('viator_payment_lines')
        .select('id', { count: 'exact', head: true })
        .gte('arrival_date', prevMonthStart)
        .lte('arrival_date', prevMonthEnd),
      supabase
        .from('boatlocal_payout_batches')
        .select('id', { count: 'exact', head: true })
        .eq('period_start', prevMonthStart),
      // GetYourGuide has no stored period columns at all — approximate using
      // the confirmed lag pattern (a payment run in month M+1 covers month
      // M) rather than leaving this source permanently unable to report
      // correctly.
      supabase
        .from('getyourguide_payments')
        .select('id', { count: 'exact', head: true })
        .gte('payment_run_date', new Date(prevDate.getFullYear(), prevDate.getMonth() + 1, 1).toISOString().slice(0, 10))
        .lt('payment_run_date', new Date(prevDate.getFullYear(), prevDate.getMonth() + 2, 1).toISOString().slice(0, 10)),
    ])
    const lagCorrectedCoverage: Record<string, boolean> = {
      viator: (viatorCoverage.count ?? 0) > 0,
      boatlocal: (boatlocalCoverage.count ?? 0) > 0,
      getyourguide: (gygCoverage.count ?? 0) > 0,
    }

    // Sum revenue per channel across all quarters
    const channelTotals: Record<string, number> = {}
    for (const src of Object.keys(CHANNEL_METADATA)) {
      channelTotals[src] = 0
    }

    for (const q of btwResult.quarters) {
      for (const [src, data] of Object.entries(q.bySource || {})) {
        if (channelTotals[src] !== undefined) {
          const rev = Math.round((data.vat9OwedCents || 0) / 0.09) + Math.round((data.vat21OwedCents || 0) / 0.21)
          channelTotals[src] += rev
        }
      }
    }

    const channels: ChannelStatusItem[] = Object.entries(CHANNEL_METADATA)
      .map(([srcKey, meta]) => {
        const prevData = prevMonthRow?.bySource?.[srcKey]
        const hasData = srcKey in lagCorrectedCoverage
          ? lagCorrectedCoverage[srcKey]
          : ((prevData?.vat9OwedCents || 0) + (prevData?.vat21OwedCents || 0)) > 0
        return {
          sourceKey: srcKey,
          key: meta.key,
          label: meta.label,
          allTimeRevenueCents: channelTotals[srcKey] ?? 0,
          hasPreviousMonthData: hasData,
          isArchived: Boolean(meta.isArchived),
        }
      })
      .sort((a, b) => b.allTimeRevenueCents - a.allTimeRevenueCents)

    return apiOk({
      previousMonth: {
        key: prevMonthKey,
        label: prevMonthLabel,
      },
      openInvoicesCount: openInvoicesRes.count ?? 0,
      outstandingPartnersCount: partnersRes.count ?? 0,
      channels,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
