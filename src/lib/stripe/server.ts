import Stripe from 'stripe'
import { stripeSecretKey, stripeIsTestMode } from '@/lib/stripe/keys'

let _stripe: Stripe | null = null

/** Lazy Stripe singleton — key chosen by STRIPE_MODE (test vs live). */
export function getStripe(): Stripe {
  if (!_stripe) {
    if (!stripeSecretKey) throw new Error(
      stripeIsTestMode
        ? 'STRIPE_SECRET_KEY_TEST is not set — add it to .env.local'
        : 'STRIPE_SECRET_KEY is not set'
    )
    _stripe = new Stripe(stripeSecretKey)
    if (stripeIsTestMode) console.log('[stripe] 🟡 TEST MODE — no real charges')
  }
  return _stripe
}
