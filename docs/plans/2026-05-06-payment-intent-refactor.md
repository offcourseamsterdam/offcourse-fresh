# Refactoring Plan — Payment Intent + Checkout Surface

**Created:** 2026-05-06
**Scope:** Stripe payment-intent and checkout-session surface — `src/lib/booking/create-intent.ts`, `src/lib/stripe/*`, `src/app/api/booking-flow/*`, `src/app/api/admin/booking-flow/*`, `src/app/api/webhooks/stripe/route.ts`, `src/components/checkout/CheckoutFlow.tsx`, `src/components/admin/fareharbor/PaymentForm.tsx`
**Status:** Plan — ready for review, not yet executed

## Context

Payments today work *most* of the time, but the architecture has two structural risks that will eventually cost money:

1. **The webhook is not authoritative.** Public bookings flow `confirmPayment` → iDEAL redirect → client returns to the page → client calls `POST /api/booking-flow/book`. The Stripe webhook listens only to `checkout.session.completed` / `checkout.session.expired`, never to `payment_intent.succeeded`. If the customer's redirect is lost (closed tab, network drop, device switch, browser cleared sessionStorage), Stripe has the money, FareHarbor may or may not have a slot reserved, and Supabase has no booking row. There is no server-side fallback.
2. **Two parallel payment models.** Public flow uses PaymentIntents. Admin "payment link" uses Checkout Sessions. They diverge on city tax (admin path skips it), on price calculation, on metadata shape, and on which webhook events drive state. Two systems doing the same job is a permanent maintenance tax.

On top of that: no idempotency keys on PaymentIntent creation, weak webhook event deduplication, hardcoded city-tax constant in three files, two ~770-line god modules (`book/route.ts`, `CheckoutFlow.tsx`), and tests that cover only the price-discipline happy path.

The intended outcome: one pricing engine, one source of truth for metadata, the webhook as the authoritative state machine, and idempotency at every Stripe boundary. **Customer-visible behavior does not change** beyond the webhook safety net catching the dropped-redirect case.

---

## 1. High-level understanding

There are four payment paths today:

- **Path A — Public website (PaymentIntent).** `POST /api/booking-flow/create-intent` → `createPaymentIntent()` → client `confirmPayment()` → optional iDEAL redirect → on return, client `POST /api/booking-flow/book` → FH validate + create + Supabase insert. Webhook is silent.
- **Path B — Admin payment link (Checkout Session).** `POST /api/admin/booking-flow/create-payment-link` → FH booking created up-front → Stripe Checkout Session → Supabase row → email link → customer pays → webhook `checkout.session.completed` flips `payment_status` to `paid`.
- **Path C — Cron payment reminders (Checkout Session).** Hourly cron iterates Stripe sessions older than 18h and emails customers.
- **Path D — Partner invoice (no Stripe).** `POST /api/booking-flow/book` with `bookingSource: 'partner_invoice'`. Skips Stripe entirely.

Hot files:

- `src/lib/booking/create-intent.ts` (~119 lines): the only place that builds a PaymentIntent. Verifies GROSS price from FareHarbor server-side, applies city tax, applies discount, attaches metadata.
- `src/lib/stripe/server.ts` (~12 lines): lazy Stripe singleton.
- `src/app/api/booking-flow/create-intent/route.ts` (~66 lines): public POST endpoint that delegates to `createPaymentIntent`.
- `src/app/api/webhooks/stripe/route.ts` (~56 lines): handles two events, both `checkout.session.*`.
- `src/app/api/booking-flow/book/route.ts` (~769 lines): the post-payment booking creator. Mixes FH validation, FH booking, Supabase insert, partner-invoice path, campaign attribution, commission, Slack alerts.
- `src/app/api/admin/booking-flow/create-payment-link/route.ts` (~167 lines): admin payment-link path; uses Checkout Sessions, omits city tax, has a three-step external-state race.
- `src/components/checkout/CheckoutFlow.tsx` (~773 lines): client-side; mixes Elements rendering, iDEAL redirect recovery via sessionStorage, post-payment booking call.
- `src/components/admin/fareharbor/PaymentForm.tsx` (~77 lines): admin Elements form.
- `src/app/api/cron/payment-reminders/route.ts` (~95 lines): reminder emails.

