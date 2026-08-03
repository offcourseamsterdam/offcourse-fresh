# AI Ops Engine ⇐ Main Sync — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring `main`'s 54 commits of changes (money-path race-condition fixes, finance/kasboek
pipelines, Pride Amsterdam, knowledge-graph blogging, RLS hardening) into `feature/ai-ops-engine`,
resolving the ~20 files that conflict, so the ops-engine branch keeps growing on top of the safer,
more current money-path logic instead of drifting further from it.

**Why now, not a merge into `main`:** `feature/ai-ops-engine` is Beer's private, local-only branch
(not pushed to `origin`) and stays that way — this plan does not push anything anywhere. The goal
is purely to reduce the size and danger of *whatever* merge happens later, by not letting the gap
widen further while ai-ops-engine keeps being developed.

**Architecture:** This is a real `git merge main`, not a manual file-by-file port. Everything in
main's 54 commits that doesn't touch a file `ai-ops-engine` also touched (the finance tab, kasboek
payout pipelines, Pride Amsterdam listing, knowledge-graph blogging, most of the RLS hardening)
auto-merges with **zero conflicts** — git handles that for free. Only ~20 files need hand
resolution, and every one of them has already been read and diagnosed (see per-task verdicts
below) — this plan is execution, not investigation.

**Key finding driving most of the money-path resolutions:** `main` didn't patch the old booking
mechanism, it **replaced it**. `ai-ops-engine` still uses a claim-mutex
(`claimBooking`/`finalizeBooking`/`releaseClaim` in `src/lib/booking/claim.ts`) with a separate
`validateBooking`-then-`createBooking` step. `main` deleted all of that in favor of: insert the
`bookings` row first (a `UNIQUE(stripe_payment_intent_id)` constraint is the exactly-once gate),
then `createBookingIdempotent` (one call, retry-safe, no separate validate step, no TOCTOU gap).
`main`'s version also fixes a real bug (`ai-ops-engine`'s VAT metadata fallback uses `Number(x) ||
fallback`, which breaks on an explicit `"0"`; `main` uses `parseMetaCents`), adds a refund guard,
and adds race-loser cleanup (Postgres error `23505` → cancel the orphaned FareHarbor booking) that
`ai-ops-engine` doesn't have at all. **`main`'s architecture wins everywhere this comes up.**
`ai-ops-engine`'s own additions in these files — `emitOpsEvent` (feeds the Ghost ops-agent fleet)
and `draftGuestMoveForNewBooking` (Ghost's gap-closing drafter) — are genuinely additive and get
grafted onto `main`'s surviving logic, not discarded.

**Tech stack:** git, Vitest, TypeScript, Supabase Management API (for regenerating
`src/lib/supabase/types.ts`).

**Verified before writing this plan:** queried the live Supabase schema directly — every table
either branch's migrations created (`clickandboat_bookings`, `fareharbor_payouts`,
`finance_share_links`, `getmyboat_bookings`, `getyourguide_payments`, `revolut_transactions` from
`main`; `ghost_knowledge`, `shifts`, `ops_events` from `ai-ops-engine`) already exists in prod.
Migrations get applied out-of-band via the Management API regardless of branch state, so
regenerating `types.ts` from prod after the merge is a complete, one-shot fix — no missing
migrations to hunt down.

---

### Task 0: Create an isolated worktree for this sync

**Files:** none yet.

**Step 1:** From the main working copy:
```bash
git worktree add ../offcourse-ai-ops-sync -b feature/ai-ops-engine-main-sync feature/ai-ops-engine
cd ../offcourse-ai-ops-sync
```
This keeps Beer's primary working directory (and any `npm run dev` he has running there)
completely untouched while this happens.

**Step 2:** Start the merge:
```bash
git merge main --no-commit --no-ff
```
Expect the same ~20 conflicts already diagnosed below (content is symmetric regardless of merge
direction — only which side is "ours" vs "incoming" flips, which is why every task below says
"keep main's version" / "keep ai-ops-engine's version" rather than HEAD/theirs).

