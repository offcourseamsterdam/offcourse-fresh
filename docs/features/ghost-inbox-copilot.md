# Ghost Inbox Co-pilot — P0

The first slice of `docs/plans/2026-06-13-ghost-inbox-copilot.md`: the Ghost
stops being only a standalone `/admin/ghost` page and starts living **in the
inbox**, where the work happens — and for the first time its work can become a
**real action** in one human click.

## What was built (P0)

In the inbox right pane (`ContextPane`), when the open conversation has Ghost
proposals, a **Ghost co-pilot** card shows:

- **Suggested reply** — the Ghost's draft + "Use this draft", which drops the
  text straight into the composer (so you send it / edit it inline).
- **Proposed booking** — the validated booking + an **"Approve & create
  booking"** button (two-step confirm) that creates a **real FareHarbor
  booking**.

Booking creation **reuses the existing money path verbatim** — it does not fork
any FareHarbor logic.

## Key files

- `src/app/api/admin/inbox/conversations/[id]/route.ts` — GET now returns
  `ghost: { replyDraft, bookingProposal }` (extended, no new route file).
- `src/app/api/admin/ghost/proposals/[id]/route.ts` — new `book` action:
  re-resolves the slot, **atomically claims** the proposal (`shadow`→`booking`),
  calls `/api/admin/booking-flow/book`, then marks it `executed`.
- `src/lib/ghost/book-from-proposal.ts` — `prepareInboxBookingBody`: turns a
  human-readable proposal into the exact money-path body, re-resolving against
  **live** availability (exact-match-or-abstain); refuses without full contact.
- `src/app/[locale]/admin/inbox/ContextPane.tsx` — the co-pilot card +
  `BookingApproval` (confirm → create).
- `ThreadPane.tsx` / `page.tsx` — the "Use this draft" → composer prefill wiring.

## Safety (verified by an adversarial pass)

- **No autonomous booking.** The only trigger is a two-step human click; every
  agent/cron/shadow path stays validate-only or `shadow`. (`booking_proposal`
  is pinned to a `dry_run` ceiling in `IRREVERSIBLE_KINDS` — code, not vibes.)
- **Money path reused verbatim** via an internal `fetch` to
  `/api/admin/booking-flow/book` (admin cookie forwarded so its `requireAdmin`
  passes); zero forked validate/create logic.
- **Re-validate on click.** The slot is re-resolved live AND the booking
  endpoint runs its own FareHarbor validate→create; the stored shadow verdict is
  informational only.
- **Atomic idempotency.** The `shadow`→`booking` claim (conditional UPDATE)
  closes the double-click / concurrent double-booking window; the claim is
  released back to `shadow` if the booking fails so it can be retried.
  (Migration `076_agent_proposals_booking_status.sql` adds `'booking'` to the
  `agent_proposals` status CHECK — without it the claim violates the constraint
  and the approve click 500s before reaching FareHarbor.)

## Tests

- `src/app/api/admin/ghost/proposals/[id]/route.test.ts` — the `book` action
  orchestration: happy path (claim → money-path reuse with cookie forwarded →
  mark executed), the guards that must never fire a real booking (already
  executed, wrong kind, prep failure, **lost atomic claim**), and
  claim-release-on-failure (FareHarbor rejects / fetch throws → back to `shadow`).
- `src/lib/ghost/ops-drafters.test.ts` — `draftCateringOrders` and
  `draftTomorrowSchedule`: dedupe-skip (no token spend), no-work-skip, happy-path
  shadow insert shape, malformed-output skip, and error-swallowing (cron-safe).

## Known limitations (deliberate, deferred)

- Inbox bookings are recorded as **`complimentary`** (no payment captured) — the
  confirm dialog says so. Paid bookings via the inbox (payment link / invoice)
  are a later phase.
- The co-pilot card lives in the `xl:` right pane; the dedicated floating panel,
  in-panel chat, confidence surface, and event tracking are P1–P5 in the plan.

## P0.1 — per-conversation co-pilot + ops dashboard

Aligning the UI with the agreed model (one conversation agent; `/admin/ghost`
demoted to an ops dashboard):

- **`/admin/ghost` → ops dashboard.** The per-message conversational feed is
  gone; the page now shows spend, learning stats, open questions, taught
  knowledge, and only the **ops** proposals (catering, scheduling). The
  inbox/booking agent tiles link into the inbox (their work lives there).
