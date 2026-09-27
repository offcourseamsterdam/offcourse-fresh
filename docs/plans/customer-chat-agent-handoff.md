# Handoff — Customer-Chat Agent (continue in a local session)

Context for a fresh Claude Code session. Written 2026-09-27 at the end of a
design session on Claude Code on the web. Nothing here is built yet. This
file and the build brief are the only output so far.

## Read first

1. `docs/plans/reschedule-agent-build-brief.md`: the build brief. It's the
   source of truth for everything below.
2. `docs/plans/00-operations-os-master-vision.md` and
   `docs/plans/ai-operations-vision.md`: the vision the brief follows (AI
   proposes and humans decide, agents are API clients, human UI comes
   first).
3. `CLAUDE.md`, especially how to talk to Beer: explain the *why* in
   non-coder terms. Beer also wants to be made to think, not just handed
   answers. Ask clarifying questions before big decisions.

Branch: `claude/offcourse-ai-agent-feasibility-vttowk` (pushed, not merged).
Run `git fetch && git checkout claude/offcourse-ai-agent-feasibility-vttowk`.

## What was decided

- **One general agent.** Every inbound customer message or email reaches
  one Claude tool-use loop. There is no classifier deciding "is this a
  reschedule?" upfront. The agent picks tools itself. Reschedule is only
  the first toolset.
- **The toolbox is the safety boundary.** Read tools: `lookup_booking`,
  `check_fareharbor_availability`, `check_skipper_availability`,
  `list_active_skippers`. Write tools: only `create_proposal`, which always
  needs a human to approve it, and `ask_customer`, which is not gated.
  The agent has no tool to rebook, update shifts or notify a skipper.
  Those run only from the approve button.
- **Every proposal is reasoned.** Even for things the agent can't execute,
  like a refund, it writes a full recommendation. Whether Approve
  auto-executes depends on a per-`kind` handler registry. v1 has one
  handler: `reschedule_request`, which reuses the existing
  `/api/admin/bookings/[id]/rebook` route. Every other kind approves as
  "Mark done, handle manually".
- **`ask_customer` is narrow.** It only sends identity questions ("what's
  your booking ID or email?") when a booking can't be matched.
- **Booking matching uses tiers.** Phone, email and booking ID are primary
  identifiers. Name is a weak signal: it can confirm a match or break a
  tie. It's only trusted alone when it's a unique match, and then the
  reasoning must say "matched by name only".
- **Slack ping on every inbound message.** The wording depends on the
  outcome: an FYI when the agent asked a question, "needs your approval"
  when it made a proposal, and "no auto-action, handle manually" when no
  handler exists for that kind.
- **Sidepane UI:** `/admin/proposals/[id]` for now, built so it can move
  into the future inbox's third column. It shows the headline action, a
  collapsible tool-call trace (`payload.trace`, human-readable lines),
  the reasoning, and the action buttons.
- **No new migrations needed.** `contacts`, `conversations`, `messages`,
  `agent_proposals`, `shifts`, `staff`, `staff_availability` and
  `webhook_logs` already exist in the live DB, but nothing in `src/`
  writes to them yet.

## Useful findings

- `postSlackDM(text, channel)` already takes any Slack user ID, so you can
  DM a skipper via `staff.slack_member_id` without new infrastructure.
  Check that `SLACK_BOT_TOKEN` is set in Vercel first. It isn't in the
  zod schema in `src/env.ts`.
- `src/lib/twilio/client.ts` (`sendTwilioSms`) is the pattern to copy for
  sending WhatsApp messages. WhatsApp needs the `whatsapp:` prefix and has
  to respect `conversations.wa_window_expires_at`.
- Nothing writes to `shifts` today. Only `assigned-captain.ts` reads it.
  Expect many bookings to have no skipper on record.
- `getClaude()` and `CLAUDE_MODEL` in `src/lib/ai/clients.ts` are the
  existing Claude client. Reuse them.

## Next step (ask Beer before going further)

Build a **throwaway prototype** of the M2 agent loop:
`scripts/agent-prototype.ts`, not wired into the app. It should make a
real Claude tool-use loop call with **mocked** tool functions that return
synthetic data, run with `npx tsx`. The web session couldn't do this
because it had no `ANTHROPIC_API_KEY`. A local session has one in
`.env.local`.

Run these scenarios and show Beer the full tool-call trace and the final
proposal for each:
1. A clean reschedule: phone matches one booking and the skipper is free.
2. The phone matches two live bookings and the customer's name breaks the
   tie.
3. The phone matches two live bookings and the name doesn't help. It
   should call `ask_customer`, not guess.
4. There's no match at all. It should call `ask_customer`.
5. A refund request (no handler). It should make a reasoned
   `create_proposal`, not a raw escalation.
6. A skipper is explicitly unavailable. It should propose a swap, or
   "none available".

The goal is to see whether the real model makes the judgment calls the
design assumes, especially cases 2 and 3, before building M1–M4.

**Safety:** `.env.local` holds LIVE keys (Stripe, Supabase prod). The
prototype must use only mocked tools. It must not write to the DB, send
WhatsApp or Slack messages, or call FareHarbor. If you want real data,
use read-only queries only, and ask Beer first.

## Still open (see "Open decisions" in the brief)

1. Is the Twilio number WhatsApp-enabled, and has Meta business
   verification started?
2. Is the admin-page approval surface OK for v1, instead of Slack buttons?
3. When no skipper is free, should the booking move with the shift left
   open?
5. Where exactly is the line for what `ask_customer` may auto-send?