**Step 3:** Commit after every task below (not one giant commit) — if something goes wrong two
tasks from now, you want to `git reset --hard` to a known-good point, not lose everything.

---

### Task 1: `package.json` — union both new deps

**Files:** Modify `package.json`

Both sides added a new dependency in the same spot. Keep all three:
```json
"pdf-lib": "^1.17.1",
"pdfjs-dist": "^6.1.200",
"qrcode.react": "^4.2.0",
```
Remove the conflict markers. Do not touch `package-lock.json` yet (Task 16 regenerates it once, at
the end, after every other file conflict — including any other lockfile-relevant change — is
resolved).

**Verify:** `git diff --check` reports no leftover conflict markers anywhere in the repo yet (run
this after every task from here on — cheap and catches a missed marker immediately).

---

### Task 2: `.env.example` — union both new var blocks, dedupe `SLACK_BOT_TOKEN`

**Files:** Modify `.env.example`

Both sides added a `SLACK_BOT_TOKEN=` line with a different comment (main: routes CRITICAL alerts
to Beer's DM; ai-ops-engine: OAuth token for `/checkin /checkout` slash commands). It's the same
env var serving both purposes in the merged code — keep one `SLACK_BOT_TOKEN=` line with a comment
that says both:

```
# Slack incoming webhook — for booking notifications
# Create at: https://api.slack.com/apps → Incoming Webhooks
SLACK_WEBHOOK_URL=
# Bot token (xoxb-…, chat:write + OAuth scopes) — routes CRITICAL alerts to Beer's DM instead of
# the shared channel, AND powers the /checkin /checkout slash commands. Without it, postSlackCritical
# falls back to SLACK_WEBHOOK_URL only, and slash commands won't work. Signing secret from Basic Information.
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
# Target DM channel/user id for critical alerts. Has a hardcoded fallback if unset.
SLACK_ALERT_DM_CHANNEL=
# Channel for shift reminders when a captain has no linked Slack member ID
SLACK_OPS_CHANNEL=#bookings
# AI spend alerts (every €5) go to this Slack channel/DM id — defaults to Beer's DM in code
AI_COST_ALERT_SLACK_ID=
# Dev-only: on localhost ALL Slack messages go to this DM instead of the team
# channel (defaults to Beer's DM / AI_COST_ALERT_SLACK_ID). Needs SLACK_BOT_TOKEN.
SLACK_DEV_DM_CHANNEL=
# Maintenance agent: the "Maintenance and Ideas" channel ID the Ghost reads
# (add the bot to that channel + grant channels:history + files:read, and point
# the Slack app's Events API at /api/slack/events). Dark until this is set.
SLACK_MAINTENANCE_CHANNEL_ID=
```

**Verify:** `grep -c "SLACK_BOT_TOKEN=" .env.example` → `1` (not 2).

---

### Task 3: `.claude/launch.json` — union configs, keep ai-ops-engine's port-3001 fix

**Files:** Modify `.claude/launch.json`

ai-ops-engine moved the default dev port to 3001 with the reasoning "3000 belongs to boatlocal"
(Beer's other project) — keep that. Keep main's "Next.js Stripe Test Mode" config (port 3050) and
ai-ops-engine's "Exchange Dev Server" config (port 8080, different project). Result:
```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "Next.js Dev Server", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 3001, "autoPort": true },
    { "name": "Next.js Dev (webpack)", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev:local"], "port": 3001, "autoPort": true },
    { "name": "Next.js Stripe Test Mode", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev:local", "--", "-p", "3050"], "port": 3050, "autoPort": false },
    { "name": "Exchange Dev Server", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", "/Users/beer/Developer/Exchange-released-version", "run", "dev"], "port": 8080, "autoPort": true }
  ]
}
```

---

### Task 4: `docs/features/README.md` — concatenate both new-rows blocks

**Files:** Modify `docs/features/README.md`

Both sides appended new table rows after the same existing row (`wordpress-blog.md`). Keep both
blocks, main's rows first (older work), then ai-ops-engine's Ghost/ops rows. No reordering needed
— this is just an index, order doesn't carry meaning beyond "when it landed."

---

### Task 5: `src/lib/booking/create-intent.ts` — keep both metadata fields

**Files:** Modify `src/lib/booking/create-intent.ts:225-233`

Complementary — no real conflict. Keep both:
```ts
campaign_id: input.campaignId ?? '',
partner_id: input.partnerId ?? '',
traffic_label: formatTrafficSource(input.attribution),
```
(exact field names/order: check what's already there outside the conflict markers and slot both
sets of lines in without disturbing the rest — the `formatTrafficSource` import is already present
unconflicted elsewhere in the file).

---

### Task 6: `src/lib/booking/create-intent.test.ts` — take main's version wholesale

**Files:** Replace `src/lib/booking/create-intent.test.ts` with main's version

This is an add/add conflict — both branches wrote this test file from scratch, testing two
different implementations. `main`'s implementation (atomic conditional-UPDATE claim, FareHarbor
`validateBooking` called *before* charging) is the one that survives (Task 5 confirms the real
`create-intent.ts` is main's almost verbatim). ai-ops-engine's test mocks a plain select+update
with no pre-charge FH validation at all — it would fail immediately against the surviving
implementation.

```bash
git show main:src/lib/booking/create-intent.test.ts > src/lib/booking/create-intent.test.ts
```

Optional (not required for correctness): add one assertion to main's test file confirming
`traffic_label` shows up in the PaymentIntent metadata, since that field only exists thanks to
ai-ops-engine's addition in Task 5.

**Verify:** `npx vitest run src/lib/booking/create-intent.test.ts` → all pass.

---

### Task 7: `src/app/api/admin/bookings/[id]/cancel/route.ts` — union imports

**Files:** Modify `src/app/api/admin/bookings/[id]/cancel/route.ts:8-14`

All four imports are used at distinct, non-overlapping call sites in the (unconflicted) function
body — `notifyBookingsChanged()`, `emitOpsEvent(...)`, `postSlackText([...])`,
`formatAmsterdamTime(...)`. Keep all four import lines, any order:
```ts
import { postSlackText } from '@/lib/slack/send-notification'
import { notifyBookingsChanged } from '@/lib/realtime/notify'
import { formatAmsterdamTime } from '@/lib/utils'
import { emitOpsEvent } from '@/lib/ops/events'
```
(adjust to the actual existing import paths in the file — these are from the agent's read, confirm
against the file itself since paths weren't verified character-for-character).

---

### Task 8: `src/lib/ai/clients.ts` — keep ai-ops-engine's version, discard main's

**Files:** `src/lib/ai/clients.ts:23-35`

ai-ops-engine's version is a strict superset — same `CLAUDE_MODEL` value, plus a new
`CLAUDE_DRAFTER_MODEL = 'claude-haiku-4-5'` export the Ghost fleet needs for high-volume drafting.
Resolve by keeping ai-ops-engine's block entirely; discard main's incoming hunk.

---

### Task 9: `src/app/api/cron/fh-consistency/route.ts` — keep ai-ops-engine's version

**Files:** `src/app/api/cron/fh-consistency/route.ts:47-57`

ai-ops-engine's query (`.or(...)` catching website/webhook rows where `booking_date` is null but
`start_time` is today-or-later) is a bugfix main doesn't have — and the file's own
`consistencyDisplayDate()` helper (already present, unconflicted) was built specifically for this
fallback. Keep ai-ops-engine's version; discard main's simpler filter.

---

### Task 10: `src/app/api/cron/withlocals-reviews/route.ts` — take main's version, verify the admin trigger

**Files:** Replace `src/app/api/cron/withlocals-reviews/route.ts` with main's version; check
`src/app/[locale]/admin/reviews/page.tsx` (or wherever "Sync Withlocals" lives)

Add/add conflict solving the identical problem two different ways. main's version uses the shared
`requireCronSecret()` helper + `alertCronFailure()` (the sitewide cron-failure-alerting pipeline) —
strictly better than ai-ops-engine's inline Bearer-token check + bare `console.error`.

**Step 1:** Before replacing, check how the admin UI's "Sync Withlocals" button calls this route —
ai-ops-engine's version has a comment noting it's "also callable manually from /admin/reviews."
```bash
grep -rn "withlocals-reviews" src/app/\[locale\]/admin/ src/components/
```

**Step 2:** If the button calls the route directly without a cron secret (i.e. relies on an admin
session instead), `requireCronSecret()` will break that manual-trigger path. If so, this route
needs to accept *either* a valid cron secret *or* a valid admin session (mirror the pattern used
elsewhere for dual-trigger cron routes, if one exists in the codebase — check
`src/lib/auth/require-cron-secret.ts` and nearby files for a precedent before inventing a new one).
If the button already goes through an admin-authenticated API route that then calls this cron
route server-to-server with the secret, no change needed.

**Step 3:** Take main's file:
```bash
git show main:src/app/api/cron/withlocals-reviews/route.ts > src/app/api/cron/withlocals-reviews/route.ts
```
Re-apply whatever dual-trigger fix Step 2 required, if any.

---

### Task 11: `src/lib/auth/admin-route-contract.test.ts` — merge changelogs, regenerate snapshot

**Files:** Modify `src/lib/auth/admin-route-contract.test.ts:111-179`

Both sides bumped the inline route-count snapshot independently (main: 116, ai-ops-engine: 97) with
their own changelog comment listing new routes. Don't arithmetic your way to a number — concatenate
both changelog comment blocks (either order), then let the test tell you the real number:
```bash
npx vitest run src/lib/auth/admin-route-contract.test.ts -u
```
This file's own header comments explain this is the supported way to update its snapshot.

**Critical check (per CLAUDE.md's documented gotcha on this exact file):** confirm `findHandlers()`
recognizes every route-export shape now present after the merge. It already handles
`export async function GET(...)`, `withRoute(...)`, and `createSummaryRoute(...)` — check whether
any of ai-ops-engine's new routes (ghost/*, inbox/*, scheduling/*, maintenance, stock,
notifications) use a *different* wrapper pattern:
```bash
grep -rLE "export (async function|const)" src/app/api/admin/{ghost,inbox,scheduling,maintenance,stock,notifications}/**/*.ts 2>/dev/null
```
If `findHandlers()` silently finds **zero** unguarded handlers post-merge where you'd expect some
routes to be newly scanned, that's the "reads as all clear when it's actually blind" failure mode
CLAUDE.md warns about — not a pass. Confirm the reported handler count roughly matches
`find src/app/api/admin -name route.ts | wc -l`.

---

### Task 12: `src/lib/supabase/types.ts` — don't hand-resolve, regenerate from prod

**Files:** Regenerate `src/lib/supabase/types.ts`

Both sides' conflict hunks are just different generated table blocks (`main` added
`clickandboat_bookings`, `fareharbor_payouts`, `finance_share_links`, `getmyboat_bookings`,
`getyourguide_payments`, `revolut_transactions`; ai-ops-engine's own tables — `ghost_knowledge`,
`shifts`, etc. — live outside the conflicted regions, untouched). Already confirmed (see plan
header) that prod has all nine tables from both lines, so:
```bash
curl -s "https://api.supabase.com/v1/projects/fkylzllxvepmrtqxisrn/types/typescript" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['types'])" > src/lib/supabase/types.ts
```
Do not manually edit conflict markers in this file — regeneration replaces the whole thing.

**Verify:** `npx tsc --noEmit` after this (and after Tasks 17/19, since those touch the files that
use these types most).

---

### Task 13: `src/components/checkout/CheckoutFlow.tsx` — weave both, main's recovery logic wins

**Files:** Modify `src/components/checkout/CheckoutFlow.tsx:85-127`

ai-ops-engine's 3-way flag split gives better UX (a "your bank declined this" message instead of a
generic error) but as written it would break iDEAL's "processing" case: main's version explicitly
routes `redirect_status === 'processing'` into the same recovery flow as `'succeeded'` (the
recovery endpoint is built to handle both), but ai-ops-engine's split would show a "still being
processed" error message *instead of* triggering recovery — a real customer stuck on an error
screen instead of the finalising spinner. Keep the "bank declined" improvement, fix the regression:

