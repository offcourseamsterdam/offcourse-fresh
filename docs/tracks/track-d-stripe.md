# Track D: Stripe Native Checkout + Payments

**Phase:** 1 (MVP)
**Dependencies:** Track C (booking flow provides booking data to checkout)
**Parallel with:** None — this is the final Phase 1 track

## Objective
Implement Stripe Payment Intents (native checkout, NOT Checkout Sessions) with full Google Ads conversion tracking. Handle both cruise bookings and merch purchases.

## Steps

### D1. Stripe Server Client (`src/lib/stripe/client.ts`)
```typescript
import Stripe from 'stripe';
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

### D2. Create Payment Intent Route (`src/app/api/stripe/create-payment-intent/route.ts`)

**For cruise bookings:**
```
POST /api/stripe/create-payment-intent
Body: { listing_id, availability_pk, customer_type_rate_pk, guest_count, contact }
```

Flow:
1. Validate booking with FareHarbor (`/bookings/validate/`)
2. Create PaymentIntent with metadata:
   - `booking_type: 'cruise'`
   - `listing_id`, `availability_pk`, `customer_type_rate_pk`
   - `boat_name`, `duration_minutes`, `guest_count`
   - `customer_name`, `customer_email`
3. Create pending booking in Supabase `bookings` table
4. Return `clientSecret` + `booking_id` to client

**For merch orders:**
```
POST /api/stripe/create-payment-intent
Body: { items: [{product_id, size, quantity}], contact, shipping_address }
```

Flow:
1. Calculate total from `merch_products` prices
2. Verify stock availability
3. Create PaymentIntent with metadata
4. Create pending order in `merch_orders` table
5. Return `clientSecret` + `order_id`

**Important:** Use idempotency keys to prevent duplicate charges on retries.

### D3. Checkout Page (`src/app/[locale]/book/checkout/page.tsx`)

Client Component with Stripe Elements:
```typescript
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
```

- Load Stripe with publishable key
- Render PaymentElement (handles all payment methods: card, iDEAL, Bancontact, etc.)
- Show booking/order summary alongside payment form
- Submit → `stripe.confirmPayment()` → redirect to confirmation page
- Handle errors gracefully (card declined, network issues)

### D4. Confirmation Page (`src/app/[locale]/book/confirmation/page.tsx`)

```
/book/confirmation?payment_intent={id}&payment_intent_client_secret={secret}
```

1. Retrieve PaymentIntent status via server action
2. If `succeeded` → show success with booking details
3. If `processing` → show "Payment is processing" message
4. If `requires_payment_method` → show error, link back to checkout

**Google Ads conversion tracking (CRITICAL):**
```typescript
// Fire on successful payment confirmation
window.dataLayer?.push({
  event: 'purchase',
  ecommerce: {
    transaction_id: paymentIntent.id,
    value: amount / 100,
    currency: 'EUR',
    items: [{
      item_name: `${boatName} - ${duration}min`,
      item_category: cruiseType,
      price: amount / 100,
      quantity: 1,
    }],
  },
});
```

This is the whole reason we use Payment Intents instead of Checkout Sessions — the `purchase` event fires on our domain, not stripe.com.

### D5. Stripe Webhook Handler (`src/app/api/stripe/webhook/route.ts`)

```typescript
// Verify webhook signature
const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
```

Handle events:
- `payment_intent.succeeded` →
  1. Confirm FareHarbor booking (POST to `/bookings/` endpoint)
  2. Update `bookings` table: payment_status = 'paid'
  3. Decrement merch stock if applicable
  4. Trigger notification events (for Slack in Phase 3)
- `payment_intent.payment_failed` →
  1. Update booking status to 'failed'
  2. Do NOT create FareHarbor booking
- `charge.refunded` →
  1. Cancel FareHarbor booking
  2. Update booking status to 'refunded'

### D6. Merch Checkout Flow
- Cart context/state (items, quantities, sizes)
- Cart page with item list, quantity adjusters, total
- Reuse the same checkout page with merch-specific summary
- Shipping address form (for merch only, not cruises)

### D7. GTM / Google Ads Setup
- Add Google Tag Manager script to root layout
- Configure dataLayer events:
  - `page_view` on route change
  - `begin_checkout` when entering checkout
  - `purchase` on confirmation (see D4)
  - `add_to_cart` for merch

## Verification Checklist
- [ ] PaymentIntent creates successfully (test mode)
- [ ] Stripe Elements renders payment form
- [ ] Payment completes end-to-end in test mode
- [ ] Confirmation page shows correct booking details
- [ ] `purchase` dataLayer event fires on confirmation
- [ ] Webhook receives `payment_intent.succeeded` and confirms FH booking
- [ ] Failed payment does NOT create FH booking
- [ ] Merch checkout works with stock validation
- [ ] Idempotency prevents duplicate PaymentIntents
- [ ] No Stripe keys exposed in client-side code
- [ ] Error states handled (card declined, network error, expired session)
