# AI Ops Center (v1: lightweight summary + link out) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** A persistent top-right icon in the admin header (visible on every
admin page — Bookings, Inbox, Catering, Planning, Availability, Maintenance,
Stock, everywhere) with a live badge count, opening a compact slide-over
panel that answers four questions at a glance: what has the Ghost (AI)
done, what couldn't it confidently do (and why), what plain automated code
did with zero AI judgment involved, and what needs my approval right now.
Links out to the existing full-detail pages (`/admin/ghost`, `/admin/inbox`)
for anything that needs a real decision — this version does not duplicate
their review UI.

**Architecture:** Almost all of the underlying data already exists —
`/admin/ghost` (1372 lines) already reviews proposals across 7 op kinds.
This plan does NOT rebuild that. It adds: (1) one missing piece of data —
today, when the scheduler decides *not* to act, its reasoning is thrown away
the moment the function returns, so "couldn't take action" has nothing to
show; (2) a second missing piece — several REAL automated actions
(`catering-auto-send`, `extras-upsell`, the Google Ads guardrail's
auto-pause) already execute with zero AI judgment involved, but today only
post to Slack — nothing queryable is left behind, so "what did automated
code do on its own" has no data source either; (3) one new lightweight
summary endpoint that reads across `agent_proposals` + `ops_events` +
`messages` without re-deriving any of `/admin/ghost`'s per-kind rendering
logic; (4) the header button + panel themselves, mounted once in
`admin/layout.tsx` so every admin page gets it for free.

**Dependency note:** Task 3 below reads a `catering_order_sent` ops_event
that is instrumented by a *different*, already-written plan
(`docs/plans/2026-08-07-booking-ops-timeline-plan.md`, Task 1) — don't
re-add that instrumentation here. If that plan hasn't been executed yet,
the catering-auto-send row in this panel's "Automated" bucket will simply
stay empty until it has been; everything else in this plan works
independently of it.