```ts
const isIdealReturn = redirectStatus === 'succeeded' || redirectStatus === 'processing'
const isIdealFailed = redirectStatus === 'requires_payment_method'
```
Drop ai-ops-engine's separate `isIdealProcessing` variable and its distinct error-message branch —
`isIdealReturn` already routes `'processing'` into the recovery/finalising flow, which covers it.
Keep ai-ops-engine's `isIdealFailed` check and "bank declined" message as an addition alongside
`isIdealReturn`, not a replacement for it.

---

### Task 14: `src/app/[locale]/admin/layout.tsx` — keep ai-ops-engine's nav, verify the route folder name

**Files:** `src/app/[locale]/admin/layout.tsx:19-25`

ai-ops-engine renamed `Planning` → `Scheduling` (same icon reused) and added `Maintenance` +
`Stock` nav items — a superset, not a real conflict.

**Verify before committing to `scheduling` as the href:**
```bash
ls src/app/\[locale\]/admin/ | grep -E "planning|scheduling"
```
Use whichever directory actually exists post-merge as the `href`. Keep ai-ops-engine's three-item
block; discard main's single `Planning` line.

---

### Task 15: `src/lib/utils.test.ts` — union imports and describe blocks

**Files:** Modify `src/lib/utils.test.ts`

Both sides added tests for different new helpers in `src/lib/utils.ts` — main's finance/timezone
helpers (`fmtEuros`, `fmtEurosRounded`, `toAmsDateStr`, `formatReviewMonthYear`) and ai-ops-engine's
scheduling/ops helpers (`amsterdamToday`, `formatAmsterdamTime`, `timeAgoShort`). Union the import
line to include all of them, keep main's `describe` blocks for its three helpers where they
currently sit (before the shared `formatPrice` block), then **read past line 90** (outside the
originally-analyzed conflict range) to check whether ai-ops-engine has its own `describe` blocks
for `amsterdamToday`/`formatAmsterdamTime`/`timeAgoShort` further down the file that also need
folding in — don't assume they're only in the marked hunk.

