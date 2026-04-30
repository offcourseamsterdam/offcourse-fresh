import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { getStripe } from '@/lib/stripe/server'
import { FHNotFoundError, FHValidationError } from '@/lib/fareharbor/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const { refundOption = 'none', partialAmountCents } = body as {
      refundOption?: 'full' | 'partial' | 'none'
      partialAmountCents?: number
    }

    const supabase = createAdminClient()
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, booking_uuid, status, booking_source, stripe_payment_intent_id, stripe_amount')
      .eq('id', id)
      .single()

    if (fetchError || !booking) return apiError('Booking not found', 404)
    // Note: we allow re-cancelling an already-cancelled booking so the admin
    // can still issue a Stripe refund or force-sync the status.

    if (booking.booking_uuid && booking.status !== 'cancelled') {
      try {
        const fh = getFareHarborClient()
        await fh.cancelBooking(booking.booking_uuid)
      } catch (err) {
        // If FH says the booking is already gone or already cancelled, proceed with local cancel
        const alreadyCancelled = err instanceof FHValidationError &&
          err.message.toLowerCase().includes('already')
        if (!(err instanceof FHNotFoundError) && !alreadyCancelled) throw err
      }
    }

    const { error: updateError } = await supabase
      .from('bookings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)

    if (updateError) return apiError(updateError.message)

    // Stripe refund (website bookings only)
    let refundId: string | null = null
    let refundError: string | null = null
    if (
      refundOption !== 'none' &&
      booking.booking_source === 'website' &&
      booking.stripe_payment_intent_id
    ) {
      try {
        const stripe = getStripe()
        const refundParams: Parameters<typeof stripe.refunds.create>[0] = {
          payment_intent: booking.stripe_payment_intent_id,
        }
        if (refundOption === 'partial' && partialAmountCents && partialAmountCents > 0) {
          refundParams.amount = partialAmountCents
        }
        const refund = await stripe.refunds.create(refundParams)
        refundId = refund.id
      } catch (err) {
        // Refund failed (e.g. PI not found, already refunded, test/live key mismatch)
        // Booking is already cancelled in DB — surface the warning but don't block.
        refundError = err instanceof Error ? err.message : 'Stripe refund failed'
        console.error('[cancel-booking] Stripe refund failed for booking', id, err)
      }
    }

    return apiOk({ cancelled: true, refundId, refundError })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
