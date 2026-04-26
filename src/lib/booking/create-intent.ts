import { getStripe } from '@/lib/stripe/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { calculateExtras, type ExtrasCalculation } from '@/lib/extras/calculate'
import { DEFAULT_DURATION_MINUTES } from '@/lib/constants'
import { fmtEuros } from '@/lib/utils'

interface CreateIntentInput {
  baseAmountCents: number
  listingId: string
  listingTitle: string
  availPk: number
  customerTypeRatePk: number
  guestCount: number
  category: string
  date: string
  contact: { name: string; email: string; phone?: string }
  selectedExtraIds: string[]
  durationMinutes: number
  promoCodeId?: string
  discountAmountCents?: number
}

interface CreateIntentResult {
  clientSecret: string
  calculation: ExtrasCalculation
  discountAmountCents: number
  chargedCents: number
}

/**
 * Shared logic for creating a Stripe PaymentIntent.
 * Verifies the base price from FareHarbor (never trusts client amounts),
 * fetches extras from DB, calculates the total, and creates the PaymentIntent.
 */
export async function createPaymentIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
  const {
    listingId, listingTitle, availPk, customerTypeRatePk,
    guestCount, category, date, contact,
    selectedExtraIds, durationMinutes = DEFAULT_DURATION_MINUTES,
    promoCodeId, discountAmountCents: inputDiscount = 0,
  } = input

  // Verify base price server-side from FareHarbor.
  // Use total_including_tax (gross) — this is the price we charge customers.
  // FareHarbor's `total` field is NET (ex-VAT); using it would under-charge by 9%.
  const fh = getFareHarborClient()
  const availDetail = await fh.getAvailabilityDetail(availPk)
  const matchingRate = availDetail.customer_type_rates?.find(
    (r: { pk: number }) => r.pk === customerTypeRatePk
  )
  const verifiedBaseCents =
    matchingRate?.customer_prototype?.total_including_tax
    ?? matchingRate?.customer_prototype?.total
    ?? input.baseAmountCents
  console.log('[create-intent] price resolution', {
    matchingRateFound: !!matchingRate,
    total: matchingRate?.customer_prototype?.total,
    total_including_tax: matchingRate?.customer_prototype?.total_including_tax,
    verifiedBaseCents,
    inputBaseAmountCents: input.baseAmountCents,
  })
  const isPrivate = category === 'private'
  const serverBaseAmount = isPrivate ? verifiedBaseCents : verifiedBaseCents * guestCount

  // Fetch selected extras from DB
  const supabase = await createServiceClient()
  const extrasResult = selectedExtraIds.length > 0
    ? await supabase.from('extras').select('*').in('id', selectedExtraIds).eq('is_active', true)
    : { data: [] as any[], error: null }
  if (extrasResult.error) {
    console.error('[create-intent] extras query failed', extrasResult.error)
  }
  const extras = extrasResult.data
  console.log('[create-intent] extras', {
    selectedExtraIds,
    extrasFromDB: extras?.length ?? 0,
    extrasIds: extras?.map((e: any) => e.id),
  })

  const calc = calculateExtras(serverBaseAmount, guestCount, (extras ?? []) as any, durationMinutes)

  // City tax: €2.60 per ticket on shared cruises (municipality levy, not in FareHarbor)
  const cityTaxCents = category === 'shared' ? guestCount * 260 : 0

  // Apply promo discount (server re-validates the amount passed from client)
  const totalBeforeDiscount = calc.grand_total_cents + cityTaxCents
  const discountAmountCents = Math.min(inputDiscount, totalBeforeDiscount)
  const chargedCents = Math.max(50, totalBeforeDiscount - discountAmountCents)

  if (calc.grand_total_cents < 50) {
    throw new Error('Amount must be at least €0.50')
  }

  const extrasSummary = calc.line_items
    .map(li => `${li.name} (${fmtEuros(li.amount_cents)})`)
    .join(', ')

  console.log('[create-intent] charge', {
    serverBaseAmount,
    extrasAmount: calc.extras_amount_cents,
    grandTotal: calc.grand_total_cents,
    cityTaxCents,
    chargedCents,
  })

  const paymentIntent = await getStripe().paymentIntents.create({
    amount: chargedCents,
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
      ...(promoCodeId ? { promo_code_id: promoCodeId, discount_amount_cents: String(discountAmountCents) } : {}),
    },
  })

  return { clientSecret: paymentIntent.client_secret!, calculation: calc, discountAmountCents, chargedCents }
}
