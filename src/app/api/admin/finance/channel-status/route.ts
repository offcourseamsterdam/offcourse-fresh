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

    const prevMonthRow = btwResult.months.find(m => m.quarter === prevMonthKey)

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
        const hasData = ((prevData?.vat9OwedCents || 0) + (prevData?.vat21OwedCents || 0)) > 0
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