**Verify:** `npx vitest run src/lib/utils.test.ts` → all pass.

---

### Task 16: Regenerate `package-lock.json`

**Files:** `package-lock.json`

```bash
rm -f package-lock.json
npm install
```
Don't hand-resolve the lockfile conflict — Task 1 already fixed `package.json` with the full set of
deps from both sides; regenerating from that is correct and avoids a malformed lockfile.

---

### Task 17: `src/app/api/webhooks/stripe/route.ts` — main as base, graft ai-ops's hooks

**This is the highest-risk file in the plan alongside Task 19. Take it slowly, one graft at a
time, re-running the webhook test file after each.**

**Files:** Replace, then modify `src/app/api/webhooks/stripe/route.ts`

**Step 1 — start from main's version, not the conflicted file:**
```bash
git show main:src/app/api/webhooks/stripe/route.ts > src/app/api/webhooks/stripe/route.ts
```

**Step 2 — imports.** Add two ai-ops-engine-only imports on top of main's import block:
```ts
import { emitOpsEvent } from '@/lib/ops/events'
import { draftGuestMoveForNewBooking } from '@/lib/ghost/guest-move-drafter'
```
Do not import `claimBooking`/`finalizeBooking`/`releaseClaim` (from the old `@/lib/booking/claim`)
or anything from `@/lib/booking/recover-from-pi` — both files get deleted in Task 20. `main`'s
version already imports `logWebhookEvent`, `parseMetaCents`, `resolveCampaignCommission`, and
`buildFhBookingPlan` — leave those as-is.

