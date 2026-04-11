import Stripe from 'stripe'

let _stripe: Stripe | null = null

/** Lazy Stripe singleton — avoids build-time failures when STRIPE_SECRET_KEY is not set */
export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured')
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  }
  return _stripe
}
