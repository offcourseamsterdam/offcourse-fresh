# AI Ops Center (v1: lightweight summary + link out)

## What was built

A persistent icon in the admin header — a small ghost icon, top-right, on
**every** admin page (Bookings, Inbox, Catering, Planning, Availability,
Maintenance, Stock, all of it), not just a section of the app. It carries a
live badge count and, when clicked, opens a slide-over panel with a short
recent-activity feed grouped into four buckets:

1. **Needs your approval** — an AI (Ghost) proposal still waiting for a
   human decision.
2. **Couldn't confidently act** — the AI looked at a situation and
   deliberately chose not to act, with its own reasoning attached.
3. **Automated (no AI judgment)** — plain code that executed on its own,
   no AI involved at all (an ads campaign auto-paused, an upsell email
   auto-sent, a catering order auto-sent).
4. **Ghost took action** — an AI proposal that was approved and executed.

Every row is a one-line summary that links out to `/admin/ghost` (or, for
automated events, a relevant admin section like `/admin/google-ads` or
`/admin/catering`) for the real detail and any decision that still needs to
be made. The panel itself never lets you approve/reject/act — it's a glance
layer, not a second review UI.

This closes two blind spots that existed before this feature:
- When the AI decided *not* to act, its reasoning used to be thrown away
  the instant the function returned — there was nothing to show "why didn't
  it do anything."
- Several fully-automated (zero-AI) actions — the Google Ads guardrail's
  auto-pause, the extras-upsell cron's auto-send — only ever posted to
  Slack. There was no queryable record, so "what did automated code do on
  its own" had no data source.

## Key files

Across the 5 commits that make up this feature (`1ed15f6`, `7dd5cdf`,
`63345a7`, `f5b2440`, `6b4815e` — in that order; `61eb189`, "rename
Scheduling nav item to Availability," sits between two of these commits on
the branch but is unrelated housekeeping, not part of this feature):

