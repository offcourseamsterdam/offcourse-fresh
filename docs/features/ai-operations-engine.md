# AI Operations Engine — fundament (fase 1) + guest outreach (fase 3a)

## What was built

The first slice of the AI Operations Engine from the Boat Local PRD, built on the
existing Ghost agent framework. Three pillars:

1. **`ops_events`** — an append-only event log recording every operational
   transition (bookings confirmed/cancelled, shifts assigned, recommendations
   made/reviewed/approved). This is the engine's memory: future scoring,
   acceptance-probability calibration, and demand forecasting all train on it.
   Distinct from `admin_event_log` (human-facing audit feed) by design — different
   retention, different query patterns, no severity/message semantics.
2. **Operational profiles** — the PRD's shared-vs-private flexibility rules as a
   pure function: shared cruises are `flexible` (time change / merge / boat swap
   allowed), private cruises are `protected` (nothing moves without a human asking
   the guest). Enforced in code, never in prompts.
3. **The operations optimizer** — the seventh Ghost agent (`ops_review` kind).
   Every evening (ghost-ops cron, 15:00 UTC) it reviews tomorrow: TypeScript
   computes the deterministic facts (gaps between sailings, paid idle minutes and
   their € cost, boat-merge candidates, staffing level, blocking maintenance),
   Claude judges those facts through the agentic tool loop and submits explainable
   recommendations — each with `est_saving_cents`, guest impact, and confidence.
   Shadow-only (`propose` on the autonomy ladder, ceiling `ask`).

Plus the missing piece that makes the agent trustworthy: **automatic shift sync**.
The bookings→shifts generator (previously only behind the manual Sync button in
/admin/scheduling) now also runs at the start of the ghost-ops cron, so the agent
never reasons over a stale roster.

### Guest outreach (fase 3a — PRD "Smart Guest Suggestions")

4. **Guest move requests** (`guest_move_request` kind). When tomorrow has a paid
   gap worth ≥ €20 / ≥ 45 min, the Ghost picks ONE booking that could close it
   and drafts the ask: an SMS + email (brand voice, incentive = a bottle of wine,
   quote summary, price unchanged) with a `{{link}}` placeholder. A human clicks
   **Approve & contact guest** on /admin/ghost → email (Resend) + SMS (Twilio,
   optional) go out with the guest's personal HMAC-tokened response link. The
   guest taps **Yes, that's fine** / **Let me check** / **Keep my original time**
   (en/nl page, no login). Every answer lands in `ops_events`
   (`guest_move_accepted/declined/deferred`) — the acceptance-probability
   training data the PRD calls for.

   Hard rules, all in `selectMoveCandidate()` (code, never prompts):
   - **sequential** — at most one open ask per day, ever;
   - **private cruises**: never asked;
   - **bookings with catering/drinks aboard: never asked** (Beer 2026-07-04 —
     the supplier order is already placed);
   - **multi-booking departures**: never asked (would race several parties);
   - a guest **yes never rebooks by itself** — Slack pings the team to perform
     the FareHarbor rebook via admin. Unanswered asks expire after 48h (cron).

## Key files

| File | Role |
|---|---|
| `supabase/migrations/083_ops_events.sql` | Append-only event log — RLS on, zero policies, no update/delete path |
| `src/lib/ops/events.ts` | `emitOpsEvent()` — typed union, fire-and-forget, never throws, never blocks the money path |
| `src/lib/ops/profile.ts` | `deriveOperationalProfile()` — shared=flexible, private=protected, unknown=protected |
| `src/lib/ghost/ops-review.ts` | The agent: `computeDayFacts()` (pure, tested) + `draftOpsReview()` (loop + proposal) |
| `src/lib/scheduling/sync-shifts.ts` | `syncShiftsForRange()` — extracted from the manual sync route, shared with the cron |
| `src/app/api/cron/ghost-ops/route.ts` | Now: sync shifts → then draft schedule + catering + ops review in parallel |
| `src/lib/ghost/agents.ts` | `operations` agent registered; `ops_review` at `propose`, ceiling `ask` |
| `src/app/[locale]/admin/ghost/page.tsx` | Ops-review card: facts strip + per-recommendation badge, €, guest impact, confidence |
| `scripts/run-ops-review.ts` | Run the agent once for real (sync + draft + print the proposal) |
| `src/lib/ghost/guest-move-drafter.ts` | `selectMoveCandidate()` (pure, tested — all outreach hard rules) + `draftGuestMoveRequest()` + 48h expiry sweep |
| `src/lib/ops/move-token.ts` | Per-proposal HMAC token for the guest's personal response link |
| `src/lib/sms/send-sms.ts` | Twilio SMS via one fetch — `false` when unconfigured, throws on real failure |
| `src/app/[locale]/(public)/move/[id]/[token]/` | The guest response page (en/nl): offer, quote, three buttons |
| `src/app/api/move/respond/route.ts` | Records the guest's answer: outcome + ops_events + Slack ping (accept → "rebook now") |
| `scripts/demo-guest-move.ts` | Insert/cleanup a demo request to eyeball the page + admin card |

