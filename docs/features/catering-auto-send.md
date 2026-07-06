# Catering order auto-send (7-day window)

## What was built

Before this change, the catering-order email to the supplier (Pure Boats) was **entirely manual** — a booking with food/drinks extras only got a Slack "review needed" ping at booking time; a human had to open the admin catering dashboard and click "Send" to actually notify the supplier. Now that email sends itself automatically once a booking's departure is 7 days away or less:

- **Booked more than 7 days out** — the email is held back and sent automatically the moment the cruise crosses the 7-day-out mark.
- **Booked within 7 days of departure** (last-minute) — already inside the window the first time the cron sees it, so it sends on the next run, same as any other eligible booking.

The manual "Send" button in the admin catering dashboard still works — it's now just for resending or force-sending early, since the common case is automatic.

## Key files

- [`src/lib/catering/send-catering-email.ts`](../../src/lib/catering/send-catering-email.ts) — the actual send logic (build email, Resend, Slack confirmation, FareHarbor note update, stamp `catering_email_sent_at`). Extracted from the admin route so both the manual button and the cron call identical code.
- [`src/lib/catering/auto-send-cutoff.ts`](../../src/lib/catering/auto-send-cutoff.ts) — pure helper computing the Amsterdam-local cutoff date N days ahead; unit tested (`auto-send-cutoff.test.ts`) for month/year rollover and the UTC/Amsterdam timezone edge near midnight.
- [`src/app/api/cron/catering-auto-send/route.ts`](../../src/app/api/cron/catering-auto-send/route.ts) — daily Vercel Cron (08:30 UTC) that finds eligible bookings and sends.
- [`src/app/api/admin/bookings/[id]/catering-email/route.ts`](../../src/app/api/admin/bookings/[id]/catering-email/route.ts) — admin manual send/resend button; now a thin wrapper around `sendCateringOrderEmailForBooking`.
- [`vercel.json`](../../vercel.json) — registers the new cron.

## Architecture decisions

**One cron, one rule, no separate "send now" branch.** Rather than special-casing last-minute bookings (send immediately at booking time) vs. long-lead bookings (schedule for later), a single daily query — `booking_date <= today + 7 days AND catering_email_sent_at IS NULL` — naturally covers both: a booking made yesterday for next week is already inside the window on the very first cron run after it's created; a booking made a month out simply waits until the query's date filter includes it. Same latency (next daily cron tick) for every booking, same code path, nothing to keep in sync.

**Eligibility keyed on `catering_email_sent_at IS NULL`**, the same column the admin dashboard already used to show "pending" catering orders. No new tracking column was needed — this feature converts what was previously a manually-cleared "pending" queue into one that clears itself.

**Eligibility uses `hasCatering()` (food + drinks)**, matching the exact predicate the send function itself requires (`filterCateringItems`), not the food-only filter the admin dashboard's "Food Orders" view uses for a different purpose. This keeps "will the cron try to send this" consistent with "can this booking's email actually be sent."

**No unit tests for the cron route or the send function's DB/Resend/Slack calls** — this matches the existing pattern in this codebase: none of the other ~12 cron routes have tests either (they're thin orchestration over Supabase/Resend/Slack, already exercised manually). The new *business logic* — the date-window calculation — is unit tested per the project's testing rule; the orchestration is not, for consistency with sibling crons.

## How it works

```
Daily cron (08:30 UTC)
  → cutoff = today + 7 days (Amsterdam-local)
  → SELECT bookings WHERE status IN (confirmed, booked)
                       AND booking_date <= cutoff
                       AND catering_email_sent_at IS NULL
  → filter to bookings with food/drinks in extras_selected
  → for each: sendCateringOrderEmailForBooking(id)
        → email to supplier (Resend)
        → Slack confirmation
        → FareHarbor note update (best-effort)
        → stamp catering_email_sent_at
```

## How to extend

If the window (currently 7 days) ever needs to change, it's the single `7` argument to `cateringAutoSendCutoffDate(7)` in the cron route — no other code depends on the number.

## Dependencies

- Depends on `catering_email_sent_at` (pre-existing column) and the `extras_selected` JSON shape (`ExtrasLineItem[]`, category `food`/`drinks`).
- Depends on `CRON_SECRET`, `RESEND_API_KEY`, `CATERING_EMAIL_RECIPIENT` env vars (all pre-existing).
- The admin catering dashboard ([`admin-performance.md`](admin-performance.md) area) will show fewer "pending" bookings over time as this cron clears the backlog automatically.