**Step 3 — graft into `checkout.session.completed`.** Find `await notifyBookingsChanged()` inside
that handler (this is main's, already in the file from Step 1) and add directly after it:
```ts
await emitOpsEvent({ eventType: 'booking_confirmed', /* ...same fields ai-ops-engine passed here, check its version for the exact shape via: */ })
after(() => draftGuestMoveForNewBooking(/* same args ai-ops-engine passed */))
```
Get the exact field/argument shapes by reading `git show feature/ai-ops-engine:src/app/api/webhooks/stripe/route.ts` around its own `checkout.session.completed` handler (line ~140 on that branch) — copy the call verbatim, only the surrounding code differs.

**Step 4 — graft into the `payment_intent.succeeded` success path.** Main's version, after Step 1,
has an insert-row → `buildFhBookingPlan` + `createBookingIdempotent` → 3x-retried confirm-flip
update sequence, ending in a second `notifyBookingsChanged()` call on success. Add the same
`emitOpsEvent`/`draftGuestMoveForNewBooking` pair directly after that final
`notifyBookingsChanged()`, using the same argument shapes as ai-ops-engine's version (read
`git show feature/ai-ops-engine:...` around its own success path, roughly where its
`finalizeBooking` call resolves, to get the exact fields).

**Step 5 — do NOT port `sendCriticalAlert`.** Keep main's `alertWebhookFailure` (the
`postSlackCritical`-based one, 4-argument signature `(stripe, pi, reason, actionLine)`) exactly as
main has it. ai-ops-engine's `sendCriticalAlert` adds an email fanout gated on
`ALERT_EMAIL_RECIPIENT`, which isn't in `.env.example`/provisioned anywhere — an inert code path.
Not worth the risk of introducing here; can be proposed as a standalone enhancement later.