Trust boundary (today): client provides `selectedExtraIds`, `displayedTotalCents`, contact info. Server re-fetches extras, recomputes total, compares against displayed within a 50¢ tolerance. Server never trusts client-supplied amounts to charge.

---

## 2. Main problems and code smells

| # | Issue | Where | Why it's a problem |
|---|---|---|---|
| P1 | No `payment_intent.succeeded` webhook handler | `src/app/api/webhooks/stripe/route.ts` | Public path relies entirely on client returning from redirect. Lost redirect = paid customer, no booking. Webhook must be a safety net, not absent. |
| P2 | No idempotency key on `paymentIntents.create` | `src/lib/booking/create-intent.ts` (~line 97) | Network retry from client creates duplicate intents. Stripe is at-least-once on retries; we should pin keys. |
| P3 | Weak webhook deduplication | `src/app/api/webhooks/stripe/route.ts` (lines ~25–32) | Only protection is `eq('payment_status', 'pending_payment')`. No event-ID dedup table. Stripe retries can re-execute side effects (Slack, refunds). |
| P4 | Admin `create-payment-link` skips city tax | `src/app/api/admin/booking-flow/create-payment-link/route.ts` (~lines 99–134) | Charges `overrideAmountCents` raw; `base_vat_amount_cents`, `extras_amount_cents`, `total_vat_amount_cents` written as 0. Diverges silently from public path. |
| P5 | Race condition: FH booking → Stripe session → Supabase save | `src/app/api/admin/booking-flow/create-payment-link/route.ts` | No transaction across three external systems. Webhook can arrive before Supabase write completes; booking ends up in limbo (FH reserved, Stripe paid, no DB row). |
| P6 | Two parallel payment models | Public path = PaymentIntents; admin path = Checkout Sessions | Two webhook surfaces, two metadata shapes, two recovery flows. Bug fix in one path will not propagate. |
| P7 | City-tax constant duplicated | `src/lib/booking/create-intent.ts` (~line 76: `260`), `src/lib/booking/useBookingPanel.ts`, `src/app/api/booking-flow/book/route.ts` (~line 392) | Three places to update if the rate changes. Easy to miss one and produce silent under/over-charge. |
| P8 | Book route swallows Supabase write failure | `src/app/api/booking-flow/book/route.ts` (~lines 269–274) | Returns 200 OK with logs + Slack alert when Supabase insert fails after FH booking + payment. Customer sees "confirmed" with no DB record; manual recovery only. |
| P9 | `book/route.ts` god module (769 lines) | `src/app/api/booking-flow/book/route.ts` | FH validation + FH booking + Supabase write + partner invoice + campaign attribution + commission + Slack all in one file. Hard to test, hard to reason about. |
| P10 | `CheckoutFlow.tsx` god component (773 lines) | `src/components/checkout/CheckoutFlow.tsx` | Mixes Stripe Elements lifecycle, iDEAL redirect recovery via sessionStorage, post-payment booking call, error UI. |
| P11 | Stripe env access scattered | `STRIPE_SECRET_KEY` in `src/lib/stripe/server.ts`, `STRIPE_WEBHOOK_SECRET` inline in webhook route, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` duplicated in `CheckoutFlow.tsx` and `PaymentForm.tsx` | Three env vars, three independent reads. No startup validation. Failures surface inside requests. |
| P12 | Stripe API version not pinned | `src/lib/stripe/server.ts` | SDK upgrades silently change request/response shapes. Pin explicitly. |
| P13 | PaymentIntent metadata loosely typed and missing keys | `src/lib/booking/create-intent.ts` (~lines 101–115). No `BookingPaymentMetadata` type. `fareharbor_uuid` / `booking_id` not in metadata. | Webhook (when added in P1's fix) cannot correlate `payment_intent.succeeded` back to a booking row without expensive queries. Loose `Record<string,string>` invites typos. |
| P14 | 50-cent client/server total tolerance | `src/lib/booking/create-intent.ts` (~line 83) | A 50¢ window is wide enough to hide UI staleness bugs that overcharge customers. Should be near-zero with explicit logging when triggered. |
| P15 | Test coverage on the money path is shallow | `src/lib/booking/create-intent.test.ts` (~6 cases — all happy-path price discipline). No tests for webhook, book route, create-payment-link. | The most consequential code in the repo (real money) has the lightest safety net. |
| P16 | `extras_summary` is a lossy comma-string | `src/lib/booking/create-intent.ts` (~line 93) | If extras share a name they collapse. Webhook reconstruction would need to re-query Supabase. |

---

## 3. Refactoring goals

- **G1 — Webhook is authoritative.** Add `payment_intent.succeeded` and `payment_intent.payment_failed` handlers. The client redirect path becomes a fast happy-path; the webhook is the safety net that catches dropped redirects. (Resolves P1, mitigates P5.)
- **G2 — Idempotency end-to-end.** Idempotency keys on `paymentIntents.create`. Event-ID dedup table for the webhook. (Resolves P2, P3.)
- **G3 — One pricing engine.** Single `calculateBookingTotal()` function used by `create-intent.ts`, `book/route.ts`, `useBookingPanel.ts`, and `create-payment-link/route.ts`. Single exported `CITY_TAX_PER_GUEST_CENTS` constant. (Resolves P4, P7.)
- **G4 — Typed structured metadata.** Define `BookingPaymentMetadata` with a zod schema. Serializer to Stripe's `Record<string,string>` and parser back. Always include `booking_id` (or pre-allocated UUID) and `fareharbor_uuid` once known. (Resolves P13, P16.)
- **G5 — Never silently lose a paid booking.** If Supabase write fails after FH booking + payment, the route refunds (or queues a refund) and alerts loudly; it does not return 200 OK. (Resolves P8.)
- **G6 — Centralize Stripe config.** One module reads all three env vars at startup, validates them, pins API version, exposes the singleton client and the publishable key helper. (Resolves P11, P12.)
- **G7 — Shrink god modules.** Split `book/route.ts` and `CheckoutFlow.tsx` into named, testable units behind their existing public surfaces. (Resolves P9, P10.)
- **G8 — Test the orchestration boundary.** Add tests for webhook event handlers (with idempotency), book route (with Supabase failure), create-payment-link (with city tax), and the price calculator. (Resolves P15.)
- **G9 (optional, Phase 3) — Unify the two payment models.** Either convert admin payment links to PaymentIntents, or factor a shared adapter so that both paths share one metadata shape, one price calculator, and one webhook reconciler. (Resolves P6.)

External behavior stays the same except for the webhook safety net catching the dropped-redirect case. Pricing displayed to customers does not change.

---

## 4. Phased refactoring plan

### Phase 1 — Safe / mechanical clean-ups

1. **Pin the Stripe API version.** In `src/lib/stripe/server.ts`, pass `apiVersion` explicitly to the Stripe constructor and pin it to the current SDK default. Comment links to the Stripe API changelog.

2. **Centralize the publishable key.** Replace the duplicated `loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)` in `src/components/checkout/CheckoutFlow.tsx` and `src/components/admin/fareharbor/PaymentForm.tsx` with a single shared `src/lib/stripe/client.ts` that exports a memoised promise.

3. **Extract the city-tax constant.** Create `src/lib/booking/constants.ts` exporting `CITY_TAX_PER_GUEST_CENTS = 260`. Replace the three hardcoded `260`s in `create-intent.ts`, `useBookingPanel.ts`, and `book/route.ts` with imports of this constant.

4. **Add explicit return types** to `createPaymentIntent` and the route handlers in `create-intent/route.ts`, `book/route.ts`, `create-payment-link/route.ts`, and the webhook route.

5. **Narrow the displayed-total tolerance.** Reduce the 50¢ window in `create-intent.ts` (~line 83) to ≤5¢ and add a structured log (`console.warn` with listing_id, expected vs received) every time it triggers. This surfaces UI staleness as signal instead of silently absorbing it.

### Phase 2 — Structural and modular improvements

6. **Define `BookingPaymentMetadata`.** In `src/lib/booking/types.ts`, define the structured metadata type and a matching zod schema. Add `to_stripe_metadata(meta)` serializer that produces Stripe's flat string map and a `from_stripe_metadata(raw)` parser used by the webhook. Include a pre-allocated `booking_id` UUID minted at create-intent time. (Resolves P13.)

7. **Build a single price calculator.** Create `src/lib/booking/calculate-total.ts` with `calculateBookingTotal({ baseAmountCents, extrasAmountCents, guestCount, discountAmountCents })` returning `{ city_tax_cents, subtotal_cents, grand_total_cents, base_vat_cents, extras_vat_cents, total_vat_cents }`. Use it in `create-intent.ts`, `book/route.ts`, `useBookingPanel.ts`, and `create-payment-link/route.ts`. (Resolves P7; precondition for P4.)

8. **Fix admin city-tax omission.** In `create-payment-link/route.ts`, replace the raw `overrideAmountCents` write with a call to `calculateBookingTotal()`. Persist the same VAT/city-tax breakdown as the public path. (Resolves P4.)

9. **Add idempotency keys to PaymentIntent creation.** In `createPaymentIntent`, derive a stable key from `listing_id + avail_pk + email + chargedCents + booking_id`. Pass it as the second arg to `paymentIntents.create`. (Resolves P2.)

10. **Add a `processed_stripe_event_ids` table.** Migration: `(event_id text primary key, type text, processed_at timestamptz)`. In the webhook, before any side effect, `INSERT … ON CONFLICT DO NOTHING`; if no row was inserted, return 200 immediately. (Resolves P3.)

11. **Add the `payment_intent.succeeded` webhook handler.** Logic:
    - Parse `BookingPaymentMetadata` from `pi.metadata`.
    - Look up `bookings` by `stripe_payment_intent_id`. If found and `payment_status='paid'` → no-op (idempotent).
    - If found and pending → flip to `paid`.
    - If not found → this is the dropped-redirect case. Validate FH availability, create FH booking via `getFareHarborClient().validateBooking` then `createBooking`, insert booking row, send confirmation email. Use the metadata's pre-allocated `booking_id`.
    - Log structured events at every branch.
    (Resolves P1 and most of P5.)

12. **Add `payment_intent.payment_failed` handler.** Mark any pending booking row tied to the intent as `failed`. Optionally email customer.

13. **Fix the book-route Supabase failure path.** In `src/app/api/booking-flow/book/route.ts`, when Supabase insert fails after FH booking and payment:
    - Cancel the FH booking (best effort).
    - Issue a refund via `stripe.refunds.create` against the PaymentIntent.
    - Return 500 with a clear error code; alert Slack as before.
    Never return 200 OK without a DB row and a confirmed booking.
    (Resolves P8.)

14. **Centralize Stripe env.** Create `src/lib/stripe/env.ts` that reads and validates `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` once. Throw at import time in production if any are missing. `lib/stripe/server.ts`, the webhook route, and `lib/stripe/client.ts` consume from this module. (Resolves P11.)

15. **Persist a `pending_bookings` server record at create-intent time.** New row keyed by PaymentIntent ID with the metadata and the pre-allocated `booking_id`. The webhook reads from this table to reconstruct the booking when the redirect is lost — independent of client sessionStorage. (Reinforces P1's safety net; precondition for P10's simplification of `CheckoutFlow.tsx`.)

### Phase 3 — Deeper design and architecture improvements

Higher risk; only after Phase 2 has shipped and stabilized.

16. **Decompose `book/route.ts`.** Extract:
    - `src/lib/booking/save-booking.ts` (Supabase insert, refund-on-failure)
    - `src/lib/booking/partner-invoice.ts` (commission calc, attribution)
    - `src/lib/booking/notify.ts` (Slack, email)
    - `src/lib/booking/book.ts` (orchestrator: FH validate → FH create → save → notify)
    The route file becomes a thin HTTP wrapper. (Resolves P9.)

17. **Decompose `CheckoutFlow.tsx`** into:
    - `<StripeElementsForm>` — Elements lifecycle and `confirmPayment` only.
    - `<PostPaymentBooking>` — handles the post-redirect `POST /book` call.
    - `<RedirectRecovery>` — reads `?payment_intent=` from URL and the new server-stored `pending_bookings` row instead of sessionStorage (more robust across tabs/devices).
    (Resolves P10.)

18. **Unify admin and public payment models.** Convert admin payment links to PaymentIntents (with a hosted Stripe Checkout-like page, or with an off-session confirmation flow), or formalise a small adapter so both paths share `BookingPaymentMetadata`, `calculateBookingTotal`, and one webhook reconciler. (Resolves P6.)

19. **Stripe-event-driven booking state machine.** Once 11/12 are in, the webhook is authoritative for state transitions. Document the state machine (`pending → paid → confirmed | failed | refunded | cancelled`) and remove any client-side state writes that duplicate webhook responsibilities.

---

## 5. Impact and risk per step

| Step | Impact | Risk | Watch out for |
|---|---|---|---|
| 1 — pin API version | Stable SDK behavior | Low | Test the booking flow once after pin |
| 2 — central publishable key | Less drift | Low | Both client components must update simultaneously |
| 3 — city-tax constant | Single point of change | Low | Grep for `260` widely; not all 260s are city tax |
| 4 — explicit return types | Catches future drift | Low | None |
| 5 — narrow tolerance | Surfaces UI bugs | Low–Med | Will produce log noise during transition; treat as signal |
| 6 — typed metadata | Schema-safe webhook reads | Low | Stripe metadata values must be strings; serializer must enforce |
| 7 — single price calculator | Removes a class of pricing drift | Med | Output must match current values byte-for-byte; snapshot tests required |
| 8 — admin city tax | Admin charges go up by €2.60×guests | **Med–High** (customer-visible) | Coordinate with Beer; existing pending payment links may be unaffected — verify |
| 9 — idempotency keys | Eliminates duplicate intents | Low | Key must include enough variance to permit retried *different* bookings |
| 10 — event-ID dedup table | Eliminates duplicate side effects | Low–Med | Migration must run before code deploys |
| 11 — `payment_intent.succeeded` handler | **Closes the dropped-redirect hole** | **Med–High** (real-money path) | Idempotency is critical; must not double-book on a redirect that *did* succeed |
| 12 — `payment_intent.payment_failed` handler | Better customer signal | Low | None |
| 13 — book-route refund-on-failure | No more silent paid-no-booking | Med | Stripe refund call itself can fail; alert Slack and queue retry |
| 14 — central Stripe env | Loud failure at boot | Low–Med | Don't break local dev when keys are intentionally absent — gate on NODE_ENV |
| 15 — `pending_bookings` table | Safety-net data source for webhook | Med | New write on every create-intent; small Supabase load increase |
| 16 — decompose book route | Testability | Med | Extract behind existing route signature; integration test the route end-to-end |
| 17 — decompose CheckoutFlow | Testability + UX robustness | Med | Don't break iDEAL recovery during refactor; keep a fallback to sessionStorage for one release |
| 18 — unify payment models | One system to maintain | **High** | Big behavioral change; ship behind a feature flag and migrate admin path gradually |
| 19 — formal state machine | Clear invariants | Med | Removing client writes may surface ordering assumptions; do last |

---

## 6. Testing and validation strategy

### Existing safety net (preserve and grow)

- `src/lib/booking/create-intent.test.ts` (6 cases — GROSS price, fallbacks, city tax). Keep green at every step.
- `src/lib/fareharbor/filters.test.ts`, `config.test.ts` — unrelated but share the suite.
- `src/lib/extras/calculate.test.ts`, `src/lib/utils.test.ts` — unrelated.

### New tests to add (in order, before the structural changes that touch each module)

1. **`src/lib/booking/calculate-total.test.ts`** — pure unit. Covers:
   - City tax × guests is added.
   - Extras add to subtotal.
   - Discount subtracts.
   - VAT breakdown matches existing book-route output (snapshot 5+ real cases first).
2. **Extend `src/lib/booking/create-intent.test.ts`** — add cases for:
   - Idempotency key derivation.
   - `BookingPaymentMetadata` serialization / round-trip.
   - Discount validation throws on >5¢ mismatch.
   - Negative inputs / missing rate / FH error path.
3. **`src/app/api/webhooks/stripe/route.test.ts`** — mock `stripe.webhooks.constructEvent`, mock Supabase + FH client. Cover:
   - Signature failure → 400.
   - `checkout.session.completed` happy path; replay → no-op (event-ID dedup).
   - `checkout.session.expired` cancels FH and DB.
   - `payment_intent.succeeded` when DB row already exists → no-op.
   - `payment_intent.succeeded` when DB row missing → creates FH booking + DB row.
   - `payment_intent.payment_failed` marks pending row failed.
4. **`src/app/api/booking-flow/book/route.test.ts`** — cover:
   - Happy path.
   - Supabase insert failure → triggers refund + Slack + 500 (not 200).
   - Partner-invoice path skips Stripe.
5. **`src/app/api/admin/booking-flow/create-payment-link/route.test.ts`** — cover:
   - City tax included in `stripe_amount` and `total_vat_amount_cents`.
   - Race recovery: webhook arrives before save → state still consistent (relies on event-ID dedup + `pending_bookings`).

### Per-phase validation checklist

- [ ] `npm test` — all suites green.
- [ ] `npx tsc --noEmit` — no new type errors.
- [ ] Stripe CLI `stripe listen` against a local webhook + `stripe trigger payment_intent.succeeded` — verify handler runs and is idempotent on replay.
- [ ] Manual end-to-end on Stripe test mode:
  - Public path with iDEAL → return → booking created.
  - Public path with iDEAL → close tab during redirect → wait for webhook → booking created.
  - Public path with card decline → `payment_intent.payment_failed` recorded.
  - Admin payment link → customer pays → `checkout.session.completed` flips status; replay event → no second update.
  - Admin payment link → expire → FH cancel + DB cancel.
- [ ] Snapshot diff `/api/booking-flow/create-intent` response for a known input before/after each step (output must be byte-identical except for new fields like `booking_id`).
- [ ] After step 8: re-create three admin payment links pre- and post-change for the same input; confirm `stripe_amount` increased by exactly `260 × guest_count`.

---

## 7. Execution order and practical tips

### Recommended order

1. **Phase 1 in one PR (steps 1–5).** Mechanical, fast review.
2. **Add tests first** (calculator, webhook, book route, create-payment-link) — one PR per file, *before* the structural refactor of that module.
3. **Step 6 (typed metadata) and step 14 (env central)** — small, independent, low risk.
4. **Step 7 (calculator) before step 8 (admin city tax fix)** — calculator must exist before admin path is rewritten to use it.
5. **Step 10 (event-ID dedup table) before steps 11/12 (new webhook handlers)** — dedup must be in place when new side effects land.
6. **Step 15 (`pending_bookings` table) before step 11 (`payment_intent.succeeded` handler)** — handler relies on this table to reconstruct dropped-redirect bookings.
7. **Step 11**, then **step 12**, then **step 13** in three separate PRs. Each is a real-money path; ship and watch logs for one full booking day before stacking the next.
8. **Step 9 (idempotency keys)** — independent; can land any time after step 6.
9. Stop and ship Phase 2. Validate in production for at least one full booking weekend.
10. **Phase 3 (steps 16–19)** — only after Phase 2 has been live and stable. Step 18 behind a feature flag.

### Practical tips

- **One concern per PR.** This surface is real money in flight; tiny PRs make bisects fast.
- **Snapshot Stripe responses** before and after the calculator change. Any pricing-affecting PR must include a side-by-side comparison in the description.
- **Use Stripe test mode aggressively.** Trigger every event variant locally with `stripe trigger` before merging.
- **Branch naming:** keep this plan on `claude/refactoring-plan-template-Wn1Tw`; spin off feature branches per phase, e.g. `refactor/payments-phase-1-cleanup`, `refactor/payments-add-pi-succeeded`, `refactor/payments-unify-models`.
- **Commit messages** name the smell (`fix: handle payment_intent.succeeded webhook (resolves P1)`) so plan and history stay in sync.
- **Don't skip the test-first rule.** Steps 11 and 13 in particular must not land without their tests; they are the ones touching live money.
- **Coordinate step 8 with Beer.** Admin payment links currently under-charge by €2.60 × guests. Fixing that is an intentional pricing change — should be communicated, not silently shipped.

### Critical files (modification surface)

- `src/lib/booking/create-intent.ts`
- `src/lib/booking/useBookingPanel.ts`
- `src/lib/booking/calculate-total.ts` *(new)*
- `src/lib/booking/constants.ts` *(new)*
- `src/lib/booking/types.ts` *(new or extended)*
- `src/lib/booking/save-booking.ts` *(new, Phase 3)*
- `src/lib/booking/partner-invoice.ts` *(new, Phase 3)*
- `src/lib/booking/notify.ts` *(new, Phase 3)*
- `src/lib/booking/book.ts` *(new, Phase 3 — orchestrator)*
- `src/lib/stripe/server.ts`
- `src/lib/stripe/client.ts` *(new)*
- `src/lib/stripe/env.ts` *(new)*
- `src/app/api/webhooks/stripe/route.ts`
- `src/app/api/booking-flow/create-intent/route.ts`
- `src/app/api/booking-flow/book/route.ts`
- `src/app/api/admin/booking-flow/create-payment-link/route.ts`
- `src/app/api/cron/payment-reminders/route.ts`
- `src/components/checkout/CheckoutFlow.tsx`
- `src/components/admin/fareharbor/PaymentForm.tsx`
- `supabase/migrations/NNN_processed_stripe_events.sql` *(new)*
- `supabase/migrations/NNN_pending_bookings.sql` *(new)*
- `src/lib/supabase/types.ts` *(regenerated after each migration)*

### Existing helpers/utilities to reuse

- `getStripe()` (`src/lib/stripe/server.ts`) — single chokepoint for the SDK; do not introduce parallel instantiations.
- `createPaymentIntent` (`src/lib/booking/create-intent.ts`) — keep as the single PaymentIntent creation entry; extend rather than fork.
- `getFareHarborClient()` and the two-step `validateBooking` / `createBooking` — the webhook's new `payment_intent.succeeded` handler must use these, not a parallel path.
- `BookingPayload` (currently inline in `book/route.ts`, ~lines 327–357) — promote to `src/lib/booking/types.ts` and have both the route and the webhook handler share it.
- The existing tolerance check in `create-intent.ts` — keep the structure, narrow the threshold, add the log.
