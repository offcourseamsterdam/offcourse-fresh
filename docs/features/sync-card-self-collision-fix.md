# Synchronous-Card Self-Collision Fix

> Companion to [payment-flow-hardening.md](payment-flow-hardening.md). That work
> hardened the **async / iDEAL** path (redirect → recover → webhook safety net).
> This work fixes a **synchronous card / wallet** failure mode that the async
> hardening didn't cover: a paid card booking colliding with *its own twin*.

## What was built

A fix for the "**PAID BUT NO BOOKING**" false alarm that fired on successful
synchronous card payments (card, Google Pay, Apple Pay, Link). The customer was
correctly booked and charged, but still saw a "something went wrong" error
screen and ops got a CRITICAL Slack alert telling them to refund or recreate a
booking that already existed.

**Reference incident:** 2026-06-27, Agnes Crepet, €328.20, Private Hidden Gems
Cruise, PI `pi_3TmpEZGh1qCF71Ta15j4WcIs`, FH booking `f77b627b`. Paid with
Google Pay (a *synchronous* card). Two Slack messages fired 07:58 for the same
PI: "New booking confirmed!" **and** "CRITICAL: PAID BUT NO BOOKING / 291398
unable to satisfy resources." The booking was real; the alert was false; no
refund was (correctly) issued.

## Root cause

A synchronous card payment triggers **two finalize paths for one PaymentIntent**,
both firing within milliseconds:

- **(A)** the browser POSTs `/api/booking-flow/book` right after
  `stripe.confirmPayment` returns `succeeded` (card/wallets confirm inline), and
- **(B)** the Stripe `payment_intent.succeeded` webhook, which has **no
  card/async guard** — it fires for every PI.

The [booking claim mutex](booking-claim-mutex.md) correctly stopped a *second*
FareHarbor booking from being created. But the **losing** path still validated
against FareHarbor and then false-alarmed. The enabler was a one-line bug:

```ts
// src/app/api/admin/booking-flow/book/route.ts — idempotency check
.select('id, fareharbor_booking_uuid')   // ← column does not exist
```

The real column is `booking_uuid`. PostgREST returned error `42703`
(undefined column), but the code only destructured `data` (not `error`), so
`existing` was **always `null`** — the idempotency short-circuit never fired.
`/book` therefore *always* fell through to claim + validate, even when the
webhook had already created the booking. FareHarbor then rejected `/book`'s
validate with **291398 "unable to satisfy resources"** — because the boat had
just been consumed by *the customer's own webhook booking*. A **self-collision**,
not a real resource conflict (low traffic rules out genuine competition).

The losing `/book` then:
- fired `notifyBookingFailure(stage: 'fareharbor_validate')` → **MSG 2** (the
  false CRITICAL alert), and
- returned **HTTP 422** to the browser → the customer's "something went wrong"
  screen.

## The fixes

| # | Pri | Fix |
|---|-----|-----|
| 1 | P0 | **Repair the dead idempotency SELECT.** `fareharbor_booking_uuid` → `booking_uuid`, and capture + log the query `error` so a future column bug can't be swallowed silently. This single line restores the dedupe short-circuit. |
| 2 | P0 | **Re-check (with a brief poll) before alerting.** When FareHarbor validate fails *and* a `stripePaymentIntentId` is present, re-query `bookings` by PI via `findRaceWinner()` (3 attempts, 600 ms apart). If a row appears, the webhook won the race — return `{ deduplicated: true }` (success) and **skip the CRITICAL alert + the 422**. The short poll covers the window where the winner created the FareHarbor booking (consuming the slot) but hadn't yet committed its Supabase row. |
| 3 | P2 | **Method-derived Slack label.** The "New booking confirmed!" webhook + recovery messages no longer hardcode `_(iDEAL/async — via webhook)_`. They derive the label from the **actual charge** (`latest_charge.payment_method_details.type`, via `resolvePaymentMethodLabel`), e.g. `_(card — via webhook)_` or `_(Apple Pay — via browser recovery)_`. |
| 4 | P2 | **Safer alert copy.** `notifyBookingFailure` now leads its action line with *"first check the bookings table (filter by Stripe PI) and FareHarbor — if a booking exists, this is a false alarm, do NOT refund or recreate."* |

Fixes #1 and #2 are independent backstops: #1 closes the common case, #2 catches
the residual tight race. The real one-PI-one-booking guarantee comes from the
[booking claim mutex](booking-claim-mutex.md), not from any payment-method timing.

> **Superseded:** an earlier revision added a `payment_method_types`-based "wait
> 8 s for sync payments" deferral in the webhook. It was **removed** — it never
> ran in production (every PI is created with a static
> `payment_method_types: ['card','ideal','link']`, so the "is sync?" test was
> always false) and it broke the webhook test suite (mocked PIs omit the field,
> making the test always true → an 8 s real-timer hang). The claim mutex's
> `in_flight` branch already serialises the race correctly, so the deferral was
> redundant as well as dead.

## Key files

