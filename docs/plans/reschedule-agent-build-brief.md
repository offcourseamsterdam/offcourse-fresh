# Build Brief — Reschedule Request Agent (first `agent_proposals` kind)

**Branch:** `feature/reschedule-agent` (branch from `main`).
**Vision rules:** `docs/plans/00-operations-os-master-vision.md` §2 — AI proposes,
human decides; agents are API clients, never UI users; human-powered UI
before an agent touches a domain (already true here — `/rebook` predates
this brief). Detail pattern: `ai-operations-vision.md` §1.
**Decided in chat (2026-09-20):** intake = the WhatsApp customer chat
channel · autonomy = draft-then-approve, no auto-execute in v1.

This is the **pilot** for the whole `agent_proposals` pattern — the first
row this table has ever held. Keep it narrow; the point is to prove the
loop end-to-end (signal → proposal → decision → outcome), not to cover
every reschedule edge case on day one.

---

## The headline finding — most of the schema already exists

Before writing anything, checked the live DB via `src/lib/supabase/types.ts`.
**`contacts`, `conversations`, `messages`, `agent_proposals`, `shifts`,
`staff`, `staff_availability`, `webhook_logs` are all already live tables**,
shaped almost exactly like `ai-operations-vision.md` and
`unified-inbox-and-comms.md` spec them (`conversations.wa_window_expires_at`
confirms WhatsApp was the intended first channel; `messages.provider` /
`provider_message_id` and `webhook_logs.provider_event_id` are ready for
webhook dedupe). **Nothing in `src/` writes to any of them** — the only
reference in the whole codebase is `assigned-captain.ts` reading `shifts`
read-only to print a name on an email/SMS.

**This means M1–M4 below need zero new migrations.** If a real gap turns
up mid-build (e.g. a column genuinely missing), add it — but the default
assumption is reuse, not a new table.

## Existing infrastructure to reuse (do not rebuild)

- **Reschedule the booking itself** — `POST /api/admin/bookings/[id]/rebook`
  (`src/app/api/admin/bookings/[id]/rebook/route.ts`) already validates the
  new slot against live FareHarbor availability, creates the linked
  rebooking (FH cancels the old one via the `rebooking` field — do NOT add
  a separate cancel call, see that file's own comment on the Brenda
  Blechle incident), updates the booking row, Slacks ops, and emails the
  customer via `sendRescheduleEmail`. **The agent calls this route. It does
  not touch FareHarbor directly.**
- **Real availability lookup** — `GET /api/admin/booking-flow?date=` — same
  endpoint `RescheduleBookingModal.tsx` already calls to populate slots.
- **Skipper-per-booking lookup pattern** — `getCaptainFirstNames()` in
  `src/lib/scheduling/assigned-captain.ts` shows how to resolve
  `shifts.staff_id` for a booking (own `booking_id`, falling back to shared
  `fareharbor_availability_pk`). Extend, don't duplicate.
