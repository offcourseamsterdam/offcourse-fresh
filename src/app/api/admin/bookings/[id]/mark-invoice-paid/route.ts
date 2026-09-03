import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { markStripeInvoicePaidOutOfBand } from '@/lib/stripe/invoicing'
import { postSlackOps } from '@/lib/slack/send-notification'
import { notifyBookingsChanged } from '@/lib/realtime/notify-bookings-changed'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, status, stripe_invoice_id, company_name, customer_name, customer_email, stripe_amount, listing_title, booking_date, payment_status')
      .eq('id', id)
      .single()

    if (fetchError || !booking) {
      return apiError('Booking not found', 404)
    }

    if (booking.status === 'cancelled') {
      return apiError('Kan geen factuur als betaald markeren voor een geannuleerde boeking', 400)
    }

    if (booking.payment_status === 'paid') {
      return apiOk({ message: 'Booking is already marked as paid' })
    }

    // If there is a Stripe Invoice, mark it as paid out-of-band in Stripe
    if (booking.stripe_invoice_id) {
      try {
        await markStripeInvoicePaidOutOfBand(booking.stripe_invoice_id)
      } catch (err) {
        console.warn('[mark-invoice-paid] Failed to mark invoice paid in Stripe:', err)
      }
    }

    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        payment_status: 'paid',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (updateError) {
      return apiError(updateError.message)
    }

    await notifyBookingsChanged()

    await postSlackOps([
      `💶 *Stripe Invoice manually marked as PAID (Out-of-band)*`,
      `🏢 *${booking.company_name || booking.customer_name || 'Guest'}* · €${((booking.stripe_amount ?? 0) / 100).toFixed(2)}`,
      booking.stripe_invoice_id ? `Invoice ID: \`${booking.stripe_invoice_id}\`` : '',
      booking.listing_title ? `Cruise: ${booking.listing_title} (${booking.booking_date})` : '',
    ].filter(Boolean).join('\n')).catch(err => console.error('[mark-invoice-paid] Slack alert failed:', err))

    return apiOk({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
