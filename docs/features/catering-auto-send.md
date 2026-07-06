# Catering order auto-send (7-day window)

## What was built

Before this change, the catering-order email to the supplier (Pure Boats) was **entirely manual** — a booking with food/drinks extras only got a Slack "review needed" ping at booking time; a human had to open the admin catering dashboard and click "Send" to actually notify the supplier. Now that email sends itself automatically:

- **Booked within 7 days of departure** (last-minute) — sent **instantly**, the moment the booking is created (same instant as the confirmation email and Slack notification).
- **Booked more than 7 days out** — held back, then sent automatically by a daily cron the moment the cruise crosses the 7-day-out mark.

The manual "Send" button in the admin catering dashboard still works — it's now just for resending, or force-sending early for a long-lead booking.

## Key files

- [`src/lib/catering/send-catering-email.ts`](../../src/lib/catering/send-catering-email.ts) — the actual send logic (build email, Resend, Slack confirmation, FareHarbor note update, stamp `catering_email_sent_at`). Extracted from the admin route so the manual button, the instant sends, and the cron all call identical code.
- [`src/lib/catering/auto-send-cutoff.ts`](../../src/lib/catering/auto-send-cutoff.ts) — `cateringAutoSendCutoffDate(daysAhead)` (pure date-window helper, used by the cron's SQL filter) and `isWithinCateringAutoSendWindow(bookingDate)` (same rule, used at the instant-send call sites). Both unit tested (`auto-send-cutoff.test.ts`) for month/year rollover and the UTC/Amsterdam timezone edge near midnight.
- [`src/app/api/cron/catering-auto-send/route.ts`](../../src/app/api/cron/catering-auto-send/route.ts) — daily Vercel Cron (08:30 UTC) safety net for long-lead bookings crossing the 7-day mark, and for any instant-send that failed (network hiccup, Resend outage) and never got marked `catering_email_sent_at`.
- **Instant-send call sites** — each one already builds the booking row and already fires the internal Slack "review needed" ping; a conditional `sendCateringOrderEmailForBooking(id)` was added alongside it:
  - [`src/app/api/webhooks/stripe/route.ts`](../../src/app/api/webhooks/stripe/route.ts) — `payment_intent.succeeded` (website/Stripe bookings). The booking insert now chains `.select('id').single()` to get the new row's id.
  - [`src/app/api/admin/booking-flow/book/route.ts`](../../src/app/api/admin/booking-flow/book/route.ts) — admin wizard (`saveToSupabase` now returns the inserted row's `id` on success).
  - [`src/app/api/cron/pending-fh-sweep/route.ts`](../../src/app/api/cron/pending-fh-sweep/route.ts) — recovered/parked bookings that get completed later (`claimed.id` was already in scope).
- [`src/app/api/admin/bookings/[id]/catering-email/route.ts`](../../src/app/api/admin/bookings/[id]/catering-email/route.ts) — admin manual send/resend button; now a thin wrapper around `sendCateringOrderEmailForBooking`.
- [`vercel.json`](../../vercel.json) — registers the new cron.

## Architecture decisions

**Instant send at creation time, not "wait for the next cron tick."** A last-minute booking's supplier email fires in the same `Promise.allSettled` as the confirmation email and Slack ping — no cron-latency gap. The daily cron exists only for two things: (1) long-lead bookings that need to wait until they cross the 7-day mark, and (2) a safety net — if an instant send fails, the row's `catering_email_sent_at` stays null and the cron will pick it up and retry on its next run.

**One shared predicate, three call sites, one cron.** `isWithinCateringAutoSendWindow(bookingDate)` and the cron's `booking_date <= cateringAutoSendCutoffDate(7)` SQL filter both express the exact same rule (`bookingDate <= today + 7 days`), so there's no risk of the instant-send path and the cron disagreeing about what "within the window" means. The three creation-time call sites (Stripe webhook, admin wizard, pending-fh-sweep recovery) all needed the same one-line addition: check the predicate, call the shared send function if true.

**Eligibility keyed on `catering_email_sent_at IS NULL`**, the same column the admin dashboard already used to show "pending" catering orders. No new tracking column was needed — this feature converts what was previously a manually-cleared "pending" queue into one that clears itself, whether that's instantly or via the cron.

**Eligibility uses `hasCatering()` (food + drinks)**, matching the exact predicate the send function itself requires (`filterCateringItems`), not the food-only filter the admin dashboard's "Food Orders" view uses for a different purpose.

**The payment-link booking path was left untouched.** It never had any catering notification (not even the Slack ping) before this change — that's a pre-existing gap, not something introduced here. The daily cron still covers it as a fallback once such a booking reaches `confirmed`/`booked` status.

**No unit tests for the cron route or the send function's DB/Resend/Slack calls** — this matches the existing pattern in this codebase: none of the other ~12 cron routes have tests either (they're thin orchestration over Supabase/Resend/Slack, already exercised manually). The new *business logic* — the date-window calculation, and the instant-send decision at each of the three call sites — is unit tested; the orchestration is not, for consistency with sibling crons.

## How it works

```
Booking created (Stripe webhook / admin wizard / pending-fh-sweep recovery)
  → has food/drinks AND departure ≤ 7 days away?
        → yes: sendCateringOrderEmailForBooking(id) fires instantly,
               alongside the confirmation email + Slack ping
        → no:  nothing sent yet — stays queued (catering_email_sent_at IS NULL)

Daily cron (08:30 UTC) — catches long-lead bookings + any failed instant-send
  → cutoff = today + 7 days (Amsterdam-local)
  → SELECT bookings WHERE status IN (confirmed, booked)
                       AND booking_date <= cutoff
                       AND catering_email_sent_at IS NULL
  → filter to bookings with food/drinks in extras_selected
  → for each: sendCateringOrderEmailForBooking(id)

sendCateringOrderEmailForBooking(id) — shared by both paths + the manual admin button
  → email to supplier (Resend)
  → Slack confirmation
  → FareHarbor note update (best-effort)
  → stamp catering_email_sent_at
```

## How to extend

If the window (currently 7 days) ever needs to change, update the `7` passed to `isWithinCateringAutoSendWindow` at each of the three instant-send call sites AND the `cateringAutoSendCutoffDate(7)` call in the cron route — all four must stay in sync since they express the same rule in two different forms (in-process date comparison vs. a SQL `.lte()` filter).

## Dependencies

- Depends on `catering_email_sent_at` (pre-existing column) and the `extras_selected` JSON shape (`ExtrasLineItem[]`, category `food`/`drinks`).
- Depends on `CRON_SECRET`, `RESEND_API_KEY`, `CATERING_EMAIL_RECIPIENT` env vars (all pre-existing).
- The admin catering dashboard ([`admin-performance.md`](admin-performance.md) area) will show fewer "pending" bookings over time, since most bookings now clear themselves instantly.