**Tech Stack:** Next.js 16 App Router, Supabase, SWR (`useAdminFetch`, same
polling pattern the sidebar's existing badge counts already use), Vitest.

---

### Task 1: Let `agent_proposals` record a conscious "no action" decision

**Files:**
- Create: `supabase/migrations/122_agent_proposals_skipped_status.sql`

**Step 1: Write and run the migration**

```sql
-- 122: agent_proposals needs a status for "the agent looked and consciously
-- decided not to act" (distinct from 'rejected', which is a human's call,
-- and distinct from simply never creating a row, which is what happens
-- today and is why that reasoning is currently invisible).
ALTER TABLE public.agent_proposals DROP CONSTRAINT IF EXISTS agent_proposals_status_check;

ALTER TABLE public.agent_proposals ADD CONSTRAINT agent_proposals_status_check
  CHECK (status IN ('shadow', 'proposed', 'approved', 'rejected', 'expired', 'booking', 'sending', 'executed', 'skipped'));
```

Run via the Management API per CLAUDE.md's Supabase section, then verify:

```bash
SQL="SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'agent_proposals'::regclass AND contype = 'c';"
curl -s -X POST "https://api.supabase.com/v1/projects/fkylzllxvepmrtqxisrn/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$SQL" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"
```
Expected: the returned CHECK definition includes `'skipped'`.

**Step 2: Commit**

```bash
git add supabase/migrations/122_agent_proposals_skipped_status.sql
git commit -m "feat: allow agent_proposals.status = 'skipped'"
```

---

### Task 2: Persist `schedule_day`'s skip reasoning instead of discarding it

**Files:**
- Modify: `src/lib/ghost/ops-drafters.ts` (the `validAssignments.length === 0` branch, ~line 190, and the `auto` branch's `safeAssignments.length === 0` branch, ~line 230)
- Test: `src/lib/ghost/ops-drafters.test.ts`

Today, both branches just `return 'skipped'` with nothing recorded. The
model's own `parsed.summary` (its stated reasoning) is sitting right there
and gets thrown away. This is the exact gap that made the Aug 9 incident
invisible until debug logging was added by hand.

Only worth recording when there was something real to decide — i.e. when
`openShifts.length > 0` (already guaranteed, since that's checked earlier at
line 108) — so this never fires on a genuinely empty day.

**Step 1: Write the failing test**

Add to `ops-drafters.test.ts` (follow its existing mocking style — it
already mocks the Claude call and the Supabase chain):

```ts
it('persists a skipped proposal with the model\'s own reasoning when it declines to assign', async () => {
  // Arrange: one open shift, one available staff member, but the mocked
  // Claude response returns an empty assignments array with a summary.
  mockClaudeResponse({
    assignments: [],
    summary: 'Assigning would be safe, but this is a single-option scenario so I am deferring to a human.',
  })
  const insertedRows = await runDraftOrAssignScheduleAndCaptureInserts('2026-08-09')
  const skippedRow = insertedRows.find(r => r.status === 'skipped')
  expect(skippedRow).toBeTruthy()
  expect(skippedRow.reasoning).toContain('single-option scenario')
  expect(skippedRow.kind).toBe('schedule_day')
})

it('does not persist a skipped row for a day with no open shifts', async () => {
  mockNoOpenShifts()
  const insertedRows = await runDraftOrAssignScheduleAndCaptureInserts('2026-08-10')
  expect(insertedRows.find(r => r.status === 'skipped')).toBeUndefined()
})
```
(Adapt the two helper names to whatever this test file's existing mock
helpers are actually called — it already has infrastructure for mocking the
Claude response and capturing Supabase inserts from earlier tests in this
same file; reuse that, don't invent a second mocking style.)

**Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/ghost/ops-drafters.test.ts
```

**Step 3: Implement**

Replace the two bare-skip returns:

```ts
    if (!validAssignments.length) {
      await supabase.from('agent_proposals').insert({
        kind: 'schedule_day',
        payload: JSON.parse(JSON.stringify({ target_date: targetDate, assignments: [] })),
        reasoning: typeof parsed.summary === 'string' ? parsed.summary : 'Model returned no valid assignments.',
        status: 'skipped',
        model: CLAUDE_DRAFTER_MODEL,
      })
      return 'skipped'
    }
```

and, inside the `auto` branch:

```ts
      if (!safeAssignments.length) {
        await supabase.from('agent_proposals').insert({
          kind: 'schedule_day',
          payload: JSON.parse(JSON.stringify({ target_date: targetDate, assignments: [] })),
          reasoning: typeof parsed.summary === 'string'
            ? `${parsed.summary} (safety net also rejected every proposed assignment.)`
            : 'Safety net rejected every proposed assignment.',
          status: 'skipped',
          model: CLAUDE_DRAFTER_MODEL,
        })
        return 'skipped'
      }
```

Both inserts are fire-and-forget in spirit but not wrapped in try/catch here
— match the existing file's convention of letting a Supabase insert error
surface via the outer `catch` block at the bottom of `draftOrAssignSchedule`
rather than silently swallowing it (a proposal log failing to write is worth
knowing about, same reasoning as the existing "swallowed error here
previously still returned 'drafted'" comment already in this file for the
shadow-path insert).

**Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/ghost/ops-drafters.test.ts
```

**Step 5: Commit**

```bash
git add src/lib/ghost/ops-drafters.ts src/lib/ghost/ops-drafters.test.ts
git commit -m "feat: persist schedule_day's skip reasoning instead of discarding it"
```

---

### Task 3: Instrument the non-AI automated actions

**Files:**
- Create: `supabase/migrations/123_ops_events_automated_actions.sql`
- Modify: `src/lib/ops/events.ts` (the `OpsEventType` union)
- Modify: `src/lib/google-ads/guardrail.ts`
- Modify: `src/app/api/cron/extras-upsell/route.ts`
- Test: `src/lib/google-ads/guardrail.test.ts`, `src/app/api/cron/extras-upsell/route.test.ts`

`catering-auto-send`, `extras-upsell`, and the ads guardrail's auto-pause
all execute for real with zero AI reasoning involved — but today only post
to Slack. Nothing queryable survives, so the panel's "Automated" bucket
would have nothing to show for two of these three. (The third,
catering-auto-send, is instrumented by the other plan referenced above —
don't duplicate it here.)

**Step 1: Migration**

```sql
-- 123: two new ops_events types for automated (non-AI) actions that
-- previously only posted to Slack — the ads spend guardrail's auto-pause,
-- and the extras-upsell cron's auto-send. Bundled with the existing
-- catering_order_sent type (already added in migration 121) is the full
-- set the AI Ops Center's "Automated" bucket reads from.
ALTER TABLE public.ops_events DROP CONSTRAINT IF EXISTS ops_events_event_type_check;

ALTER TABLE public.ops_events ADD CONSTRAINT ops_events_event_type_check
  CHECK (event_type IN (
    'booking_created', 'booking_paid', 'booking_confirmed', 'booking_cancelled',
    'booking_fh_failed', 'booking_fh_recovered', 'shift_assigned', 'shift_unassigned',
    'recommendation_created', 'recommendation_reviewed', 'recommendation_approved', 'recommendation_rejected',
    'guest_move_requested', 'guest_move_accepted', 'guest_move_declined', 'guest_move_deferred', 'guest_move_expired',
    'catering_confirmed', 'catering_order_sent',
    'ads_campaign_paused', 'extras_upsell_sent'
  ));
```

Run it via the Management API (per CLAUDE.md's Supabase section) and verify
the same way Task 1 did. **Before writing this file, re-check the live
constraint first** (`SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'ops_events_event_type_check'`) — if the other plan's
migration 121 has already landed, copy its exact current list here rather
than the list shown above, so this migration doesn't accidentally undo it.

**Step 2: Add the two new types**

In `src/lib/ops/events.ts`, add to `OpsEventType`:
```ts
  | 'ads_campaign_paused'
  | 'extras_upsell_sent'
```

**Step 3: Write the failing tests**

`guardrail.test.ts` — assert `emitOpsEvent` is called with
`eventType: 'ads_campaign_paused'` and the campaign's id/name in `payload`
when a campaign crosses the auto-pause line, and NOT called for a campaign
that only triggers an alert (not a pause).

`extras-upsell/route.test.ts` — assert `emitOpsEvent` is called with
`eventType: 'extras_upsell_sent'` and `bookingId` set after a successful
send.

**Step 4: Run to verify they fail**

```bash
npx vitest run src/lib/google-ads/guardrail.test.ts src/app/api/cron/extras-upsell/route.test.ts
```

**Step 5: Implement**

In `guardrail.ts`, at the point where `paused.push(t)` happens (the
campaign was actually paused, not just flagged), add:
```ts
await emitOpsEvent({
  eventType: 'ads_campaign_paused',
  actorType: 'system',
  source: 'google-ads/guardrail',
  payload: { campaign_id: t.campaignId, campaign_name: t.campaignName, spend_cents: t.spendCents },
})
```
(Adjust field names to whatever the actual `t` object's shape is at that
point in the file — read the surrounding ~20 lines first.)

In `extras-upsell/route.ts`, right after the `.update({ extras_upsell_sent_at: ... })` call succeeds, add the equivalent `emitOpsEvent` call with `eventType: 'extras_upsell_sent'` and `bookingId` set to that booking's id.

**Step 6: Run to verify they pass**

```bash
npx vitest run src/lib/google-ads/guardrail.test.ts src/app/api/cron/extras-upsell/route.test.ts
```

**Step 7: Commit**

```bash
git add supabase/migrations/123_ops_events_automated_actions.sql src/lib/ops/events.ts src/lib/google-ads/guardrail.ts src/lib/google-ads/guardrail.test.ts src/app/api/cron/extras-upsell/route.ts src/app/api/cron/extras-upsell/route.test.ts
git commit -m "feat: log automated (non-AI) actions to ops_events for the AI Ops Center"
```

---

### Task 4: `GET /api/admin/ops-center/summary`

**Files:**
- Create: `src/app/api/admin/ops-center/summary/route.ts`
- Test: `src/app/api/admin/ops-center/summary/route.test.ts`

Returns a badge count plus a short, already-labeled recent-activity feed —
four buckets: `needs_approval` and `skipped` from `agent_proposals` (AI
judgment involved either way), `automated` from `ops_events` (zero AI
judgment — plain code that just ran), and `taken` for AI actions that
executed successfully. Deliberately does NOT re-implement each kind's rich
detail view (that's `/admin/ghost`'s job) — just enough per item to show a
one-line summary and a link.

**Step 1: Write the failing test**

Cover: an `executed` schedule_day proposal maps to a `taken` item with the
assigned captain's name in the summary; a `skipped` proposal maps to a
`skipped` item using its `reasoning`; a `shadow` proposal maps to a
`needs_approval` item; an `ads_campaign_paused` ops_event maps to an
`automated` item naming the campaign; an `extras_upsell_sent` or
`catering_order_sent` ops_event likewise maps to `automated`;
`emailsProcessedToday` counts `messages` rows where `provider = 'gmail'`
and `direction = 'in'` and `created_at` is today (Amsterdam calendar day);
the total badge count = `needs_approval` count + `skipped` count from the
last 24h (things worth a glance) — NOT `taken` or `automated` counts
(already-completed actions aren't something that needs attention).

**Step 2: Implement**

```ts
import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { amsterdamToday } from '@/lib/utils'

const OPS_KINDS = ['schedule_day', 'catering_order', 'catering_upsell', 'maintenance_task', 'stock_reorder', 'ops_review', 'guest_move_request']
const AUTOMATED_EVENT_TYPES = ['catering_order_sent', 'extras_upsell_sent', 'ads_campaign_paused']

interface FeedItem {
  id: string
  kind: string
  bucket: 'needs_approval' | 'taken' | 'skipped' | 'automated'
  summary: string
  occurredAt: string
  href: string
}

function summarizeProposal(kind: string, status: string, reasoning: string | null, payload: Record<string, unknown>): string {
  if (status === 'skipped') return reasoning ?? `${kind.replace(/_/g, ' ')} — nothing confidently actionable.`
  if (kind === 'schedule_day') {
    const assignments = (payload.assignments as { staff_name?: string }[] | undefined) ?? []
    return assignments.length
      ? `Assigned ${assignments.map(a => a.staff_name).filter(Boolean).join(', ')} for ${payload.target_date}`
      : `Schedule review for ${payload.target_date}`
  }
  return reasoning ?? kind.replace(/_/g, ' ')
}

function summarizeAutomatedEvent(eventType: string, payload: Record<string, unknown>): string {
  if (eventType === 'ads_campaign_paused') return `Paused ad campaign "${payload.campaign_name}" — spend with no bookings`
  if (eventType === 'extras_upsell_sent') return 'Sent an extras upsell email'
  if (eventType === 'catering_order_sent') return 'Sent a catering order to the supplier'
  return eventType.replace(/_/g, ' ')
}

export async function GET(_request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const supabase = createAdminClient()
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const today = amsterdamToday()

  const [proposalsRes, eventsRes, emailsRes] = await Promise.all([
    supabase
      .from('agent_proposals')
      .select('id, kind, status, reasoning, payload, created_at')
      .in('kind', OPS_KINDS)
      .in('status', ['shadow', 'executed', 'skipped'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('ops_events')
      .select('id, event_type, payload, occurred_at')
      .in('event_type', AUTOMATED_EVENT_TYPES)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(30),
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('provider', 'gmail')
      .eq('direction', 'in')
      .gte('created_at', `${today}T00:00:00Z`),
  ])

  if (proposalsRes.error) return apiError(proposalsRes.error.message)
  if (eventsRes.error) return apiError(eventsRes.error.message)

  const proposalItems: FeedItem[] = (proposalsRes.data ?? []).map(p => ({
    id: p.id,
    kind: p.kind,
    bucket: p.status === 'shadow' ? 'needs_approval' : p.status === 'skipped' ? 'skipped' : 'taken',
    summary: summarizeProposal(p.kind, p.status, p.reasoning, (p.payload as Record<string, unknown>) ?? {}),
    occurredAt: p.created_at,
    href: '/admin/ghost',
  }))

  const automatedItems: FeedItem[] = (eventsRes.data ?? []).map(e => ({
    id: e.id,
    kind: e.event_type,
    bucket: 'automated',
    summary: summarizeAutomatedEvent(e.event_type, (e.payload as Record<string, unknown>) ?? {}),
    occurredAt: e.occurred_at,
    href: e.event_type === 'ads_campaign_paused' ? '/admin/google-ads' : '/admin/catering',
  }))

  const feed = [...proposalItems, ...automatedItems].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))

  const needsApprovalCount = feed.filter(f => f.bucket === 'needs_approval').length
  const skippedRecentCount = feed.filter(f => f.bucket === 'skipped').length

  return apiOk({
    badgeCount: needsApprovalCount + skippedRecentCount,
    emailsProcessedToday: emailsRes.count ?? 0,
    feed,
  })
}
```

**Step 3: Run to verify it passes**

```bash
npx vitest run src/app/api/admin/ops-center/summary/route.test.ts
```

**Step 4: Commit**

```bash
git add src/app/api/admin/ops-center/summary/
git commit -m "feat: add GET /api/admin/ops-center/summary endpoint"
```

---

### Task 5: The header button + slide-over panel

**Files:**
- Create: `src/components/admin/AiOpsCenter.tsx`
- Modify: `src/app/[locale]/admin/layout.tsx`

One component covers both the button and its panel (same pattern as
`GhostActivityPanel.tsx` for the trigger-plus-slideover shape — read that
file first for the exact slide-over styling/positioning to match, rather
than inventing new CSS).

**Step 1: Implement**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Ghost, X, CheckCircle2, HelpCircle, Mail, Zap } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'

interface FeedItem {
  id: string
  kind: string
  bucket: 'needs_approval' | 'taken' | 'skipped' | 'automated'
  summary: string
  occurredAt: string
  href: string
}
interface SummaryData {
  badgeCount: number
  emailsProcessedToday: number
  feed: FeedItem[]
}

const BUCKET_LABEL: Record<FeedItem['bucket'], string> = {
  needs_approval: 'Needs your approval',
  taken: 'Ghost took action',
  skipped: "Couldn't confidently act",
  automated: 'Automated (no AI judgment)',
}

const BUCKET_ICON: Record<FeedItem['bucket'], React.ReactNode> = {
  taken: <CheckCircle2 className="w-3 h-3 text-emerald-500" />,
  automated: <Zap className="w-3 h-3 text-indigo-500" />,
  needs_approval: <HelpCircle className="w-3 h-3 text-amber-500" />,
  skipped: <HelpCircle className="w-3 h-3 text-amber-500" />,
}

export function AiOpsCenter({ locale }: { locale: string }) {
  const [open, setOpen] = useState(false)
  const { data } = useAdminFetch<SummaryData>('/api/admin/ops-center/summary', { refreshInterval: 30_000 })

  const grouped: Record<FeedItem['bucket'], FeedItem[]> = { needs_approval: [], taken: [], skipped: [], automated: [] }
  for (const item of data?.feed ?? []) grouped[item.bucket].push(item)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg hover:bg-zinc-100 transition-colors"
        title="AI Ops Center"
      >
        <Ghost className="w-5 h-5 text-zinc-500" />
        {!!data?.badgeCount && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
            {data.badgeCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-96 max-h-[70vh] overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 sticky top-0 bg-white">
              <p className="text-sm font-semibold text-zinc-900">AI Ops Center</p>
              <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {!!data?.emailsProcessedToday && (
              <div className="flex items-center gap-2 px-4 py-2 text-xs text-zinc-500 border-b border-zinc-50">
                <Mail className="w-3.5 h-3.5" /> {data.emailsProcessedToday} email{data.emailsProcessedToday === 1 ? '' : 's'} processed today
              </div>
            )}

            {(['needs_approval', 'skipped', 'automated', 'taken'] as const).map(bucket =>
              grouped[bucket].length > 0 && (
                <div key={bucket} className="px-4 py-3 border-b border-zinc-50 last:border-0">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400 mb-2 flex items-center gap-1.5">
                    {BUCKET_ICON[bucket]}
                    {BUCKET_LABEL[bucket]}
                  </p>
                  <div className="space-y-2">
                    {grouped[bucket].map(item => (
                      <Link
                        key={item.id}
                        href={`/${locale}${item.href}`}
                        className="block text-xs text-zinc-700 hover:text-zinc-900 leading-relaxed"
                      >
                        {item.summary}
                      </Link>
                    ))}
                  </div>
                </div>
              )
            )}

            {!data?.feed.length && (
              <p className="px-4 py-6 text-xs text-zinc-400 text-center">Nothing in the last 48 hours.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
```

**Step 2: Mount it in the admin layout**

In `admin/layout.tsx`, add a thin header bar above `{children}` (there
isn't one today — the sidebar and `<main>` sit directly side by side), so
the button is genuinely visible on every admin page regardless of what that
page renders internally:

```tsx
<main className="flex-1 overflow-auto flex flex-col">
  <div className="flex items-center justify-end px-4 py-2 border-b border-zinc-100 bg-white shrink-0">
    <AiOpsCenter locale={locale} />
  </div>
  <div className="flex-1 overflow-auto">{children}</div>
</main>
```
(Import `AiOpsCenter` from `@/components/admin/AiOpsCenter` at the top of
the file alongside the other admin component imports.)

**Step 3: Verify live in the browser**

Per CLAUDE.md's UI verification workflow — `preview_start` the AI Ops
Engine Sync Worktree config, then:
1. Load `/admin/bookings` — confirm the icon appears top-right, independent
   of that page's own content.
2. Navigate to Inbox, Catering, Planning, Availability, Maintenance, Stock —
   confirm it's present and shows the SAME badge count on all of them (it's
   not page-scoped data).
3. Click it open — confirm all four buckets render (including "Automated"
   once Task 3's instrumented actions have real rows), links go to
   `/admin/ghost`, and it closes on outside-click.
4. Check at 375px width (mobile) per the Responsive Design rules — the
   sidebar's own mobile drawer behavior must not conflict with this panel's
   positioning.

**Step 4: Commit**

```bash
git add src/components/admin/AiOpsCenter.tsx src/app/[locale]/admin/layout.tsx
git commit -m "feat: persistent AI Ops Center header panel across all admin pages"
```

---

### Task 6: Full verification + docs

**Step 1:**
```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
```

**Step 2:** Write `docs/features/ai-ops-center.md` per CLAUDE.md's
Documentation Rule — cover what was built, the deliberate choice to link
out to `/admin/ghost` rather than duplicate its review UI, and how to add a
new bucket or a new counted signal (e.g. WhatsApp messages processed) later
without touching the panel component itself (extend the summary route's
response shape only).

**Step 3:** Add a row to `docs/features/README.md`.

**Step 4: Commit**

```bash
git add docs/features/ai-ops-center.md docs/features/README.md
git commit -m "docs: AI Ops Center feature documentation"
```

---

## Explicitly out of scope for v1

- Reply/booking-correction approvals from the Inbox are NOT included in the
  feed — they stay reviewed in-context of their conversation thread, where
  the full message history is visible. Pulling them into this panel without
  that context would strip the thing that makes them reviewable.
- No per-section filtering (e.g. "only show me Catering-related items while
  I'm on the Catering page") — the panel shows the same global feed
  everywhere. A worthwhile v2 idea, not needed to deliver the core ask.
- No push notifications / sound / badge-on-tab-title — purely an in-app
  panel for now.
