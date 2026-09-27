import { decodeItemId, type DecodedItemId } from './item-id'
import { getListingBySlug } from '@/lib/cruise/get-cruise-page-data'
import { getFilteredAvailabilityBySlug } from '@/lib/fareharbor/availability'
import { CITY_TAX_CENTS_PER_GUEST } from '@/lib/booking/constants'
import type { CheckoutItemInput, CheckoutLineItem, CheckoutMessage } from './types'

export interface ResolvedCheckout {
  slug: string
  listingId: string
  listingTitle: string
  date: string
  /** Human-display time (e.g. "11am") — for storage/display only, never matching logic. */
  time: string
  availPk: number
  startAt: string
  endAt: string
  category: string
  isPrivate: boolean
  guestCount: number
  lineItems: CheckoutLineItem[]
  /** Line items only, before city tax. */
  subtotalCents: number
  cityTaxCents: number
  /** subtotalCents + cityTaxCents — the amount actually charged (matches what calculateQuote independently re-derives at completion). */
  totalCents: number
  /** Matches calculateQuote's QuoteInput.customerTypeRates shape — one entry per rate purchased. */
  customerTypeRates: Array<{ pk: number; count: number }>
  /** The single rate pk to use as QuoteInput.customerTypeRatePk (the first/only rate for private). */
  primaryCustomerTypeRatePk: number
}

export type ResolveResult = { ok: true; checkout: ResolvedCheckout } | { ok: false; messages: CheckoutMessage[] }

function errorResult(content: string, code: string, param?: string): ResolveResult {
  return { ok: false, messages: [{ type: 'error', content, code, ...(param ? { param } : {}) }] }
}

/**
 * Resolves a raw ACP `items[]` array into a priced, availability-verified
 * checkout. Always re-checks live FareHarbor availability — never trusts
 * that an item id (which may have been minted from a search result minutes
 * earlier) is still bookable.
 *
 * Private vs. shared pricing (this is the one detail that's easy to get
 * backwards and would badly mis-charge a booking, per calculateQuote's own
 * comment: "for private, the rate IS the boat price — keep as-is"):
 *   - Shared: each item's `quantity` is a headcount for that ticket type
 *     (adult/child); price is per-person × quantity; guestCount = sum of
 *     quantities; multiple items (mixed ticket types) are allowed.
 *   - Private: exactly one item; its `quantity` IS the guest count riding
 *     along, but the price is the flat boat rate regardless of headcount.
 */
export async function resolveCheckoutItems(items: CheckoutItemInput[]): Promise<ResolveResult> {
  if (items.length === 0) return errorResult('At least one item is required', 'items_required')

  const decoded: Array<{ input: CheckoutItemInput; item: DecodedItemId }> = []
  for (const input of items) {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      return errorResult(`Invalid quantity for item "${input.id}"`, 'invalid_quantity', input.id)
    }
    const item = decodeItemId(input.id)
    if (!item) return errorResult(`Unrecognized item id "${input.id}"`, 'invalid_item', input.id)
    decoded.push({ input, item })
  }

  const [{ item: first }] = decoded
  const sameSelection = decoded.every(
    (d) => d.item.slug === first.slug && d.item.date === first.date && d.item.availPk === first.availPk
  )
  if (!sameSelection) {
    return errorResult('All items in one checkout must be for the same cruise, date, and time', 'mixed_selection')
  }

  const listing = await getListingBySlug(first.slug)
  if (!listing) return errorResult(`No cruise found for "${first.slug}"`, 'listing_not_found')

  const isPrivate = listing.category === 'private'
  if (isPrivate && decoded.length > 1) {
    return errorResult('A private charter checkout takes exactly one item (its quantity is the guest count)', 'mixed_selection')
  }

  // For availability filtering, guestCount is the real headcount either way —
  // for private that's decoded[0].input.quantity itself, not a sum.
  const guestCount = isPrivate ? decoded[0].input.quantity : decoded.reduce((sum, d) => sum + d.input.quantity, 0)

  const { slots, reasonCode } = await getFilteredAvailabilityBySlug(first.slug, first.date, guestCount)
  if (reasonCode === 'LISTING_NOT_FOUND') {
    return errorResult(`No cruise found for "${first.slug}"`, 'listing_not_found')
  }

  const slot = slots.find((s) => s.pk === first.availPk)
  if (!slot) {
    return errorResult(`No availability for ${first.slug} (availability ${first.availPk}) on ${first.date}`, 'not_available')
  }

  const lineItems: CheckoutLineItem[] = []
  const customerTypeRates: Array<{ pk: number; count: number }> = []
  let subtotalCents = 0

  // Private: FareHarbor's minimumParty/maximumParty on the rate itself is
  // structurally always 1/1 there (it bounds "how many of this line item",
  // i.e. always one boat) — it is NOT a guest-count bound. Guest count for a
  // private charter is validated against the listing's own max_guests
  // instead. Confirmed against live data: a real Diana rate reports
  // minimumParty=1, maximumParty=1 regardless of the boat's true capacity.
  if (isPrivate) {
    const guestQuantity = decoded[0].input.quantity
    if (guestQuantity < 1 || (listing.max_guests != null && guestQuantity > listing.max_guests)) {
      return errorResult(
        `This boat holds up to ${listing.max_guests ?? 'a limited number of'} guests`,
        'party_size',
        decoded[0].input.id
      )
    }
  }

  for (const { input, item } of decoded) {
    const rate = slot.customerTypes.find((ct) => ct.pk === item.customerTypeRatePk)
    if (!rate) return errorResult(`Rate ${item.customerTypeRatePk} is not available for this slot`, 'rate_not_available', input.id)

    if (!isPrivate && (input.quantity < rate.minimumParty || input.quantity > rate.maximumParty)) {
      return errorResult(
        `${rate.name} requires between ${rate.minimumParty} and ${rate.maximumParty} guests`,
        'party_size',
        input.id
      )
    }

    const lineTotal = isPrivate ? rate.priceCents : rate.priceCents * input.quantity
    lineItems.push({
      id: input.id,
      item: { id: input.id, name: rate.name, unit_amount: rate.priceCents },
      quantity: input.quantity,
      unit_amount: rate.priceCents,
      totals: [{ type: 'subtotal', display_text: 'Subtotal', amount: lineTotal }],
    })
    customerTypeRates.push({ pk: item.customerTypeRatePk, count: input.quantity })
    subtotalCents += lineTotal
  }

  // Amsterdam city tax — not in FareHarbor's price, added here so the total
  // shown at checkout creation matches what calculateQuote will charge at
  // completion (see calculate-quote.ts step 4; same constant, same formula).
  const cityTaxCents = guestCount * CITY_TAX_CENTS_PER_GUEST

  return {
    ok: true,
    checkout: {
      slug: first.slug,
      listingId: listing.id,
      listingTitle: listing.title,
      date: first.date,
      time: slot.startTime,
      availPk: slot.pk,
      startAt: slot.startAt,
      endAt: slot.endAt,
      category: listing.category ?? 'shared',
      isPrivate,
      guestCount,
      lineItems,
      subtotalCents,
      cityTaxCents,
      totalCents: subtotalCents + cityTaxCents,
      customerTypeRates,
      primaryCustomerTypeRatePk: customerTypeRates[0].pk,
    },
  }
}
