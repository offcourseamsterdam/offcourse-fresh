# Booking double-create guard (PaymentIntent claim)

## What was built

A race guard that prevents one paid Stripe PaymentIntent from producing **two**
FareHarbor bookings. Both booking write paths now atomically *claim* the
PaymentIntent — by inserting the booking row in a `pending_payment` state —
**before** they call FareHarbor. Exactly one path wins; the loser backs off
without creating anything.

## The bug it fixes

One payment can be turned into a booking by two independent paths:

- `POST /api/booking-flow/book` (browser, card payments), and
- the `payment_intent.succeeded` branch of `POST /api/webhooks/stripe` (iDEAL/async
  + safety net for when the browser flow doesn't complete).

Both used to do: *check if a booking exists for this PI → `fh.createBooking` →
INSERT*. The `UNIQUE(stripe_payment_intent_id)` constraint (migration 052) only
fails the **second INSERT** — which happens **after both have already called
`fh.createBooking`**. So a lost race left an **orphan FareHarbor booking**: real
capacity consumed, no Supabase row.

That orphan is the worst kind of bug to diagnose — Stripe shows one clean charge,
the customer sees one confirmation, Supabase has one tidy row, but FareHarbor
holds two reservations for one slot. The `fh-consistency` cron can't catch it
either (it reconciles Supabase → FareHarbor, so a booking with no Supabase row is
never checked). It surfaces only as "why is this slot full / why did a skipper
show up to an empty boat." Most likely with fast card payments + an eager webhook
(for iDEAL the browser `/book` path usually doesn't run, so only the webhook does).

## How it works

The constraint is the same `UNIQUE(stripe_payment_intent_id)`, but now it fires
**before** FareHarbor instead of after. New shared primitives in
[`src/lib/booking/claim.ts`](../../src/lib/booking/claim.ts):

- **`claimBooking(supabase, row)`** — inserts `row` with `status` forced to
  `pending_payment` and `booking_uuid` nulled. Returns:
  - `won` — this call created the row → proceed to `fh.createBooking`.
  - `lost` — a `23505` unique violation → another path owns this PI → **do NOT
    call FareHarbor**.
  - `error` — any other insert failure → fail safe, **do NOT call FareHarbor**
    (Stripe re-delivers the webhook for 72h, so the booking can still complete
    later — better an un-booked retry than an orphan booking).
- **`finalizeBooking(supabase, piId, { bookingUuid })`** — after FareHarbor
  confirms, promotes the claimed row to `confirmed` with the real booking UUID.
- **`releaseClaim(supabase, piId)`** — if `fh.createBooking` fails *after* winning
  the claim, deletes the still-`pending_payment` row so a retry isn't permanently
  blocked. A status guard means it never deletes a finalized booking.

`pending_payment` is an **existing** status value (no new enum introduced — see
[migration-code-drift-risk]), and active-booking reads filter on
`status in ('confirmed','booked')`, so a claim row is never mistaken for a real
booking during the brief window before finalize.

### Flow (website path)

```
validate (read-only)
  → claimBooking            lost → return { deduplicated: true }   (no FareHarbor call)
                            error → alert + return 500             (no FareHarbor call)
  → fh.createBooking        throws → releaseClaim + alert + 500
  → finalizeBooking         → status 'confirmed', booking_uuid set
  → promo usage + Slack + email + catering
```

The sequential idempotency pre-checks (a `select` by PI id in both paths) are
kept as a fast path; the claim is the authoritative **concurrent** guard. Between
the two, the race is fully closed: whoever inserts the claim row first wins, and
the other either sees it in its pre-check or loses the claim insert.

## Key files

| File | Change |
|------|--------|
| [`src/lib/booking/claim.ts`](../../src/lib/booking/claim.ts) | **New.** `claimBooking` / `finalizeBooking` / `releaseClaim` + `CLAIM_STATUS`. |
| [`src/lib/booking/claim.test.ts`](../../src/lib/booking/claim.test.ts) | **New.** 9 cases incl. the two-racers-one-booking test and the loser-never-calls-FareHarbor test. |
| [`src/app/api/admin/booking-flow/book/route.ts`](../../src/app/api/admin/booking-flow/book/route.ts) | Website path now claims → creates → finalizes. Internal/recovery path unchanged. Row-building extracted to `buildBookingRow` (shared, no drift). Fixed a silently-broken idempotency pre-check that selected a non-existent `fareharbor_booking_uuid` column. |
| [`src/app/api/webhooks/stripe/route.ts`](../../src/app/api/webhooks/stripe/route.ts) | `payment_intent.succeeded` now validates → claims → creates → finalizes, releasing the claim on FareHarbor failure. |
| [`src/lib/booking/notify-booking-failure.ts`](../../src/lib/booking/notify-booking-failure.ts) | Added a `db_claim` failure stage. |

## Architecture decisions

- **Claim with the full row, finalize with a tiny patch.** The claim inserts the
  entire booking row (everything known before FareHarbor) and finalize only
  patches `booking_uuid` + `status`. This keeps the two writes from drifting —
  there is one row definition (`buildBookingRow`), not a minimal-stub insert plus
  a big update that could fall out of sync.
- **Claim only on the website path.** The `UNIQUE` mutex keys on
  `stripe_payment_intent_id`, which is non-null only for website bookings. Internal
  / partner-invoice / stripe-recovery bookings are admin-triggered single writers
  with no competing path (and a null PI, which Postgres treats as distinct), so
  they keep the original validate → create → insert flow untouched.
- **Fail safe on claim error.** If the claim insert errors for a non-unique reason
  we deliberately do **not** call FareHarbor — an un-booked payment is recoverable
  (the webhook retries for 72h); an orphan FareHarbor booking is not.

## Ghost decision

**Not ghostable.** This is an internal correctness fix to the booking execution
chokepoint, not a recurring human decision the Ghost could shadow. Bookings remain
an `IRREVERSIBLE_KIND` pinned to a `dry_run` ceiling (CI-guarded in
`agent-runtime.test.ts`) — the Ghost still never auto-creates a real booking.

## Dependencies

- Depends on the `UNIQUE(stripe_payment_intent_id)` constraint from
  `supabase/migrations/052_bookings_security.sql`.
- The `fh-consistency` cron remains a Supabase → FareHarbor reconciliation; a
  FareHarbor → Supabase reverse check (to catch any pre-existing orphans) is
  tracked separately and not part of this change.
