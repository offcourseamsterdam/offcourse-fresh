import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { enforceRateLimit } from '@/lib/rate-limit'
import { getSession, updateSession, isExpired } from '@/lib/acp/session-store'
import { resolveCheckoutItems } from '@/lib/acp/resolve-checkout-items'
import { calculateQuote } from '@/lib/booking/calculate-quote'
import { buildPaymentIntentMetadata, type AcpBuyer } from '@/lib/acp/build-payment-intent-metadata'
import { formatSession } from '@/lib/acp/format-session'
import { getStripe } from '@/lib/stripe/server'
import type { CheckoutLineItem } from '@/lib/acp/types'

interface CompleteBody {
  payment_data?: { instrument?: { credential?: { type?: string; token?: string } } }
  buyer?: AcpBuyer
}

/**
 * POST /api/acp/checkout_sessions/{id}/complete
 *
 * Charges the buyer's Shared Payment Token and, on success, hands off to the
 * EXISTING Stripe webhook to create the real FareHarbor booking — this
 * route does not create bookings itself. That's deliberate: the webhook is
 * this codebase's one hardened, exactly-once booking finalizer (unique
 * constraint on stripe_payment_intent_id), and duplicating that logic here
 * would risk exactly the double-booking bug class it was built to prevent.
 *
 * Returns `complete_in_progress` immediately after a successful charge —
 * the agent polls GET .../checkout_sessions/{id} until the webhook (which
 * runs asynchronously, typically within a second or two) flips it to
 * `completed`. This is a real ACP status precisely for this shape of flow.
 *
 * Scope limit: if Stripe requires additional authentication (3D Secure/SCA
 * — possible even with a Shared Payment Token, since this merchant is in
 * the EU), that's reported as `authentication_required` and rejected
 * outright. Handling an SCA challenge would need the agent to hand the
 * buyer back to a browser mid-flow, which isn't built here.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = enforceRateLimit(request, 'acp-checkout-complete', 20, 60_000)
  if (limited) return limited

  const { id } = await params
  const session = await getSession(id)
  if (!session) return NextResponse.json({ type: 'invalid_request_error', message: 'No such checkout session' }, { status: 404 })

  if (session.status === 'completed' || session.status === 'complete_in_progress') {
    return NextResponse.json(formatSession(session))
  }
  if (session.status === 'canceled') {
    return NextResponse.json({ type: 'invalid_request_error', message: 'This session was canceled' }, { status: 409 })
  }
  if (isExpired(session)) {
    return NextResponse.json({ type: 'invalid_request_error', message: 'This session has expired' }, { status: 409 })
  }

  let body: CompleteBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ type: 'invalid_request_error', message: 'Invalid JSON body' }, { status: 400 })
  }

  const credential = body.payment_data?.instrument?.credential
  if (credential?.type !== 'spt' || !credential.token) {
    return NextResponse.json(
      { type: 'invalid_request_error', message: 'payment_data.instrument.credential must be a Shared Payment Token (type "spt")' },
      { status: 400 }
    )
  }

  // Final live re-check right before charging — the session's stored line
  // items are a snapshot from create/update; never charge against a stale one.
  const storedLineItems = (session.line_items as CheckoutLineItem[] | null) ?? []
  const result = await resolveCheckoutItems(storedLineItems.map((li) => ({ id: li.id, quantity: li.quantity })))

  if (!result.ok) {
    await updateSession(id, { status: 'not_ready_for_payment', messages: result.messages })
    return NextResponse.json(
      { type: 'invalid_request_error', code: result.messages[0]?.code, message: result.messages[0]?.content },
      { status: 409 }
    )
  }

  const buyer: AcpBuyer = { ...(session.buyer as AcpBuyer | null), ...(body.buyer ?? {}) }
  if (!buyer.email) {
    return NextResponse.json({ type: 'invalid_request_error', message: 'buyer.email is required to complete checkout' }, { status: 400 })
  }

  let quote
  try {
    quote = await calculateQuote({
      listingId: result.checkout.listingId,
      availPk: result.checkout.availPk,
      customerTypeRatePk: result.checkout.primaryCustomerTypeRatePk,
      guestCount: result.checkout.guestCount,
      category: result.checkout.category,
      customerTypeRates: result.checkout.isPrivate ? undefined : result.checkout.customerTypeRates,
    })
  } catch (err) {
    console.error('[acp] quote calculation failed at completion:', err)
    return NextResponse.json({ type: 'invalid_request_error', message: 'Could not verify pricing — please try again' }, { status: 409 })
  }

  const metadata = buildPaymentIntentMetadata(id, result.checkout, quote, buyer)
  const stripe = getStripe()

  let paymentIntent: Stripe.PaymentIntent
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: quote.totalCents,
        currency: 'eur',
        // Undocumented-in-SDK-types field as of stripe@22 — confirmed from
        // Stripe's own agentic-commerce docs example (curl form:
        // payment_method_data[shared_payment_granted_token]=spt_...).
        payment_method_data: { shared_payment_granted_token: credential.token } as unknown as Stripe.PaymentIntentCreateParams.PaymentMethodData,
        confirm: true,
        metadata,
      },
      { idempotencyKey: `acp-complete-${id}` }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment failed'
    console.error('[acp] PaymentIntent creation/confirmation failed:', err)
    await updateSession(id, { messages: [{ type: 'error', content: message }] })
    return NextResponse.json({ type: 'processing_error', message }, { status: 402 })
  }

  if (paymentIntent.status !== 'succeeded') {
    // e.g. requires_action (3D Secure) — not handled by this integration; see doc comment above.
    await updateSession(id, {
      payment_intent_id: paymentIntent.id,
      status: 'authentication_required',
      messages: [{ type: 'error', content: 'This payment requires additional authentication, which is not supported here.' }],
    })
    return NextResponse.json(
      { type: 'invalid_request_error', message: 'Payment requires additional authentication and could not be completed automatically' },
      { status: 402 }
    )
  }

  const updated = await updateSession(id, { payment_intent_id: paymentIntent.id, status: 'complete_in_progress' })
  return NextResponse.json(formatSession(updated!))
}
