# Planning Optimizer Panel

## What was built

A new "Optimizer" button on `/admin/planning`, opening a dedicated panel
that surfaces every schedule inefficiency it can find for the dates
currently in view:

- **Same-day paid gaps** — already computed correctly by the nightly
  ops-review optimizer, but until now that logic only ever ran once, for
  tomorrow. The panel runs it on demand for every visible day instead. Shown
  read-only — no ask exists for a gap yet, `/admin/ghost`'s nightly review
  covers it.
- **Same-day boat swaps** (`same_day_merge`, extended 2026-08-23) — a
  single-booking shift that fits cleanly onto another in-use boat's day, no
  overlap, capacity checked. **Private cruises are included** (Beer,
  2026-08-23: "private cruises can definitely swap Diana for Curaçao") — a
  private party doesn't care which specific boat, just that it fits; a real
  data bug had this gated on the wrong profile flag (`allowMerge`, which
  correctly stays false for private — that flag is about never combining two
  parties onto one departure, not about boats) instead of the right one
  (`allowBoatSwap`, true for both categories). Priced at the moving boat's
  full shift cost — "one boat, one day, one shift" means the swap frees that
  boat's captain entirely for the day. Actionable: dry-run validated against
  FareHarbor (same time, other boat — never a different time), then drafted
  and shown inline exactly like cross-day.