| File | Description |
|---|---|
| `supabase/migrations/122_agent_proposals_skipped_status.sql` | Adds `'skipped'` to `agent_proposals.status`'s CHECK constraint — a status for "the AI looked and consciously decided not to act," distinct from `'rejected'` (a human's call) and distinct from never inserting a row at all (today's behavior). |
| `src/lib/ghost/ops-drafters.ts` | The `schedule_day` drafter's two "nothing to assign" branches (plain-drafter and the `auto`-mode safety net) now insert a `skipped` `agent_proposals` row carrying the model's own `parsed.summary` as `reasoning`, instead of just returning the string `'skipped'` and discarding everything. Only fires when there was a real decision to make (`openShifts.length > 0`), so a genuinely empty day never creates noise. |
| `src/lib/ghost/ops-drafters.test.ts` | Tests that a skipped proposal is persisted with the model's reasoning, and that no row is created when there were no open shifts to begin with. |
| `supabase/migrations/123_ops_events_automated_actions.sql` | Adds `'ads_campaign_paused'` and `'extras_upsell_sent'` to `ops_events.event_type`'s CHECK constraint. |
| `src/lib/ops/events.ts` | Adds `'ads_campaign_paused' \| 'extras_upsell_sent'` to the `OpsEventType` union. |
| `src/lib/google-ads/guardrail.ts` | Emits an `ads_campaign_paused` ops_event (campaign id/name, reason, cost, conversions) at the exact point a campaign is actually paused — not when it's merely flagged for review. |
| `src/lib/google-ads/guardrail.test.ts` | Asserts the event fires on a real pause and does not fire for an alert-only campaign. |
| `src/app/api/cron/extras-upsell/route.ts` | Emits an `extras_upsell_sent` ops_event (booking id, recipient, listing, date) right after the upsell email send succeeds and the booking is flagged `extras_upsell_sent_at`. |
| `src/app/api/cron/extras-upsell/route.test.ts` | Asserts the event fires with the booking id set on a successful send. |
| `src/app/api/admin/ops-center/summary/route.ts` | `GET /api/admin/ops-center/summary` — the endpoint powering the badge count and the feed. Reads `agent_proposals` (kinds in `OPS_KINDS`, statuses `shadow`/`executed`/`skipped`) and `ops_events` (types in `AUTOMATED_EVENT_TYPES`) over the last 48h, plus a same-day count of inbound Gmail messages from `messages`. Bucketizes and one-line-summarizes each row; does not re-derive any of `/admin/ghost`'s per-kind detail logic. |
| `src/app/api/admin/ops-center/summary/route.test.ts` | Covers the bucket mapping for each status/event type, the `emailsProcessedToday` count, and the badge-count math. |
| `src/lib/auth/admin-route-contract.test.ts` | Updated inline snapshot (142 → 143 guarded admin route files) so the new summary route is accounted for by the sitewide "every admin handler has `requireAdmin()`" guardrail. |
| `src/components/admin/AiOpsCenter.tsx` | The header trigger + slide-over panel component. Polls the summary endpoint every 30s via `useAdminFetch`, groups the feed into the four buckets, renders the badge and the panel. Styled to match the existing `GhostActivityPanel.tsx` slide-over (full-height right-edge panel, click-outside-to-close, same header/loading/empty-state treatment). |
| `src/app/[locale]/admin/layout.tsx` | Mounts `<AiOpsCenter locale={locale} />` in a new thin header bar above `{children}`, inside `<main>`, so it's genuinely present on every admin page regardless of what that page renders — there was no shared header bar there before this. |

## Architecture decisions

**1. The panel deliberately does not duplicate `/admin/ghost`'s review UI.**
`/admin/ghost` is already a 1,372-line page that reviews AI proposals across
7 op kinds in full detail — approve/reject controls, payload inspection, the
works. This feature does not rebuild any of that. The summary endpoint
produces one line of text and a link per item; every "do something about
this" action still happens on the existing full page. Keeping the two
separate means there is exactly one place that owns the actual review
logic, and the header panel can stay a thin, fast, read-only glance layer
that's safe to mount globally without dragging in that page's complexity or
its data-fetching cost onto every admin route.

**2. `agent_proposals` gained a `'skipped'` status to stop discarding the
AI's own reasoning when it declines to act.** Before this, the `schedule_day`
drafter's "nothing to assign" branches just `return 'skipped'` as a plain
string — nothing was written anywhere. The concrete motivating scenario
(described in the implementation plan, `docs/plans/2026-08-08-ai-ops-center-plan.md`,
Task 2): the drafter can reach a state where assigning a captain would
technically be safe, but it's a single-option scenario the model chooses to
defer to a human on anyway — and that reasoning used to vanish the instant
the function returned, undiscoverable without hand-added debug logging
after the fact. `'skipped'` is intentionally a third state, distinct from
`'rejected'` (a human explicitly said no) and distinct from no row at all
(which reads as "nothing happened" when actually "the AI thought about it
and chose not to act" is itself useful information).

**3. AI-judgment actions and zero-judgment automated actions are two
separate buckets, not merged into one.** `agent_proposals` is the source for
`needs_approval`, `skipped`, and `taken` — all three involve the AI actually
reasoning about something, whether or not it ended up acting. `ops_events`
is the source for `automated` — plain code (the ads guardrail's auto-pause,
the extras-upsell cron) that ran with no AI involved whatsoever. Collapsing
these into one list would blur a distinction Beer specifically wanted
visible at a glance: "did a person's judgment (via the AI) make this call,
or did a rule just fire." The summary route keeps them as two independent
queries against two different tables rather than one unified feed with a
type flag, so each source's own meaning stays intact all the way to the UI.

## How it works

**Data flow:**
1. `AiOpsCenter.tsx` polls `GET /api/admin/ops-center/summary` every 30
   seconds via `useAdminFetch` (the same SWR-based polling pattern the
   sidebar's other badge counts already use).
2. The route runs three Supabase queries in parallel:
   - `agent_proposals` where `kind` is one of `OPS_KINDS` (`schedule_day`,
     `catering_order`, `catering_upsell`, `maintenance_task`,
     `stock_reorder`, `ops_review`, `guest_move_request`) and `status` is
     `shadow`, `executed`, or `skipped`, from the last 48 hours.
   - `ops_events` where `event_type` is one of `AUTOMATED_EVENT_TYPES`
     (`catering_order_sent`, `extras_upsell_sent`, `ads_campaign_paused`),
     from the last 48 hours.
   - `messages` count where `provider = 'gmail'`, `direction = 'in'`, and
     `created_at` falls on today's Amsterdam calendar day — this is
     `emailsProcessedToday`.
3. Each `agent_proposals` row maps to a bucket by its `status`: `shadow` →
   `needs_approval`, `skipped` → `skipped`, anything else (`executed`) →
   `taken`. Each `ops_events` row is always `automated`.
4. `summarizeProposal()` / `summarizeAutomatedEvent()` turn each row into
   one human-readable line (e.g. a skipped row shows its own `reasoning`; an
   `ads_campaign_paused` event names the campaign).
5. The two lists are merged and sorted newest-first into `feed` (48h
   window — two days of context in the panel).
6. **Badge count** is deliberately narrower than the feed: it only counts
   `needs_approval` + `skipped` items from the **last 24h** (things that
   are worth a glance right now). `taken` and `automated` items never count
   toward the badge, regardless of age — they're already-completed actions,
   not something waiting on anyone.
7. The panel component just groups `feed` by `bucket` and renders each
   group in fixed order (`needs_approval`, `skipped`, `automated`, `taken`),
   with `emailsProcessedToday` shown as a small line under the panel title
   when non-zero.

## How to extend

**Adding a new automated (non-AI) action to the "Automated" bucket:**
1. Add its event type to the `ops_events_event_type_check` CHECK constraint
   in a new migration (follow the pattern in
   `supabase/migrations/123_ops_events_automated_actions.sql` — always
   re-check the live constraint first before writing the migration, since
   other in-flight plans may have already extended it).
2. Add the new type to the `OpsEventType` union in `src/lib/ops/events.ts`.
3. Call `emitOpsEvent({ eventType: '<new_type>', actorType: 'system', ... })`
   at the actual point the automated action executes (not at a "this was
   merely flagged/skipped" branch — only real actions should be logged
   here).
4. Add the new type to `AUTOMATED_EVENT_TYPES` in
   `src/app/api/admin/ops-center/summary/route.ts`, and a case for it in
   `summarizeAutomatedEvent()` (and adjust the `href` logic if it should
   link somewhere other than `/admin/catering`).

No changes are needed to `AiOpsCenter.tsx` — the panel component only knows
about the four buckets, never about individual event/kind types.

**Adding a new AI-proposal kind:** if it's inserted into `agent_proposals`
with the standard shape (`kind`, `status` one of `shadow`/`executed`/
`skipped`/etc., `reasoning`, `payload`) and its `kind` is added to
`OPS_KINDS` in the summary route, it is picked up automatically — no other
changes needed unless you want a kind-specific summary line (extend
`summarizeProposal()`) or a different link target than the default
`/admin/ghost`.

## Dependencies

**Depends on:**
- `/admin/ghost` — the existing full-detail review page every feed item
  links out to. This feature never re-implements its logic, only surfaces
  a pointer to it.
- `agent_proposals` table — source of the `needs_approval`, `skipped`, and
  `taken` buckets.
- `ops_events` table — source of the `automated` bucket.
- `messages` table — source of `emailsProcessedToday`.

**Depended on by:** nothing yet — this is a pure read/summary layer with no
writes of its own, so nothing else in the codebase currently relies on it
existing.

**Known gap, by design:** a *different*, not-yet-executed plan
(`docs/plans/2026-08-07-booking-ops-timeline-plan.md`) will eventually
instrument a `catering_order_sent` ops_event. This panel's `AUTOMATED_EVENT_TYPES`
list and `summarizeAutomatedEvent()` already know how to display that event
type — it was included on the assumption the other plan would land migration
121 first. Until that plan actually runs, no `catering_order_sent` rows will
ever exist, so that specific row in the "Automated" bucket will simply never
appear; nothing else in this feature is affected.

## Explicitly out of scope for v1

(Carried over from the implementation plan, for anyone extending this later.)

- Inbox reply/booking-correction approvals are not in the feed — they stay
  reviewed in the context of their conversation thread, where the full
  message history is visible. Pulling them into this panel without that
  context would strip the thing that makes them reviewable.
- No per-section filtering (e.g. only Catering-related items while on the
  Catering page) — the panel shows the same global feed everywhere.
- No push notifications, sound, or badge-on-tab-title — purely an in-app
  panel for now.
