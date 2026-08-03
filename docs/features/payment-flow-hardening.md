# Payment Flow Hardening

## What was built

A set of fixes closing the gaps that caused real production incidents: customers
seeing "booking not found" after paying with iDEAL, and paid bookings silently
failing when FareHarbor rejected them. The theme: **a paid customer must always
end up with either a confirmed booking or their money back — automatically, with
ops alerted either way.**

The fixes, in order of impact:

1. **Recover response-shape bug (the root cause of the iDEAL incidents).**
   `/api/booking-flow/recover` returns `{ ok, data: { listingSlug } }` (the
   standard `apiOk` envelope), but `CheckoutFlow` read `result.listingSlug` from
   the top level — always `undefined`. Every successful browser-side iDEAL
   recovery was treated as a failure: the customer saw a scary error message and
   never reached the confirmation page, even though their booking existed.

2. **Confirmation page polls instead of failing.** With iDEAL, the customer
   often lands on `/book/{slug}/confirmation` seconds before the Stripe webhook
   has written the booking row. The page now renders a "Confirming your
   booking…" state that polls `/api/booking-flow/confirmation-status` every
   2.5s (up to ~60s) and refreshes itself once the booking appears.

3. **Auto-refund when payment succeeds but FareHarbor fails.** Previously the
   webhook only posted a Slack alert and the customer's money stayed charged
   until a human intervened. Now the webhook waits 8 seconds (so a racing
   browser-side flow can finish), re-checks for a booking, and if there is
   truly none: issues a Stripe refund automatically and alerts Slack with the
   refund outcome.

4. **Duplicate-booking race cleanup.** The browser recovery and the webhook can
   both create a FareHarbor booking for the same payment before either writes
   to the database. The DB's unique constraint on `stripe_payment_intent_id`
   already blocked the duplicate *row* — now the loser also **cancels its
   duplicate FareHarbor booking** so the boat isn't blocked twice.

5. **Atomic quote claim.** `createPaymentIntent` used to read `consumed_at` and
   write it later — two separate steps, so a double-tap on Pay could create two
   PaymentIntents. The claim is now one conditional
   `UPDATE … WHERE consumed_at IS NULL`; only one request can win. Failures
   after the claim (Stripe outage, price drift) release it so a retry works.

6. **`processing` status handled end-to-end.** iDEAL banks report success to
   the browser before Stripe settles the payment. The recovery path now returns
   a distinct `processing` outcome (instead of an error), and the browser parks
   the customer on the polling confirmation page until the webhook completes
   the booking.

7. **Ops visibility + UX polish.** Browser-side recovery failures now alert
   Slack (previously console-only); recovered bookings post the normal "new
   booking" Slack message; the checkout shows a blocking "Finalising your
   payment…" screen during iDEAL recovery so customers can't pay twice; an
   explicit `"0"` in VAT metadata is no longer treated as "missing"
   (`parseMetaCents`).

## Key files

| File | Change |
|------|--------|
| `src/components/checkout/CheckoutFlow.tsx` | Response-shape fix, `recovering` blocking screen, `redirect_status=processing` handling |
| `src/lib/booking/recover-from-pi.ts` | `processing` outcome, refund guard, duplicate-insert FH cancel, Slack on success, `parseMetaCents` |
| `src/app/api/booking-flow/recover/route.ts` | `processing` pass-through, Slack alert on failure |
| `src/app/api/webhooks/stripe/route.ts` | `refundFailedBooking` (recheck + auto-refund), duplicate-insert FH cancel, `maxDuration = 60` |
| `src/lib/booking/create-intent.ts` | Atomic quote claim + release-on-failure |
| `src/app/api/booking-flow/confirmation-status/route.ts` | **New** — polled `{ found }` endpoint, no booking details exposed |
| `src/components/checkout/ConfirmationPending.tsx` | **New** — polling client component with timeout fallback |
| `src/app/[locale]/(public)/book/[slug]/confirmation/page.tsx` | Pending state wiring, `.maybeSingle()`, pending-aware header |

Tests: `src/app/api/webhooks/stripe/route.test.ts` (4 new),
`src/lib/booking/recover-from-pi.test.ts` (new file, 8 tests),
`src/lib/booking/create-intent.test.ts` (new file, 6 tests).

## Architecture decisions

**Why wait 8 seconds before refunding?** Three actors can complete a booking
(browser `/book`, browser `/recover`, Stripe webhook). When the webhook's
FareHarbor validation fails, the most common reason is that *the customer's own
booking* just consumed the slot via another actor. Refunding instantly would
hand money back to someone with a valid booking. The recheck-after-delay makes
"refund" mean "nobody booked anything for this payment, anywhere."
`maxDuration = 60` on the webhook route keeps Vercel from killing the function
mid-wait.

**Why does the loser cancel its FareHarbor booking instead of preventing the
race?** Truly preventing it would need a distributed lock across serverless
invocations. The DB unique constraint already arbitrates who wins; detecting
the `23505` unique violation and cancelling the just-created FH booking is a
compensating action — simpler, and it converges to the correct state.

**Why polling instead of pushing?** The confirmation page only needs to bridge
a window of seconds between redirect and webhook. A 2.5s poll against an
indexed single-row lookup is trivially cheap and needs no realtime
infrastructure. The endpoint returns only `{ found: boolean }` so a guessed
PaymentIntent id can't leak booking details.

**Why is the quote claim released on failure?** Without release, a transient
Stripe error would permanently lock the quote ("already used") and force the
customer to rebuild their booking. The release is guarded by
`consumed_intent_id IS NULL` so a quote that actually produced a PaymentIntent
can never be un-claimed.

## How it works (iDEAL flow, after this change)

1. Customer pays at their bank, returns with `redirect_status=succeeded` (or
   `processing`).
2. CheckoutFlow shows the blocking "Finalising your payment…" screen and calls
   `/recover` (or `/book` when sessionStorage survived).
3. `/recover` outcomes: booking created/found → redirect to confirmation;
   payment still `processing` → redirect to confirmation anyway (poller waits
   for the webhook); hard failure → Slack alert + customer-facing message,
   webhook safety net still behind it.
4. Confirmation page: booking row present → full details; not yet → poll up to
   60s, then a reassuring "details are taking longer" fallback.
5. Webhook (`payment_intent.succeeded`): idempotent against the bookings table;
   creates the booking when nobody else did; on FareHarbor failure → recheck →
   auto-refund + Slack.

## How to extend

- **New async payment method (Bancontact, SEPA, …):** nothing to do — the
  recover/webhook/poller machinery is method-agnostic; add the method to
  `payment_method_types` in `create-intent.ts`.
- **New booking-completion path:** always `insert` into `bookings` with the
  `stripe_payment_intent_id` and handle error code `23505` by cancelling any
  FareHarbor booking you just created — the unique constraint is the arbiter.
- **Changing the poll window:** `POLL_INTERVAL_MS` / `MAX_ATTEMPTS` in
  `ConfirmationPending.tsx`; keep it comfortably above webhook latency.

## Dependencies

Depends on: Stripe PaymentIntents + webhook (`payment_intent.succeeded`,
`charge.refunded`), FareHarbor two-step booking, the
`bookings_stripe_payment_intent_id_unique` constraint (migration 052),
`pricing_quotes` (migration that added `consumed_at` / `consumed_intent_id`),
Slack webhook for alerts.

Depended on by: the entire public checkout (Track D), admin booking dashboard
(reads the same `bookings` rows), Google Ads conversion reporting (fires from
the same webhook and is retracted by the auto-refund via `charge.refunded`).
