/**
 * Stripe key resolver — picks live or test keys based on STRIPE_MODE.
 *
 * Live keys stay under their original names (STRIPE_SECRET_KEY, etc.) so
 * existing Vercel env config needs no changes.
 *
 * To switch to test mode locally, add to .env.local:
 *   STRIPE_MODE=test
 *   NEXT_PUBLIC_STRIPE_MODE=test
 *   STRIPE_SECRET_KEY_TEST=sk_test_...
 *   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST=pk_test_...
 *   STRIPE_WEBHOOK_SECRET_TEST=whsec_...   # from: stripe listen --forward-to localhost:3000/api/webhooks/stripe
 */

// Both vars checked so the resolver works in server and client contexts:
//   STRIPE_MODE — server-side only (never baked into the client bundle)
//   NEXT_PUBLIC_STRIPE_MODE — baked in at build time → readable on the client
export const stripeIsTestMode =
  process.env.STRIPE_MODE === 'test' || process.env.NEXT_PUBLIC_STRIPE_MODE === 'test'

/** Server-only: Stripe secret key. */
export const stripeSecretKey = stripeIsTestMode
  ? (process.env.STRIPE_SECRET_KEY_TEST ?? '')
  : (process.env.STRIPE_SECRET_KEY ?? '')

/** Server-only: Stripe webhook signing secret. */
export const stripeWebhookSecret = stripeIsTestMode
  ? (process.env.STRIPE_WEBHOOK_SECRET_TEST ?? '')
  : (process.env.STRIPE_WEBHOOK_SECRET ?? '')

/**
 * Client-safe: Stripe publishable key.
 * Both NEXT_PUBLIC_ variants are baked into the bundle; the mode flag picks
 * between them at runtime without an extra network round-trip.
 */
export const stripePublishableKey = stripeIsTestMode
  ? (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST ?? '')
  : (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '')
