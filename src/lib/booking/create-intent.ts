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
}

interface CreateIntentResult {
  clientSecret: string
  calculation: ExtrasCalculation
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
  } = input

  // Verify base price server-side from FareHarbor
  const fh = getFareHarborClient()
  const availDetail = await fh.getAvailabilityDetail(availPk)
  const matchingRate = availDetail.customer_type_rates?.find(
    (r: { pk: number }) => r.pk === customerTypeRatePk
  )
  const verifiedBaseCents = matchingRate?.customer_prototype?.total ?? input.baseAmountCents
  const isPrivate = category === 'private'
  const serverBaseAmount = isPrivate ? verifiedBaseCents : verifiedBaseCents * guestCount

  // Fetch selected extras from DB
  const supabase = await createServiceClient()
  const { data: extras } = selectedExtraIds.length > 0
    ? await supabase.from('extras').select('*').in('id', selectedExtraIds).eq('is_active', true)
    : { data: [] }

  const calc = calculateExtras(serverBaseAmount, guestCount, (extras ?? []) as any, durationMinutes)

  if (calc.grand_total_cents < 50) {
    throw new Error('Amount must be at least €0.50')
  }

  const extrasSummary = calc.line_items
    .map(li => `${li.name} (${fmtEuros(li.amount_cents)})`)
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

  return { clientSecret: paymentIntent.client_secret!, calculation: calc }
}
