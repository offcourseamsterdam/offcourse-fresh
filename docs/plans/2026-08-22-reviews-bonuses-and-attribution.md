# Reviews: skipper attribution, €5 bonuses, and same-day visibility

**Status:** planned, not started. Branch: `feature/ai-ops-engine-main-sync` (Beer's decision,
2026-08-22 — the bonus tables, conflict UI and payroll integration already live here).

**Goal in one line:** every new review is noticed the day it lands, the skipper it names gets
their €5 and a Slack message, and anything the machine isn't sure about reaches a human instead
of being silently paid or silently dropped.

---

## What already exists (do NOT rebuild)

| Piece | Where |
|---|---|
| `review_bonuses` (staff_id, review_id, amount_cents=500, awarded_at) | migration `080` |
| `review_bonus_conflicts` (review_id, matched_name, candidate_staff_ids, resolved_at, awarded_staff_id) | migration `081` |
| Name matcher + 20 tests | `src/lib/scheduling/review-bonuses.ts` |
| Conflict-resolution UI | `src/app/[locale]/admin/reviews/BonusConflictCards.tsx` |
| Bonuses flow into payroll + CSV | `src/lib/scheduling/payroll-query.ts`, `payroll-csv.ts` |
| Per-staff bonus history API | `GET /api/admin/scheduling/staff/[id]/bonuses` |
| Slack DM to a staff member | `postDm(slack_member_id, …)` — used by shift-reminder, availability-request |
| Review ingestion | Outscraper (Google + TripAdvisor), Withlocals cron, GYG cron |

The existing matcher works around a limitation: first names that are also ordinary words
(`will`, `grace`, `rose`, `summer`, and **`beer`** — the word a canal-drinks review says most)
only auto-pay when a role word (`skipper`, `captain`, `schipper`, …) corroborates the mention.

**Beer's instruction (2026-08-22): drop the role-word requirement — a name being mentioned is
enough.** He is right, but only *after* AI extraction replaces the regex (§2.1). The role-word
check is a crutch for a regex that cannot tell a name from a word: delete it today and
"we **will** be back" pays a skipper named Will, and "we had a **beer**" pays Beer. Claude
reading the same sentences returns no names at all.

**Therefore the ordering is a hard dependency, not a preference: §2.1 ships before the
role-word guard and `COMMON_WORD_NAMES` are removed.** Both are deleted as part of §2.1, not
before it.

---

## Prerequisite risk: migration drift (fix before adding schema)

`main`'s `supabase/migrations/` jumps **067 → 082**. Migrations `068`–`081` — including the
`staff`, `shifts` and both review-bonus tables — exist only on this branch, yet are **already
applied to the live production database** (main's generated `types.ts` references
`review_bonuses`). Production therefore runs on 14 migrations whose `.sql` files are absent
from the branch it deploys from.

This does not block work *on this branch*, but any new migration must be numbered so it can't
collide when these branches eventually reconcile. Verify the highest applied number against the
live DB before writing one. Beer has been told; fixing the drift itself is a separate task.

---

## Phase 1 — Correctness on what already runs

**✅ Done (2026-08-22).** Checked first: 0 bonuses existed anywhere, so there was nothing to
reverse. Both fixed and tested (8 new tests) in `review-bonuses.ts`/`.test.ts` and
`outscraper/route.ts`/`.test.ts`.

### 1.1 Five-star gate (live bug)
`awardReviewBonuses(reviewId, text)` never receives the rating, so **a 3-star review naming a
skipper pays €5 today**. Beer's rule: *"5 stars only, 4 stars we dont."*

- Change the signature to `awardReviewBonuses(reviewId, text, rating)`.
- Return early unless `rating >= 5` — no bonus **and** no conflict row (a conflict exists only
  to decide who gets paid; below 5 stars nobody does). Visibility of the mention is Phase 3's
  job, not the bonus system's.
- Update the caller in `src/app/api/webhooks/outscraper/route.ts:147` to pass the row's rating.
- **Before shipping:** query whether any bonus was already awarded on a sub-5-star review.
  If so, tell Beer the list and let him decide — do not silently reverse a payment.

### 1.2 Award the bonus for the month it was *found*
Beer's rule: the month we ingested it, not the month it was posted. `review_bonuses.awarded_at`
already defaults to `now()`, and payroll reads by date range — so this is **already correct**.
Add a test that pins it, so a future "improvement" to use `publish_time` doesn't regress it.

---

## Phase 2 — Better matching, and telling the skipper

