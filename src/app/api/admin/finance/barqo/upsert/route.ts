import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/admin/finance/barqo/upsert
 *
 * Save one booking read off barqo.co/dashboard/booking-overview — there's no
 * recurring payout email or CSV export for Barqo (unlike every other kasboek
 * source), so this is entered by hand/agent whenever a new booking shows up,
 * the same "no document, read the portal" pattern as Zettle. Keyed by
 * `bookingNumber` (Barqo's own code, e.g. "BJL4QP") so re-running for a
 * booking already stored updates it in place rather than duplicating.
 *
 * `netPayoutCents` is optional — it's the actual bank-confirmed payout
 * (gross `priceCents` minus Barqo's own commission incl. 21% VAT), found by
 * cross-referencing a bank statement, not visible on the dashboard itself.
 * Leave it out until a real payout figure is confirmed; the aggregator falls
 * back to treating the gross price as its own net until then.
 *
 * Body (JSON): { bookingNumber, guestName, boatName, tripDate: "YYYY-MM-DD", priceCents, netPayoutCents? }
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body.bookingNumber !== 'string' || !body.bookingNumber) {
      return apiError('bookingNumber is required', 400)
    }
    if (typeof body.priceCents !== 'number' || !Number.isFinite(body.priceCents)) {
      return apiError('priceCents must be a number', 400)
    }
    if (body.tripDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(body.tripDate)) {
      return apiError('tripDate must be "YYYY-MM-DD"', 400)
    }
    if (body.netPayoutCents != null && (typeof body.netPayoutCents !== 'number' || !Number.isFinite(body.netPayoutCents))) {
      return apiError('netPayoutCents must be a number', 400)
    }

    const supabase = createAdminClient()

    const { data: existing, error: lookupError } = await supabase
      .from('barqo_bookings')
      .select('id, net_payout_cents')
      .eq('booking_number', body.bookingNumber)
      .maybeSingle()
    if (lookupError) return apiError(lookupError.message)

    // netPayoutCents comes from a separate source (a bank statement) than the
    // dashboard fields — a re-run that only refreshes guest/boat/price
    // shouldn't silently wipe out an already-confirmed payout figure.
    const netPayoutCents = body.netPayoutCents != null ? body.netPayoutCents : (existing?.net_payout_cents ?? null)

    const patch = {
      booking_number: body.bookingNumber,
      guest_name: body.guestName ?? null,
      boat_name: body.boatName ?? null,
      trip_date: body.tripDate ?? null,
      price_cents: body.priceCents,
      net_payout_cents: netPayoutCents,
    }

    if (existing) {
      const { error } = await supabase
        .from('barqo_bookings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) return apiError(error.message)
    } else {
      const { error } = await supabase.from('barqo_bookings').insert(patch)
      if (error) return apiError(error.message)
    }

    return apiOk({ bookingNumber: body.bookingNumber, alreadyExisted: !!existing })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
