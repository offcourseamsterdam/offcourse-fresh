# Cross-Day Shared-Cruise Consolidation ("Optimizer") — Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or
> superpowers:subagent-driven-development to implement this plan task-by-task,
> once the open questions in Part 3 are answered.

**Goal:** When two shared cruises on nearby days are each running under-full,
detect it, get Beer's approval, and ask one party (with an incentive) to move
onto the other's departure — freeing an entire day's boat and captain cost
instead of running two half-empty boats.

**Status:** Design + findings, not yet a task-by-task build plan. Part 3 lists
the decisions that need an answer before this becomes one.

---

## Part 1 — Correcting the premise: most of this already exists

Before designing anything new, here's what's already live in this codebase.
This isn't "start building the optimizer" — an optimizer already runs every
night. What's missing is one specific, new kind of move.

### Already built

**`src/lib/ghost/ops-review.ts` — the operations optimizer, literally named
that in its own doc comment.** Every evening it reads *tomorrow's* shifts and
proposes the most profitable improvements: close a paid gap, consolidate onto
one boat, fix the staffing level. Crucially, it already prices everything in
real euros — not a flat assumption, the ACTUAL captain's `hourly_rate_cents`
per staff member (`staff` table). Beer's own rate in the system is €35.00/hr
(`hourly_rate_cents: 3500`) — that's presumably where "€35/hour" came from;
it's already a real number for at least one person, not something to invent.

**`src/lib/ghost/guest-move-drafter.ts` — the guest-outreach half.** This is
almost exactly the "SMS the customer, offer them something" idea:
- Finds a paid idle gap worth ≥45 min and ≥€20 (`rulebook.ts`).
- Drafts an SMS + email with a tokened Yes/Let me check/Keep-my-time link.
- **A human approves the send before anything goes out** — exactly "of course
  you have to check for approval."
- The incentive is already wired in: `'a bottle of wine on the house'`
  (`guest-move-drafter.ts:542`, also in `rulebook.ts:84`). Champagne instead
  of wine is a one-line change, not new infrastructure (see Part 3, Q2).
- **Private vs. shared is already the exact hard rule described**: private
  cruises can be asked to move *time*, but are never merged onto another
  party's boat (`deriveOperationalProfile(...).allowMerge`, enforced in code,
  not just the prompt). This is precisely "if it's private, no — if it's
  shared, yes."
- Every response lands in `ops_events` (`guest_move_requested/accepted/
  declined/deferred/expired`) — there's already a track record to learn from.

**What this means:** the send mechanism, the incentive, the approval gate,
the private/shared rule, and the cost math all exist. Building those from
scratch would be rebuilding something that's already running nightly.

### The actual gap

Both existing systems only look at gaps and merges **within a single
calendar day**:
- `ops-review.ts`'s "merge candidates" = two shifts *on the same day*, on
  *different boats*, where one could absorb the other's guests.
- `guest-move-drafter.ts`'s "move candidates" = shrinking the *idle time
  between two sailings on the same boat, same day*.

Neither one compares **Tuesday's shift to Wednesday's shift.** A lone shared
booking on Tuesday and a lone shared booking on Wednesday each look
"normal" in isolation — one boat, one booking, nothing idle to close — so
today's optimizer has no reason to flag either of them. The waste isn't idle
minutes; it's a whole extra boat-day for what one boat could carry. That's
the piece that's genuinely new, and it's a legitimately different kind of
optimization (call it a third kind of consolidation, alongside "same-day gap"
and "same-day cross-boat merge").

---

## Part 2 — The worked example, with real numbers

Checked directly against prod (not assumed):

| | Paige Monacelli | Sophie Russell |
|---|---|---|
| Date | **Tue 25 Aug** | **Wed 26 Aug** |
| Departure | 15:00–16:30 | 15:00–16:30 |
| Guests | 4 | 2 |
| Shift (prep→wrap-up) | 14:15–17:30 (3h15m) | 12:15–17:30 (5h15m) |
| Captain assigned | none (open) | none (open) |