### 2.1 "Sounds like one of ours" → assign AND flag
Beer's rule: *"if it finds a name it doesn't find, but sounds like a name we have… then do
assign it AND flag it for human review."* This is a new third state:

| Case | Bonus | Conflict row |
|---|---|---|
| Exact first-name match, unambiguous | ✅ award | — |
| Two staff share the first name | — | ✅ flag (existing) |
| **Near-miss ("Joshy" ≈ Joshua, "Sem" ≈ Sam)** | **✅ award** | **✅ flag** *(new)* |
| No resemblance to any staff name | — | — |

The old "common word with no role word → flag" row is **gone** — once Claude is doing the
extracting, a name it returns *is* a name, so there is nothing left to corroborate. Delete
`COMMON_WORD_NAMES`, `ROLE_WORDS` and `hasRoleWord()` in this step, and delete the tests that
assert the role-word behaviour (keep the ones asserting shared-first-name conflicts).

Note this is the only case where a bonus and a conflict coexist, so
`review_bonus_conflicts` needs to represent "already paid, but confirm" — reuse
`awarded_staff_id` for that, and make the UI read "Paid to X — confirm or reassign?"
rather than the current "who should get this?".

**How to find candidate names.** Two layers, deliberately split along the project's
"facts in TypeScript, judgment in Claude" line:

1. **Claude extracts** the person-names a review mentions, and *only* that — it is genuinely
   judgment (is "Diana" the boat or a person? is "Amsterdam" a name?). It never sees the staff
   roster, never decides money, and returns a plain list of strings.
2. **TypeScript matches** each extracted name against active staff first names and decides the
   payout — exact, near-miss, or no match. Use a normalized edit distance (Levenshtein ≤ 1 for
   names ≤ 5 chars, ≤ 2 above) rather than Soundex, which is tuned for English and mangles
   Dutch names.

**Claude leads, regex does not.** An earlier draft of this plan had the regex run first and
Claude only as a fallback, to save tokens. That is wrong: the regex is precisely what cannot
distinguish "we will be back" from "Will was great", and running it first re-introduces the
false positives the role-word guard existed to suppress. Claude extracts; the regex is gone.

Cost is not a real objection — this runs once per *new review*, a handful a week, not per page
view. If the Claude call fails, award **nothing** and raise a conflict row so the mention still
reaches a human. Failing to a human is correct here; failing to a regex would quietly resurrect
the bug.

### 2.2 Slack the skipper when they're named
Beer's rule: *"skippers should get a slack message when a review in their name has been
mentioned."*

- On award, DM `staff.slack_member_id` via the existing `postDm`.
- Respect `staff.slack_notifications_enabled` (migration `128`) — do not DM someone who opted out.
- No `slack_member_id` → skip silently; it is not an error.
- Message: the star rating, the platform, the review text, and the fact that €5 was added to
  this month's pay. Keep it warm — this is a compliment being passed on, not a payroll notice.
- **Decided (2026-08-22): hold the DM until the match is confirmed.** For a near-miss/conflict
  case, do NOT DM at award time — only once a human confirms or reassigns it in the Reviews tab
  (§3.2). Never send a "congrats!" that might need walking back if the bonus gets reassigned.

---

## Phase 3 — Notice every review the day it lands

### 3.1 "Red bulb" per unseen review
Add `seen_at timestamptz null` to `social_proof_reviews` (new migration). A review is "new"
until someone opens the Reviews page with it visible.

- Sidebar badge on Reviews = count of `seen_at is null`, same pattern as the existing
  `inbox-open-count` / `pending-catering-count` badges.
- Red dot on each unseen row.
- Mark seen on view (not on page load — only rows actually rendered).

### 3.2 The Reviews tab is the management home — not the inbox (Beer's decision, 2026-08-22)

**✅ Done (2026-08-22).** Migration 130 added `social_proof_reviews.conversation_id`.
`handleGygReviewNotification` in `lib/gmail/sync.ts` now ingests the review directly (upsert
keyed on `(source, external_review_id)`, `is_active: false`), runs `awardReviewBonuses`, and
auto-resolves the conversation unless a pending conflict remains. The old dedicated
`/api/admin/reviews/conflicts` + `/conflicts/[id]` routes and `BonusConflictCards.tsx` are
deleted, replaced by one generalized `POST /api/admin/reviews/[id]/assign` route (handles first
assignment, reassignment, un-award-on-clear, conflict resolution, and conversation auto-resolve
through the same code path) and `GET /api/admin/reviews` now returns each review's `matchStatus`
(`no_match` / `assigned` / `needs_confirmation`). `ReviewItem.tsx` renders the status inline with
an assign/reassign `<select>` sourced from the existing `/api/admin/scheduling/staff` list — no
new staff endpoint. Known, documented limitation: the email path's numeric `external_review_id`
doesn't match the scraper's synthetic `gyg_{name}_{date}` id scheme, so if the scraper ever gets
unblocked and re-finds the same review, it inserts a second row with the real reviewer name
(placeholder is `"GetYourGuide guest"`) — a human merges/deletes via the Reviews tab. §3.1 (red
bulb / `seen_at`) is separate and not started.

