# Build Brief — General Customer-Chat Agent (reschedule tools first)

**Branch:** `feature/reschedule-agent` (branch from `main`).
**Vision rules:** `docs/plans/00-operations-os-master-vision.md` §2 — AI proposes,
human decides; agents are API clients, never UI users; human-powered UI
before an agent touches a domain (already true here — `/rebook` predates
this brief). Detail pattern: `ai-operations-vision.md` §1.
**Decided in chat (2026-09-20):**
- Intake = the WhatsApp customer chat channel.
- Autonomy = draft-then-approve, no auto-execute in v1.
- **Scope is general, not reschedule-only.** Every inbound message/email
  reaches ONE agent. There is no upfront "is this a reschedule?" gate —
  the agent reasons over a toolbox and decides for itself what's useful,
  the way this session decides whether to Grep or Read rather than
  following a fixed script. Reschedule is just the first toolset it has,
  not a special-cased path.
- **When no tool covers the ask, the agent doesn't guess or fabricate a
  proposal — it escalates to Beer's Slack in plain language** (see the
  `escalation` kind below). This is the safety valve that makes "general
  agent, narrow toolbox" work: the agent can reason about anything, but
  can only ever *act* through tools that exist, and escalation is what
  happens when none fit.

This is the **pilot** for the whole `agent_proposals` pattern — the first
row this table has ever held. Keep the toolbox narrow (reschedule-only
tools); the point is to prove the *loop* end-to-end (signal → agent
reasons → proposal → decision → outcome) in a shape that adding a second
toolset later (replies, cancellations, stock) doesn't require touching —
only adding more tools and proposal `kind`s.

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
  exactly. Two `kind`s in v1: `'reschedule_request'` and `'escalation'`.
  **The tool-call trace (below) also lives in `payload` as `payload.trace`
  — no new column.** `payload` is already an unstructured jsonb bucket;
  giving the trace its own column would just be the same data typed twice.
- **Brand voice** — `src/lib/ai/context.ts` already exists and is the
  system-prompt seed every other AI feature in this codebase uses
  (translations, blog content). The agent's system prompt should import
  it too, even though v1's only output is structured proposals, not
  customer-facing prose — the `reasoning` field is read by Beer, and
  "sounds like Off Course" beats "sounds like a generic ops bot" even
  in an internal-only string.
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
4. ~~Non-reschedule messages~~ — **resolved (2026-09-20):** every message
   reaches the same agent, no upfront classifier gate. If nothing in its
   toolbox fits the ask, it writes an `escalation` proposal and Slacks
   Beer directly — see M2.

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

## M2 — The general agent loop (every message reaches this)

New: `src/lib/agents/customer-chat/run-agent.ts`. **One Claude tool-use
loop, run per new inbound message** (or re-run on the conversation when a
new message lands mid-thread). No upfront classifier — the system prompt
(brand voice from `src/lib/ai/context.ts` + the job description below) and
the tools available are the entire steering mechanism.

**Tools in v1 (reschedule-only toolbox; deliberately narrow):**

| Tool | Type | What it does |
|---|---|---|
| `lookup_booking(phone_or_email)` | read | `bookings` where contact matches, `booking_date >= today`, `status != 'cancelled'`. Zero or multiple matches are valid results — the agent decides whether to ask a clarifying question (via `create_proposal` with a question, or `escalate`) or pick the obvious one. |
| `check_fareharbor_availability(listingId, date)` | read | wraps `/api/admin/booking-flow?date=` |
| `check_skipper_availability(staffId, date)` | read | `staff_availability` |
| `list_active_skippers()` | read | `staff` where `is_active` |
| `create_proposal(kind, payload, reasoning)` | **write — the only one** | inserts into `agent_proposals`, `status: 'pending'`. `kind` is `'reschedule_request'` in v1. |
| `escalate(reason)` | **write** | inserts into `agent_proposals` with `kind: 'escalation'`, `payload: { rawMessage, reason }`, then `postSlackOps()`s Beer directly with the message + the agent's own explanation of why nothing in its toolbox covers it. |

**The hard rule, restated:** the agent has no `rebook_booking`,
`update_shifts`, or `notify_skipper` tool. It cannot execute anything —
only propose or escalate. That boundary is enforced by *what tools exist*,
not by a code branch checking intent, which is what makes "reason freely,
narrow toolbox" safe to ship even before the agent's judgment is proven.

**Trace capture:** every tool call the loop makes gets appended to an
in-memory list as `{ tool, input_summary, result_summary }` — a short
human-readable line per call, not the raw request/response (keeps
`payload.trace` skimmable and avoids parking raw PII in a jsonb blob
longer than needed). Whichever of `create_proposal`/`escalate` ends the
loop writes that list into `payload.trace` on the row it creates. This is
what the sidepane (M3) renders as "how the agent got here."

**Escalation is the general fallback**, not a reschedule-specific thing —
a booking question, a complaint, a cancellation ask, anything the v1
toolbox has no tool for, all land here identically. This is intentional:
it means the *loop* is already general-purpose on day one, even though
only one real toolset exists yet. Adding a second toolset later (e.g.
reply drafting) is additive — more tools, one more `kind` — not a rewrite
of this file.