Both are the *only* booking on their respective shared departure. Combined
guest count (6) comfortably fits either boat's 12-seat capacity. **Neither
shift has a captain yet** — the cleanest possible case: nobody even needs to
be un-assigned, the whole Wednesday shift simply never needs to exist.

At Beer's own €35/hr rate, Wednesday's 5h15m shift would cost **≈€183.75** to
crew. If Sophie's party of 2 is asked to shift a day earlier onto Paige's
Tuesday departure (6 guests total, still well within capacity), Wednesday's
boat doesn't sail at all — that whole cost disappears, in exchange for one SMS
and (say) a bottle of something on the house.

This is the exact shape of opportunity this plan is meant to catch
automatically, going forward, on any pair of near-empty shared departures —
not just this one.

---

## Part 3 — Open questions before this becomes a task list

**Q1 — How far apart counts as "nearby"?** Tuesday→Wednesday is 1 day. Is a
2-3 day window worth also proposing (e.g. a Monday booking asked to move to
Thursday), or does asking a guest to shift more than a day feel too pushy?
Recommend starting at ±1 day only, widen later if it proves too rare to matter.

**Q2 — Incentive: wine (existing) or champagne (what you said)?** The
existing `guest-move-drafter.ts` hardcodes "a bottle of wine on the house."
Recommend making the incentive line a single config value in `rulebook.ts`
(where every other threshold already lives) rather than hardcoding champagne
in a second place — one source, reusable by both the existing same-day
drafter and the new cross-day one.

**Q3 — Where does the "Optimizer" button live?** You asked for "a panel
button that says Optimizer" on the Planning page specifically. There's
already a Ghost Activity panel (`GhostActivityPanel.tsx`) and the global AI
Ops Center icon reviewing proposals. Recommend: a new "Optimizer" button in
Planning's header (next to "Find captains") that runs the cross-day scan
**on-demand for whatever date range is currently in view** and drops results
into the same `agent_proposals` table the rest of Ghost already uses — so
approval still happens on the one existing review surface, and Planning's
button is just a fast, scoped trigger, not a second review UI to maintain.

**Q4 — Who executes the actual move once a guest says yes?** Every existing
move (same-day time shift) still ends with a human doing the real FareHarbor
rebook — the drafter never touches FareHarbor directly. A cross-day merge is
the same, just bigger (cancel one whole booking's slot, add it to another
day's departure, then mark the freed shift as no longer needed). Recommend
keeping that human-does-the-real-move rule unchanged for v1 — this is a
bigger, less reversible action than a same-day snap, not a good candidate for
first-version automation.

---

## Part 4 — Proposed shape, once Part 3 is answered

1. **`findCrossDayConsolidationCandidates`** (new, pure function, in
   `src/lib/ghost/` alongside `ops-review.ts`) — across the optimize horizon,
   find pairs of shared-category shifts where: both are single-booking
   departures, same listing/product type, dates within the Q1 window,
   combined guest count ≤ the receiving boat's capacity, neither booking has
   catering (same rule as today — a placed food order means leave them
   alone). Outputs the same shape of "candidate + estimated saving" the
   existing code already produces, so it slots into the same review pattern.

2. **Extend `craftAndInsertMoveProposal`'s ask** (or a sibling function next
   to it) to draft the cross-day version: "move to [other date], same boat,
   same price, [incentive]" instead of "move to [time] today." Reuses the
   tokened response link (`lib/ops/move-token.ts`) and the `agent_proposals`
   + `ops_events` plumbing as-is.

3. **The Optimizer button** (Planning page header) — POST to a new route that
   runs the scan for the visible date range and inserts any found candidates
   as `shadow` proposals, same as tonight's cron does automatically. Existing
   Ghost review surfaces pick them up with no further UI work.

4. **Docs** — per this repo's rule, a `docs/features/` writeup once built.

Not attempting a full TDD task breakdown yet (file-by-file, test-by-test) —
that's the next step once Q1–Q4 have answers, following this repo's normal
`writing-plans` format.