> *"if you get an email about a review... don't show it in the inbox if that's already been
> taken care of in the review session."*

Superseded an earlier draft of this plan that put the co-pilot card in `ContextPane`. Beer's
call: managing which captain a review belongs to should live in **one place — the Reviews
tab** — regardless of which platform the review came from (email, Outscraper, Withlocals). The
inbox stays a passive record of the notification email, and auto-resolves once the Reviews tab
has dealt with it, so it never sits in "Open" as a thing to act on twice.

**The email is still the fastest ingestion path — that part of the original design stands.**
The GYG notification already carries everything a review row needs: platform, star rating,
review text, product name, and a stable id (subject line
`You have a new review on GetYourGuide - 607167 (126695754)` — product id and review id). So:

1. `detectReviewNotification(fromEmail, subject, body)` → `{ platform, externalReviewId, rating,
   text, productName }`, extending the existing `detectGygReviewNotification` pattern.
2. **Insert straight into `social_proof_reviews`** (`is_active: false`, so it's not published
   until approved) keyed on `(source, external_review_id)` — the existing unique constraint makes
   this idempotent against the scraper finding the same review later.
3. Run the §2.1 matcher — writes a `review_bonuses` row on an unambiguous match, or a
   `review_bonus_conflicts` row otherwise. Same matcher, same tables, regardless of whether the
   review arrived by email or by scraper — the Reviews tab doesn't need to know which.
4. Still trigger the platform's normal sync afterwards (rating/photo/translations may be richer
   there), debounced to one refetch per platform per hour.
5. **Record which conversation this review email came from** (`social_proof_reviews.source_conversation_id`,
   new column) — the link the auto-resolve step in the inbox needs.

**This is still the fix for the dead GYG scraper.** It's been Cloudflare-blocked and silently
importing zero; the email path doesn't touch Cloudflare at all, so new GYG reviews start arriving
again regardless of whether the scraper is ever repaired.

**The Reviews tab becomes the real management surface**, not just a list with an Active checkbox:

- Every review row shows its match status: the assigned captain's name, "no match," or "needs
  confirmation" (the near-miss case from §2.1) — not just conflicts, *every* review's state.
- An assign/reassign action on each row — a dropdown of active staff, or "no bonus" — replaces
  needing to dig through an inbox thread to fix a wrong match. This generalizes
  `BonusConflictCards` rather than sitting beside it: a conflict is just a review whose match
  status is "needs confirmation," rendered inline in the same list instead of a separate panel.
- Confirming/reassigning here is what actually inserts the `review_bonuses` row (or moves it),
  DMs the skipper (§2.2 — only NOW, once confirmed, never speculatively), and marks the review's
  match resolved.

**The inbox auto-resolve.** Once a review's match status leaves "needs confirmation" (whether
because the matcher was unambiguous from the start, or a human resolved it in the Reviews tab),
find its conversation via `source_conversation_id` and set `status: 'resolved'` — same pattern
as the `own_channel`-matched branch in `ota/handle-message.ts` already uses to keep a
notification email out of "Open" once nothing more needs doing with it. The email is still
there under "Resolved"/"All" if Beer wants to read the original, but it never demands attention
twice.

Ghost's reply drafting is skipped for these conversations entirely (same as every other OTA/
notification-shaped email) — nobody replies to a GetYourGuide review notification.

---

## Phase 4 — Replying (separate, larger)

