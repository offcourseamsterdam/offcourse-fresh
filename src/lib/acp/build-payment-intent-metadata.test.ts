import { describe, it, expect } from 'vitest'
import { buildPaymentIntentMetadata } from './build-payment-intent-metadata'
import type { ResolvedCheckout } from './resolve-checkout-items'
import type { QuoteResult } from '@/lib/booking/calculate-quote'

const CHECKOUT: ResolvedCheckout = {
  slug: 'book-curacao-boat-tour-amsterdam',
  listingId: 'listing-1',
  listingTitle: 'Book the Curaçao',
  date: '2026-07-04',
  time: '14:00',
  availPk: 555,
  startAt: '2026-07-04T14:00:00+02:00',
  endAt: '2026-07-04T15:30:00+02:00',
  category: 'private',
  isPrivate: true,
  guestCount: 6,
  lineItems: [],
  subtotalCents: 31000,
  cityTaxCents: 1560,
  totalCents: 32560,
  customerTypeRates: [{ pk: 333, count: 6 }],
  primaryCustomerTypeRatePk: 333,
}

const QUOTE: QuoteResult = {
  basePriceCents: 31000,
  serverBaseAmount: 31000,
  extrasCalculation: {
    base_vat_amount_cents: 2400,
    extras_amount_cents: 0,
    extras_vat_amount_cents: 0,
    total_vat_amount_cents: 2400,
    grand_total_cents: 31000,
    line_items: [],
  } as unknown as QuoteResult['extrasCalculation'],
  cityTaxCents: 1560,
  discountAmountCents: 0,
  totalCents: 32560,
  durationMinutes: 90,
  customerTypeName: 'Diana - 1.5 Hours',
}

describe('buildPaymentIntentMetadata', () => {
  it('carries every field the Stripe webhook reads, all as strings', () => {
    const metadata = buildPaymentIntentMetadata('cs_abc', CHECKOUT, QUOTE, { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' })

    expect(metadata.acp_checkout_session_id).toBe('cs_abc')
    expect(metadata.avail_pk).toBe('555')
    expect(metadata.customer_type_rate_pk).toBe('333')
    expect(metadata.guest_count).toBe('6')
    expect(metadata.category).toBe('private')
    expect(metadata.date).toBe('2026-07-04')
    expect(metadata.start_at).toBe('2026-07-04T14:00:00+02:00')
    expect(metadata.guest_name).toBe('Ada Lovelace')
    expect(metadata.guest_email).toBe('ada@example.com')
    expect(metadata.city_tax_cents).toBe('1560')
    expect(metadata.server_base_amount_cents).toBe('31000')
  })

  it('omits customer_type_rates when there is only one rate (single-item checkout)', () => {
    const metadata = buildPaymentIntentMetadata('cs_abc', CHECKOUT, QUOTE, {})
    expect(metadata.customer_type_rates).toBeUndefined()
  })

  it('includes customer_type_rates as JSON when multiple rates are purchased (mixed shared tickets)', () => {
    const mixed: ResolvedCheckout = { ...CHECKOUT, customerTypeRates: [{ pk: 111, count: 2 }, { pk: 222, count: 1 }] }
    const metadata = buildPaymentIntentMetadata('cs_abc', mixed, QUOTE, {})
    expect(JSON.parse(metadata.customer_type_rates)).toEqual([{ pk: 111, count: 2 }, { pk: 222, count: 1 }])
  })

  it('defaults missing buyer fields to empty strings rather than "undefined"', () => {
    const metadata = buildPaymentIntentMetadata('cs_abc', CHECKOUT, QUOTE, {})
    expect(metadata.guest_name).toBe('')
    expect(metadata.guest_email).toBe('')
    expect(metadata.guest_phone).toBe('')
  })
})
