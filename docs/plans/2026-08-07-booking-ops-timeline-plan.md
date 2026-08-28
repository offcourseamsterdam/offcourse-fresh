# Booking Ops Timeline (Conductor, Phase 1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Give the AI ops system (and Beer) one place to see where a single
booking actually is in its journey — confirmed → catering ordered → supplier
confirmed → captain assigned — instead of that picture only existing
implicitly, scattered across five independently-scheduled crons that never
talk to each other. This is Phase 1 only: **visibility**, not control. No
existing cron's trigger logic changes; nothing here decides anything. See
`docs/plans/2026-08-07-ai-ops-orchestra-gap-analysis.md` Part 4 (“the
conductor gap”) for the why.

**Architecture:** Reuse the `ops_events` table that already exists
(`src/lib/ops/events.ts`, migration `083_ops_events.sql`) as the event
substrate — do NOT create a parallel table. Two small gaps get closed in the
existing instrumentation (a missing event type + a missing `booking_id` on
an existing emit call), then a new pure function derives a booking's current
stage **primarily from real state columns** (`bookings.catering_email_sent_at`
etc.), using `ops_events` only to attach a "when" timestamp where no column
already carries one. This matters: `emitOpsEvent` is explicitly
fire-and-forget and can silently fail (by design — it must never block a
booking or a payment), so it must never be the sole source of truth for
"did this happen," only for "when did it happen."

**Tech Stack:** Next.js 16 App Router route handler, Supabase (service-role,
via `createAdminClient`), Vitest, React (client component using the existing
`useAdminFetch` hook).

**Known limitation, stated up front:** for shared-cruise bookings (multiple
listings sharing one FareHarbor availability slot), the "captain assigned"
step's *done/not-done* state will be correct, but its *timestamp* may be
missing — the `shift_assigned` event is only ever stamped with the ID of the
one booking that happens to own that shift row, not every booking sharing
the slot. This is documented, not silently wrong: the UI shows the step as
done with no date rather than a wrong date.

---

### Task 0: Fix a real, live bug found while planning this

**Files:**
- Create: `supabase/migrations/121_ops_events_catering_types.sql`

While tracing where a `catering order sent` event should be emitted, I found
that `src/lib/gmail/sync.ts` already emits an ops event with
`eventType: 'catering_confirmed'` whenever a supplier confirms an order by
email — but the **live production** `ops_events_event_type_check` constraint
(verified directly against prod via the Management API) only allows the list
from migration `086_guest_move_events.sql`, which does **not** include
`catering_confirmed`. Since `emitOpsEvent()` swallows all insert errors by
design (`src/lib/ops/events.ts` — "never blocks the caller"), every single
`catering_confirmed` event has been silently failing to insert since that
feature shipped (migration `109_catering_confirmation.sql`). Nothing broke —
`bookings.catering_confirmed_at` itself is written correctly by a separate
statement in the same code path — but the event log has a silent hole in it.

This task fixes that hole and adds the one new event type this plan needs, in
a single constraint replace (same pattern as migration 086 — full
`DROP CONSTRAINT` / `ADD CONSTRAINT`, not an `ALTER ... ADD VALUE`, since this
is a plain `CHECK`, not a Postgres enum type).

**Step 1: Write the migration**

```sql
-- 121: fix a silent gap in ops_events_event_type_check (catering_confirmed
-- was emitted by gmail/sync.ts since migration 109 but was never added to
-- this constraint, so every insert has been failing silently — emitOpsEvent
-- swallows errors by design) — and add catering_order_sent for the new
-- booking-ops-timeline feature.

ALTER TABLE public.ops_events DROP CONSTRAINT IF EXISTS ops_events_event_type_check;

ALTER TABLE public.ops_events ADD CONSTRAINT ops_events_event_type_check
  CHECK (event_type IN (
    'booking_created',
    'booking_paid',
    'booking_confirmed',
    'booking_cancelled',
    'booking_fh_failed',
    'booking_fh_recovered',
    'shift_assigned',
    'shift_unassigned',
    'recommendation_created',
    'recommendation_reviewed',
    'recommendation_approved',
    'recommendation_rejected',
    'guest_move_requested',
    'guest_move_accepted',
    'guest_move_declined',
    'guest_move_deferred',
    'guest_move_expired',
    'catering_confirmed',
    'catering_order_sent'
  ));
```

**Step 2: Run it against prod via the Management API**

Per CLAUDE.md's Supabase section — this branch has authority to run this
directly:

