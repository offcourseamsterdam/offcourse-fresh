# OTA Autonomous Agent (Withlocals) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **Status: FUTURE / NOT STARTED.** This plan was written ahead of time, per Beer's request, to
> think through the shape of the work before committing to it. Do not begin any task in this
> plan without Beer's fresh, explicit go-ahead in that session — this is a save-for-later
> document, not a queued task.

**Goal:** Replace the current "Ghost reads a Withlocals notification email and shows Beer a fact
card" pipeline (built 2026-08-03/04, see `docs/features/ota-notifications.md`) with an agent that
operates Withlocals' own web platform directly — reading the guest's actual message thread there,
drafting a reply in Off Course's voice, checking real availability, and (once approved) sending
the reply and confirming the booking on Withlocals' own site. Starts fully human-gated
(propose-only); FareHarbor booking creation stays a manual step even once this ships.

**Architecture:** A new, small, persistent Node service — **not** Claude Code, not a Vercel
serverless function (these don't hold a long-lived authenticated browser session well) — running
Playwright against a real Chromium instance, logged into Withlocals as Off Course. It polls (or is
webhook-notified via the existing Gmail sync, which already fires the instant a Withlocals email
lands) for new guest activity, scrapes the actual conversation from Withlocals' own dashboard
(their email is just a notification — the real message thread lives on their site), drafts a
reply using the exact same brand-voice system prompt and `ghost_knowledge` table Ghost's inbox
agent already uses, and writes an `agent_proposals` row for Beer to approve in the existing admin
inbox UI — reusing the whole approval-and-execute pattern already built for `booking_proposal` and
`booking_correction`. Approving a proposal here doesn't just flip a status flag like today; it
triggers the automation service to actually type and send that exact, approved message (and click
"confirm") on Withlocals' site.

**Tech Stack:** Playwright (browser automation) · a persistent Node worker process, hosted
separately from the Next.js app (see Task 1 for options) · the existing `CLAUDE_DRAFTER_MODEL`
(Haiku) + `OFF_COURSE_SYSTEM_PROMPT` + `ghost_knowledge` for drafting · existing
`agent_proposals` / admin inbox UI for the approval step · existing `checkOtaAvailability` for
real FareHarbor availability.

---

## Decisions already locked in (Beer, 2026-08-04)

1. **Platform: Withlocals only, first.** GetMyBoat is a deliberate non-goal until Withlocals
   proves out — same "one real platform at a time" discipline as `ota/detect.ts`.
2. **Autonomy: propose-only.** Every message the agent would send, and every booking it would
   confirm, is drafted and shown to Beer for a one-click approve — nothing is sent to a guest or
   confirmed on Withlocals without that click. This matches `AUTONOMY_CEILING` in
   `src/lib/ghost/agents.ts`, where every existing booking-affecting Ghost action tops out at
   `ask` or `dry_run`, never `auto`.
3. **FareHarbor stays manual.** Confirming a booking on Withlocals' own site is as far as this
   agent goes. Creating the actual FareHarbor booking (comp, capacity check, confirmation email)
   remains a separate, existing, human-driven step — not automated by this plan.
4. **Hard escalation triggers** (the agent MUST stop and hand off to Beer, never guess, regardless
   of confidence):
   - Any cancellation or refund request
   - A guest question outside taught `ghost_knowledge` / policy (same "don't invent" rule the
     chat agent already follows)
   - A requested date/guest count that doesn't match any bookable option
   - A guest who sounds upset, confused, or difficult (sentiment-based escalation)

## Open questions — resolve in Phase 0 before writing any product code

These are technical/legal unknowns, not product decisions Beer needs to make blind — Phase 0's
job is to turn each of these into an answer, then update this plan before Phase 1 starts.

1. **Does Withlocals have any official partner/API integration** for messaging or booking
   management? If yes, prefer it over browser automation entirely — no ToS risk, no
   anti-bot/CAPTCHA cat-and-mouse, no breakage every time they redesign their dashboard. Check
   their partner/host documentation and support before assuming browser automation is the only
   path.
2. **Terms of Service risk.** Read Withlocals' host/partner ToS specifically for language about
   automated access to their platform. Automating a login and UI interactions on a partner
   platform without their knowledge is a real account-suspension risk for Off Course's Withlocals
   listing — this needs a clear answer, possibly including asking Withlocals directly, before any
   code is written.
3. **Login stability.** Can the Withlocals account log in without interactive 2FA (e.g. an app
   password, or 2FA disabled for this specific access pattern)? Playwright can't solve a 2FA
   prompt sent to Beer's phone unattended. If 2FA can't be avoided, this whole approach needs a
   different shape (e.g. Beer completes login periodically, the service reuses the session
   cookie).
4. **Where does the actual guest conversation live?** Confirm whether Withlocals' notification
   email is purely a heads-up (guest messages live entirely on their site) or whether some
   platforms support replying by email directly. This determines whether the agent needs to
   scrape a dashboard UI at all, or could keep working entirely through email.

## Per-platform playbook docs (new deliverable, per Beer's request)

Create one reference doc per OTA platform the agent will ever operate on — NOT written yet, since
step 1 is Phase 0 research. Each doc is both a human-readable reference for Beer and the grounding
context an agent implementation would read before acting on that platform, mirroring how
`ota/detect.ts`'s comments insist every pattern be grounded in a real example, never guessed.

- **Create:** `docs/ota-platforms/withlocals.md`
- **Create:** `docs/ota-platforms/getmyboat.md` (stub only — "not built yet, see
  2026-08-04-ota-autonomous-agent.md" — until GetMyBoat work actually starts)

Each platform doc should cover, once known:
- How their notification emails look (already partly documented in `ota/detect.ts`'s test
  fixtures — link to it, don't duplicate)
- Where the real guest conversation happens (their dashboard URL, login flow)
- The exact UI steps to send a reply and to confirm/decline a booking (selectors, screenshots)
- Platform-specific tone or policy quirks (e.g. does Withlocals expect a certain response format,
  time window, language)
- What Withlocals' own fee/payout mechanics mean for what "confirm" actually commits Off Course to
  (cross-reference `docs/features/kasboek-payout-pipelines.md`)

---

## Phase 0: Research (no code)

### Task 1: Answer the four open questions above

**Files:** none (research only) — findings get written into this plan doc's "Open questions"
section above, replacing each question with its answer, before Phase 1 starts.

**How:** Check Withlocals' host help center / partner docs for an API. Read their ToS. Test
whether Beer's existing Withlocals login can authenticate without interactive 2FA (try it, don't
guess). Confirm via one more real Withlocals email (or asking their support) whether guest replies
ever come through email.

### Task 2: Decide the hosting shape for the persistent automation worker

**Files:** none yet — decision recorded in this plan.

Options to weigh (this is a technical call, not one to push onto Beer blind — come back with a
recommendation):
- A small always-on VPS/container (e.g. Fly.io, Railway) running a Node process with Playwright —
  simplest mental model, costs a few dollars/month, Beer already runs similar always-on services
  for the 7-agent Ghost fleet (see `project-ops-agents` in memory).
- A hosted headless-browser service (e.g. Browserbase) called from a Vercel cron — no server to
  maintain, but adds a paid third-party dependency and less control over session persistence
  across logins.
- Reuse whatever infra the existing `ai-ops-engine` background agents already run on, if that
  infra is a good fit (check `project-ops-agents` memory / the `feature/ai-ops-engine` branch
  before assuming a new service is needed).

---

## Phase 1: Read pipeline — see what's actually happening on Withlocals

*(Tasks intentionally left at a coarser grain than a normal bite-sized plan — the concrete
implementation shape depends entirely on Phase 0's answers, especially whether there's an API.)*

### Task 3: Authenticate and read the guest conversation thread

**Files:**
- Create: `automation/withlocals/client.ts` (or equivalent, once hosting shape from Task 2 is
  chosen — path TBD)
- Test: mock the browser/API layer; never hit the real Withlocals site in CI

Log in (however Task 0.3 determined is stable), navigate to a specific booking's conversation
thread, extract every guest message with timestamps. Ground this against the SAME real booking
ref (`39f8dc7a`) already used throughout `ota/detect.ts`'s tests, so the first real run has a
known-good thread to check the scraper against.

### Task 4: Wire into the existing Gmail-triggered pipeline

**Files:**
- Modify: `src/lib/ota/handle-message.ts` — `new_request` and `confirmed` branches gain a new step
  after the existing availability-check/proposal-write logic

When `handleOtaMessage` runs today, it writes an `ota_availability` or `ota_booking_ready`
proposal and stops. This task adds: also fetch the live conversation thread from Withlocals
(Task 3) so the draft in Phase 2 can respond to what the guest ACTUALLY said, not just the
structured booking-request fields already parsed from the notification email.

---

## Phase 2: Draft — propose the reply, using Ghost's existing brain

### Task 5: Draft a reply using the same system prompt + knowledge Ghost already has

**Files:**
- Create: `src/lib/ota/draft-platform-reply.ts`
- Test: `src/lib/ota/draft-platform-reply.test.ts`

Reuses `OFF_COURSE_SYSTEM_PROMPT` (`src/lib/ai/context.ts`) and the `ghost_knowledge` table
exactly as `draftShadowReply` does — this is the one piece of the whole plan that should feel
completely familiar, because it's the same brain Ghost already has for chat/email. The new part is
what it's grounded in (the Withlocals thread, not an Off Course inbox message) and what it can do
when done (see Task 6 escalation gate).

**Escalation gate (hard-codes the 4 locked-in triggers):** before ever proposing a reply, check —
in order — (a) is this a cancellation/refund request → escalate, (b) does answering require a
fact not in `ghost_knowledge` → escalate, (c) does `checkOtaAvailability` fail to find a bookable
match for the requested date/guests → escalate, (d) run the SAME sentiment check pattern used
elsewhere in Ghost (if one exists — check `src/lib/ghost/` for a precedent before writing a new
one) → escalate if upset/difficult. "Escalate" here means: write a normal `ota_availability`-style
fact-only proposal (today's existing behavior) instead of a reply draft — Beer sees it and handles
it himself, same as before this plan existed.

### Task 6: New proposal kind — `ota_platform_reply`

**Files:**
- Migration: `supabase/migrations/NNN_ota_platform_reply.sql` — no schema change needed if this
  reuses the existing `agent_proposals.kind` free-text column (confirm no CHECK constraint blocks
  a new kind value, same as `ota_availability`/`ota_booking_ready` needed no migration for this)
- Modify: `src/lib/ghost/agents.ts` — add `ota_platform_reply` to `AUTONOMY_CEILING` and
  `AUTONOMY_LEVEL`, pinned to `ask` (never higher) per the locked-in propose-only decision
- Modify: `src/app/api/admin/inbox/conversations/[id]/route.ts` — `loadGhostProposals` gains this
  kind
- Modify: `src/app/[locale]/admin/inbox/types.ts`, `ContextPane.tsx` — a new card showing the
  drafted reply + an "Approve & send" button (visually similar to `SuggestedReply`, but the
  approve action calls a new endpoint, not just a translate/use-draft action)

---

## Phase 3: Execute — send the approved reply and confirm the booking

### Task 7: Approval triggers the automation worker to act for real

**Files:**
- Create: `src/app/api/admin/ghost/proposals/[id]/route.ts` — extend the existing `action` union
  (already handles `book`, `correct_booking`, `translate`) with a new `send_to_platform` action
- The automation worker (Task 2's service) exposes an endpoint or queue the Next.js app can call
  to say "send this exact approved text to this Withlocals thread, then click confirm"

**This is the highest-stakes task in the whole plan** — it's the one moment where an approved
action from Beer actually touches Withlocals' live platform. Log every action taken (what was
typed, what was clicked, a screenshot before/after) to a new audit table, same spirit as
`docs/features/observability-hardening.md`'s money-path logging — if something goes wrong on
Withlocals' side, there must be a clear record of exactly what the agent did.

### Task 8: Full verification pass

Run the existing full suite (`npm test`), confirm the admin-route-contract guardrail test still
passes with the new route shape (see CLAUDE.md's "New Admin Route Export Shapes" gotcha — if
Task 7's new action doesn't change the route's export shape this is a no-op, but check), and do a
manual dry run against a real (test) Withlocals conversation before ever approving a real one.

---

## Explicitly out of scope for this plan

- GetMyBoat (separate future plan, once Withlocals is proven)
- Auto-creating the FareHarbor booking (stays manual, per Beer's decision above)
- Any autonomy level above propose-only (revisit only after Withlocals has run propose-only for a
  meaningful stretch with a good track record — same philosophy as `booking_correction` starting
  directly at `ask` rather than `propose`, but never climbing to `auto` for anything
  money-or-guest-facing)