| File | Change |
|------|--------|
| `src/app/api/admin/booking-flow/book/route.ts` | Fix #1 (idempotency SELECT column + error logging), Fix #2 (`findRaceWinner()` polling re-check before `notifyBookingFailure` on validate failure) |
| `src/app/api/webhooks/stripe/route.ts` | Fix #3 (method-derived `paymentMethodLabel` from the charge); **removed** the dead `isSyncPayment` deferral |
| `src/lib/stripe/payment-method-label.ts` | New — `resolvePaymentMethodLabel(stripe, pi)` shared by the webhook + recovery paths |
| `src/lib/booking/recover-from-pi.ts` | Fix #3 (method-derived label in the browser-recovery Slack message) |
| `src/lib/booking/notify-booking-failure.ts` | Fix #4 (action copy: verify before refund/recreate) |

## Architecture decisions

**Why two independent P0 fixes instead of one?** Fix #1 (repair the SELECT) closes
the case where the webhook's row is already visible when `/book` checks. Fix #2
(re-check at the alert site) closes the *narrower* race where the webhook inserts
*after* `/book`'s initial SELECT but *before* `/book`'s FareHarbor validate
returns. Defence in depth on a live money path: either one alone removes the
customer-facing error; together they also remove the false alert.

**Why not bias the race with a webhook delay?** An earlier revision tried to (see
the "Superseded" note above). The serialisation is already done correctly by the
claim mutex: whichever path claims the PI first wins, and the other gets
`in_flight`/`duplicate` and steps aside. A timing hack on top of that was both
redundant and — because it keyed off the *offered* method list rather than the
*used* method — dead in production. Deleting it also returned the webhook tests
to green. The lesson: serialise with a mutex, don't race-bias with sleeps.

**Why read the method from the charge, not `payment_method_types`?**
`pi.payment_method_types` is the list of methods we *offered* (always
`card/ideal/link`); it can't tell card from iDEAL. The method actually *used*
lives on `latest_charge.payment_method_details.type`. `resolvePaymentMethodLabel`
looks it up best-effort (and maps Apple/Google Pay via the card wallet sub-type),
falling back to `'online payment'` so a cosmetic label never blocks a booking.

**Why not retry FareHarbor on 291398?** Tempting, but dangerous *here*: the
"conflict" is the booking's own twin. A retry would either re-collide (same false
alarm) or, worse, create a duplicate real booking once the claim released.
Re-checking the DB is the correct disambiguation, not retrying the external call.

**Why is "no refund" the correct end state?** `/book` has no refund logic at all;
the webhook's auto-refund ([payment-flow-hardening.md](payment-flow-hardening.md),
`refundFailedBooking`) only triggers on *webhook-side* failure after an 8s
recheck — and the webhook **succeeded**. Booked + paid + not refunded = correct.

## How it works (sync card flow, after this change)

1. Customer pays by card/wallet; `confirmPayment` returns `succeeded` inline.
2. Browser POSTs `/book`. Its idempotency SELECT (now on the real column) sees no
   row yet, claims the PI, validates, creates the FH booking, inserts the row.
3. The `payment_intent.succeeded` webhook fires in parallel and calls
   `claimPaymentIntent`. Because `/book` holds the claim, the webhook gets
   `in_flight`, waits its recheck window, finds `/book`'s row, and returns early —
   no second FH booking, no second alert. (If `/book` never arrives, the webhook's
   stale-claim takeover still books it — the true safety net.)
4. In the rare interleaving where the webhook wins the FH booking and `/book`'s
   validate then fails 291398: `/book`'s **`findRaceWinner()` poll** finds the
   webhook's row and returns `{ deduplicated: true }` — success to the browser,
   **no** CRITICAL alert.
5. Whichever path completes, the browser is sent to the polling
   `/confirmation` page — never a dead-end error (see
   [the staged-status UX](#customer-facing-staged-status)).

## How to extend

- **New payment method**: add it to `payment_method_types` in `create-intent.ts`,
  and add a pretty label to `PRETTY` in `payment-method-label.ts`. No
  webhook timing changes are needed — the claim mutex handles the race for any
  method.
- **Any new finalize path**: before alerting on a FareHarbor failure for a paid
  PI, **always re-query `bookings` by `stripe_payment_intent_id` first** (use
  `findRaceWinner` or equivalent) — a row means a sibling path already succeeded.

## Customer-facing staged status

The customer never sees a raw "something went wrong" after a successful payment.
`CheckoutFlow.handlePaymentSuccess` always routes to
`/book/{slug}/confirmation?payment_intent=…` once Stripe returns `succeeded` —
even if the fast `/book` path errors — because the webhook is the guaranteed
backstop. The confirmation page (`ConfirmationPending` + `BookingProgressSteps`)
shows a staged checklist — **Payment received ✓ → Confirming your booking ⏳ →
Confirmation email** — and tells the customer exactly what to wait for ("you're
all paid; we're reserving your boat; we'll email you when it's confirmed, or if
something's wrong with the payment"). It polls `/confirmation-status` and renders
the full booking the moment the row lands.

## Dependencies

Builds on the [booking claim mutex](booking-claim-mutex.md) (one PI → one FH
booking) and [payment-flow-hardening.md](payment-flow-hardening.md) (the 8s
recheck window, `refundFailedBooking`, the `stripe_payment_intent_id` unique
constraint). Shares the Slack alerting in `notify-booking-failure.ts` and
`postSlackText`.