```bash
SQL=$(cat supabase/migrations/121_ops_events_catering_types.sql)
curl -s -X POST "https://api.supabase.com/v1/projects/fkylzllxvepmrtqxisrn/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$SQL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"
```

**Step 3: Verify**

```bash
SQL="SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ops_events_event_type_check';"
curl -s -X POST "https://api.supabase.com/v1/projects/fkylzllxvepmrtqxisrn/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$SQL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"
```
Expected: the returned CHECK definition includes both `catering_confirmed`
and `catering_order_sent`.

**Step 4: Commit**

```bash
git add supabase/migrations/121_ops_events_catering_types.sql
git commit -m "fix: add missing catering event types to ops_events check constraint"
```

---

### Task 1: Add the `catering_order_sent` TS type + emit it on send

**Files:**
- Modify: `src/lib/ops/events.ts` (the `OpsEventType` union, ~line 24)
- Modify: `src/lib/catering/send-catering-email.ts`
- Test: `src/lib/catering/send-catering-email.test.ts`

**Step 1: Add the type**

In `src/lib/ops/events.ts`, add to the `OpsEventType` union (next to
`catering_confirmed`):

```ts
  | 'catering_confirmed'
  | 'catering_order_sent'
```

**Step 2: Write the failing test**

Add to `send-catering-email.test.ts`. Follow the file's existing mock style
exactly (it already mocks `@/lib/supabase/admin`, `@/lib/slack/send-notification`,
`@/lib/fareharbor/client`, `@/lib/gmail/client`) — add one more mock:

```ts
const h = vi.hoisted(() => ({
  // ...existing fields...
  emitOpsEvent: vi.fn().mockResolvedValue(undefined),
}))
// ...existing vi.mock calls...
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: h.emitOpsEvent }))
```

Then add a test (near the existing "sends the email" test):

```ts
it('emits a catering_order_sent ops event on a successful send', async () => {
  h.single.mockResolvedValue({ data: { ...BOOKING, extras_selected: [food] }, error: null })
  await sendCateringOrderEmailForBooking('b1')
  expect(h.emitOpsEvent).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: 'catering_order_sent', bookingId: 'b1' })
  )
})

it('does not emit an event when there is nothing to send', async () => {
  h.single.mockResolvedValue({ data: { ...BOOKING, extras_selected: [drinks] }, error: null })
  await sendCateringOrderEmailForBooking('b1')
  expect(h.emitOpsEvent).not.toHaveBeenCalled()
})
```

**Step 2b: Run to verify it fails**

```bash
npx vitest run src/lib/catering/send-catering-email.test.ts
```
Expected: FAIL — `emitOpsEvent` not called (not wired up yet), or a mock
import error if `@/lib/ops/events` isn't mocked yet.

**Step 3: Implement**

In `src/lib/catering/send-catering-email.ts`, add the import:

```ts
import { emitOpsEvent } from '@/lib/ops/events'
```

Then, right after the `catering_email_sent_at` update succeeds (just before
`return { ok: true, resent: isResend, recipient }`), add:

```ts
  await emitOpsEvent({
    eventType: 'catering_order_sent',
    actorType: 'system',
    bookingId,
    payload: { resent: isResend, recipient },
    source: 'catering/send-catering-email',
  })
```

**Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/catering/send-catering-email.test.ts
```
Expected: PASS, all tests including the two new ones.

**Step 5: Commit**

```bash
git add src/lib/ops/events.ts src/lib/catering/send-catering-email.ts src/lib/catering/send-catering-email.test.ts
git commit -m "feat: emit catering_order_sent ops event (both auto-send and manual send paths)"
```

Note: this one function is shared by the `catering-auto-send` cron AND the
admin "Send to supplier" button (see the file's own header comment) — one
change covers both trigger paths, no duplication.

---

### Task 2: Attach `bookingId` to the existing `shift_assigned` event

**Files:**
- Modify: `src/lib/scheduling/apply-assignments.ts` (lines 53–79)
- Test: `src/lib/scheduling/apply-assignments.test.ts`

Today `shift_assigned` events carry `shiftId`/`staffId` but not `bookingId`,
even though the `shifts` row being updated already has that column. Phase 2
(the "captain assigned" timeline step) needs to look up *when* a shift was
assigned for a given booking — this closes that gap.

**Step 1: Write the failing test**

In `apply-assignments.test.ts`, extend the `makeSupabase` helper's fake
`select('id')` response to also return `booking_id` per shift (add a second
param, e.g. `bookingIdByShift: Record<string, string | null> = {}`, default
empty so existing calls without it behave as before with `booking_id: null`).
Then add:

```ts
it('includes the shift\'s booking_id on the emitted event', async () => {
  const supabase = makeSupabase(['shift-1'], { 'shift-1': 'booking-99' })
  await applyScheduleAssignments(supabase, [{ shift_id: 'shift-1', staff_id: 'staff-1' }], {
    actorType: 'agent', source: 'test',
  })
  expect(emitOpsEvent).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: 'shift_assigned', bookingId: 'booking-99' })
  )
})