**Step 6 — sanity diff.** Run:
```bash
git show feature/ai-ops-engine:src/app/api/webhooks/stripe/route.ts | grep -n "emitOpsEvent\|draftGuestMoveForNewBooking"
```
and confirm every call site it lists has a corresponding call in the new file. This is the check
against silently dropping a Ghost-fleet hook.

---

### Task 18: `src/app/api/webhooks/stripe/route.test.ts` — main as base, re-add ai-ops's mocks

**Files:** Replace, then modify `src/app/api/webhooks/stripe/route.test.ts`

```bash
git show main:src/app/api/webhooks/stripe/route.test.ts > src/app/api/webhooks/stripe/route.test.ts
```
Then add these two mock declarations near the top (they were already unconflicted, silently-merged
additions in the original dry-run — confirm they're present, add if the wholesale replace above
dropped them):
```ts
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: vi.fn() }))
vi.mock('@/lib/ghost/guest-move-drafter', () => ({ draftGuestMoveForNewBooking: vi.fn() }))
```
Do not port ai-ops-engine's `capturedInsert`/`insertResult` mock scaffolding or its
`update`/`insert` mock shapes — those model the superseded select-then-claim flow and are
incompatible with main's insert-first architecture (already correctly mocked in main's version of
this file).

**Verify:**
```bash
npx vitest run src/app/api/webhooks/stripe/route.test.ts
```
All existing tests must pass. Coverage gap to flag, not required to close in this task: no test
currently exercises the newly-grafted `emitOpsEvent`/`draftGuestMoveForNewBooking` calls from Task
17 — worth a follow-up task, but not blocking this sync.

---

### Task 19: `src/app/api/admin/booking-flow/book/route.ts` — main as base, graft ai-ops's hooks

**Files:** Replace, then modify `src/app/api/admin/booking-flow/book/route.ts`

