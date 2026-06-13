# Ghost Inbox Co-pilot — plan

**Status:** plan (agreed direction; phased build). Builds on the Ghost shadow
AI (`docs/features/ghost-shadow-ai.md`) and the unified inbox.

## The goal

Move the Ghost from the standalone `/admin/ghost` page **into the inbox** as a
co-pilot side panel, so that — for one customer conversation — you see what the
Ghost would do, can act on it in one click, can *ask* it to do things, and over
time let it do the reversible parts on its own. The end state is an agent that
**takes actions**, climbing a trust ladder:

1. asks approval for each step,
2. shows an honest confidence level per step,
3. ("you approved my last N replies → 92% this is right"),
4. you grant it permission to act on your behalf — for reversible actions only.

## The reframe (why this is smaller than it looks)

The hard engine already exists on this branch:

- `runAgenticLoop` (the tool-use loop) + `buildGhostTools` (read-only tools)
- `checkBookingViability` / `resolveBookingSlot` (FareHarbor dry-run, fail-closed)
- `agent_proposals` (per-conversation record: draft, steps, verdict, outcome, reasoning)
- the autonomy ladder (`AUTONOMY_CEILING` / `IRREVERSIBLE_KINDS`) with money pinned to `dry_run`
- the learning loop (`outcome`, `compare.ts`, `similarity.ts`, `ghost_knowledge`)
- a hardened booking endpoint (`/api/admin/booking-flow/book`: validate→create→Supabase→Slack→email)

So "agent takes action" = **surface the proposal in the inbox + one button that
re-validates the slot and calls the booking endpoint.** Everything else is wiring.

## Architecture

- **One per-conversation timeline** = a merge of three sources:
  `messages` (the text) · `agent_proposals` (the Ghost's drafts) ·
  **`conversation_events`** (NEW — the *verbs*: human searches, lookups,
  bookings created, replies sent, proposals approved/rejected, co-pilot turns).
  Events are the ordering spine; messages/proposals are hydrated by id.
- **Reuse `agent_proposals`** as the per-conversation Ghost record (add
  `source: 'shadow'|'copilot'` + `approved_by_profile_id`). The co-pilot writes
  proposals here too, so the ladder + stats + learning work for free.
- **Co-pilot chat** = the same `runAgenticLoop` + tools, flipped from
  passive/auto to interactive/propose-then-approve. You type "book Diana 2h
  Saturday for 4" → it runs `search_availability` + `check_booking` → emits a
  `booking_proposal` with an Approve button. It never auto-executes.
- **Create-from-inbox** reuses `/api/admin/booking-flow/book` verbatim (the
  single money-path chokepoint). The proposal's human-readable slot is resolved
  to FareHarbor PKs by `resolveBookingSlot`, **re-validated at click time**, then
  booked. Logged as a `booking_created` event.
- The panel is `'use client'` and only ever talks to the server engine through
  API routes (server-only boundary: never import the runtime into the panel).

## The trust ladder (honest)

- **Confidence is a heuristic, not a guarantee** — computed per action *kind*
  from real history: approval rate + edit/rewrite rate (`similarity.ts`) +
  outcome accuracy over a rolling window. Meaningless below ~dozens of samples,
  so it's **read-only and deferred** until there's volume.
- **States** map to the existing ladder: `propose` (shadow) → `dry_run`
  (validated, shown with Approve) → `ask` (one-click pre-send, reversible kinds)
  → `auto` (auto-with-undo, reversible kinds only).
- **Promotion is explicit and demotable** — the % proposes, the human disposes.
  No kind promotes itself by crossing a threshold.
- **Safety, in code not vibes:** `IRREVERSIBLE_KINDS` (booking create, refunds,
  payouts) are pinned to a `dry_run` ceiling forever by tests that already pass.
  They can be auto-*checked* but never auto-*executed*; the Promote button is
  hard-hidden for them. `auto` is only safe for reversible kinds because of an
  **undo window** (a sent reply sits cancellable ~10 min). If an action can't sit
  in a revertible buffer, it can't reach `auto`.

## Phased roadmap (each phase ships value)

| Phase | Deliverable | Effort | Why |
|---|---|---|---|
| **P0** | Surface the existing `booking_proposal` (with its green dry-run verdict) + `reply_draft` in the inbox thread. "Approve & create booking" → re-resolve slot → `/booking-flow/book`. Reply draft → prefill composer. | M | **The agent-takes-action moment.** Reuses everything; the only new logic is the resolver bridge + re-validate-on-click. |
| **P1** | Proper collapsible co-pilot side panel (floating toggle in `ThreadPane`, like the Availability pill). Re-draft + answer-question (teach) moved in. Manual "create a booking" via the existing AvailabilityFinder. | M | The co-pilot lives in one place; act on suggestions or start your own, without leaving the inbox. |
| **P2** | In-panel chat: type intent → `runAgenticLoop` scoped to this conversation → proposal card with the P0 Approve button. | M | Turns the panel from a suggestion box into something you direct. New entry point, not a new engine. |
| **P3** | Read-only confidence surface: per-kind "how often its draft matched what you sent", from data already captured. No behavior change. | S | Honest evidence base — only meaningful once volume exists. |
| **P4** | Scoped event log (`conversation_events`) — the approve/edit/reject *decisions* (not a search firehose) the ladder actually consumes. | L | The evidence trail to raise a reversible kind's autonomy. |
| **P5** | Raise `reply_draft` (reversible, ceiling already `ask`) to one-click pre-send once data earns it. **Bookings stay human-click forever.** | S | The only safe rung up — and only for replies. |

## Deliberately deferred (anti-scope-creep)

- **Rolling confidence %** before approval volume — a % off 3 samples is noise. → P3, read-only.
- **Full event instrumentation** ("track every search/lookup") — largely redundant with the reply outcome loop + taught knowledge; a privacy/storage/write-path firehose. → P4, scoped to decisions only.
- **"Act on my behalf" for bookings** — never. Pinned to `dry_run` by `IRREVERSIBLE_KINDS`; cut any language that lets it creep back.
- **A separate per-conversation "agent record"** — `agent_proposals` already is one (keyed by `conversation_id`). Don't model a second source of truth.
- **A bespoke floating-panel shell** before there's content in it — start inside the existing three-pane `ContextPane` (P0), extract the panel in P1.

## The one place to spend real rigor

The **slug→availPk resolver + re-validate-on-click**. The proposal speaks human
("Diana 2h", "5pm"); the booking endpoint needs `availPk` + `customerTypeRatePk`.
`resolveBookingSlot` does this, but live availability can change between dry-run
and approval — so Approve MUST re-resolve and re-validate (exact-match-or-abstain;
never book a guessed slot), and the create needs an idempotency guard (inbox
bookings have no Stripe PaymentIntent to dedupe on — add `bookings.idempotency_key`).
This is the single point where the AI's words become a real booking.

## First step

Build **P0** in the existing inbox, reusing `resolveBookingSlot` and
`/api/admin/booking-flow/book`. Ship it, then let usage — not this doc — decide
whether chat, confidence, and events earn their build.