it('passes bookingId: null through for a shared-cruise shift with no booking_id', async () => {
  const supabase = makeSupabase(['shift-1']) // no bookingIdByShift entry
  await applyScheduleAssignments(supabase, [{ shift_id: 'shift-1', staff_id: 'staff-1' }], {
    actorType: 'agent', source: 'test',
  })
  expect(emitOpsEvent).toHaveBeenCalledWith(
    expect.objectContaining({ eventType: 'shift_assigned', bookingId: null })
  )
})
```

**Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/scheduling/apply-assignments.test.ts
```
Expected: FAIL — current mock/implementation never returns or reads
`booking_id`.

**Step 3: Implement**

In `apply-assignments.ts`, change line 59 from `.select('id')` to
`.select('id, booking_id')`, capture the row, and pass it through:

```ts
    const { data: updated } = await supabase
      .from('shifts')
      .update({ staff_id: a.staff_id, status: 'assigned' })
      .eq('id', a.shift_id)
      .eq('status', 'open')
      .is('staff_id', null)
      .select('id, booking_id')

    if (!updated?.length) {
      skipped.push({ shift_id: a.shift_id, reason: 'no longer open (manual change wins)' })
      continue
    }

    applied.push({ shift_id: a.shift_id, staff_name: a.staff_name })
    if (notify) {
      await notifyShiftAssigned(supabase, a.shift_id)
      await supabase.from('shifts').update({ notified_at: new Date().toISOString() }).eq('id', a.shift_id)
    }
    await emitOpsEvent({
      eventType: 'shift_assigned',
      actorType: actor.actorType,
      actorId: actor.actorId ?? null,
      bookingId: updated[0].booking_id ?? null,
      shiftId: a.shift_id,
      staffId: a.staff_id,
      proposalId: actor.proposalId ?? null,
      source: actor.source,
    })
```

**Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/scheduling/apply-assignments.test.ts
```
Expected: PASS, including the two new tests and all pre-existing ones
(update the mock's default so tests that don't care about `booking_id` still
pass — they'll now just assert `bookingId: null` implicitly wherever they
use `expect.objectContaining`, which ignores extra fields).

**Step 5: Commit**

```bash
git add src/lib/scheduling/apply-assignments.ts src/lib/scheduling/apply-assignments.test.ts
git commit -m "feat: attach booking_id to shift_assigned ops events"
```

---

### Task 3: `deriveBookingTimeline` — the pure function

**Files:**
- Create: `src/lib/ops/booking-timeline.ts`
- Test: `src/lib/ops/booking-timeline.test.ts`

This is the one piece of real business logic in this plan — a pure function,
no I/O, no mocking needed. It takes already-fetched state and returns the
ordered steps. Deliberately does NOT take `ops_events` rows as input for the
done/not-done booleans — only for the one timestamp column that doesn't
already exist (`captainAssignedAt`), per the Architecture note above.

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { deriveBookingTimeline } from './booking-timeline'

const base = {
  status: 'confirmed',
  createdAt: '2026-08-01T10:00:00Z',
  hasCatering: false,
  cateringEmailSentAt: null,
  cateringConfirmedAt: null,
  captainAssigned: false,
  captainAssignedAt: null,
}

describe('deriveBookingTimeline', () => {
  it('marks confirmed done and catering steps not applicable when there is no catering', () => {
    const t = deriveBookingTimeline(base)
    expect(t.cancelled).toBe(false)
    const byKey = Object.fromEntries(t.steps.map(s => [s.key, s]))
    expect(byKey.confirmed.done).toBe(true)
    expect(byKey.catering_ordered.applicable).toBe(false)
    expect(byKey.catering_confirmed.applicable).toBe(false)
    expect(byKey.captain_assigned.done).toBe(false)
  })

  it('walks through catering steps in order when catering is present', () => {
    const t = deriveBookingTimeline({
      ...base, hasCatering: true, cateringEmailSentAt: '2026-08-02T09:00:00Z',
    })
    const byKey = Object.fromEntries(t.steps.map(s => [s.key, s]))
    expect(byKey.catering_ordered.applicable).toBe(true)
    expect(byKey.catering_ordered.done).toBe(true)
    expect(byKey.catering_ordered.occurredAt).toBe('2026-08-02T09:00:00Z')
    expect(byKey.catering_confirmed.done).toBe(false)
  })

  it('marks captain_assigned done with its timestamp when assigned', () => {
    const t = deriveBookingTimeline({
      ...base, captainAssigned: true, captainAssignedAt: '2026-08-03T08:00:00Z',
    })
    const byKey = Object.fromEntries(t.steps.map(s => [s.key, s]))
    expect(byKey.captain_assigned.done).toBe(true)
    expect(byKey.captain_assigned.occurredAt).toBe('2026-08-03T08:00:00Z')
  })

  it('flags cancelled bookings without hiding what already happened', () => {
    const t = deriveBookingTimeline({ ...base, status: 'cancelled', hasCatering: true, cateringEmailSentAt: '2026-08-02T09:00:00Z' })
    expect(t.cancelled).toBe(true)
    const byKey = Object.fromEntries(t.steps.map(s => [s.key, s]))
    expect(byKey.confirmed.done).toBe(true) // it WAS confirmed before being cancelled
    expect(byKey.catering_ordered.done).toBe(true) // and catering had already gone out
  })

  it('treats a captain-assigned step with no timestamp as done, not broken', () => {
    // the shared-cruise limitation documented at the top of this plan
    const t = deriveBookingTimeline({ ...base, captainAssigned: true, captainAssignedAt: null })
    const byKey = Object.fromEntries(t.steps.map(s => [s.key, s]))
    expect(byKey.captain_assigned.done).toBe(true)
    expect(byKey.captain_assigned.occurredAt).toBeNull()
  })
})
```

**Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/ops/booking-timeline.test.ts
```
Expected: FAIL — module doesn't exist yet.

**Step 3: Implement**

```ts
// src/lib/ops/booking-timeline.ts

/**
 * Derives a booking's ops timeline from real state, not from the ops_events
 * log — emitOpsEvent is fire-and-forget and can silently fail (by design,
 * see src/lib/ops/events.ts), so it must never be the source of truth for
 * "did this happen." It's only used (by the caller, before this function
 * runs) to fill in `captainAssignedAt`, the one step with no dedicated
 * timestamp column of its own.
 */

export type BookingTimelineStepKey =
  | 'confirmed'
  | 'catering_ordered'
  | 'catering_confirmed'
  | 'captain_assigned'

export interface BookingTimelineStep {
  key: BookingTimelineStepKey
  label: string
  applicable: boolean
  done: boolean
  occurredAt: string | null
}

export interface BookingTimelineInput {
  status: string | null
  createdAt: string | null
  hasCatering: boolean
  cateringEmailSentAt: string | null
  cateringConfirmedAt: string | null
  captainAssigned: boolean
  captainAssignedAt: string | null
}

export interface BookingTimeline {
  cancelled: boolean
  steps: BookingTimelineStep[]
}

export function deriveBookingTimeline(input: BookingTimelineInput): BookingTimeline {
  const cancelled = input.status === 'cancelled'

  return {
    cancelled,
    steps: [
      {
        key: 'confirmed',
        label: 'Booking confirmed',
        applicable: true,
        // A cancelled booking was, by definition, confirmed at some point first.
        done: cancelled || input.status === 'confirmed' || input.status === 'booked',
        occurredAt: input.createdAt,
      },
      {
        key: 'catering_ordered',
        label: 'Catering order sent to supplier',
        applicable: input.hasCatering,
        done: !!input.cateringEmailSentAt,
        occurredAt: input.cateringEmailSentAt,
      },
      {
        key: 'catering_confirmed',
        label: 'Supplier confirmed the order',
        applicable: input.hasCatering,
        done: !!input.cateringConfirmedAt,
        occurredAt: input.cateringConfirmedAt,
      },
      {
        key: 'captain_assigned',
        label: 'Captain assigned',
        applicable: true,
        done: input.captainAssigned,
        occurredAt: input.captainAssignedAt,
      },
    ],
  }
}
```

**Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/ops/booking-timeline.test.ts
```
Expected: PASS, all 5 tests.

