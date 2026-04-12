import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { getStripe } from '@/lib/stripe/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { calculateExtras } from '@/lib/extras/calculate'
import { DEFAULT_DURATION_MINUTES } from '@/lib/constants'

/**
 * POST /api/admin/booking-flow/create-intent
 *
 * Creates a Stripe PaymentIntent. Total is calculated server-side from
 * baseAmountCents + selected extras — client-provided amounts are never trusted.
 *
 * Body: {
 *   baseAmountCents: number      — cruise price in cents (from FareHarbor rate)
 *   listingId: string            — used for metadata
 *   listingTitle: string         — human label for Stripe dashboard
 *   availPk: number              — FareHarbor availability PK
 *   customerTypeRatePk: number
 *   guestCount: number           — actual guests on board (used for city tax)
 *   category: string             — 'private' | 'shared'
 *   date: string                 — YYYY-MM-DD
 *   contact: { name, email, phone }
 *   selectedExtraIds?: string[]  — IDs of extras the customer selected
 * }
 *
 * Returns: { ok, clientSecret, calculation }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      baseAmountCents, listingId, listingTitle,
      availPk, customerTypeRatePk, guestCount,
      category, date, contact,
      selectedExtraIds = [],
      durationMinutes = DEFAULT_DURATION_MINUTES,
    } = body

    if (baseAmountCents == null || !availPk || !customerTypeRatePk || !contact?.name || !contact?.email) {
      return apiError('Missing required fields: baseAmountCents, availPk, customerTypeRatePk, contact.name, contact.email', 400)
    }

    if (!Number.isFinite(Number(guestCount)) || Number(guestCount) < 1) {
      return apiError('guestCount must be a positive integer', 400)
    }

    // Verify base price server-side from FareHarbor — never trust client-provided amounts
    const fh = getFareHarborClient()
    const availDetail = await fh.getAvailabilityDetail(Number(availPk))
    const matchingRate = availDetail.customer_type_rates?.find(
      (r: { pk: number }) => r.pk === Number(customerTypeRatePk)
    )
    const verifiedBaseCents = matchingRate?.customer_prototype?.total ?? Number(baseAmountCents)
    const isPrivate = category === 'private'
    const serverBaseAmount = isPrivate ? verifiedBaseCents : verifiedBaseCents * Number(guestCount)

    // Fetch selected extras from DB
    const supabase = await createServiceClient()
    const { data: extras } = selectedExtraIds.length > 0
      ? await supabase.from('extras').select('*').in('id', selectedExtraIds).eq('is_active', true)
      : { data: [] }

    const calc = calculateExtras(serverBaseAmount, Number(guestCount), (extras ?? []) as any, Number(durationMinutes))

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