**Step 1 — start from main's version:**
```bash
git show main:src/app/api/admin/booking-flow/book/route.ts > src/app/api/admin/booking-flow/book/route.ts
```

**Step 2 — imports.** Keep main's commission/attribution/Slack/constants imports
(`commissionFromInvoiceAmount`, `commissionForCampaign`, `resolveCampaignCommission`,
`parseAttribution`, `postSlackText`, `postSlackCritical`, `notifyBookingsChanged`,
`CITY_TAX_CENTS_PER_GUEST`, `CRUISE_VAT_RATE`, `EXTRAS_VAT_RATE`). Add:
```ts
import { emitOpsEvent } from '@/lib/ops/events'
import { draftGuestMoveForNewBooking } from '@/lib/ghost/guest-move-drafter'
```
`formatTrafficSource` — check whether main's version already imports it (it's used in
`create-intent.ts` per Task 5's note that it merged unconflicted); if `book/route.ts` doesn't
already use it, don't add an unused import.

**Step 3 — the dangerous part.** main's version of this route uses a **flattened single-path**
save flow (no claim mutex — the public website no longer calls this route at all post-webhook-only
finalization, so the only caller is admin/OTA-sourced bookings, single-writer). ai-ops-engine still
wraps this in a `needsClaim` / `claimBooking(...)` / `releaseClaim(...)` block. Because these two
control-flow shapes are structurally different (not just different lines inside the same shape),
git's line-based merge does **not** reliably flag the whole differing region — some of
ai-ops-engine's claim-wrapper code can survive unmarked, interleaved with main's fixes, producing
code that references `claimBooking` even though it's not imported. **Do not trust the marked
`<<<<<<<` hunks alone here.**

Concretely: read main's whole function body covering booking validation → FH create → save (this
spans what was roughly lines 361–595 in the pre-merge ai-ops-engine file — find the equivalent
region in the fresh `git show main:...` copy from Step 1 by searching for the FH-validate-failure
handling, e.g. `grep -n "validateBooking\|findRaceWinner" src/app/api/admin/booking-flow/book/route.ts`)
and treat **that entire region, verbatim from main**, as the skeleton. Do not attempt to
hand-splice ai-ops-engine's claim-block fragments into it piece by piece — replace the whole
region with main's version first, confirm it compiles and its own tests pass, *then* do Step 4.

**Step 4 — graft ai-ops's hooks onto main's skeleton (now that it's the base).** Two insertion
points:
- After the row save succeeds and `notifyBookingsChanged()` is called (main's success branch,
  post-`23505`-handling): add `emitOpsEvent(...)` + `draftGuestMoveForNewBooking(...)`, same
  argument shapes as Task 17 Step 4 (get them from
  `git show feature/ai-ops-engine:src/app/api/admin/booking-flow/book/route.ts`, its own success
  path after `finalizeBooking`).
- After the promo-usage bump (if ai-ops-engine's version does this in a spot main's doesn't — check
  both versions for a promo/discount-usage increment call near the end of the success path).

**Step 5 — `saveToSupabase`.** Keep main's inline version verbatim (builds the row inline,
resolves `campaign_id`, branches `booking_id` by source, computes `stripe_amount` with
`CITY_TAX_CENTS_PER_GUEST`, and — critically — does `.select('id').single()` so the caller gets the
inserted row's id back for `savedBookingId`/catering auto-send). Do **not** port ai-ops-engine's
`buildBookingRow(supabase, p)` helper or its plain `.insert(row)` (no `.select()` — a functional
gap, the caller needs that id). Confirm nothing else in the merged codebase calls `buildBookingRow`
before deleting it:
```bash
grep -rn "buildBookingRow" src/
```

**Step 6 — `alertBookingSaveFailure`.** Keep main's version (`postSlackCritical`, using the
existing `fmtEurosRounded as fmtAmountEur` import alias from `@/lib/utils`). **Do not** keep
ai-ops-engine's local `function fmtAmountEur(cents) {...}` declaration — main's file already has
`fmtAmountEur` as an *imported* alias, and ai-ops-engine's local function with the same name is a
duplicate-identifier TypeScript compile error, not a silent bug. Delete that local function
entirely if the Step 1 replace + Step 3/4 grafts left it in anywhere.