**Step 5: Commit**

```bash
git add src/lib/ops/booking-timeline.ts src/lib/ops/booking-timeline.test.ts
git commit -m "feat: add deriveBookingTimeline pure function"
```

---

### Task 4: `GET /api/admin/bookings/[id]/timeline`

**Files:**
- Create: `src/app/api/admin/bookings/[id]/timeline/route.ts`
- Test: `src/app/api/admin/bookings/[id]/timeline/route.test.ts`

Follow the exact conventions of
`src/app/api/admin/planning/ghost-activity/[id]/confirm/route.ts`:
`requireAdmin()` from `@/lib/auth/require-admin`, `apiOk`/`apiError` from
`@/lib/api/response`, `createAdminClient` from `@/lib/supabase/admin`.

**Step 1: Write the failing test**

Mirror the mocking style used in
`src/app/api/admin/planning/ghost-activity/[id]/confirm/route.test.ts`
(mock `@/lib/auth/require-admin` to pass, mock `@/lib/supabase/admin`'s
`from()` chain per-table). Cover:
- a private booking with no catering and an assigned captain (via
  `booking_id` match) → `captain_assigned.done === true`
- a booking with catering, order sent but not yet confirmed
- a shared-cruise booking whose own shift row is unassigned but a sibling
  shift row sharing its `fareharbor_availability_pk` has a captain →
  `captain_assigned.done === true` (the fallback path)
- unknown booking id → 404 via `apiError`

