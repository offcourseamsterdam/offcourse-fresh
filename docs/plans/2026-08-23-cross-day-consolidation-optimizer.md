# Cross-Day Shared-Cruise Consolidation ("Optimizer") — Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or
> superpowers:subagent-driven-development to implement this plan task-by-task,
> once the open questions in Part 3 are answered.

**Goal:** When two shared cruises on nearby days are each running under-full,
detect it, get Beer's approval, and ask one party (with an incentive) to move
onto the other's departure — freeing an entire day's boat and captain cost
instead of running two half-empty boats.

**Status:** Design finalized (Part 3 decided, 2026-08-23). Ready for a
task-by-task TDD breakdown.

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

## Part 3 — Decisions (Beer, 2026-08-23)

**Q1 — Day window: ±1 day only.** Tuesday↔Wednesday, Wednesday↔Thursday.
Not 2-3 days — start narrow.

**Q2 — Incentive: a bottle of Crémant de Bourgogne (sparkling wine), not the
existing "bottle of wine on the house."** Kept as a single config value in
`rulebook.ts` (same place every other threshold already lives), so it's one
line to change again later — including differentiating it further by
category if that turns out to matter once this is actually running (Beer's
answer floated "it depends" on private vs. shared; v1 uses one incentive
line for the cross-day ask specifically, since only shared cruises are
eligible for it at all — private never merges, so there's no private-vs-
shared incentive split to make *within this feature*).

**Q3 — A new, dedicated Optimizer panel** — not folded into the existing
Ghost Activity review page. Its own surface, purpose-built for these
consolidation opportunities.

**Q4 — A human reviews and clicks approve, every time. No auto-send.** The
panel shows, before anything goes anywhere: (a) the proposed move itself
(which booking, from which date to which date, combined guest count vs.
capacity, estimated saving) and (b) the exact SMS + email text that would be
sent — both editable/cancelable, nothing sends on discovery alone.

**How the guest's answer comes back:** reusing the existing mechanism
verbatim — a unique tokened link in the SMS/email (`lib/ops/move-token.ts`),
landing the guest on a page with Yes / Let me check / Keep-my-time buttons.
Not a "reply YES to this text" flow — no inbound-SMS parsing to build; the
click is the answer, recorded straight to `ops_events`
(`guest_move_accepted`/`declined`/`deferred`).

---

## Part 4 — Proposed shape

1. **`findCrossDayConsolidationCandidates`** (new, pure function, in
   `src/lib/ghost/` alongside `ops-review.ts`) — across the optimize horizon,
   find pairs of shared-category shifts where: both are single-booking
   departures, same listing/product type, dates exactly ±1 day apart,
   combined guest count ≤ the receiving boat's capacity, neither booking has
   catering (same rule as today — a placed food order means leave them
   alone). Outputs the same shape of "candidate + estimated saving" the
   existing code already produces.

2. **A cross-day sibling to `craftAndInsertMoveProposal`** — drafts "move to
   [other date], same boat, same price, a bottle of Crémant de Bourgogne on
   us" instead of "move to [time] today." Reuses the tokened response link
   and the `agent_proposals` + `ops_events` plumbing as-is. Inserted as a
   `shadow` proposal — nothing sends until approved (Q4).

3. **New `OptimizerPanel` component** (Planning page — a header button opens
   it, matching the `GhostActivityPanel`/`AiOpsCenter` slide-over pattern
   already used elsewhere) listing candidates for the visible date range,
   each row expandable to show the proposed move AND the exact drafted
   message, with Approve (sends it) / Dismiss actions. Approve marks the
   proposal `executed` and fires the actual send; the real FareHarbor
   rebooking, once a guest says yes, stays a human action in
   `/admin/ghost` — same as every other move type today (not revisited here;
   no answer changed that).

4. **Docs** — per this repo's rule, a `docs/features/` writeup once built.

Next step: a full TDD task breakdown (file-by-file, test-by-test), following
this repo's normal `writing-plans` format, once Beer confirms this shape is
ready to build.
