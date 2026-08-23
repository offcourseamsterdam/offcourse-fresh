# Planning Optimizer Panel

## What was built

A new "Optimizer" button on `/admin/planning`, opening a dedicated panel
that surfaces every schedule inefficiency it can find for the dates
currently in view:

- **Same-day paid gaps** and **same-day cross-boat merges** — already
  computed correctly by the nightly ops-review optimizer, but until now that
  logic only ever ran once, for tomorrow. The panel runs it on demand for
  every visible day instead. Shown read-only — `/admin/ghost` already owns
  full review of these.
- **Cross-day consolidation** (new) — two single-booking shared departures
  exactly 1 day apart, same product, whose combined guest count fits one
  boat. Real example checked against prod (2026-08-23): Paige Monacelli
  (Tue 25 Aug, 4 guests) and Sophie Russell (Wed 26 Aug, 2 guests) were each
  the *only* booking on their departure — moving one onto the other frees a
  whole boat-day. This item type is actionable directly from the panel: the
  drafted SMS/email is shown inline, and Approve sends it immediately.

Full design history and the decisions behind it:
`docs/plans/2026-08-23-cross-day-consolidation-optimizer.md`.

## Key files

| File | Description |
|---|---|
| `src/lib/ghost/cross-day-consolidation.ts` | `findCrossDayConsolidationCandidates()` — pure function, the core new logic. |
| `src/lib/ghost/cross-day-move-drafter.ts` | `draftCrossDayConsolidation()` — drafts the SMS/email via Claude and inserts the proposal. |
| `src/lib/ghost/rulebook.ts` | `CROSS_DAY_WINDOW_DAYS`, `CROSS_DAY_INCENTIVE`, `CROSS_DAY_MOVE_PROMPT` — the tunable dials. |
| `src/app/api/admin/planning/optimizer/route.ts` | `GET ?from=&to=` — merges same-day facts + cross-day candidates into one tagged list. |
| `src/app/[locale]/admin/planning/OptimizerPanel.tsx` | The slide-over UI. |
| `src/app/[locale]/admin/planning/page.tsx` | The header button + wiring. |

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

**Same-day items are read-only in this panel.** Applying a same-day
cross-boat merge safely (reassigning a captain, changing a shift's boat)
is a separate, larger action than approving a text message — v1 shows the
opportunity here for visibility, but the actual fix still happens via the
existing `/admin/ghost` review flow.

**The candidate-finder always frames the LATER day's booking as moving onto
the EARLIER day's departure** (never the reverse), so each adjacent pair of
shifts produces exactly one candidate instead of two mirror-image ones for
the same real opportunity.

## How to extend

**Widening the day window:** `CROSS_DAY_WINDOW_DAYS` in `rulebook.ts` is
currently 1 (adjacent days only). Raising it to admit a real range (e.g. 1
OR 2 days apart) needs the loop in `findCrossDayConsolidationCandidates`
widened to check every offset up to the window — right now it reads exactly
one fixed offset, documented in a comment at the call site.

**Adding a fourth optimization kind:** give it its own `OptimizerItem.kind`
value, push items for it in the route alongside the existing three, and add
a `KIND_META` entry in `OptimizerPanel.tsx`. No other changes needed — the
panel only ever renders whatever kinds it's given.

## Dependencies

**Depends on:** `computeDayFacts` (`ops-review.ts`), `shiftCostCents`
(`scheduling/shift-cost.ts`), the existing `guest_move_request` send/response
flow, `shift_bookings` membership.

**Depended on by:** nothing yet — this is a new, additional surface.