**✅ Done for the copy-paste path (2026-08-22).** Google Business Profile is the only one of
the four with a reply API — reviving it needs a brand-new OAuth consent flow (Google Ads'
existing refresh token can't just gain a new scope) and carries a real risk of repeating the
exact failure migration 051 fixed (the old OAuth refresh token sat behind a public anon-read
policy on `google_reviews_config` for a period). Beer chose, when asked, to ship the
**copy-paste draft for all four platforms first** and treat live Google auto-posting as its own
later decision, not bundled into this pass.

What shipped: migration 131 adds `social_proof_reviews.ai_draft_reply` / `replied_at` — no OAuth
columns this time, unlike the old design. `src/lib/reviews/draft-reply.ts` (`draftReviewReply`)
reuses `OFF_COURSE_SYSTEM_PROMPT` + `CLAUDE_MODEL`, carrying over the pre-053 reply generator's
voice rules generalized from Google-only to all four sources. `POST /api/admin/reviews/[id]/
draft-reply` drafts and saves it, de-duping against the 5 most recent drafts across any review so
phrasing doesn't repeat. `ReviewItem.tsx` shows the draft inline with Draft/Regenerate, Copy
(clipboard), and a self-reported "Mark as replied" toggle — nothing here confirms the paste
actually happened on the platform, it's just a checklist.

Two corrections found live in the browser the same day, both now fixed:
- **Tone.** The first real draft ("...he has a way of making two hours on the water feel like the
  afternoon just disappeared...") read as manufactured/cheesy rather than genuinely thankful.
  Beer: "dint make the ai replies too cheesy. just thankful." `REPLY_VOICE_RULES` now explicitly
  bans invented imagery/metaphors the reviewer didn't use, caps replies at 1-3 sentences, and
  says plain beats clever. See [[feedback-review-reply-tone]].
- **Withlocals has no reply mechanism at all** — not just no API, no dashboard reply box either.
  The reply control is hidden entirely for `source === 'withlocals'` in `ReviewItem.tsx`, and
  `POST /api/admin/reviews/[id]/draft-reply` rejects it server-side too (400), not just
  client-side. See [[withlocals-no-reply-feature]]. Google, TripAdvisor, and GetYourGuide all
  keep the feature — GetYourGuide's own notification email literally has a "Reply to review"
  link, confirming its dashboard has one.

**Not done, deliberately deferred:** live auto-posting to Google Business Profile. If Beer wants
this later: confirm which GCP project `GOOGLE_OAUTH_CLIENT_ID` lives in and whether the Business
Profile API is enabled there (the same project-mismatch problem forced the Gmail Pub/Sub
integration onto its own separate OAuth client), then run a fresh consent flow for the
`business.manage` scope specifically — Google Ads' refresh token cannot be reused for it.

---

## Known weaknesses in ingestion (not this feature's job, but they cap its value)

- ~~GYG scraper silently imports nothing when Cloudflare blocks it~~ — **removed entirely,
  2026-08-23** (see addendum below). No longer applicable.
- ~~GYG synthetic IDs collide: `gyg_{Name}_{YYYYMMDD}`~~ — moot now that the scraper (the only
  thing that generated IDs in that scheme) is gone. The email path's numeric
  `detection.externalReviewId` is the only GYG id scheme left.
- Google/TripAdvisor have **no Vercel cron** — they depend on a schedule configured inside the
  Outscraper dashboard, invisible to anyone reading this repo. Still true, still a blind spot.
- `possible_duplicate_of` is written by the Withlocals sync and **never displayed anywhere**.
  Still true.

**Fixed 2026-08-23 — the bonus scan is now push-based per platform, not manual.** Beer asked
directly: "its push based right?... how will we do so for each platform?" Audit found
`syncWithlocalsReviews` and the (now-deleted) GYG scraper's weekly-cron path never called
`awardReviewBonuses` at all — every review arriving through either path sat unscanned until
someone clicked "Scan" in the Reviews tab. Confirmed live (not assumed) per platform:
- **Google & TripAdvisor** (Outscraper): push — Outscraper's own external schedule (not a Vercel
  cron; still a blind spot, see above) triggers a scrape, delivered to `/api/webhooks/outscraper`,
  which already called `awardReviewBonuses` in its `after()` block. No gap here, no change made.
- **Withlocals**: pull — weekly Vercel cron (`cron/withlocals-reviews`, Mondays 08:00 UTC) or the
  manual "Sync" button, both calling `syncWithlocalsReviews` directly. Was NOT auto-scanning —
  fixed: `syncWithlocalsReviews` now scans every freshly-inserted row inline, right after insert.
- **GetYourGuide**: the email-first path (`lib/gmail/sync.ts`'s `handleGygReviewNotification`,
  Phase 3.2) is genuinely push-based (Gmail Pub/Sub) and already scanned inline — this is now the
  ONLY GYG ingestion path.

**Removed entirely, 2026-08-23 — the GYG page-scraping fallback.** Beer asked to actually test it
("does this work? i give you an url and the scraper gets new reviews?") — ran `syncGYGReviews`
live against both known GYG product URLs and got `{blocked:true}` for both. Confirmed dead, not
just "sometimes blocked" as originally documented. Deleted: `lib/getyourguide/sync.ts` (and its
test), `api/cron/getyourguide-reviews/route.ts` (and its test), the `getyourguide-reviews` cron
entry in `vercel.json`, and the "best-effort enrichment" call + `GYG_PRODUCT_URLS` import that
`handleGygReviewNotification` made into it after email ingestion. The reviewer-name gap
(`reviewer_name: 'GetYourGuide guest'` — the email never carries a real name) is now permanent,
since there's no other GYG path left to backfill it from; a human can hand-edit it in the Reviews
tab. This also retires the duplicate-ID-scheme risk noted above, since there's only one ingestion
path left to generate an id at all.

---

## Suggested order

1. **1.1 + 1.2** — small, fixes a live money bug, no schema change.
2. **2.1** — AI extraction, fuzzy matching, and deleting the role-word guard. Moved earlier
   than originally drafted because Beer's "name mentioning is enough" rule depends on it: the
   guard cannot be removed while the matcher is still a regex.
3. **3.2** — email ingestion + the Reviews tab overhaul (match status, assign/reassign,
   inbox auto-resolve). No longer a `ContextPane` card, no new Ghost proposal kind, no
   `AgentTool` change — genuinely smaller than the original draft now that it's "one list, one
   dropdown" instead of a new inbox UI. Still the fix for the dead GYG scraper (Cloudflare-
   blocked today; the email path bypasses it entirely), so it still outranks the polish below.
