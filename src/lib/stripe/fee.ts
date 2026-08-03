import type Stripe from 'stripe'

/**
 * Stripe's own processing fee for a payment intent's charge, in cents.
 *
 * The fee isn't on the PaymentIntent itself — it lives on the charge's
 * balance_transaction (the ledger entry for the actual bank transfer).
 * Best-effort — returns null if the charge or balance transaction can't be
 * resolved (never throws; never blocks a booking on this).
 */
export async function resolveStripeFeeCents(
  stripe: Stripe,
  pi: Stripe.PaymentIntent,
): Promise<number | null> {
  try {
    const chargeId = typeof pi.latest_charge === 'string'
      ? pi.latest_charge
      : pi.latest_charge?.id ?? null
    if (!chargeId) return null
    const charge = await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] })
    const bt = charge.balance_transaction
    if (!bt || typeof bt === 'string') return null
    return bt.fee
  } catch {
    return null
  }
}
