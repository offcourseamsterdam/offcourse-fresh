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
   pure function: shared cruises are `flexible` (time change, merge, boat swap
   all allowed); private cruises are `protected` from **merging** only — a
   private booking is never combined onto another party's departure, but it
   CAN be time/boat moved at the same threshold as shared (Beer 2026-07-04).
   Every move still requires a human to approve the actual send. Enforced in
   code, never in prompts.
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
   - **sequential** — at most one open ask per day, ever, and at most ONE new
     draft per triggering run;
   - **private cruises CAN be asked** (Beer 2026-07-04, same €/minute threshold
     as shared) — but only a TIME or boat change, **never merged** onto
     another party's departure (`allowMerge` stays false for private —
     exclusivity is what the guest paid for; this drafter never merges anyone
     anyway, it only ever moves one booking's own time);
   - **bookings with catering/drinks aboard: never asked** (Beer 2026-07-04 —
     the supplier order is already placed);
   - **multi-booking departures**: never asked (would race several parties);
   - a guest **yes never rebooks by itself** — Slack pings the team to perform
     the FareHarbor rebook via admin. Unanswered asks expire after 48h (cron).

   **Horizon (Beer 2026-07-04):** the nightly scan covers the next
   `OPTIMIZE_HORIZON_DAYS` (14) days, only days where a SECOND booking exists,
   and drafts the single most valuable ask across the window — asking two
   weeks out is friendlier and likelier to succeed than the evening before.
   The cron's shift sync covers the same window.

   **Dry-run (autonomy climb to `dry_run`, 2026-07-04):** the gap math
   proposes times derived from shift geometry, but FareHarbor only offers its
   own slot grid — so before any ask is drafted, the ideal time is **snapped
   to a real FH availability** (same boat, same duration, window between the
   current departure and the ideal; matching on `startAt` ISO — display times
   come back as "3pm", verified live) and confirmed with FH's non-mutating
   validate **for the whole party**. Verified live that FH validates a target
   slot while the guest's original booking still holds its own slot. The
   snapped slot's REAL recovered saving replaces the geometric estimate; if
   no slot in the window clears the same €/minute thresholds, no ask exists
   (zero Claude spend). The send button re-validates the stored slot
   immediately before dispatch (execution-chokepoint rule) — a slot taken in
   the meantime expires the request with a clear 409 instead of texting the
   guest a promise we can't keep. The card shows the verdict: "FareHarbor
   confirmed 13:30 is bookable · checked 21:04".

   **Event-driven trigger (Beer 2026-07-04 — "every time a new booking comes
   in"):** `draftGuestMoveForNewBooking(date)` fires fire-and-forget
   (`after()`) right after a booking is confirmed — the Stripe webhook (both
   flows) and the admin `/booking-flow/book` route (both its claim-based
   website path and its internal/recovery path) — scoped to just that
   booking's own date. It syncs that single day's shifts first (the new
   booking's shift may not exist yet), then runs the same candidate check as
   the nightly scan. Skip-first holds: no second booking yet on that date →
   zero DB writes, zero AI calls. Shares its Claude-drafting and insert logic
   with the nightly scan via `craftAndInsertMoveProposal()` — only the
   "how was this candidate found" reasoning differs between the two.

5. **Snackbox upsell** (`catering_upsell` kind, catering agent). Guests whose
   catering is EXACTLY the unlimited-drinks package (`isDrinksOnlyBooking()` in
   `src/lib/catering/filter.ts`) get a drafted bites-box offer 2 days before
   their cruise — grounded in real menu items + prices from the `extras` table,
   linking to their existing pre-order page (extras token). Human-approved send
   via the same approve-button flow; sending stamps `extras_upsell_sent_at`, the
   same column the automated extras-upsell cron checks, so a guest can only
   ever receive one upsell email. The two audiences are disjoint by definition
   (cron = zero catering; Ghost = drinks-only).

6. **Dev Slack redirect** (`src/lib/slack/send-notification.ts`): on localhost
   (NODE_ENV=development) `postSlackText` NEVER touches the team webhook —
   everything goes to Beer's DM (`SLACK_DEV_DM_CHANNEL`, default D08PRAXD13R)
   with a `[dev]` prefix via the bot token. Pinned by tests.

### AI Operations dashboard + the learning loop (Beer 2026-07-04)

7. **The Rulebook** (`/admin/ghost/rulebook`, `src/lib/ghost/rulebook.ts`): the
   page that shows exactly what each agent is told (the prompt) and what the
   code enforces around it (hard rules, each naming its enforcing file), plus
   every tunable threshold. Prompts marked **live** are the literal strings the
   drafters import — the page cannot drift from what the AI reads. Thresholds
   (gap minimums, horizon, upsell lead days, expiry hours) now LIVE in
   rulebook.ts and are imported by the drafters.
8. **Approve & execute — schedule** (`apply_schedule` action): `schedule_day`
   climbed to `ask` (owner-approved 2026-07-04). One click assigns the proposed
   captains — but only to shifts that are STILL open (a manual assignment made
   after the draft always wins), notifies the captains, emits `shift_assigned`
   events, and the runtime guard refuses if the kind ever drops below `ask`.
9. **Learning on expiry** (`src/lib/ghost/evaluate.ts`): when a proposal's
   target date passes unapproved, the sweep (first step of the ghost-ops cron)
   scores it against reality — schedule drafts get a per-shift agreement score
   (proposed vs actually-assigned captain), ops reviews get a resolved/not
   check, unsent upsells are recorded. Everything ends status `expired` with
   the lesson in `outcome`. Recent schedule lessons are injected into the next
   draft's prompt ("here's how the human really assigns — imitate"), and the
   dashboard shows the running agreement percentage. This is retrieval-based
   learning, same pattern as the inbox agent's reply corrections.
10. **Needs-your-decision strip** on `/admin/ghost` (now titled AI Operations):
    actionable shadow proposals surface at the top with their target dates.

## Key files

| File | Role |
|---|---|
| `supabase/migrations/083_ops_events.sql` | Append-only event log — RLS on, zero policies, no update/delete path |
| `src/lib/ops/events.ts` | `emitOpsEvent()` — typed union, fire-and-forget, never throws, never blocks the money path |
| `src/lib/ops/profile.ts` | `deriveOperationalProfile()` — shared=flexible (merge ok), private=protected (no merge, time/boat moves ok), unknown=protected |
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

---

## Cancellation & refund agent (`cancellation_request`) — SPEC, not yet built

**Owner decision (Beer, 2026-08-21).** A guest emailing "we need to cancel, please
refund" is today the one common inbox intent the Ghost has no concept of. It
produces no proposal at all — not even a reply draft — so the whole thing is
manual. This closes that gap.

### The rule Beer asked for, stated plainly

> "If I call for it, it doesn't have to be dry run. If you suggest it, then I want
> to proceed and click it from the sidebar, whilst you also draft a response."

So: **the agent never refunds on its own, but Beer's single click does the real
thing.** That is the `ask` rung — the same shape as `book` and `import_fh_booking`,
which also perform genuinely irreversible work on one human click.

This is deliberately NOT the `booking_proposal` ceiling. Both touch money, but they
are not the same risk:

| | `booking_proposal` | `cancellation_request` |
|---|---|---|
| Ceiling | `dry_run` — pinned forever | `ask` |
| Why | Creating a booking consumes a real slot and charges a card; a hallucinated one invents a customer | Cancelling acts on a booking a **real guest asked about in writing**, and the refund amount is computed by policy, never by the model |
| Human role | Clicks a button that re-resolves and re-validates from scratch | Clicks a button that executes the already-computed action |

The safety property is the same in both cases: **the model's output is never
trusted as the instruction.** See "What the model may and may not decide" below.

### What the agent reads

1. **Intent** — does this message actually ask to cancel? Distinguish a real
   cancellation from "can we move it" (that is `guest_move_request`, which already
   exists and should win) and from a question about the policy.
2. **Which booking** — matched from the conversation's contact, the same way
   `booking_correction` already resolves its target. Never guessed from prose.
3. **Where in the cancellation window it falls** — `src/lib/cancellation/policy.ts`
   already does this and needs no changes:
   - `hoursUntil(departure)` → how long until it sails
   - `getRefundPercent(tiers, departure)` → 100 / 50 / 0 per the tiers on the
     parent `fareharbor_items.cancellation_tiers` (default: 100% >48h, 50% 24–48h,
     0% <24h)
   - `calculateRefundCents(...)` → the actual €, from what was really paid.
     Its own docstring already says "for future refund-management UI" — this is it.

### What the proposal looks like

```
kind: 'cancellation_request'
payload: {
  booking_id, guest_name, departure_at,
  hours_until_departure,        // from hoursUntil()
  refund_percent,               // from getRefundPercent()  — policy, not the model
  refund_cents,                 // from calculateRefundCents() — policy, not the model
  amount_paid_cents,
  policy_summary,               // e.g. "51h before departure → full refund tier"
  reply,                        // the drafted response, in the guest's language
}
```

The card in the sidebar states the situation in one line — *"Paul Kehoe wants to
cancel Private Hidden Gems Cruise, Fri 12 Sep. 51h before departure → full refund
tier. Paid €310 → refund €310."* — then offers:

- **Cancel & refund €X** — the suggested action, pre-filled from policy
- **Cancel, no refund** — for the goodwill/edge cases policy cannot know about
- **Send reply only** — when it is a question, not an instruction
- Every option sends the drafted reply; none of them is silent to the guest.

### What the model may and may not decide

| Decided by code | Decided by the model |
|---|---|
| Which booking this is | Whether the message is a cancellation at all |
| Hours until departure | The wording of the reply |
| Refund tier and € amount | Whether anything looks unusual enough to flag |
| Whether the action can execute at all | — |

Same principle as the rest of this engine: **facts in TypeScript, judgment in
Claude.** A model that miscounts hours cannot cause a wrong refund, because it
never supplies the number — `calculateRefundCents()` does, from the real paid
amount, at click time.

### Execution path (reuses what already exists — do not fork it)

The click goes through `POST /api/admin/ghost/proposals/[id]` with
`action: 'cancel_booking'`, following the identical shape as `book`:

1. Validate the proposal kind and that it is still `shadow`
2. Re-read the booking **live** — never trust the payload's snapshot
3. **Re-compute the refund at click time**, not from the payload. A proposal
   drafted yesterday may have crossed a tier boundary overnight; the guest must
   get today's honest answer, not yesterday's.
4. Atomic claim `shadow → booking` (the existing double-click guard)
5. Call the existing `POST /api/admin/bookings/[id]/cancel` route — which already
   cancels in FareHarbor, refunds via Stripe, and **already refuses when the
   booking has no FareHarbor reference** (added 2026-08-21). No new money path.
6. Send the drafted reply, mark `executed`, `notifyBookingsChanged()`,
   `syncAndScheduleShifts()` so the freed slot leaves the roster
7. Release the claim back to `shadow` on any failure, so a retry is possible

### Hard rules

- **Ceiling `ask`. Never `auto`.** Refunding money and telling a guest their trip
  is off is not something that should ever happen without a person clicking.
- **The refund € is recomputed server-side at execution.** The payload figure is
  for display only.
- **OTA bookings are excluded.** Viator/GetYourGuide hold the customer
  relationship and the money; the existing UI already routes those to "manage this
  on the platform", and this agent must respect the same boundary.
- **A reply always goes out.** A cancelled booking with silence to the guest is
  worse than no automation.

### Files this will touch

- `src/lib/ghost/agents.ts` — register the kind, ceiling `ask`
- `src/lib/ghost/rulebook.ts` — a RULEBOOK entry (it is the in-app explanation of
  what the AI may do; a kind missing from it is invisible to Beer)
- `src/lib/chat/shadow-drafter.ts` — a terminal `submit_cancellation_request` tool,
  alongside the existing `submit_booking_proposal`
- `src/app/api/admin/ghost/proposals/[id]/route.ts` — the `cancel_booking` action
- The inbox co-pilot card + `/admin/ghost` — render it
- Tests: intent vs. move-request, each refund tier, the recompute-at-click
  behaviour, and that an OTA booking is refused

### Dependencies

`src/lib/cancellation/policy.ts` (exists, unchanged), the cancel route (exists,
already guarded), Stripe refunds (exists), the atomic-claim pattern (exists).
Nothing new is required beyond the agent itself.