4. **2.2** — the skipper DM. Reuses `postDm`. Fires from the Reviews tab's assign action
   (§3.2), only once a match is confirmed — never speculatively.
5. **3.1** — red bulb. One column, one badge.
6. **Phase 4** — replies, as its own project.

**Note on ordering:** 3.2 could ship before 2.1 using today's exact-match-only matcher — reviews
would just show "no match" more often in the Reviews tab, and never wrongly. If Beer wants the
tab overhaul sooner, that's a safe way to split it.

---

## Addendum — backfill, payroll exclusion, and statistics (2026-08-23)

**Historical backfill run.** `scripts/backfill-review-bonus-scan.ts` (mirrors the
`/api/admin/reviews/backfill-bonus-scan` route) ran the matcher over all 153 pre-existing 5-star
reviews. Found 3 real crew names with zero staff-roster match: **Bas** (3 reviews), **Mare** /
"Maré" / "Maare" (4 reviews, one person spelled 3 ways), **Bo** (1 review), plus **Casper** (1
review, skipped — Beer's choice). Bas, Mare, and Bo added to `staff` (role `skipper`) with Beer's
approval; their specific reviews had `bonus_checked_at` cleared and were re-scanned. Two of
Mare's four mentions ("Mare" exact, in Tracie's and Shaun Baillie's reviews) weren't picked up by
Claude's extraction on the re-scan — a real AI non-determinism gap, not a code bug (see
`feedback-review-reply-tone`-adjacent memory) — fixed manually via the assign endpoint / a direct
additive insert (Shaun Baillie's review already credited Beer Zoomers; the single-assignee
`/api/admin/reviews/[id]/assign` endpoint would have wrongly removed that credit, so Mare's bonus
was added directly instead — **known gap: the assign UI doesn't support adding a second assignee
without replacing the first**).

**Payroll exclusion (migration 133).** Beer: "we wont pay out bonuses this month" — the backfill's
~55 retroactive awards would otherwise inflate August payroll by their full backlog value, since
`payroll-query.ts` buckets a bonus by `awarded_at` (when found), not the review's own date. Added
`review_bonuses.excluded_from_payroll` (default `false`), one-time-set `true` on every row that
existed at migration time (i.e. the whole backfill), and `payroll-query.ts` now filters
`.eq('excluded_from_payroll', false)`. Bonuses awarded normally going forward are unaffected.

**Reviews tab Statistics section (done).** `src/app/[locale]/admin/reviews/monthly-stats.ts`
(`computeMonthlyStats`, `computeMonthlyGrowth`) + `MonthSwitcher.tsx` + `ReviewsGrowthChart.tsx`
(recharts, stacked by platform) + `ReviewsStatsSection.tsx`: a month-switchable per-captain bonus
table, per-platform review count, and a 6-month stacked growth chart — all derived client-side
from the same `useReviews()` fetch, no new endpoint.

**Deferred: "how many requests we've sent out."** No feature sends guests a review request today.
Beer wants one built (email + SMS, automatic N hours/days post-cruise, one admin-set destination
URL, must credit the assigned captain by name) but said to focus on statistics first — full design
and reusable building blocks captured in memory `project-review-request-feature` for when this
resumes.