Emit points wired into existing transitions: `webhooks/stripe` (booking_confirmed,
both payment flows), `admin/bookings/[id]/cancel` (booking_cancelled),
`admin/scheduling/shifts/[id]` (shift_assigned/unassigned),
`admin/ghost/proposals/[id]` (recommendation_reviewed/approved),
`ghost/ops-review` (recommendation_created).

## Architecture decisions

- **Facts in TypeScript, judgment in Claude.** The LLM never computes a number: every
  € in a recommendation traces to a precomputed gap cost or staffing figure in
  `computeDayFacts()`. This is the PRD's explainability requirement made structural.
- **No solver, no ML.** With 2 boats the whole day fits in a screenful of facts;
  exhaustive deterministic computation beats any optimizer at this scale. The clean
  interfaces (`ops_events` schema, pure functions) are what Boat Local inherits, not
  a generic platform.
- **Hard rules in code.** Private-cruise protection is a filter in
  `computeDayFacts()` (a protected shift never becomes a merge candidate), not a
  prompt instruction. Prompts repeat the rules only so the model reasons within them.
- **Append-only at the database.** `ops_events` has RLS enabled with zero policies:
  only the service role writes, and nothing — not even admin code — updates or
  deletes. Bad data is corrected by emitting a new event, never by rewriting history.
- **New table, not `admin_event_log`.** Audit feed and training substrate have
  opposite retention and query needs; merging them poisons both.

## How it works (data flow)

```
15:00 UTC cron → syncShiftsForRange(today, tomorrow)     [bookings → shifts, idempotent]
              → draftOpsReview()
                  1. fetch tomorrow: shifts + staff + availability + blocking maintenance
                  2. computeDayFacts()                    [pure TS: gaps, €, merges, staffing]
                  3. runAgenticLoop(facts, tools, submit_ops_review)
                  4. insert agent_proposals kind 'ops_review' (status shadow)
                  5. emitOpsEvent('recommendation_created')
/admin/ghost  → renders the card; Review click → emitOpsEvent('recommendation_reviewed')
```

Dedupe: one proposal per target date (`payload->>target_date`), re-runs are no-ops.
No shifts tomorrow → skip at zero cost. All Claude calls metered via `ai_usage`
(feature `ghost_ops_review`, €5 Slack tripwire applies).

## How to extend

- **New event type**: add to the CHECK constraint (new migration) + the
  `OpsEventType` union, then emit from the transition that owns it.
- **New recommendation type**: extend `submit_ops_review`'s enum +
  `validateRecommendations` + `OPS_REC_BADGE/LABEL` on the Ghost page.
- **Phase 2 (per the plan)**: replace the LLM's freeform judgment with enumerated,
  scored scenarios in `src/lib/ops-engine/` (pure TS) — the LLM then only narrates.
  Phase 3 (booking-triggered runs + sequential guest outreach) is gated on a job
  queue (Inngest/QStash, audit finding H2).
- **Autonomy climb**: when `agent_proposals.outcome` history shows sustained
  agreement, bump `ops_review` propose → ask in `agents.ts` (ceiling already `ask`).

## Dependencies

Builds on: Ghost framework (`agent-runtime`, `tools`, `agents`, `/admin/ghost`),
captain scheduling (`shifts`, `staff`, `staff_availability`, `generate-shifts`),
maintenance agent (`maintenance_tasks` for blocking-task conflicts), `ai_usage`
metering. Depended on by: nothing yet — later phases read `ops_events`.

## Verification

- `npx vitest run src/lib/ops src/lib/ghost/ops-review.test.ts` — fact math (gaps,
  idle €, merge candidacy, private protection), event helper, profile matrix.
- `npx tsx --tsconfig tsconfig.scripts.json scripts/run-ops-review.ts` — real run:
  syncs shifts, drafts the review, prints the proposal + latest ops_events rows.
- Verified live 2026-07-04: agent found tomorrow's unstaffed Curaçao 17:00 shift and
  proposed the only available captain, confidence 1.0, €0 invented savings; card
  renders on /admin/ghost; `ops_events` received `recommendation_created`.
