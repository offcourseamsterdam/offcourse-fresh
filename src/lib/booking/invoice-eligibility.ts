import type { BookingSource } from '@/lib/constants'

/**
 * Our self-generated VAT invoice PDF (attached to the confirmation email) is only
 * for bookings the guest paid through our own Stripe checkout. Every other source
 * is free (complimentary), paid and invoiced on a platform (GYG, Withlocals, …),
 * or billed with a real Stripe Invoice (invoice_later) that Stripe emails itself.
 */
export function shouldAttachVatInvoicePdf(p: {
  bookingSource: BookingSource
  baseAmountCents?: number | null
  amountCents: number
}): boolean {
  return p.bookingSource === 'website' && (p.baseAmountCents ?? 0) > 0 && p.amountCents > 0
}
