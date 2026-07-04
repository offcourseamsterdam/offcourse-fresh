# Observability hardening + money-path test coverage

## What was built

Two related batches that make failures **surface fast and stay debuggable**, plus
the test coverage that pins the money path so a regression can't slip through CI.

### A. Money-path test coverage (previously untested)

The highest-revenue code had almost no handler-level tests. Added:

- **`src/lib/booking/create-intent.test.ts`** — the quote-trust / anti-tampering
  boundary: missing/expired/consumed quote, total-drift refusal, the €0.50 floor,
  and the happy path (PI created against the recomputed total + quote consumed).
- **`src/lib/booking/recover-from-pi.test.ts`** — extras parsing from the stored
  quote, idempotency (existing booking → no second FH booking), and the recovery
  insert with the VAT fallback.
- **`src/app/api/admin/booking-flow/book/route.handler.test.ts`** — the POST
  handler: validate-before-create ordering, private (1) vs shared (per-guest)
  customer counts, 9%/21% VAT fallback, idempotency, the claim win/lose race, the
  fail-safe on a non-unique claim error, and the **save-failure path that alerts
  but still returns success**.
- **Stripe webhook** — pinned the `Number(meta.x) || extractVat(...)` VAT-fallback
  trap: a metadata VAT of `'0'` is falsy and triggers recompute, while a real value
  passes through.

### B. Observability hardening

1. **Silent crons now alert.** `auto-close-entries`, `ghost-ops`, `shift-reminder`,
   and `fh-consistency` previously returned a bare 500 (or threw) with no alert.
   Each now wraps its work and calls `alertCronFailure` so an unattended failure
   pages Slack. `shift-reminder` (every 5 min, the captain check-in safety net) and
   `fh-consistency` (the orphan/cancelled-booking reconciler) were the most dangerous.

2. **Consistency-cron blind spot fixed.** `fh-consistency` filtered
   `.not('booking_date','is',null)`, silently skipping website/webhook bookings that
   leave `booking_date` null and keep the real departure in `start_time`. The query
   now also includes `booking_date IS NULL AND start_time >= today` (via `.or(...)`),
   and a shared `consistencyDisplayDate()` falls back to the `start_time` date — the
   same fallback `generate-shifts` already uses.

3. **Second alert channel.** `src/lib/alerts/critical-alert.ts` (`sendCriticalAlert`)
   fans CRITICAL money alerts out to Slack **AND** email (Resend), so a muted/
   misconfigured Slack can't swallow a paid-but-unrecorded booking. Wired into the
   `/book` save-failure alert, the webhook booking-failure alert, and the chargeback
   alert. Gated on `ALERT_EMAIL_RECIPIENT` (Slack-only if unset).

4. **Webhook audit log.** `src/lib/webhooks/log.ts` (`logWebhookEvent`) writes every
   verified Stripe event to the previously-dormant `webhook_logs` table
   (`provider_event_id`, `signature_valid`, `payload`, `processed`) — a durable
   replay/audit breadcrumb so a missing booking can be traced from our own DB.

## Key files

| File | Change |
|------|--------|
| `src/lib/alerts/critical-alert.ts` | **New.** `sendCriticalAlert` → Slack + email, best-effort. |
| `src/lib/webhooks/log.ts` | **New.** `logWebhookEvent` → best-effort `webhook_logs` insert. |
| `src/app/api/cron/{auto-close-entries,ghost-ops,shift-reminder,fh-consistency}/route.ts` | `alertCronFailure` on failure. |
| `src/app/api/cron/fh-consistency/route.ts` | Null-`booking_date` rows now included; `consistencyDisplayDate` helper. |
| `src/app/api/webhooks/stripe/route.ts` | Logs every event; critical alerts routed through `sendCriticalAlert`. |
| `src/app/api/admin/booking-flow/book/route.ts` | Save-failure alert routed through `sendCriticalAlert`. |
| `.env.example` | New `ALERT_EMAIL_RECIPIENT`. |
| `*.test.ts` (5 new files) | Money-path + alert + log + consistency-date coverage (+38 tests). |

## Architecture decisions

- **Alert email strips `*` and backticks but NOT underscores** — Stripe IDs (`pi_…`)
  and PKs contain underscores; stripping them would mangle the exact value you need
  to recover. (Caught by a test.)
- **Crons throw into a single catch** rather than returning ad-hoc 500s, so every
  failure path goes through one `alertCronFailure` call.
- **Webhook logging is best-effort and additive** — a wrapped insert that can never
  break or delay event handling.

## Not done yet (scoped separately)

- **Per-event idempotency ledger** (refusing to re-process a redelivered
  `charge.refunded` / `charge.dispute.created`) needs a `UNIQUE` index on
  `webhook_logs.provider_event_id` (a migration) to be race-safe. The audit log is
  in place; the dedup gate is a follow-up.
- **Outscraper webhook logging** — same `logWebhookEvent` helper, not yet wired.

## Ghost decision

**Not ghostable.** Pure operational infrastructure (alerting, logging, cron safety) —
no recurring human decision for the Ghost to shadow.

## Dependencies

- `sendCriticalAlert` uses Resend (`RESEND_API_KEY`) + `ALERT_EMAIL_RECIPIENT`.
- `logWebhookEvent` writes the existing `webhook_logs` table (no migration).
- The null-date fix mirrors `resolveDate` in `src/lib/scheduling/generate-shifts.ts`.
