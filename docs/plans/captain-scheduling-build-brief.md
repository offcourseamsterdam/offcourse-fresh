# Build Brief — Captain Scheduling, Roles, Time Tracking (Stage 1)

**Branch:** `feature/captain-scheduling` (branch from main AFTER merging
`claude/codebase-health-audit-bkda9o` — it contains the AdminFormModal/
useAdminSave foundation and security fixes this build rides on).
**Vision rules:** `docs/plans/00-operations-os-master-vision.md` §2 —
human-powered UI, single source of truth, append-only history.
**Decisions (Beer, 2026-06-12):** captains use their own `/captain`
portal (not /admin) · Slack two-way in/out included in this build ·
hours auto-approve with exception flags · ICS calendar feed included ·
no-show alerts NOT in v1 · reminders = ONE Slack DM 5 min before shift,
only if not checked in (anti-overload rule).

Work milestone by milestone. After each: `npx tsc --noEmit`, `npm test`,
commit. Verify in the dev server before moving on.

---

## Existing infrastructure to reuse (do not rebuild)

- **Roles**: `UserProfile.role` already has `'captain'`; `ProtectedLayout`
  takes `allowedRoles`; `/captain` layout already exists with
  `DashboardSidebar`; admin users page already invites by email + role.
- **UI foundation**: `AdminFormModal`, `useAdminSave`/`adminMutate`,
  field components (`src/components/admin/ui/`), `useAdminFetch`.
- **Auth guards**: `requireAdmin` (admin routes; contract test enforces —
  update its expected count), `requireCronSecret` (crons).
- **Slack outbound**: `postSlackText`. Inbound is NEW (M4).
- **`webhook_logs`**: typed in `lib/supabase/types.ts` but table never
  created — create it in M1's migration; M4 uses it for event dedupe.

## Migration (M1) — check current max migration number first

```
staff               id uuid pk, user_id uuid null FK→user_profiles (links login),
                    name, phone, email null, role text ('skipper'|'host'),
                    hourly_rate_cents int not null default 0,
                    slack_member_id text null, calendar_token uuid default gen_random_uuid(),
                    is_active bool, max_shifts_per_week int null, notes, created_at
shifts              id, date date, start_at timestamptz, end_at timestamptz,
                    boat_id FK→boats, staff_id FK→staff null,
                    booking_id FK→bookings null UNIQUE,
                    status ('open'|'assigned'|'confirmed'|'completed'|'cancelled'),
                    reminder_sent_at timestamptz null, notes, created_at, updated_at
staff_availability  id, staff_id FK, date date, status
                    ('available'|'unavailable'|'prefer_not'), note,
                    UNIQUE(staff_id, date)
time_entries        id, staff_id FK, shift_id FK null, clock_in_at, clock_out_at null,
                    source ('slack'|'portal'|'admin'),
                    hourly_rate_cents int  ← SNAPSHOT of staff rate at creation
                    flag text null ('auto_closed'|'manual_edit'|'overlong'|'no_shift'),
                    flag_resolved_by uuid null, note, created_at
webhook_logs        per the existing generated type (provider,
                    provider_event_id UNIQUE, payload jsonb, signature_valid,
                    processed_at, error)
```
RLS on, service-role only (bookings posture). Indexes: shifts(date),
shifts(staff_id), staff_availability(staff_id,date),
time_entries(staff_id, clock_in_at). Apply via Management API per
CLAUDE.md; regenerate types. Also apply 064_pricing_quotes_enable_rls.sql
if still unapplied.

## M1 — Staff management (admin)

`/admin/scheduling` page with a Staff tab: list (name, role, rate,
Slack linked?, active) + CRUD via AdminFormModal. Rate input in euros,
stored cents (use existing cents helpers). Fields: name, phone, email,
role, hourly rate, slack_member_id (plain text field + help text "Slack
profile → ⋮ → Copy member ID"), is_active, linked login (dropdown of
user_profiles with role captain, nullable). API: `/api/admin/scheduling/staff`
(+`/[id]`) with requireAdmin, zod-validated bodies.

## M2 — Shifts: sync from bookings + week grid

- **Pure function** `generateShiftsFromBookings(bookings, existingShifts)`
  → `{ toCreate, toUpdate }`. One open shift per confirmed booking
  (date/start/end/boat from the booking). Skip cancelled bookings; if a
  booking's time/boat changed after its shift was created, return an
  update. **Unit-test thoroughly** (the core logic of this build).
- `POST /api/admin/scheduling/sync` (requireAdmin) runs it for a date
  range; "Sync from bookings" button in the UI. Manual "Add shift" too
  (AdminFormModal) for non-booking shifts (maintenance day, charter hold).
- **Week grid**: days × boats; cells show shifts with status colors
  (open amber / assigned blue / confirmed green / completed zinc).
  Prev/Today/Next. Click shift → AdminFormModal: assign staff (dropdown
  of active skippers showing that date's availability + their assigned
  count this week), status, notes.
