# Ghost Shadow AI — proposals, ops drafters & cost metering

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