- **Per-skipper Slack DM** — `postSlackDM(text, channel)` in
  `src/lib/slack/send-notification.ts` already accepts an arbitrary Slack
  user ID as `channel` — a skipper's `staff.slack_member_id` works as-is.
  **No new Slack infra needed for skipper notification.** Precondition:
  confirm `SLACK_BOT_TOKEN` is actually set in the deployed environment
  (it's in CLAUDE.md's env var list but not yet in `src/env.ts`'s zod
  schema — verify in Vercel before relying on it; `postSlackDM` no-ops to
  `false` if it's missing, which the agent must treat as "notification
  failed," not silently ignore).
- **`agent_proposals` columns** — `kind`, `payload` (jsonb), `reasoning`,
  `status`, `human_edits`, `outcome`, `conversation_id`,
  `trigger_message_id`, `model` already match the vision doc's design
  exactly. Use `kind: 'reschedule_request'`.
- **Ops alerting** — `postSlackOps()` for the "new proposal ready" ping,
  same routing rule as everything else non-booking/non-catering.

## Open decisions to confirm before/at M1

1. **WhatsApp provider setup** — Twilio WhatsApp Business needs Meta
   business verification (lead time item — start this first, same
   guidance as `unified-inbox-and-comms.md` §6). `TWILIO_ACCOUNT_SID`/
   `AUTH_TOKEN`/`FROM_NUMBER` already exist in `src/env.ts`; confirm the
   number is WhatsApp-enabled, not SMS-only.
2. **Approval surface for v1** — no Slack interactive buttons yet (that's
   a real Slack App/Events API upgrade — bigger lift, see
   `00-operations-os-master-vision.md` §9's Slack-upgrade note). **Proposed:**
   a minimal admin-auth-gated page, `/admin/proposals/[id]`, with
   Approve / Edit / Reject — not a Slack button. Confirm this is
   acceptable for v1 before building it.
3. **No skipper available at any candidate slot** — proposed behavior:
   the proposal says so explicitly ("no skipper free — needs manual
   assignment") and still lets Beer approve the booking reschedule alone;
   it never silently books a cruise with nobody assigned. Confirm.
4. **Non-reschedule messages** — until Phase 1's real inbox UI exists,
   what should happen to a WhatsApp message that ISN'T a reschedule
   request? Proposed: still capture it (M1 always fires), but only Slack
   Beer a heads-up with the raw text — no drafted proposal. Confirm this
   is enough for v1 rather than blocking on building more of the inbox.

## M1 — WhatsApp intake (data capture only, no UI)

`POST /api/webhooks/twilio/whatsapp`:
1. Verify Twilio's request signature (fail closed if unset — same posture
   as the Slack verifier described in `captain-scheduling-build-brief.md`
   M4).
2. Dedupe on Twilio's `MessageSid` via `webhook_logs.provider_event_id`
   (Twilio retries deliveries).
3. Upsert `contacts` by `phone_e164`.
4. Upsert `conversations` (`channel: 'whatsapp'`, set
   `wa_window_expires_at = now + 24h` per WhatsApp's messaging-window
   rule, bump `last_message_at`, `unread_count`).
5. Insert `messages` (`provider: 'twilio_wa'`, `direction: 'inbound'`,
   `body`, `provider_message_id: MessageSid`).

Respond 200 fast; everything past this is a follow-up job, not inline
(matches the existing `webhook_outbox`/cron-retry philosophy elsewhere in
this codebase's sibling project — keep webhook handlers thin).

**Done when:** a real WhatsApp sandbox message produces one row each in
`contacts`, `conversations`, `messages` — verified by querying the tables
directly, no UI needed yet.

## M2 — Classify + match to a booking

New: `src/lib/agents/reschedule/classify.ts` (pure-ish, one Claude call):
- Input: message body. Output: `{ intent: 'reschedule' | 'other', requestedDate?: string, requestedTime?: string }` (zod-validated structured output).
- `'other'` → `postSlackOps()` a short heads-up with the raw message and
  stop (open decision #4 above).
- `'reschedule'` → proceed to M3.

Match the contact to a booking: `bookings` where
`customer_phone` normalizes to the contact's `phone_e164` AND
`booking_date >= today` AND `status != 'cancelled'`. Zero matches → Slack
Beer directly (no proposal possible). Multiple matches → the proposal
(M3) surfaces all candidates and asks which one, rather than guessing.

**Unit-test the classifier's prompt/parsing separately from the Claude
call itself** (per this project's testing rules) — mock the API response,
test the zod parsing and the zero/multiple-match branches with fixtures.

## M3 — The proposal agent (core logic)

New: `src/lib/agents/reschedule/build-proposal.ts`. Given a matched
booking + `requestedDate`/`requestedTime`:

1. Call `/api/admin/booking-flow?date=` (or the underlying `lib/`
   function directly, server-side) for the booking's listing, scoped to
   the requested date. No slots → proposal says so; still lets Beer see
   the customer's ask and respond manually.
2. Resolve the booking's current shift + skipper via the
   `assigned-captain.ts` pattern.
3. If a skipper is assigned: check `staff_availability` for that skipper
   on the candidate date.
   - Available or no row logged → **keep them**, reasoning: "Jasper has
     no unavailability logged for Saturday — keeping him."
   - Explicitly `unavailable` → check other `staff.is_active` rows for an
     available match on that date. Found → propose the swap with
     reasoning. None found → flag "no skipper available" (open decision #3).
4. Write one row to `agent_proposals`:
   ```
   kind: 'reschedule_request'
   conversation_id, trigger_message_id: <from M2>
   payload: { bookingId, currentSlot, proposedSlot, currentSkipper, proposedSkipper, skipperAction: 'keep'|'swap'|'none_available' }
   reasoning: <plain-English string, cites the specific staff_availability/FH rows it used>
   status: 'pending'
   model: <model id used>
   ```
5. `postSlackOps()` a short summary + link to `/admin/proposals/[id]`.

**Unit-test the skipper-decision branch logic thoroughly** (keep / swap /
none-available, and the "no availability row = treat as available"
default) — this is the one piece of judgment in the whole flow, per this
project's rule that new business logic gets tests first.

## M4 — Approval UI + execution

`/admin/proposals/[id]` (`requireAdmin`, reuse `AdminFormModal`-adjacent
patterns where they fit): renders the proposal's `payload` + `reasoning`
plainly, with Approve / Edit (adjust slot or skipper before approving) /
Reject.

**On Approve:**
1. Call the existing `/api/admin/bookings/[id]/rebook` with the
   (possibly human-edited) slot — reuse verbatim, this is the whole point
   of rule 3.
2. Upsert the `shifts` row for the new date/time: update the existing row
   if one exists for this `booking_id`, else create one (`status: 'open'`
   if `skipperAction === 'none_available'`, else `'assigned'`).
3. If the skipper changed or the time changed: `postSlackDM()` the
   affected skipper(s) via `staff.slack_member_id` — a short message
   ("Your Sat shift moved to 16:00" / "You've been swapped onto Sat
   16:00 — was Jasper's, he's unavailable").
4. Update the `agent_proposals` row: `status: 'approved'`,
   `human_edits` (if the admin changed anything from the draft),
   `reviewed_at`.
5. Customer notification is already handled — `/rebook` sends
   `sendRescheduleEmail` internally. No separate step.

**On Reject:** `status: 'rejected'`, `reviewed_at` set, no side effects.
Replying to the customer's WhatsApp thread is manual for now (outbound
WhatsApp reply is out of scope — see below).

## Out of scope (explicitly — do not build now)

- The full three-pane inbox UI (Phase 1) — this brief only builds enough
  intake to trigger one proposal kind, not a general support tool.
- Outbound WhatsApp reply to the customer (confirmation is email-only via
  the reused `/rebook` call; replying on WhatsApp itself is a Phase 1/3
  concern).
- Slack interactive Approve/Reject buttons — needs the full Slack
  Events API app upgrade; the admin-page link is the v1 approval surface.
- Auto-execute without approval — explicitly decided against this session.
- Any `agent_proposals` kind other than `reschedule_request`.
- Backfilling `shifts` for bookings that AREN'T being rescheduled — this
  brief only ever touches the one shift belonging to the booking in play.
  The general "sync shifts from all bookings" job is still
  `captain-scheduling-build-brief.md` M2's job, separate work.
- Cancellation requests, refund requests, or any intent other than
  "move this booking" — classifier routes everything else to a plain
  Slack heads-up (M2), nothing more.

## Wrap-up (required by CLAUDE.md)

- `docs/features/reschedule-agent.md` + index entry in
  `docs/features/README.md`.
- Full pass: `npx tsc --noEmit`, `npm test` (green before and after),
  `npm run build`.
- Dev-server / sandbox walkthrough: send a real WhatsApp sandbox message
  ("can we move Saturday's cruise to Sunday?") → confirm proposal appears
  correctly reasoned → approve → confirm booking rebooked, shift moved,
  skipper DMed, customer emailed → check `agent_proposals.outcome` /
  `status` reflects it.
- Mobile check on `/admin/proposals/[id]` per the responsive-design rules
  (this is a page Beer will very plausibly open from his phone).