- On assignment: `postSlackText("🧑‍✈️ {name} assigned: Sat 21 Jun
  14:00–16:00 · Diana")` — channel message in v1; per-captain DM arrives
  with M4.
- Mobile (CLAUDE.md responsive rules): grid horizontal-scrolls at 375px,
  44px touch targets.

## M3 — Captain portal

`/captain` (ProtectedLayout allowedRoles `['captain','admin']`; resolve
staff record via `staff.user_id = profile.id`; show a friendly "ask the
admin to link your account" state if unlinked):
- **Home**: next shift card + big Check in / Check out button (state from
  open time_entry). Check-in creates `time_entries` (source 'portal',
  rate snapshotted, shift_id = today's matching shift if any, else
  flag 'no_shift'). Double check-in → no-op with message. Check-out
  closes it.
- **My shifts**: list grouped by week (read-only).
- **My availability**: month grid, tap to cycle
  available → prefer_not → unavailable. Writes `staff_availability`.
- Captain API routes under `/api/captain/*`: auth = session profile with
  role captain/admin AND matching staff record (no requireAdmin here —
  write a small `requireCaptain()` guard; NOTE: the admin route contract
  test does not cover /api/captain — keep these guards explicit).

## M4 — Slack two-way: in/out + reminders

**Manual setup first (Beer, ~20 min):** create app at api.slack.com/apps
→ enable Event Subscriptions (request URL
`https://<site>/api/webhooks/slack/events`), subscribe to bot event
`message.im`; OAuth scopes: `chat:write`, `im:history`, `im:write`,
`users:read`; install to workspace. Add to env (+ `.env.example` + zod
in `src/env.ts`): `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`.

- `POST /api/webhooks/slack/events`:
  1. **Verify signature**: `v0=` + HMAC-**SHA256** of
     `v0:{timestamp}:{rawBody}` with signing secret; reject if timestamp
     older than 5 min (replay). Fail closed when secret unset. Read the
     RAW body before JSON parsing (signature is over raw bytes).
  2. Handle `url_verification` challenge (echo `challenge`).
  3. Dedupe on Slack `event_id` via `webhook_logs` (Slack retries
     deliveries — duplicates must be no-ops). Respond 200 fast; the
     processing here is one DB write, inline is fine (no queue needed).
  4. `message.im` events, ignore bot's own messages: normalize text
     (trim/lowercase). `"in"` → open time entry for the staff matched by
     `slack_member_id` (same rules as portal check-in). `"out"` → close.
     Reply via `chat.postMessage` ("✅ Checked in 13:58 — Diana 14:00
     shift"). Unknown sender → polite "I don't recognize this account —
     ask Beer to link your Slack ID". Unknown text → short help reply.
- **Reminder cron** `/api/cron/shift-reminders` (vercel.json `*/5`,
  requireCronSecret, wire `alertCronFailure`): shifts starting within
  the next 5–10 min where staff has `slack_member_id`, no open time
  entry, `reminder_sent_at IS NULL` → ONE DM ("⏰ Your Diana shift starts
  at 14:00 — reply 'in' to check in") → set `reminder_sent_at`
  (idempotent). NO follow-ups, NO no-show alert (explicit decision).
- Unit-test the in/out state machine (double-in, out-without-in,
  auto-close interplay) and the signature verifier.

## M5 — Payroll + flags + ICS

- **Auto-close job** (extend the same cron): open entries past their
  shift's end + 1h → close at shift end, flag `'auto_closed'`. Entries
  > 12h with no shift → flag `'overlong'`.
- **Payroll tab** on `/admin/scheduling`: month picker → per staff:
  shifts worked, hours (sum of entries), rate, total €; flagged entries
  highlighted inline — edit/resolve via AdminFormModal (edits create the
  corrected value but keep `flag` + `flag_resolved_by` — append-only
  spirit). Auto-approved otherwise (decision). **CSV export** button
  (filename `payroll-2026-06.csv`).
- **ICS feed**: `GET /api/captain/calendar/[token]` matching
  `staff.calendar_token` → `text/calendar` of their assigned shifts
  (UID per shift id so updates replace, not duplicate). Captain portal
  shows the subscribe URL with copy button + "add to phone calendar"
  hint. Unit-test the ICS generation (escaping, UTC times).
- Unit-test payroll math (hours across midnight, rate snapshots).

## Wrap-up (required by CLAUDE.md)

- `docs/features/captain-scheduling.md` + index entry in
  `docs/features/README.md`.
- Update the admin sidebar: 'planning' coming-soon → Scheduling (live);
  captain portal nav: Home / My shifts / Availability.
- Full pass: `npx tsc --noEmit`, `npm test` (all green before AND after),
  `npm run build`, dev-server walkthrough: create staff → sync → assign
  (Slack msg arrives) → captain portal check-in → Slack 'out' → payroll
  shows the hours → ICS subscribes in a calendar app → mobile 375px.

## Out of scope (explicitly — do not build now)

Shift swaps · no-show alerts · AI rota proposals · WhatsApp anything ·
demand forecasting · multi-role granular admin permissions beyond the
existing role gate.
