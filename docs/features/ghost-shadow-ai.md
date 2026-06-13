# Ghost Shadow AI — agents, proposals, learning loop & cost metering

## How the Ghost learns (read this if you're unsure how it "gets smarter")

The Claude model itself is **frozen** — it never changes. So the Ghost doesn't
learn the way a brain studies; it learns the way a sharp new employee does who
wakes up with amnesia every morning but reads fast. Each time it acts, the
system hands it a **fresh briefing note** assembled from the database, it does
the work, then forgets. "Learning" = the briefing note gets better, not the
model gets smarter. The technical name is **retrieval, not training**.

So, directly:

- **Does it store everything in a database?** Yes — the database *is* its
  memory. The model has none of its own. Two stores: `ghost_knowledge` (facts
  the team typed in — explicit memory) and `agent_proposals.outcome` (your real
  replies vs the Ghost's drafts — learned-by-example memory).
- **Is the table the learning?** The table is the *filing cabinet*; the learning
  happens at the instant rows get **selected into the prompt** (see
  `shadow-drafter.ts`). A row nobody injects changes nothing. The intelligence
  lives in the *selection*, which is why scaling = better selection, not bigger
  storage.
- **Should learnings live in CLAUDE.md?** No. CLAUDE.md is static dev
  instructions — written by developers, shipped in a git deploy, read while
  *building* the app. The Ghost's knowledge changes at runtime, written by ops
  staff clicking "Teach", many times a day, no deploy. Different author,
  different speed, different reader → different home (the DB). CLAUDE.md only
  holds a *pointer* to where the runtime memory lives.

### The 500-message problem (selection ladder)

You can't paste 500 lessons into every prompt — too expensive, and the model
loses focus. So you select a subset. Three stages, each matched to data volume:

| Stage | Mechanism | Worth it at |
|---|---|---|
| **1. Recency (today)** | Inject newest 20 knowledge + last 5 corrections | 1–~40 rows |
| **1b. Pinned (today)** | `pinned` facts always injected regardless of age — a hedge so a critical old fact never falls off the window. Pin from the "What the Ghost knows" panel | any volume |
| **2. Relevance (pgvector)** | Embed each fact; fetch the ones *most similar* to this message, any age | ~40–60+ rows, or when you re-teach a forgotten fact |
| **3. Distillation (playbook)** | Periodically have Claude compress all rows into a tight, deduped playbook, injected whole | ~100–150+ rows |

We are at **Stage 1 + pinned** deliberately. With a handful of facts, recency +
pinning is correct; pgvector and the playbook are **documented-and-deferred**
(building them now would be indexing a one-page notebook). The honest next step
isn't more machinery — it's *usage*: the Ghost can only learn from data that
exists. Revisit Stage 2 at ~40–60 facts, Stage 3 at ~100–150.

## The agent layer (C11)

The Ghost is organized as **six agents, one per operation domain**, registered
in `src/lib/ghost/agents.ts`: inbox, booking, catering, scheduling (active) +
maintenance, storage (planned — they activate when their tables exist, vision
doc §3/§9). The Ghost page shows the fleet; each proposal is attributed to its
agent via `agentForKind()`.

What makes them *agents* rather than text models (per Anthropic's "Building
Effective Agents": *"LLMs using tools based on environmental feedback in a
loop"*):

- `src/lib/ghost/agent-runtime.ts` — the canonical Anthropic tool-use loop:
  Claude gets a goal + tool definitions; on `stop_reason: 'tool_use'` we
  execute the requested read-only tools and feed `tool_result` blocks back
  (errors flagged `is_error: true` so the model self-corrects); the run ends
  when the agent calls a terminal `submit_*` tool whose schema-validated
  input IS the proposal. Guardrails: max 6 turns, `max_tokens` 1200/step,
  clamped tool results, every call metered, all failures → null.
- `src/lib/ghost/tools.ts` — the toolbox: `search_availability` (live
  FareHarbor through the 3-layer filters), `get_customer_bookings`,
  `get_schedule`. Few, consolidated, compact results — per Anthropic tool-
  design guidance.
- The inbox agent (`src/lib/chat/shadow-drafter.ts`) investigates before
  drafting — e.g. observed re-checking availability with guests=5 when the
  customer said "4 people plus the dog". If a customer wants a concrete,
  *confirmed-available* slot it ends with `submit_booking_proposal` →
  a `booking_proposal` row (booking agent) carrying the action chain; the
  Ghost card renders "AGENT INVESTIGATED" steps + the proposed booking.
- Execution stays OFF: tools are read-only; the only write is the proposal.
  Approval-to-execute is the next trust-ladder rung, per kind.

## Dry-run execution & the autonomy ladder (C12)

The owner's question: *"how do I know it executes well, without taking
permanent action?"* Answer: the booking agent now **executes for real, but
reversibly**, on FareHarbor's own dry-run endpoint.

- **Autonomy ladder** (`src/lib/ghost/agents.ts`): every kind has a level —
  `propose` (shadow only) → `dry_run` (validate against the real system, attach
  a verdict, still nothing created) → `ask` (human clicks to perform a
  reversible action) → `auto` (far future). Stored as typed config constants,
  not a DB table (premature). Each kind also has a hard `AUTONOMY_CEILING` it
  can never exceed.
- **Irreversible safety invariant:** `IRREVERSIBLE_KINDS = ['booking_proposal']`
  is pinned to a `dry_run` ceiling — the agent may *validate* a booking but can
  **never** create one, refund, or pay out without a human. Enforced three ways:
  the ceiling constant, a unit test (`agent-runtime.test.ts`) that fails CI if a
  money kind is bumped past `dry_run`, and the dry-run route's runtime guard.
- **The dry-run itself** (`src/lib/ghost/dry-run.ts`): after the booking agent
  emits a `booking_proposal`, it re-derives the exact FareHarbor `availPk` +
  `customerTypeRatePk` from the proposal (exact time + option match, or
  abstain), then calls **only** `fh.validateBooking` — FareHarbor's
  `/bookings/validate/` endpoint, which returns "would this book?" + a price
  quote and creates nothing, emails no one, holds no capacity. The verdict
  (`is_bookable`, code, error, quote) is stored in `payload.verdict`; status
  stays `shadow`. A grep-guard test asserts the module never references the
  create/rebook endpoints.
- **Why not "create then delete"?** The owner's own observation: a real
  `createBooking` fires a FareHarbor confirmation email (and a cancellation),
  consumes capacity, and is messy to undo. `validate` is the clean, contractual
  no-side-effect check — verified across all 4 existing call sites + the FH docs
  by an adversarial red-team before building.
- **What you see** (`/admin/ghost`): each booking card shows a green *"✓ Would
  book successfully — validated, nothing created, no email"* with the FareHarbor
  quote, or amber *"✗ Would NOT book — <reason>"*, plus a **Re-check** button
  (verdicts go stale as capacity changes). Agent chips show each agent's current
  level (e.g. *Booking agent · dry-run*).
- **Fail-closed everywhere:** `is_bookable` is true only on a 200 with literal
  `true`; any error, ambiguity, or vanished slot ⇒ not bookable, with the reason
  shown. The real booking (whenever a human eventually approves) must re-validate
  immediately before create — a stored green verdict is advisory, never a
  skip-validation token.

## What was built

The Ghost is the first slice of the AI operations layer from
`docs/plans/ai-operations-vision.md`: an AI that **reads the database, drafts
what it would do, and never executes**. Every draft is a row in
`agent_proposals` with status `'shadow'`, visible on `/admin/ghost` (sidebar →
Dev → Ghost AI). Comparing its drafts against what humans actually did is how
each proposal kind earns promotion up the trust ladder
(shadow → always-ask → auto-with-undo → auto; money actions never pass
always-ask).

Three kinds ship today:

| Kind | Trigger | What it drafts |
|---|---|---|
| `reply_draft` | every inbound webchat message (`after()` in the chat routes) | the reply it would send, in the customer's language, + reasoning |
| `schedule_day` | daily cron 15:00 UTC (`/api/cron/ghost-ops`) | captain per open shift tomorrow, using availability + 7-day workload fairness |
| `catering_order` | same cron | consolidated supplier order for the next 3 days' catering bookings, flagging unsent supplier emails |

Every Claude call is metered: tokens → euro cents → `ai_usage` table. Each €5
of cumulative spend sends **one** Slack DM to Beer (PK-guarded in
`ai_usage_alerts`, so concurrent calls can't double-alert). The Ghost page
header shows total / 30-day spend.

## Key files

- `supabase/migrations/071_agent_proposals.sql` — one proposals table for ALL kinds: `kind`, `payload` jsonb, `reasoning`, status ladder, `human_edits`, `outcome`
- `supabase/migrations/072_ai_usage.sql` — `ai_usage` ledger + `ai_usage_alerts` (threshold PK = alert-once)
- `src/lib/ai/usage.ts` — `recordAiUsage()` (MANDATORY on every AI call), `computeCostEurCents()`, `crossedThresholds()`, `getAiSpendSummary()`
- `src/lib/chat/shadow-drafter.ts` — `reply_draft` drafter (conversation + contact + booking history → draft + reasoning)
- `src/lib/ghost/ops-drafters.ts` — `schedule_day` + `catering_order` drafters
- `src/app/api/cron/ghost-ops/route.ts` — daily cron (requireCronSecret), runs both ops drafters
- `src/app/api/admin/ghost/route.ts` — proposals + spend for the dev page (requireAdmin)
- `src/app/[locale]/admin/ghost/page.tsx` — the notebook UI: per-kind cards + spend header

## Architecture decisions

- **Shadow-only writes.** Drafters insert proposals and nothing else. No
  FareHarbor calls, no emails, no Slack to customers. Promotion to acting is
  a future, per-kind decision backed by this page's evidence.
- **Agents read tables, never UI** (vision doc §1b). The drafters query the
  same Postgres the admin uses; new channels/features feed them automatically.
- **Never break the host flow.** `reply_draft` runs in `next/server`'s
  `after()` (post-response) and swallows all errors; cron drafters return
  `'skipped'` on any failure.
- **Skip-first cost discipline.** No open shifts / no catering bookings /
  proposal already exists for the target date → no Claude call at all.
  `max_tokens ≤ 1000`, prompt lists capped (30 messages, 5 bookings).
- **Cost estimate, not bookkeeping.** Pricing constants (USD/Mtok × EUR rate)
  live in `usage.ts`; good enough for runaway protection, not invoicing.
- **Alert-once via PK.** `ai_usage_alerts.threshold_eur` is the primary key;
  the first inserter wins and sends the DM, the loser hits the conflict.

## The learning loop (how it gets smarter, mechanically)

No model training — three retrieval mechanisms, all visible on `/admin/ghost`:

1. **Corrections.** When an admin sends a reply in the inbox, the messages
   route attaches it to the latest unanswered `reply_draft` proposal for that
   conversation (`outcome: { human_reply, replied_by, replied_at }`). The
   drafter includes the 5 most recent draft-vs-actual pairs in every prompt
   as "HOW THE TEAM ACTUALLY REPLIES" — few-shot imitation of real style and
   choices. The Ghost card shows both bubbles side by side.
2. **Questions → knowledge.** The drafter operates under a hard rule: it may
   only assert brand facts, taught knowledge, and the customer's booking
   data. Anything else (amenities, policies, prices) → a warm "let me check"
   reply + one `open_question` in the payload. The questions panel on the
   Ghost page lists unanswered ones; answering inserts a `ghost_knowledge`
   row, and the newest 20 entries are injected into every future prompt as
   "THINGS THE TEAM HAS TAUGHT YOU (treat as ground truth)". Verified live:
   asked about toilets/blankets → "let me check" + question; after one
   taught answer → complete confident reply, open_question null.
3. **Stats.** The strip on the Ghost page counts proposals by kind,
   corrections captured, open questions, and knowledge entries — learning,
   measured. (pgvector similarity retrieval is the planned next rung when
   volume outgrows "5 most recent".)

## How to extend (the CLAUDE.md rule)

Adding any new operational feature? Answer in its feature doc: *can the Ghost
shadow it?* If yes:

1. Pick a `kind` string; design the payload (include `target_date` for
   cron-driven kinds — it's the dedupe key).
2. Write a drafter following `ops-drafters.ts`: read truth → one metered
   Claude call → JSON parse → insert proposal → return `'drafted' | 'skipped'`.
3. Add it to `/api/cron/ghost-ops` (or hook an event with `after()`).
4. Add a card renderer in `ghost/page.tsx` (`KIND_META` + a payload section).
5. **Meter the call** with `recordAiUsage({ feature: 'ghost_<kind>', … })`.

## Dependencies

- Depends on: customer chat (070), scheduling tables (068), catering filter
  lib, Slack bot token (`postToChannel`), `CRON_SECRET`, `ANTHROPIC_API_KEY`.
- Depended on by: future proposal kinds (stock orders, weather playbook,
  booking agent) — same table, same page, same meter.
- Env: `AI_COST_ALERT_SLACK_ID` (optional override; defaults to Beer's DM).