Run it, confirm it fails (route doesn't exist yet):
```bash
npx vitest run src/app/api/admin/bookings/\[id\]/timeline/route.test.ts
```

**Step 2: Implement**

```ts
import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasFood } from '@/lib/catering/filter'
import { deriveBookingTimeline } from '@/lib/ops/booking-timeline'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  const supabase = createAdminClient()

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, status, created_at, extras_selected, catering_email_sent_at, catering_confirmed_at, fareharbor_availability_pk')
    .eq('id', id)
    .single()

  if (error || !booking) return apiError('Booking not found', 404)

  const { data: ownShift } = await supabase
    .from('shifts')
    .select('id, staff_id')
    .eq('booking_id', id)
    .maybeSingle()

  let shift = ownShift

  // Shared-cruise bookings link to their captain via the FareHarbor
  // availability slot, not booking_id — same fallback the Planning page
  // uses (captainByBookingId in admin/planning/page.tsx).
  if (!shift?.staff_id && booking.fareharbor_availability_pk) {
    const { data: sharedShift } = await supabase
      .from('shifts')
      .select('id, staff_id')
      .eq('fareharbor_availability_pk', booking.fareharbor_availability_pk)
      .not('staff_id', 'is', null)
      .limit(1)
      .maybeSingle()
    if (sharedShift) shift = sharedShift
  }

  let captainAssignedAt: string | null = null
  if (shift?.staff_id) {
    const { data: event } = await supabase
      .from('ops_events')
      .select('occurred_at')
      .eq('event_type', 'shift_assigned')
      .eq('shift_id', shift.id)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    captainAssignedAt = event?.occurred_at ?? null
  }

  const timeline = deriveBookingTimeline({
    status: booking.status,
    createdAt: booking.created_at,
    hasCatering: hasFood(booking.extras_selected as never),
    cateringEmailSentAt: booking.catering_email_sent_at,
    cateringConfirmedAt: booking.catering_confirmed_at,
    captainAssigned: !!shift?.staff_id,
    captainAssignedAt,
  })

  return apiOk(timeline)
}
```

**Step 3: Run to verify it passes**

```bash
npx vitest run src/app/api/admin/bookings/\[id\]/timeline/route.test.ts
```

**Step 4: Update the admin route contract test coverage**

This route uses the plain `export async function GET(...)` shape, which
`admin-route-contract.test.ts` already recognizes (per CLAUDE.md's Gotchas —
no new pattern introduced, so no change needed there). Run it anyway to
confirm this route is correctly picked up as guarded:

```bash
npx vitest run src/lib/auth/admin-route-contract.test.ts
```
Expected: PASS, and the new route should NOT appear in any "unguarded
handlers" output.

**Step 5: Commit**

```bash
git add src/app/api/admin/bookings/\[id\]/timeline/
git commit -m "feat: add GET /api/admin/bookings/[id]/timeline endpoint"
```

---

### Task 5: Show it — `BookingTimeline` component in `BookingDetailRow`

**Files:**
- Create: `src/components/admin/BookingTimeline.tsx`
- Modify: `src/components/admin/BookingDetailRow.tsx`

No test file for this step — per CLAUDE.md's testing rules, component
rendering itself isn't unit-tested; verify it live in the browser instead
(Step 3 below).

**Step 1: Create the component**

```tsx
'use client'

import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtAdminDate } from '@/lib/admin/format'
import type { BookingTimeline as BookingTimelineData } from '@/lib/ops/booking-timeline'

export function BookingTimeline({ bookingId }: { bookingId: string }) {
  const { data, isLoading } = useAdminFetch<BookingTimelineData>(`/api/admin/bookings/${bookingId}/timeline`)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400 py-1">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading timeline…
      </div>
    )
  }
  if (!data) return null

  const visibleSteps = data.steps.filter(s => s.applicable)

  return (
    <div className="space-y-1.5">
      {data.cancelled && (
        <p className="text-xs font-medium text-red-600">Booking cancelled</p>
      )}
      {visibleSteps.map(step => (
        <div key={step.key} className="flex items-center gap-2 text-xs">
          {step.done
            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            : <Circle className="w-3.5 h-3.5 text-zinc-300 shrink-0" />}
          <span className={step.done ? 'text-zinc-700' : 'text-zinc-400'}>{step.label}</span>
          {step.occurredAt && (
            <span className="text-zinc-300">· {fmtAdminDate(step.occurredAt.split('T')[0])}</span>
          )}
        </div>
      ))}
    </div>
  )
}
```

**Step 2: Wire it into `BookingDetailRow.tsx`**

Read the full file first (it's 392 lines — this plan doesn't reproduce it).
Add `import { BookingTimeline } from './BookingTimeline'` at the top, and add
a small labeled section near the other at-a-glance info (alongside where
`CalendarDays`/`MapPin` sections render), e.g.:

```tsx
<div>
  <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">Timeline</p>
  <BookingTimeline bookingId={bookingId} />
</div>
```

**Step 3: Verify live in the browser**

Per CLAUDE.md's UI verification workflow:
1. `preview_start` the "AI Ops Engine Sync Worktree" launch config.
2. Navigate to `/en/admin/bookings`, expand a row for a private booking with
   catering that's already been sent (should show 3–4 steps, some checked).
3. Expand a row for a cancelled booking (should show the red "Booking
   cancelled" line plus whatever had already happened).
4. Expand a row for a shared-cruise booking with an assigned captain
   (confirms the availability-pk fallback works) at 375px/768px/1280px
   widths per the Responsive Design rules.

**Step 4: Commit**

```bash
git add src/components/admin/BookingTimeline.tsx src/components/admin/BookingDetailRow.tsx
git commit -m "feat: show per-booking ops timeline in the admin booking detail row"
```

---

### Task 6: Full verification + docs

**Files:**
- Create: `docs/features/booking-ops-timeline.md`
- Modify: `docs/features/README.md`

**Step 1: Full test suite + typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
```
Expected: both clean, full suite green (this repo currently sits at ~1850
tests — this plan adds roughly a dozen more).

**Step 2: Write the feature doc**

Cover, per CLAUDE.md's Documentation Rule: what was built (the shared event
log gap-fix + the per-booking timeline view), key files (this plan's task
list maps directly), the architectural decision to derive state from real
columns rather than trust the event log as ground truth, how to extend it
(adding a new step = add a case to `deriveBookingTimeline` + wire its real
state source in the route — the log itself needs no schema change unless a
brand-new event type is needed), and what it depends on / what could build
on it later (Phase 2 — agents reading `next_action` from this instead of
independently re-deriving state from dates, deliberately NOT done here).

**Step 3: Add to the docs index**

Add a row to `docs/features/README.md`'s table.

**Step 4: Commit**

```bash
git add docs/features/booking-ops-timeline.md docs/features/README.md
git commit -m "docs: booking ops timeline feature documentation"
```

---

## Explicitly out of scope for this plan

- Making any existing cron (`ghost-ops`, `catering-auto-send`, etc.) *read*
  from this timeline instead of independently re-deriving state from dates.
  That's the real Phase 2 — bigger, touches live decision-making paths, and
  deserves its own plan and its own review once Phase 1 has been live for a
  while.
- The two brand-new journey stages named in the gap analysis (day-before
  reminder, post-trip review request) — those don't exist as features yet,
  so there's nothing to log a timeline step for. Build the feature first;
  add the step after.
