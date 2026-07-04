import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Atomically allocates and persists a sequential VAT invoice number for the
 * booking identified by the given Stripe PaymentIntent id.
 *
 * Idempotent: if the booking already has a number (resend, or a concurrent
 * path won the race) the same number is returned — no new sequence value is
 * consumed.
 *
 * Format: OC-{year}-{5-digit-counter}, e.g. OC-2026-00042.
 *
 * Returns null on error so the caller can fall back to makeInvoiceNumber().
 * The DB-level guarantee (FOR UPDATE + nextval in a single RPC) means two
 * concurrent callers for the same PI cannot get two different numbers.
 */
export async function allocateInvoiceNumber(stripePaymentIntentId: string): Promise<string | null> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.rpc('allocate_invoice_number', {
      p_stripe_pi_id: stripePaymentIntentId,
    })
    if (error) {
      console.error('[allocateInvoiceNumber] RPC error:', error.message)
      return null
    }
    return typeof data === 'string' ? data : null
  } catch (err) {
    console.error('[allocateInvoiceNumber] unexpected error:', err)
    return null
  }
}
