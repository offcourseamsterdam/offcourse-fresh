import { describe, it, expect } from 'vitest'
import { shouldAttachVatInvoicePdf } from './invoice-eligibility'
import { BOOKING_SOURCES } from '@/lib/constants'

describe('shouldAttachVatInvoicePdf', () => {
  it('attaches for a paid website booking', () => {
    expect(shouldAttachVatInvoicePdf({ bookingSource: 'website', baseAmountCents: 31500, amountCents: 34620 })).toBe(true)
  })

  // Regression (2026-09-15): a €0 complimentary tour got a VAT invoice PDF with
  // the €315 cruise value on it, sent to a real guest.
  it('never attaches for a complimentary booking, even when a cruise value is stored', () => {
    expect(shouldAttachVatInvoicePdf({ bookingSource: 'complimentary', baseAmountCents: 31500, amountCents: 0 })).toBe(false)
    expect(shouldAttachVatInvoicePdf({ bookingSource: 'complimentary', baseAmountCents: 31500, amountCents: 31500 })).toBe(false)
  })

  it('never attaches for any non-website source', () => {
    for (const { value } of BOOKING_SOURCES) {
      if (value === 'website') continue
      expect(shouldAttachVatInvoicePdf({ bookingSource: value, baseAmountCents: 31500, amountCents: 31500 })).toBe(false)
    }
  })

  it('does not attach when nothing was charged or there is no base amount', () => {
    expect(shouldAttachVatInvoicePdf({ bookingSource: 'website', baseAmountCents: 31500, amountCents: 0 })).toBe(false)
    expect(shouldAttachVatInvoicePdf({ bookingSource: 'website', baseAmountCents: 0, amountCents: 5000 })).toBe(false)
    expect(shouldAttachVatInvoicePdf({ bookingSource: 'website', baseAmountCents: null, amountCents: 5000 })).toBe(false)
  })
})