- **Cross-day consolidation** — two single-booking shared departures exactly
  1 day apart, same product, whose combined guest count fits one boat. Real
  example checked against prod (2026-08-23): Paige Monacelli (Tue 25 Aug, 4
  guests) and Sophie Russell (Wed 26 Aug, 2 guests) were each the *only*
  booking on their departure — moving one onto the other frees a whole
  boat-day. Actionable directly from the panel: the drafted SMS/email is
  shown inline, and Approve sends it immediately. Prices a SHRINK, not just
  full elimination, when the moving shift also covers an unrelated departure
  that stays behind (Beer, 2026-08-23: "you are saving costs" even when a
  shift doesn't disappear entirely — it can still get shorter). At most one
  candidate per booking, ever (fixed a real bug 2026-08-23 — see below);
  food catering only ever disqualifies the party actually MOVING, never the
  stationary party receiving them.

Once a guest accepts any of these asks, the accepting admin can click **Mark
rebooked in FareHarbor** on the `/admin/ghost` card after doing the real
FareHarbor rebook by hand — this records `outcome.rebooked_at` and resyncs
the affected date(s) immediately, so Planning doesn't wait on the next
unrelated sync to reflect it (Beer, 2026-08-23: "when something was
successful to process the rebooking" — previously a guest "yes" only ever
fired a Slack reminder with nothing closing the loop).

Full design history and the decisions behind it:
`docs/plans/2026-08-23-cross-day-consolidation-optimizer.md`.

## Key files

| File | Description |
|---|---|
| `src/lib/ghost/cross-day-consolidation.ts` | `findCrossDayConsolidationCandidates()` — pure function, the cross-day logic (shrink-or-eliminate pricing). |
| `src/lib/ghost/cross-day-move-drafter.ts` | `draftCrossDayConsolidation()` — drafts the SMS/email via Claude and inserts the proposal. |
| `src/lib/ghost/ops-review.ts` | `computeDayFacts()` — same-day gaps + `mergeCandidates` (the boat-swap pool), gated on `allowBoatSwap`. |
| `src/lib/ghost/boat-swap-drafter.ts` | `findSwapSlot()`/`validateBoatSwap()` (FH dry-run, same time/other boat) + `draftBoatSwap()`. |
| `src/lib/ops/profile.ts` | `deriveOperationalProfile()` — `allowMerge`/`allowBoatSwap`/`allowTimeChange` per category. |
| `src/lib/ghost/rulebook.ts` | `CROSS_DAY_WINDOW_DAYS`, `CROSS_DAY_INCENTIVE`, `CROSS_DAY_MOVE_PROMPT`, `BOAT_SWAP_PROMPT` — the tunable dials + prompts. |
| `src/app/api/admin/planning/optimizer/route.ts` | `GET` (always today → +horizon) — merges same-day facts, boat-swap asks, and cross-day candidates into one tagged list. |
| `src/app/api/admin/ghost/proposals/[id]/route.ts` | `mark_rebooked` action — closes the loop after a guest accepts any move type. |
| `src/app/[locale]/admin/planning/OptimizerPanel.tsx` | The slide-over UI. |
| `src/app/[locale]/admin/planning/page.tsx` | The header button + wiring. |
| `src/app/[locale]/admin/ghost/page.tsx` | The proposal card — renders the boat-swap ask distinctly (same time, different boat) and the "Mark rebooked" button. |

## Architecture decisions

**Cross-day proposals reuse the `guest_move_request` kind — no new send or
response code.** `POST /api/admin/ghost/proposals/[id]` (the `send_move`
action) and `POST /api/move/respond` (the guest's tokened-link answer) were
already generic over whatever's in the proposal's `payload` — neither one
assumes the ask is a same-day time shift. A `payload.move_type: 'cross_day'`
field distinguishes the two asks for anything that reads the payload later
(analytics, the panel itself), but the send and response plumbing needed
zero changes. This is the single biggest reason the build was smaller than
"build an optimizer" sounds: an optimizer, a guest-outreach mechanism, and
an approval gate all already existed and already ran nightly — the actual
gap was one missing comparison (Tuesday's shift against Wednesday's), not
the whole system.

**Cross-day items are eagerly drafted, but idempotently.** The panel shows
the exact SMS/email text without a second round-trip per row, which means
the route calls Claude as soon as a candidate is found. To keep re-opening
the panel from calling Claude (and creating duplicate proposals) every time,
`findOpenCrossDayProposal` checks for an already-open ask on that booking
first and reuses it.

**Only a paid gap stays read-only.** Closing a gap means changing WHEN a
guest sails — that's guest-move-drafter.ts's job (a separate nightly/
new-booking drafter, not yet wired into this panel). A boat swap only
changes WHICH boat, at the exact same time, so it fits the same
dry-run-then-draft shape as cross-day and is actionable here too.

**Boat swap never re-implements the actual boat reassignment.** The ask and
its accept/decline flow are identical to every other `guest_move_request` —
the real FareHarbor change (and the shift's boat_id) still gets updated by a
human, then confirmed via `mark_rebooked`, exactly like a time or date move.

**Which party moves is decided by size, not a fixed direction** (Beer,
2026-08-23): for cross-day, whichever party is SMALLER is asked to move (a
tie defaults to the later day) — not "the later day always moves". For a
same-day boat swap there's only one party involved, so this doesn't apply.

**A booking never appears in more than one cross-day candidate** (Beer,
2026-08-23 — a real bug, found by re-tracing the pairing logic, not just a
theoretical worry). `CROSS_DAY_WINDOW_DAYS = 1` means a booking can sit
exactly 1 day from BOTH neighbors at once, and two different movers can both
target the same receiving day's spare capacity — both scenarios produced
multiple candidates touching the same booking. The idempotency lookup
(`findOpenCrossDayProposal`) is keyed only on `booking_id`, so a
later-processed candidate would silently reuse an earlier one's already-
drafted message — showing the WRONG destination in the guest-facing text
while the panel's own summary/toDate fields (built fresh per candidate)
still showed the right one. Fixed with a dedup pass at the end of
`findCrossDayConsolidationCandidates`: sort by `estSavingCents` descending,
keep the first candidate touching each booking (as either mover or
receiver), drop every other candidate that reuses either of its two
bookings.

**Food only disqualifies the party actually moving, never the stationary
receiver** (Beer, 2026-08-23): a receiving party's own food order is
untouched by someone else joining their departure, so it was never a valid
reason to exclude them as a *target*. `eligibleToReceive` (weaker — shared,
single booking, not `no_reschedule_ask`) gates pool membership for both
sides; `eligibleToMove` (`eligibleToReceive` + no food) is only checked
against whichever side turns out to be the mover, decided by size, after
pairing. `no_reschedule_ask` stays a two-sided exclusion, unlike food — an
unasked companion joining a flagged guest's shared departure changes their
own experience even though their booking itself never moves.

## How to extend

**Widening the day window:** `CROSS_DAY_WINDOW_DAYS` in `rulebook.ts` is
currently 1 (adjacent days only). Raising it to admit a real range (e.g. 1
OR 2 days apart) needs the loop in `findCrossDayConsolidationCandidates`
widened to check every offset up to the window — right now it reads exactly
one fixed offset, documented in a comment at the call site.

**Adding a new optimization kind:** give it its own `OptimizerItem.kind`
value, push items for it in the route, and add a `KIND_META` entry in
`OptimizerPanel.tsx`. If it should be actionable (not just informational),
add its kind to the panel's `isActionable` check too.

**Making same-day gaps actionable in this panel:** wire `guest-move-drafter.ts`'s
existing `selectMoveCandidate`/dry-run/draft pipeline into the route the same
way boat swaps and cross-day already are — it already supports private
bookings (`allowTimeChange`), it just isn't called from here yet.

## Dependencies

**Depends on:** `computeDayFacts` (`ops-review.ts`), `shiftCostCents`
(`scheduling/shift-cost.ts`), `deriveOperationalProfile` (`ops/profile.ts`),
the existing `guest_move_request` send/response flow, `shift_bookings`
membership, live FareHarbor availability (boat-swap and same-day dry-runs).

**Depended on by:** nothing yet — this is a new, additional surface.
