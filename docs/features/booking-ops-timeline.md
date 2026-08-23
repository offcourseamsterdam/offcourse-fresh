# Booking Ops Timeline (Phase 1: visibility)

## What was built

A small checklist on every booking's detail row (`/admin/bookings`, expand a
row) showing where that specific booking actually is in its journey:
confirmed → catering ordered → supplier confirmed → captain assigned. Before
this, that picture only existed implicitly, scattered across four
independently-scheduled crons/agents (catering-auto-send, the Gmail sync that
detects a supplier's confirmation reply, the scheduling agent) that never
talked to each other or shared a notion of "what state is this booking in."

This is Phase 1 only: **visibility**, not control. No cron's trigger logic
changed; nothing here decides anything. See
`docs/plans/2026-08-07-ai-ops-orchestra-gap-analysis.md` Part 4 ("the
conductor gap") for the original motivation, and
`docs/plans/2026-08-07-booking-ops-timeline-plan.md` for the full
implementation plan this shipped from.

Also fixed in passing: `catering_confirmed` ops events had been silently
failing to insert since an earlier migration (124) rewrote the
`ops_events_event_type_check` constraint and accidentally dropped that value
— `emitOpsEvent()` swallows insert errors by design, so nothing ever
surfaced the gap. Confirmed directly against prod before fixing it.

## Key files

| File | Description |
|---|---|
| `supabase/migrations/121_ops_events_catering_types.sql` | Restores `catering_confirmed` to the live CHECK constraint and adds the new `catering_order_sent` type. |
| `src/lib/ops/events.ts` | `OpsEventType` union gains `'catering_order_sent'`. |
| `src/lib/catering/send-catering-email.ts` | Emits `catering_order_sent` right after a successful supplier send (shared by both the auto-send cron and the manual "Send to supplier" button). |
| `src/lib/scheduling/apply-assignments.ts` | `shift_assigned` events now carry `bookingId` (previously only `shiftId`/`staffId`) — needed to look up *when* a captain was assigned for a given booking. |
| `src/lib/ops/booking-timeline.ts` | `deriveBookingTimeline()` — the one piece of real logic, a pure function with no I/O. |
| `src/app/api/admin/bookings/[id]/timeline/route.ts` | `GET` endpoint — fetches real state, resolves the captain via the booking's own shift or (for shared-cruise bookings) a sibling shift on the same FareHarbor availability slot, and returns the derived timeline. |
| `src/components/admin/BookingTimeline.tsx` | Renders the checklist. |
| `src/components/admin/BookingDetailRow.tsx` | Mounts `<BookingTimeline>` in a new "Timeline" section. |

## Architecture decisions

**State comes from real columns, not from the event log.** `emitOpsEvent()`
is deliberately fire-and-forget — a failed write must never block a booking
or a payment (see `src/lib/ops/events.ts`'s own doc comment) — which means
the event log can silently have gaps, as the `catering_confirmed` bug above
proves. `deriveBookingTimeline()` therefore takes its done/not-done booleans
from real state columns (`bookings.catering_email_sent_at`,
`catering_confirmed_at`, whether a shift has a `staff_id`) and uses the event
log for exactly one thing: the *timestamp* of when a captain was assigned,
since that's the only step with no dedicated column of its own.

**Shared-cruise fallback.** A shared-cruise booking's captain isn't
necessarily on a shift row that has `booking_id` set to that booking — it's
one of possibly several bookings on the same FareHarbor availability slot.
The route falls back to a sibling shift on the same
`fareharbor_availability_pk` when the booking's own shift row (if any) has no
`staff_id`, the same pattern `admin/planning/page.tsx` already uses. Known
limitation: in that fallback case, the step shows correctly as *done*, but
its *timestamp* may be missing (the `shift_assigned` event is only ever
stamped with the ID of the one booking that happens to own that shift row).
Documented, not silently wrong — the UI shows the step done with no date
rather than a wrong date.

## How it works

1. `BookingTimeline` (client component) fetches
   `GET /api/admin/bookings/[id]/timeline` via `useAdminFetch`.
2. The route reads the booking's real columns, resolves its shift (own, then
   shared-cruise fallback), and — only if a captain is actually assigned —
   looks up the `shift_assigned` ops event for that shift to get a timestamp.
3. `deriveBookingTimeline()` turns that into an ordered list of steps, each
   with `applicable` (catering steps only apply if the booking has food
   extras), `done`, and `occurredAt`.
4. The component renders a checkmark or empty circle per applicable step,
   plus a red "Booking cancelled" line when the booking was cancelled — a
   cancelled booking still shows what already happened before cancellation
   (e.g. catering that had already gone out).

## How to extend

Adding a new step (e.g. a future "review requested" or "weather rescheduled"
stage): add a case to `deriveBookingTimeline()`'s `steps` array with its
`applicable`/`done`/`occurredAt` logic, and wire its real state source (a new
column, or a new ops event type + lookup) into the route. No changes needed
to `BookingTimeline.tsx` — it renders whatever `applicable` steps come back.

## Dependencies

**Depends on:** the `ops_events` table (`083_ops_events.sql`), the `shifts`
and `bookings` tables' existing columns, `hasFood()` from
`src/lib/catering/filter.ts`.

**Depended on by:** the AI Ops Center's automated-actions feed
(`src/app/api/admin/ops-center/summary/route.ts`) already knew how to
display a `catering_order_sent` event — this feature is what makes that
event actually get emitted for the first time.

**Explicitly deferred (Phase 2, not built here):** making any cron
(`ghost-ops`, `catering-auto-send`, etc.) *read* from this timeline instead
of independently re-deriving booking state from raw dates — that's a bigger
change touching live decision-making paths, and the two new journey stages
named in the gap analysis (day-before reminder, post-trip review request)
don't exist as features yet, so there's nothing to add a timeline step for
until they're built.