**Unit-test:** the tool functions themselves (pure logic — availability
lookup, skipper-swap decision, matching) exactly as before, plus a small
set of scripted scenarios (mocked tool responses) asserting the loop ends
in the right `kind` and payload shape — not asserting an exact call
sequence, since that's allowed to vary. This is the real testing
trade-off called out when this shift was discussed: less deterministic
than a fixed pipeline, tested by outcome instead of by exact steps.

## M3 — The proposal sidepane (UI)

No three-pane inbox exists yet (Phase 1, unbuilt) for this to slot into
as a literal third column — so M3 builds it as `/admin/proposals/[id]`
for now, laid out so it drops into that column unchanged once Phase 1
ships (same component, just relocated).

**Layout, top to bottom:**

1. **Header** — status badge (pending / approved / rejected / handled) +
   timestamp + `kind`.
2. **Headline** — one line, the actual proposed action, rendered per
   `kind`:
   - `reschedule_request` → *"Move to Sun 28 Sep, 14:00 · keep Jasper"*
     (or *"· swap to Anna — Jasper unavailable"* / *"· no skipper free
     yet — assign manually"*).
   - `escalation` → *"Can't act on this yet — flagged to you on Slack"*,
     no Approve/Reject, just the raw customer message + the agent's own
     note on why nothing covered it, and a **Mark handled** toggle for
     bookkeeping once Beer's dealt with it manually.
3. **"How the agent got here"** — collapsed by default (this is detail,
   not the headline). Expands to the `payload.trace` list, one line per
   tool call:
   ```
   🔍 Looked up booking → #4821, Sat 14:00, Diana
   📅 Checked Sunday availability → 3 slots open
   🧑‍✈️ Checked Jasper's availability → free
   ```
   This is the literal audit trail the vision doc's rule 2 asks for
   ("proposals cite their sources so a human can click through") — here
   it's tool calls instead of row ids, same principle.
4. **Reasoning** — the `agent_proposals.reasoning` prose, sits right
   under the trace (the trace is *what* it looked at, reasoning is *why*
   it concluded what it did — keep them visually distinct, don't merge).
5. **Actions**, per `kind`:
   - `reschedule_request`: **Approve** / **Edit** (adjust slot or skipper
     before approving) / **Reject**.
   - `escalation`: **Mark handled** only.
6. **Footer**, low-emphasis — model id used, created timestamp.

**Unit-test:** the pure rendering-selection logic (which headline/actions
a given `kind`+`payload` produces) — not a full component-render test,
per this project's "don't test React rendering" rule.

## M4 — Execution on approve

**On Approve (`reschedule_request` only — `escalation` has no execution
path, just "mark handled"):**
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

- The full three-pane inbox UI (Phase 1) — M3 builds the sidepane
  component as a standalone page for now; relocating it into an actual
  inbox thread view is Phase 1's job, not this brief's.
- Outbound WhatsApp reply to the customer (confirmation is email-only via
  the reused `/rebook` call; replying on WhatsApp itself, and any
  `reply_draft`-style tool that would let the agent draft one, is a
  Phase 1/3 concern — until then, anything needing a reply escalates).
- Slack interactive Approve/Reject buttons — needs the full Slack
  Events API app upgrade; the admin-page link is the v1 approval surface.
- Auto-execute without approval — explicitly decided against this session.
  This still holds for the general loop: `escalate` and `create_proposal`
  are its only write tools, full stop.
- Any `agent_proposals` `kind` beyond `reschedule_request` and
  `escalation` — no stock, cancellation, or refund tools/kinds yet. The
  loop is general-purpose by construction, but v1 ships with exactly one
  real capability; everything else correctly escalates.
- Backfilling `shifts` for bookings that AREN'T being rescheduled — this
  brief only ever touches the one shift belonging to the booking in play.
  The general "sync shifts from all bookings" job is still
  `captain-scheduling-build-brief.md` M2's job, separate work.

## Wrap-up (required by CLAUDE.md)

- `docs/features/customer-chat-agent.md` + index entry in
  `docs/features/README.md`.
- Full pass: `npx tsc --noEmit`, `npm test` (green before and after),
  `npm run build`.
- Dev-server / sandbox walkthrough, two cases:
  1. Reschedule: send a real WhatsApp sandbox message ("can we move
     Saturday's cruise to Sunday?") → confirm the sidepane shows a
     correctly reasoned proposal with a sensible trace → approve →
     confirm booking rebooked, shift moved, skipper DMed, customer
     emailed → check `agent_proposals.outcome`/`status` reflects it.
  2. Escalation: send a message the toolbox can't handle ("can I get a
     refund?") → confirm it lands as an `escalation` row, Beer gets the
     Slack ping, and the sidepane renders the no-actions "flagged to you"
     state correctly rather than a broken proposal card.
- Mobile check on `/admin/proposals/[id]` per the responsive-design rules
  (this is a page Beer will very plausibly open from his phone).
