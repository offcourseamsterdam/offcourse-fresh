import type Stripe from 'stripe'

/**
 * Human-readable label for the payment method a customer actually used.
 *
 * `pi.payment_method_types` is the list of methods we OFFERED on the intent
 * (always `card/ideal/link` here), so it can NOT tell card from iDEAL. The
 * method actually used lives on the charge — this looks it up best-effort and
 * returns `'online payment'` if anything fails (never throws; never blocks a
 * booking on a cosmetic label).
 */
const PRETTY: Record<string, string> = {
  card: 'card', ideal: 'iDEAL', bancontact: 'Bancontact', link: 'Link',
  sepa_debit: 'SEPA', sofort: 'Sofort', giropay: 'giropay', paypal: 'PayPal',
}

export async function resolvePaymentMethodLabel(
  stripe: Stripe,
  pi: Stripe.PaymentIntent,
): Promise<string> {
  try {
    const chargeId = typeof pi.latest_charge === 'string'
      ? pi.latest_charge
      : pi.latest_charge?.id ?? null
    if (!chargeId) return 'online payment'
    const charge = await stripe.charges.retrieve(chargeId)
    const type = charge.payment_method_details?.type ?? null
    if (!type) return 'online payment'
    // Wallets (Apple/Google Pay) surface as card + a wallet sub-type.
    const wallet = charge.payment_method_details?.card?.wallet?.type
    if (type === 'card' && wallet === 'apple_pay') return 'Apple Pay'
    if (type === 'card' && wallet === 'google_pay') return 'Google Pay'
    return PRETTY[type] ?? type
  } catch {
    return 'online payment'
  }
}
