import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStripe } from '@/lib/stripe/server'
import { Resend } from 'resend'
import { paymentReminderEmailHtml } from '@/emails/PaymentReminderEmail'
import { format } from 'date-fns'

/**
 * GET /api/cron/payment-reminders
 * Vercel Cron: runs every hour.
 * Sends a reminder email to customers whose payment link was created 18h+ ago
 * and is still unpaid (and not yet expired).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const resend = new Resend(process.env.RESEND_API_KEY!)
  const stripe = getStripe()

  // Bookings that are pending_payment, reminder not yet sent,
  // created 18h+ ago, and not yet expired
  const cutoff = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_email, listing_title, booking_date, start_time, guest_count, stripe_amount, stripe_session_id, payment_link_expires_at')
    .eq('payment_status', 'pending_payment')
    .eq('payment_reminder_sent', false)
    .lt('created_at', cutoff)
    .gt('payment_link_expires_at', now)

  if (error) {
    console.error('[cron/payment-reminders] DB error:', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  let sent = 0

  for (const booking of bookings ?? []) {
    if (!booking.stripe_session_id) continue

    // Retrieve live Checkout Session URL from Stripe
    let paymentUrl = ''
    try {
      const session = await stripe.checkout.sessions.retrieve(booking.stripe_session_id)
      paymentUrl = session.url ?? ''
    } catch {
      // Session may no longer be retrievable — skip
      continue
    }

    if (!paymentUrl) continue

    const dateFormatted = booking.booking_date
      ? format(new Date(booking.booking_date), 'd MMMM yyyy')
      : ''
    const startTimeFormatted = booking.start_time
      ? format(new Date(booking.start_time), 'HH:mm')
      : ''

    try {
      await resend.emails.send({
        from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
        to: booking.customer_email,
        subject: 'Reminder: your payment link expires in ~6 hours',
        html: paymentReminderEmailHtml({
          customerName: booking.customer_name,
          listingTitle: booking.listing_title ?? '',
          bookingDate: dateFormatted,
          startTime: startTimeFormatted,
          guestCount: booking.guest_count ?? 0,
          amountCents: booking.stripe_amount ?? 0,
          paymentUrl,
        }),
      })

      await supabase
        .from('bookings')
        .update({ payment_reminder_sent: true })
        .eq('id', booking.id)

      sent++
    } catch (err) {
      console.error('[cron/payment-reminders] Email failed for booking', booking.id, err)
    }
  }

  return NextResponse.json({ ok: true, sent })
}
