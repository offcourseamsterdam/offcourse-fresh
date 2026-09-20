# Build Brief — General Customer-Chat Agent (reschedule tools first)

**Branch:** `feature/reschedule-agent` (branch from `main`).
**Vision rules:** `docs/plans/00-operations-os-master-vision.md` §2 — AI proposes,
human decides; agents are API clients, never UI users; human-powered UI
before an agent touches a domain (already true here — `/rebook` predates
this brief). Detail pattern: `ai-operations-vision.md` §1.
**Decided in chat (2026-09-20):**
- Intake = the WhatsApp customer chat channel.
- Autonomy = draft-then-approve for anything risky — but that's now a
  property of the *action*, not of the agent's reasoning. The agent
  always reasons all the way to a concrete recommended action, even for
  things it has no execute-tool for; the gate is that turning a proposal
  into a real-world effect always needs a human click. Reasoning is free,
  acting isn't.
- **Scope is general, not reschedule-only.** Every inbound message/email
  reaches ONE agent. There is no upfront "is this a reschedule?" gate —
  the agent reasons over a toolbox and decides for itself what's useful,
  the way this session decides whether to Grep or Read rather than
  following a fixed script. Reschedule is just the first toolset it has,
  not a special-cased path.
- **One unified proposal path, not a separate "escalation" dead end.**
  Earlier draft of this brief had the agent either produce a structured
  `reschedule_request` proposal or, for anything else, just forward the
  raw message to Slack with no real reasoning attached. That's worse than
  it needs to be — the agent should still reason its way to a recommended
  action even when it can't execute one itself (e.g. "customer wants a
  refund of €90 for booking #4821, weather cancellation, our policy
  covers this"). So there's **one** `create_proposal(kind, payload,
  reasoning)` tool. Whether Approve does something automatically or just
  flips the row to "approved — handle manually" depends only on whether
  that `kind` has a registered execute-handler (M4) — v1 registers exactly
  one, for `reschedule_request`. Every other `kind` the agent invents
  still gets full reasoning + trace + a Slack ping, it just can't
  self-execute yet.
- **A low-risk exception to the gate: asking the customer a clarifying
  question.** If the agent can't identify which booking a message is
  about, it's allowed to message the customer back directly asking for
  their email, phone, or booking ID — no approval needed for that,
  because it changes nothing (see M2's `ask_customer` tool). Anything
  beyond a clarifying question about identity stays gated.
- **Beer gets pinged on every single inbound message**, not just ones
  needing approval — see "Slack notifications" in M2. What varies is the
  ping's content (FYI vs. needs-your-approval), not whether it fires.

This is the **pilot** for the whole `agent_proposals` pattern — the first
row this table has ever held. Keep the toolbox narrow (reschedule-only
execution); the point is to prove the *loop* end-to-end (signal → agent
reasons → proposal → decision → outcome) in a shape that adding real
execution for a second `kind` later (refunds, cancellations, stock)
doesn't require touching this loop — only registering another handler.

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
  exactly. `kind` is free text (not an enum) — the agent can write
  whatever `kind` fits (`'reschedule_request'`, or its own word for
  something new), which is what makes "one execute-handler registered,
  everything else still gets reasoned about" work without a migration
  every time a new situation comes up.
  **The tool-call trace (below) also lives in `payload` as `payload.trace`
  — no new column.** `payload` is already an unstructured jsonb bucket;
  giving the trace its own column would just be the same data typed twice.
- **Outbound WhatsApp send** — no existing helper sends WhatsApp
  specifically, but `src/lib/twilio/client.ts` (`sendTwilioSms`) is the
  pattern to mirror for `ask_customer`: phone normalization, mock-send
  when credentials are missing (keeps local dev/tests working without
  hitting Twilio), same error shape. A WhatsApp send needs the
  `whatsapp:` prefix on `To`/`From` and must respect
  `conversations.wa_window_expires_at` (WhatsApp rejects a free-form
  message once the 24h customer-initiated window has closed — outside
  it, only a pre-approved template message is deliverable. `ask_customer`
  must check this and fall back to an approved template, or refuse and
  escalate, rather than silently failing).
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
   toolbox can execute the ask, it still writes a fully-reasoned
   `create_proposal` (just one with no execute-handler registered for its
   `kind`) and Slacks Beer directly — see M2.
5. **How far can `ask_customer` go before it needs approval too?**
   Proposed line: identity/matching questions only ("what's your booking
   ID or the email you booked with?") are auto-sent, because they carry
   no business effect and stall the whole interaction otherwise — waiting
   on Beer to approve "can I ask a question" would make every
   hard-to-match message slower than a human just answering WhatsApp
   directly. Anything beyond that (answering a policy question, offering
   a specific alternative slot) stays a `create_proposal` a human sends.
   Confirm this line is right, or move it.

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

**Tools in v1 (reschedule-only execution; deliberately narrow):**

| Tool | Type | What it does |
|---|---|---|
| `lookup_booking({ phone?, email?, bookingId?, name? })` | read | `bookings` matched by whichever identifier(s) are known — the WhatsApp channel always supplies a phone via the contact, but the agent should try email or a booking ID mentioned in the message text too, since the phone messaging from isn't always the phone the booking was made under (partner's phone, a second traveler, etc). `name` matches against `bookings.customer_name`, case-insensitive. See the confidence tiering below — `name` is not treated the same as the other three. |
| `check_fareharbor_availability(listingId, date)` | read | wraps `/api/admin/booking-flow?date=` |
| `check_skipper_availability(staffId, date)` | read | `staff_availability` |
| `list_active_skippers()` | read | `staff` where `is_active` |
| `ask_customer(question)` | **write — ungated** | sends `question` back over WhatsApp (see the outbound-send note above), logs it as an outbound `messages` row, and ends the agent's turn for this message — the next customer reply re-triggers the loop with the Q&A now in the conversation's history. **Reserved for identity/matching questions in v1** (open decision #5) — the agent isn't given license to freelance other questions yet, that's a prompt-level constraint, not a technical one, and is exactly the kind of thing to watch in early runs. |
| `create_proposal(kind, payload, reasoning)` | **write — always human-gated** | inserts into `agent_proposals`, `status: 'pending'`, `kind` free text. Always produces a fully-reasoned recommendation regardless of whether anything can auto-execute it (M4 decides that by whether a handler is registered for `kind`, not the agent). |

**Matching confidence tiering — name is not a peer of phone/email/booking
ID.** Email and booking ID are effectively unique in this dataset; phone
is unique enough that its only real failure mode is "more than one live
booking under this number." A customer's *name*, on the other hand, isn't
— Off Course plausibly has more than one "Sarah" or "Tom" with an
upcoming booking at any given time, and matching on name alone risks
surfacing a *different customer's* booking (date, price, skipper) into
this conversation, which is a real correctness and privacy problem, not
just a UX one. So:
- Name is never sufficient **alone** unless exactly one live booking
  matches it — and even then, `create_proposal`'s `reasoning` must say
  so explicitly ("matched by name only, single result — no phone/email
  corroboration") so it's visibly a weaker match on the sidepane, not
  indistinguishable from a booking-ID-certain one.
- Its better use is **corroboration**: phone matches two live bookings →
  name picks between them. Or **disambiguation**: phone matches nothing
  usable, but name plus a mentioned date narrows to one.
- Name matches more than one live booking, with nothing else to narrow
  it → same as any other unresolved match: `ask_customer`, not a guess.

**The hard rule, restated:** the agent has no `rebook_booking`,
`update_shifts`, or `notify_skipper` tool — those only run from M4's
approve action, never from inside the loop. `ask_customer` is the one
tool that sends something without a human clicking anything first, and
it's deliberately incapable of doing more than ask a question: no
attachments, no offers, no numbers, just text back to the same
conversation. That narrowness is what makes it safe to leave ungated —
the boundary is still "what a tool is capable of," just drawn one notch
more permissively for this one low-stakes case.

**Trace capture:** every tool call the loop makes (including
`ask_customer` calls) gets appended to an in-memory list as
`{ tool, input_summary, result_summary }` — a short human-readable line
per call, not the raw request/response (keeps `payload.trace` skimmable
and avoids parking raw PII in a jsonb blob longer than needed).
`create_proposal` writes that list into `payload.trace` on the row it
creates. This is what the sidepane (M3) renders as "how the agent got
here."

**Slack notification fires on every inbound message, not just ones
needing approval** — `postSlackOps()` after each agent turn, varying by
what happened:
- Loop ended in `ask_customer` → low-key FYI: *"Sarah asked to move
  Saturday's cruise — couldn't match her booking, asked for her email/
  booking ID. No action needed from you."*
- Loop ended in `create_proposal` with a registered handler → *"Sarah
  wants to move Saturday to Sunday — proposal ready, needs your
  approval: [link]"*
- Loop ended in `create_proposal` with no handler for that `kind` → same
  shape, phrased as *"...needs your approval — no auto-action for this
  one yet, you'll do it manually: [link]"*

One Slack message per inbound customer message, always — this is
deliberately the "ping each incoming message" requirement, not just an
escalation-only alert.

**Unit-test:** the tool functions themselves (pure logic — availability
lookup, skipper-swap decision, the multi-identifier matching in
`lookup_booking`) exactly as before, plus a small set of scripted
scenarios (mocked tool responses) asserting the loop ends in the right
`kind`/`ask_customer` outcome and payload shape — not asserting an exact
call sequence, since that's allowed to vary. This is the real testing
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
2. **Headline** — one line, the actual recommended action, straight from
   `reasoning`/`payload`, regardless of `kind`:
   - `reschedule_request` → *"Move to Sun 28 Sep, 14:00 · keep Jasper"*
     (or *"· swap to Anna — Jasper unavailable"* / *"· no skipper free
     yet — assign manually"*).
   - anything else (no execute-handler registered) → whatever the agent
     recommended, same styling — e.g. *"Refund €90 for booking #4821 —
     weather cancellation, covered by policy"*. The only visible
     difference from a reschedule card is the actions row below.
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
5. **Actions** — looked up from a small handler registry keyed by `kind`
   (M4), not hardcoded per `kind` in the UI:
   - `kind` has a registered handler (`reschedule_request` in v1):
     **Approve** (runs it) / **Edit** (adjust before approving) /
     **Reject**.
   - `kind` has no handler yet: **Mark done** (handled manually, just
     bookkeeping — same `status: 'approved'`, no execution call fires)
     / **Reject**. This is the exact "propose the refund, Beer clicks
     approve, Beer does it in Stripe himself" case — reasoned and
     recorded, not auto-executed, because nobody's built that
     handler yet.
6. **Footer**, low-emphasis — model id used, created timestamp.

**Unit-test:** the pure rendering-selection logic (which headline/actions
a given `kind`+`payload` produces) — not a full component-render test,
per this project's "don't test React rendering" rule.

## M4 — Execution on approve

New: `src/lib/agents/customer-chat/proposal-handlers.ts` — a tiny registry,
`Record<string, (proposal) => Promise<void>>`, keyed by `kind`. The
approve action looks up `handlers[proposal.kind]`; found → runs it (below);
not found → just flips `status` (the M3 "Mark done" case). This registry,
not the agent, is what decides whether a `kind` is auto-actionable — the
agent never needs to know or declare that itself.

**`reschedule_request` handler (v1's only registered one):**
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
- Outbound WhatsApp reply to the customer **beyond `ask_customer`'s
  narrow identity-matching question** — confirmation is email-only via
  the reused `/rebook` call; a general reply-drafting tool is a Phase
  1/3 concern. `ask_customer` is intentionally the one sliver of
  customer-facing autonomy in this brief, not a foot in the door for more.
- Slack interactive Approve/Reject buttons — needs the full Slack
  Events API app upgrade; the admin-page link is the v1 approval surface.
- Auto-execute without approval, for anything beyond `ask_customer` —
  explicitly decided against this session. `create_proposal` is always
  human-gated regardless of `kind`; only whether a registered handler
  exists varies, never whether a human clicks first.
- Any real execute-handler beyond `reschedule_request` — the agent may
  reason its way to a refund/cancellation/other recommendation and write
  it as a `create_proposal`, and that's fine (it's just reasoning), but
  M4's handler registry stays one entry deep in this brief. Building the
  refund/cancellation handlers is separate work, later.
- Backfilling `shifts` for bookings that AREN'T being rescheduled — this
  brief only ever touches the one shift belonging to the booking in play.
  The general "sync shifts from all bookings" job is still
  `captain-scheduling-build-brief.md` M2's job, separate work.

## Wrap-up (required by CLAUDE.md)

- `docs/features/customer-chat-agent.md` + index entry in
  `docs/features/README.md`.
- Full pass: `npx tsc --noEmit`, `npm test` (green before and after),
  `npm run build`.
- Dev-server / sandbox walkthrough, three cases:
  1. Clean reschedule: send a real WhatsApp sandbox message from a number
     matching an existing booking ("can we move Saturday's cruise to
     Sunday?") → confirm Beer gets one Slack ping, the sidepane shows a
     correctly reasoned proposal with a sensible trace → approve →
     confirm booking rebooked, shift moved, skipper DMed, customer
     emailed → check `agent_proposals.outcome`/`status` reflects it.
  2. Unmatched sender: same message from a number/name that doesn't match
     any booking → confirm the agent calls `ask_customer` (not
     `create_proposal`), the customer actually receives the WhatsApp
     question, Beer's Slack ping is the low-key FYI variant, and no
     `agent_proposals` row exists yet for this thread.
  3. No handler: send a message the v1 registry can't execute ("can I get
     a refund?") → confirm it still lands as a well-reasoned
     `create_proposal`, Beer's Slack ping says "no auto-action, you'll do
     it manually," and the sidepane shows Mark done / Reject rather than
     Approve.
- Mobile check on `/admin/proposals/[id]` per the responsive-design rules
  (this is a page Beer will very plausibly open from his phone).
