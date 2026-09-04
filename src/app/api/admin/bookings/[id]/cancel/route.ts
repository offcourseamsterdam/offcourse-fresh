import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { getStripe } from '@/lib/stripe/server'
import { voidStripeInvoice } from '@/lib/stripe/invoicing'
import { FHNotFoundError, FHValidationError } from '@/lib/fareharbor/types'
import { emitOpsEvent } from '@/lib/ops/events'
import { postSlackOps } from '@/lib/slack/send-notification'
import { notifyBookingsChanged } from '@/lib/realtime/notify-bookings-changed'
import { syncAndScheduleShifts } from '@/lib/scheduling/proactive-scheduling'
import { after } from 'next/server'
import { formatAmsterdamTime } from '@/lib/utils'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied
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
      .select('id, booking_uuid, booking_id, external_id, booking_date, status, booking_source, payment_status, stripe_payment_intent_id, stripe_invoice_id, stripe_amount, customer_name, customer_email, listing_title, start_time')
      .eq('id', id)
      .single()

    if (fetchError || !booking) return apiError('Booking not found', 404)
    // Note: we allow re-cancelling an already-cancelled booking so the admin
    // can still issue a Stripe refund or force-sync the status.

    // A booking that exists in FareHarbor but has no booking_uuid CANNOT be
    // cancelled there — FareHarbor addresses bookings by uuid only (a numeric
    // pk returns 403, verified). Before this guard the `if (booking_uuid)`
    // below simply skipped the FareHarbor call and fell through to marking the
    // row cancelled locally, so the boat slot stayed live while the admin
    // panel and Slack both reported it cancelled. Refuse loudly instead: an
    // honest error beats a silent lie about a real slot on a real boat.
    const existsInFareharbor = !!booking.external_id || booking.booking_id?.startsWith('fh_')
    if (!booking.booking_uuid && existsInFareharbor && booking.status !== 'cancelled') {
      return apiError(
        'This booking has no FareHarbor reference we can cancel with, so cancelling here would leave the slot live in FareHarbor. Cancel it in FareHarbor (or on the platform it was booked through) and it will sync back.',
        409,
      )
    }

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

    // Void open Stripe Invoice if present (so customer cannot pay a cancelled booking)
    let invoiceVoided = false
    let invoiceAlreadyPaid = booking.payment_status === 'paid'

    if (booking.stripe_invoice_id && !invoiceAlreadyPaid) {
      try {
        await voidStripeInvoice(booking.stripe_invoice_id)
        invoiceVoided = true
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.toLowerCase().includes('already paid') || msg.toLowerCase().includes('status is paid')) {
          invoiceAlreadyPaid = true
        }
        console.warn('[cancel-booking] Failed to void Stripe Invoice:', err)
      }
    }

    const updatePayload: Record<string, unknown> = {
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    }
    if (!invoiceAlreadyPaid) {
      updatePayload.payment_status = 'cancelled'
    } else {
      updatePayload.payment_status = 'paid'
    }

    const { error: updateError } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('id', id)

    if (updateError) return apiError(updateError.message)
    await notifyBookingsChanged()

    // A cancelled cruise changes the day's real work: its shift may now cover
    // fewer departures, or none at all (in which case the sync cancels it).
    // Without this the roster kept a shift for a cruise that is no longer
    // sailing until the nightly cron happened to notice.
    if (booking.booking_date) {
      const date = booking.booking_date
      after(() => syncAndScheduleShifts(supabase, date).catch(err => console.error('[cancel] shift sync failed:', err)))
    }

    await emitOpsEvent({
      eventType: 'booking_cancelled',
      actorType: 'human',
      bookingId: booking.id,
      source: 'admin/bookings/[id]/cancel',
    })

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

    // Slack — best-effort, never blocks the response
    const refundLabel = refundOption === 'none'
      ? 'no refund'
      : refundOption === 'partial' && partialAmountCents
        ? `partial €${(partialAmountCents / 100).toFixed(0)}`
        : `full €${((booking.stripe_amount ?? 0) / 100).toFixed(0)}`
    postSlackOps([
      `❌ *Booking cancelled (admin)*`,
      `*${booking.listing_title ?? '—'}*`,
      `👤 ${booking.customer_name ?? '—'} · ${booking.customer_email ?? '—'}`,
      `📅 ${booking.booking_date ?? '—'} · ${formatAmsterdamTime(booking.start_time)}`,
      `💰 Refund: ${refundLabel}`,
      invoiceVoided ? `🧾 Stripe factuur ingetrokken (voided in Stripe)` : '',
      booking.booking_uuid ? `🎫 FH: ${booking.booking_uuid}` : '',
    ].filter(Boolean).join('\n')).catch(err => console.error('[cancel-booking] Slack error (ignored):', err))

    return apiOk({ cancelled: true, refundId, refundError, invoiceVoided })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
