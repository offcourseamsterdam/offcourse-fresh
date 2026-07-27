import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { aggregateVatStripeSummary } from '@/lib/finance/vat-stripe-summary'

/**
 * GET /api/admin/finance/vat-stripe-summary
 *
 * BTW (VAT) breakdown + Stripe payout reconciliation, bucketed by quarter.
 * See aggregateVatStripeSummary for the bucketing/filtering rules.
 *
 * Response shape:
 * {
 *   quarters: [
 *     { quarter, bookingCount, grossCents, vat9Cents, vat21Cents, totalVatCents,
 *       stripeFeeCents, netCents, missingFeeCount }
 *   ],
 *   totals: { same shape, no `quarter` }
 * }
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    // Scoped to bookings that actually went through Stripe — reseller
    // (GetYourGuide/Viator/TripAdvisor) and complimentary bookings never have
    // a payment intent, so they're excluded here rather than by allowlisting
    // payment_status/booking_source values that could drift out of sync.
    //
    // Fully refunded bookings are excluded too: a full refund means no real
    // revenue or VAT liability remains, but base_vat_amount_cents/
    // extras_vat_amount_cents are never zeroed out on refund (the webhook
    // only flips payment_status) — leaving them in would overstate what's
    // owed on a BTW-aangifte. Partially refunded bookings are deliberately
    // still included at their original (gross) VAT — there's no stored
    // refunded-amount to compute the adjusted figure from, so this is a
    // known approximation until that's tracked; flag it if it matters.
    const { data, error } = await supabase
      .from('bookings')
      .select('created_at, stripe_amount, base_vat_amount_cents, extras_vat_amount_cents, total_vat_amount_cents, stripe_fee_cents')
      .not('stripe_payment_intent_id', 'is', null)
      .neq('payment_status', 'refunded')

    if (error) return apiError(error.message)

    return apiOk(aggregateVatStripeSummary(data ?? []))
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
