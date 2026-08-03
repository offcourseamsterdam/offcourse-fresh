# Booking claim mutex — one payment, one FareHarbor booking

## What was built

A small, isolated mutual-exclusion mechanism that makes it **structurally impossible** for a single Stripe payment to create two FareHarbor bookings.

### The bug it fixes
iDEAL (and other async Stripe methods) make two finalize paths run for one payment at nearly the same instant — the browser `/book` call and the `payment_intent.succeeded` webhook (plus the browser `/recover` fallback). Each did *check-then-act*:

1. `SELECT bookings WHERE stripe_payment_intent_id = pi` → none
2. create the FareHarbor booking
3. `INSERT` the bookings row

Both could pass step 1 before either reached step 3, so **both created a FareHarbor booking**. The `UNIQUE(stripe_payment_intent_id)` constraint (migration 052) caught the double *INSERT*, but only **after** two FareHarbor bookings already existed. The webhook and `/recover` paths cancelled their losing FareHarbor booking on the `23505`; `/book` did **not** — it fired a misleading "CRITICAL: SAVE FAILED, recover manually" alert and orphaned its FareHarbor booking. (Real incident: 2026-06-22, one €75 payment → two FareHarbor bookings.)

### The fix
Every finalize path now **claims the payment-intent id before calling FareHarbor**. The first writer wins; losers never touch FareHarbor. This upgrades the guard from *2-way, after-the-fact cancellation* to *N-way prevention*. The misleading `/book` alert is reworked: a cleanly-handled race is silent; only a genuine "FareHarbor booked but our DB save failed" pages anyone, with accurate "repair the row, don't recreate the booking" wording.

## Key files

| File | Role |
|------|------|
| `supabase/migrations/083_booking_claims.sql` | New `booking_claims` table (PK = `payment_intent_id`, `created_at`, service-role RLS). |
| `src/lib/booking/booking-claims.ts` | **New.** `claimPaymentIntent()` + `releaseClaim()` — the shared mutex helper. |
| `src/lib/booking/booking-claims.test.ts` | Unit tests, incl. the "exactly one of N concurrent claims wins" guarantee. |
| `src/app/api/webhooks/stripe/route.ts` | `payment_intent.succeeded`: refund guard (ported from `/recover`) + claim before FareHarbor + `in_flight` recheck/takeover + release. |
| `src/lib/booking/recover-from-pi.ts` | Claim before FareHarbor; `duplicate → existing`, `in_flight → processing`; release on every terminal. |
| `src/app/api/admin/booking-flow/book/route.ts` | Claim (website + PI only); reworked 23505 handling + alert; `finally` releases the claim. |
| `src/app/api/admin/booking-flow/book/route.post.test.ts` | **New.** POST-level tests for the `/book` claim + alert behavior. |

## Architecture decisions (non-obvious)

- **A dedicated table, not a `status='claiming'` row inside `bookings`.** A transient row in `bookings` would leak into ~16 readers (admin list, crons, catering, tracking) and especially the confirmation page + poller (which key on the PI with no status filter) and the 8-second refund recheck. A separate table leaves `bookings` and every reader **byte-for-byte unchanged** — the smallest possible blast radius. This is the third use of an existing, trusted idiom: see `report-conversion.ts` (`google_ads_conversions` upsert) and `create-intent.ts` (`pricing_quotes.consumed_at`).
- **The claim is an optimisation, not the last line of defence.** If the claim layer is unavailable (table missing, DB hiccup) `claimPaymentIntent` returns `'unavailable'` and the caller proceeds exactly as before — the `UNIQUE(stripe_payment_intent_id)` constraint and the retained `23505`-cancel branches remain the backstop. This means the code is safe to deploy *before* the migration is applied (it just isn't active yet).
- **Crash recovery is preserved.** A crashed owner leaves a stale claim. Two mechanisms recover it: (1) `claimPaymentIntent` reclaims a claim older than `STALE_CLAIM_MS` (90s) with no booking; (2) the webhook, on `in_flight`, waits the 8s recheck window and **takes over** if the owner stalled (the unique constraint + `23505` branch stay the final guard against a slow-but-alive owner).
- **The `23505`-cancel branches are kept as defence-in-depth.** Under the claim model the loser never creates a FareHarbor booking, so they should be unreachable — but if they ever fire it signals a claim-logic bug, and they still clean up.

## How it works

```
finalize path (webhook / recover / book)
  └─ idempotency: bookings row for PI already exists?  → yes: done (dedup)
  └─ refund guard: PI already refunded?                → yes: stop
  └─ claimPaymentIntent(supabase, pi)
       ├─ 'won'        → create FareHarbor booking → INSERT bookings row → releaseClaim
       ├─ 'duplicate'  → return existing booking (dedup), no FareHarbor call
       ├─ 'in_flight'  → browser: poll/processing; webhook: wait 8s, then done-or-takeover
       └─ 'unavailable'→ proceed (legacy path; unique constraint is the backstop)
```

`claimPaymentIntent` uses `upsert(..., { onConflict: 'payment_intent_id', ignoreDuplicates: true }).select()` — a returned row means we won; an empty result means we lost. On a loss it disambiguates: a `bookings` row exists → `duplicate`; a fresh claim and no booking → `in_flight`; a stale claim → reclaim → `won`. `releaseClaim` deletes the row on success or rollback (safe no-op otherwise).

The `/book` gate is **website + PI only** (`!isInternal && stripePaymentIntentId`): internal / partner-invoice / stripe-recovery bookings are admin-initiated, single-path, and pass through untouched.

## How to extend

- **New finalize path?** Call `claimPaymentIntent` right after your idempotency + refund checks and before any FareHarbor call; branch on the four outcomes as above; release the claim on every terminal (a `finally` is the cleanest pattern — see `/book`).
- **Tune crash recovery:** `STALE_CLAIM_MS` in `booking-claims.ts` (claim reclaim window) and `BOOKING_RECHECK_DELAY_MS` in the webhook (in-flight + refund recheck window).

## Dependencies

- Depends on: the `booking_claims` table (migration 083), the `bookings` `UNIQUE(stripe_payment_intent_id)` constraint (migration 052, backstop), Supabase admin client, FareHarbor client.
- Depended on by: the three finalize paths above. Builds directly on [payment-flow-hardening.md](payment-flow-hardening.md).

## Deployment note

Migration `083_booking_claims.sql` must be applied (table + RLS) and `src/lib/supabase/types.ts` regenerated. If the `SUPABASE_MANAGEMENT_TOKEN` is expired, apply the SQL via the Supabase dashboard SQL editor. The code degrades to legacy behavior until the table exists, so ordering is not load-bearing.
