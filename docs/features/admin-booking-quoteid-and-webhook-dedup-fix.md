# Admin booking quoteId fix + FareHarbor webhook duplicate-row fix

## What was built

Two related bugs in the admin manual-booking flow were found and fixed:

1. **The admin booking wizard's "Continue to payment" step always failed** for `website`-sourced bookings with `Missing quoteId — please refresh your booking and try again.`
2. **A separate Supabase Edge Function was silently duplicating booking rows** — about 11% of all bookings had a stale "shadow" copy sitting next to the real one, which would double-count in any report that sums `bookings` without deduplication.

## Key files

- [`src/app/[locale]/admin/fareharbor/page.tsx`](../../src/app/[locale]/admin/fareharbor/page.tsx) — `handleExtrasContinue` now fetches a server-issued quote before creating the Stripe PaymentIntent, and fixed the response-envelope bug (`json.data.clientSecret`, not `json.clientSecret`).
- [`supabase/functions/fareharbor-webhook/index.ts`](../../supabase/functions/fareharbor-webhook/index.ts) — reconciles on `booking_uuid` instead of `booking_id` before writing. Newly checked into the repo; previously only existed as a deployed Supabase Edge Function with no source control.
- [`supabase/functions/_shared/cors.ts`](../../supabase/functions/_shared/cors.ts) — shared CORS headers used by the function above (also newly checked in).
- [`supabase/migrations/086_dedupe_shadow_bookings.sql`](../../supabase/migrations/086_dedupe_shadow_bookings.sql) — one-time cleanup that removed the 35 existing duplicate rows.

## Architecture decisions

### Bug 1 — quoteId contract mismatch

The public checkout (`src/components/checkout/CheckoutFlow.tsx`) and `/api/booking-flow/create-intent` share a two-step contract: call `/api/booking-flow/quote` first to get a server-issued `quoteId` (the canonical, tamper-proof price), then pass that into `create-intent`. `POST /api/admin/booking-flow/create-intent` is a one-line re-export of the same public `create-intent` handler (`"Admin create-intent route — same logic as public route"`), so it inherited the same hard requirement for `quoteId` — but the admin wizard was never updated to fetch one. It computed a price client-side and posted straight to `create-intent`, which always 400'd.

Fix: `handleExtrasContinue` now calls `/api/booking-flow/quote` (the public quote endpoint has no auth — same trust model as availability lookups) with the booking's `listingId`, `availPk`, `customerTypeRatePk`, `guestCount`, `category`, `durationMinutes` (derived from the selected slot's start/end), `selectedExtraIds`, and `extraQuantities` (derived from the extras calculation's line items). The returned `quoteId` is then passed into `create-intent` exactly like the public flow does.

### Bug 2 — two systems, one table, no agreed-upon key

Two independent writers insert into `public.bookings`:
- **This Next.js app** (Stripe webhook + admin `/book` route) — the payment-authoritative writer. Never touches `raw_payload`.
- **The `fareharbor-webhook` Edge Function** — invoked by FareHarbor on every booking event, including bookings made through unrelated channels (e.g. an affiliate integration). Historically the sole record for ~236 bookings that never touch this app at all — so `raw_payload IS NOT NULL` is *not* a "duplicate" signal by itself.

The webhook tried to avoid duplicates with `upsert(..., { onConflict: 'booking_id' })`, but the two writers use different values for `booking_id` (this app: Stripe PaymentIntent id or FareHarbor UUID; the webhook: FareHarbor's *numeric* booking pk) — they never collide, so the upsert always inserted a new row instead of finding the app's existing one.

Fix: the webhook now looks up an existing row by `booking_uuid` (the one identifier both writers agree on) before deciding what to do:
- **Row exists** (app-owned booking) → `UPDATE` only `raw_payload`, leaving every payment-authoritative field untouched.
- **No row** (genuinely external/affiliate booking) → insert as before, keyed on `booking_id` = FareHarbor's numeric pk, so repeat webhooks for the same external booking keep updating in place.

No unique DB constraint was added on `booking_uuid` — a constraint would risk rejecting a legitimate write if the two writers ever race, and the ownership-check above already prevents the duplicate at the application level.

## How it works

```
Admin wizard "Continue to payment"
  → POST /api/booking-flow/quote        (get canonical price + quoteId)
  → POST /api/admin/booking-flow/create-intent   (quoteId only; server recomputes + charges)

FareHarbor booking event
  → fareharbor-webhook Edge Function
      → SELECT bookings WHERE booking_uuid = ?
      → if found:  UPDATE raw_payload only
      → if not:    UPSERT full row (onConflict: booking_id)
```

## How to extend

- If another admin flow needs to create a Stripe PaymentIntent, follow the same two-call pattern (`quote` → `create-intent`) rather than computing a price client-side and posting straight to `create-intent`.
- If a new external system needs to write bookings into this table, reconcile on `booking_uuid` first, the same way this webhook does — never assume `booking_id` is a shared key across writers.

## Dependencies

- Depends on `/api/booking-flow/quote` and `/api/booking-flow/calculate-quote` (pre-existing, used by the public checkout).
- The Edge Function is deployed directly to Supabase (`supabase functions deploy fareharbor-webhook --no-verify-jwt`) — it must stay `verify_jwt: false` since FareHarbor calls it without a Supabase JWT.
