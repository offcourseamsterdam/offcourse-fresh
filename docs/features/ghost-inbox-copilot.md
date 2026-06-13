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

## How to extend

Next phases (see the plan): P1 floating collapsible panel, P2 in-panel co-pilot
chat (reuse `runAgenticLoop` scoped to the conversation), P3 read-only
confidence, P4 scoped decision events, P5 raise `reply_draft` to one-click send.
