import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import Stripe from 'stripe'
import { createServiceClient } from '@/lib/supabase/server'
import { calculateExtras } from '@/lib/extras/calculate'

// Lazy-initialize to avoid build-time failures when STRIPE_SECRET_KEY is not set
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(process.env.STRIPE_SECRET_KEY)
}

/**
 * POST /api/booking-flow/create-intent
 *
 * Public endpoint for creating a Stripe PaymentIntent.
 * Total is calculated server-side — client amounts are never trusted.
 * City tax is already included as a required extra in the extras calculation.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      baseAmountCents, listingId, listingTitle,
      availPk, customerTypeRatePk, guestCount,
      category, date, contact,
      selectedExtraIds = [],
    } = body

    if (baseAmountCents == null || !availPk || !customerTypeRatePk || !contact?.name || !contact?.email) {
      return apiError('Missing required fields', 400)
    }

    if (!Number.isFinite(Number(guestCount)) || Number(guestCount) < 1) {
      return apiError('guestCount must be a positive integer', 400)
    }

    // Fetch selected extras from DB — never trust client-provided amounts
    const supabase = await createServiceClient()
    const { data: extras } = selectedExtraIds.length > 0
      ? await supabase.from('extras').select('*').in('id', selectedExtraIds).eq('is_active', true)
      : { data: [] }

    const calc = calculateExtras(Number(baseAmountCents), Number(guestCount), (extras ?? []) as any)

    // City tax is already included as a required extra in calc.grand_total_cents
    if (calc.grand_total_cents < 50) {
      return apiError('Amount must be at least €0.50', 400)
    }

    const extrasSummary = calc.line_items
      .map(li => `${li.name} (€${(li.amount_cents / 100).toFixed(2)})`)
      .join(', ')

    const paymentIntent = await getStripe().paymentIntents.create({
      amount: calc.grand_total_cents,
      currency: 'eur',
      payment_method_types: ['card', 'ideal', 'link'],
      metadata: {
        listing_title: String(listingTitle ?? ''),
        listing_id: String(listingId ?? ''),
        avail_pk: String(availPk),
        customer_type_rate_pk: String(customerTypeRatePk),
        guest_count: String(guestCount),
        category: String(category ?? ''),
        date: String(date ?? ''),
        guest_name: String(contact?.name ?? ''),
        guest_email: String(contact?.email ?? ''),
        guest_phone: String(contact?.phone ?? ''),
        extras_summary: extrasSummary,
      },
    })

    return apiOk({ clientSecret: paymentIntent.client_secret, calculation: calc })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
