import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import type Stripe from 'stripe'

export async function POST(request: NextRequest) {
  const stripe = getStripe()
  const body = await request.text()
  const sig = request.headers.get('stripe-signature') ?? ''
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? ''

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const supabase = createAdminClient()

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    await supabase
      .from('bookings')
      .update({
        payment_status: 'paid',
        stripe_payment_intent_id: session.payment_intent as string | null,
      })
      .eq('stripe_session_id', session.id)
      .eq('payment_status', 'pending_payment')
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session
    const fareharborUuid = session.metadata?.fareharbor_uuid

    if (fareharborUuid) {
      try {
        const fh = getFareHarborClient()
        await fh.cancelBooking(fareharborUuid)
      } catch (err) {
        // Non-fatal — log and continue to update DB status
        console.error('[stripe-webhook] FH cancel failed for', fareharborUuid, err)
      }
    }

    await supabase
      .from('bookings')
      .update({ status: 'cancelled', payment_status: 'cancelled' })
      .eq('stripe_session_id', session.id)
  }

  return NextResponse.json({ received: true })
}