**Step 7 — cleanup.** Search the whole file for any remaining reference to `claimBooking`,
`finalizeBooking`, `releaseClaim`, or `sendCriticalAlert` and remove — they should all be gone
after Steps 2–6:
```bash
grep -n "claimBooking\|finalizeBooking\|releaseClaim\|sendCriticalAlert" src/app/api/admin/booking-flow/book/route.ts
```
Expect zero output.

**Verify:**
```bash
npx tsc --noEmit
npx vitest run src/app/api/admin/booking-flow/book/route.post.test.ts
```
(Adjust the test filename to whatever actually exists post-merge — check for it first, per
CLAUDE.md's note that this route's money-path tests live at
`src/app/api/admin/booking-flow/book/route.post.test.ts`.)

---

### Task 20: Delete the superseded claim-mutex files

**Files:** Delete `src/lib/booking/claim.ts`, `src/lib/booking/claim.test.ts`,
`src/lib/booking/recover-from-pi.ts`, `src/lib/booking/recover-from-pi.test.ts`

Confirmed (via `git grep` during the earlier analysis) that no other ai-ops-engine code — including
the Ghost fleet's own booking-proposal flow — depends on these. Re-verify before deleting, since
that check was done pre-merge and this task runs post-merge:
```bash
grep -rln "from '@/lib/booking/claim'\|from '@/lib/booking/recover-from-pi'" src/
```
Expect only the four files themselves (or zero, if the grep pattern doesn't match the files'
own internal references) — if anything else shows up, stop and investigate before deleting.

```bash
git rm src/lib/booking/claim.ts src/lib/booking/claim.test.ts \
       src/lib/booking/recover-from-pi.ts src/lib/booking/recover-from-pi.test.ts
```

---

### Task 21: Full verification pass

**Step 1:** Full test suite:
```bash
npm test
```
Expect all tests passing (baseline before this merge: 1215+ tests across 120+ files on `main`,
plus however many `ai-ops-engine` added — the exact number isn't predictable in advance since
Task 11 regenerates one snapshot, but zero failures is the bar).

**Step 2:** Typecheck:
```bash
npx tsc --noEmit
```

**Step 3:** Search the whole repo for any leftover conflict markers (belt-and-braces, should
already be zero from per-task checks):
```bash
grep -rn "^<<<<<<<\|^=======$\|^>>>>>>>" --include="*.ts" --include="*.tsx" --include="*.json" .
```

**Step 4:** Manual money-path smoke test, using the test-mode Stripe trick from CLAUDE.md (never
touches `.env.local` or real Stripe):
```bash
STRIPE_MODE=test STRIPE_SECRET_KEY_TEST=sk_test_... npx vitest run src/lib/booking/stripe-integration.test.ts
```

**Step 5:** Commit the merge:
```bash
git add -A
git commit -m "chore(ai-ops-engine): sync main's money-path fixes + 54 commits of unrelated feature work"
```

---

### Task 22: Hand back to Beer — do not fast-forward `feature/ai-ops-engine` automatically

Leave the result on `feature/ai-ops-engine-main-sync`. Do not merge it into
`feature/ai-ops-engine` or anywhere else without Beer explicitly reviewing it — ideally running
`npm run dev` from the worktree and clicking through a booking manually, given how much of this
plan touches the Stripe webhook and admin booking creation. Once he confirms it's good:
```bash
git checkout feature/ai-ops-engine
git merge --ff-only feature/ai-ops-engine-main-sync
git worktree remove ../offcourse-ai-ops-sync
git branch -d feature/ai-ops-engine-main-sync
```
All of this stays local — nothing in this plan pushes to `origin` at any point.