- **Drafts translated to English.** Every non-English/Dutch draft gets an
  English read-out: stored at draft time (`payload.reply_en` in
  `shadow-drafter.ts`), and a `translate` action on the proposals route
  backfills older drafts on demand. Shown under the suggested reply in the
  co-pilot.
- **Per-conversation learning trail.** The co-pilot shows "What it's learned
  here" — past drafts vs what you actually sent, with the match / minor /
  rewrote-it badge and the lesson. The feedback loop (use the draft, edit it,
  or send something else) is captured automatically on send (the messages
  route attaches your reply to the draft's `outcome`) and now visible in the
  inbox, not just on the dev page.

## Availability-aware booking proposals (alternatives)

When the proposed slot isn't bookable, the co-pilot no longer dead-ends at "sold
out" — it surfaces up to 3 ranked, **already-validated** nearby options (nearest
earlier/later on the same boat, the other boat, or the same product another day),
and the agent offers them in its reply. Each option is one click to book through
the same money path.

- **Where the smarts live** — `checkBookingViability(input, { withAlternatives })`
  in `src/lib/ghost/dry-run.ts`. Skip-first: alternatives are built ONLY when the
  asked slot won't book, so the happy path does zero extra work. Same-day
  candidates come from the availability already fetched (no extra FareHarbor GETs);
  the finder validates at most `ALT_VALIDATE_MAX` of them and probes at most
  `ALT_MAX_DAYS` other days, one validate each — a hard FareHarbor-cost ceiling.
  `rankAlternatives()` is a pure, unit-tested ranker (same boat first, nearest
  time, later-preferred; then other boat; then other day).
- **The agent self-corrects in one pass** — `check_booking` (`tools.ts`) returns
  the validated `alternatives` inside the same tool result, so the agent's reply
  can't drift from what's actually bookable. RULES tell it to offer the options
  (or re-propose onto the best one) and never invent a slot.
- **Stored, not actioned** — alternatives live in `payload.verdict.alternatives`
  (status stays `shadow`). The narrowed inbox query (`payload->verdict`) already
  carries them; no schema change.
- **Booking one** — the card's per-option "Use this" POSTs
  `{ action: 'book', alternative_index }`. The route re-derives the booking from
  the **stored** alternative (its pks are hints only) and runs the same atomic
  claim + `/booking-flow/book` money path, which re-resolves and re-validates
  live. An out-of-range index is refused before any claim.

Safety is unchanged: still validate-only, still exact-match-or-abstain, still no
autonomous booking (every option needs the two-step human confirm). Tests:
`rankAlternatives` + the finder in `dry-run.test.ts`; the `alternative_index`
book path in `proposals/[id]/route.test.ts`.

## Catering / snacks in chat (the `list_extras` tool)

The conversation agent can now answer "what snacks/drinks can we get?" with the
**real** menu instead of guessing. `list_extras` (`src/lib/ghost/tools.ts`) is a
read-only tool: given a cruise slug it resolves the listing, pulls active
food + drinks `extras`, applies the same per-listing/global scope filter as the
public extras upsell page, and returns a compact priced menu (`extraPriceLabel`
+ `compactExtras`, priced with `fmtEuros` so €10.80 isn't rounded to €11). It's
added to the inbox agent's allow-list, and a RULES line tells the agent to use it
for catering questions, offer the real items, and point customers to the booking
page / checkout to select (no payment until the day) — never invent menu items.

**Ghost-rule decision:** this is a read-only *lookup* tool, not a new proposal
kind. The agent describing the menu is safe; **ordering** catering stays the
existing `catering_order` shadow drafter (supplier-facing, human-approved) — a
money/supplier action that never auto-executes. Letting a customer pick in chat
and the agent draft an extras order for approval is a future extension (same
shadow→approve pattern as booking alternatives). Tests: `extraPriceLabel` +
`compactExtras` in `src/lib/ghost/tools.test.ts`; the DB query path verified
against live data.

## How to extend

Next phases (see the plan): P1 floating collapsible panel, P2 in-panel co-pilot
chat (reuse `runAgenticLoop` scoped to the conversation), P3 read-only
confidence, P4 scoped decision events, P5 raise `reply_draft` to one-click send.
