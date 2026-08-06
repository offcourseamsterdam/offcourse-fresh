# Gmail Inbox Integration

## What was built

Gmail is now a channel in the existing customer-chat inbox, alongside webchat.
Email sent to `cruise@offcourseamsterdam.com` lands as a `conversation`
(`channel: 'email'`) and flows through the **existing, unmodified** Ghost
pipeline (`draftShadowReply`) — the same AI that already drafts replies and
booking proposals for webchat. No changes were made to Ghost's decision logic;
this is purely a new input/output adapter.

**Explicitly out of scope (deferred):** OTA confirmation emails from
GetYourGuide/Viator, which — once those platforms connect directly to
FareHarbor — represent a booking that already exists there and should just be
logged with the right net-rate/commission rather than trigger a new booking
creation. No existing code hooks into this yet, and the matching key (how to
link an email to its FareHarbor booking) is still an open question. Ships as
its own pass once a real example email exists.

## Key files

| File | Purpose |
|---|---|
| `supabase/migrations/108_gmail_thread_id.sql` | Adds `conversations.provider_thread_id` — Gmail's own thread id, used to group messages correctly and thread replies |
| `src/lib/gmail/auth.ts` | OAuth2 refresh-token → access-token exchange, byte-for-byte the same pattern as `google-ads/auth.ts` |
| `src/lib/gmail/client.ts` | Raw Gmail REST API calls (list, get, send) — no `googleapis` SDK, matching this repo's existing no-SDK philosophy. Recursive MIME-part parsing for the plain-text body (falls back to stripped HTML) |
| `src/lib/gmail/sync.ts` | Ingestion: find-or-create contact/conversation, insert message, call `draftShadowReply` |
| `src/app/api/cron/gmail-inbox-sync/route.ts` | Polls every 2 minutes (`vercel.json`) |
| `src/app/api/admin/inbox/conversations/[id]/messages/route.ts` | Outbound send — new branch for `channel === 'email'` |
| `scripts/gmail-oauth-setup.ts` | One-time script to generate the Gmail OAuth consent URL and exchange the resulting code for a refresh token |

## Architecture decisions

**Why polling, not Gmail push (Cloud Pub/Sub).** A push subscription needs a
"watch" that expires every 7 days and a separate Pub/Sub topic — one more thing
to silently break. A 2-minute poll is indistinguishable from instant for
support email and reuses the cron infrastructure this project already has.

**Why conversations group strictly by Gmail's `threadId`, not by contact.**
Webchat groups an open conversation by contact alone, because a customer only
has one active chat at a time. Email is different — the same person can have
two genuinely unrelated threads open (a booking question and a separate
complaint) at once. Grouping by `threadId` keeps them separate; grouping by
contact would silently merge them.

**Why no `googleapis` npm dependency.** The existing Google Ads OAuth code
(`google-ads/auth.ts`) already established the pattern of talking to Google's
APIs via raw `fetch` calls instead of an SDK, to keep the dependency surface
and serverless cold-start cost minimal. Gmail's REST API is simple enough
(list/get/send) that the same approach applies cleanly.

**Why the OAuth client is shared with Google Ads, but the refresh token is
new.** `GOOGLE_OAUTH_CLIENT_ID/SECRET` already exists and was safe to reuse.
The refresh token is scope-specific, though — Google issues it for whatever
scopes were granted at consent time, and Gmail scopes were never granted to
this client before. `scripts/gmail-oauth-setup.ts` is the one-time script to
get a fresh consent grant with `gmail.readonly` + `gmail.send`.

**Why `GMAIL_SUPPORT_ADDRESS` exists separately from `GMAIL_USER`.** The
customer-facing address (`cruise@offcourseamsterdam.com`) turned out to be a
Gmail **alias** on a shared mailbox (`info@offcourseamsterdam.com`), not a
separate account. Aliases don't get their own mailbox — mail addressed to
either lands in the exact same inbox, and there's no way to grant Gmail API
access scoped to just the alias. Without a code-level filter, ingestion would
pull in every unrelated email in that shared inbox, not just customer/OTA
traffic. `GMAIL_USER` is the actual authenticated account (the OAuth `userId`);
`GMAIL_SUPPORT_ADDRESS` scopes the Gmail search query to `to:<address>` and is
used as the `From` header on replies, so customers see mail coming from the
address they wrote to, not the underlying shared account. Leave
`GMAIL_SUPPORT_ADDRESS` unset when the mailbox itself IS the customer-facing
address (no alias involved) — everything falls back to `GMAIL_USER`.

**Why sending happens before inserting the message row.** The route calls
Gmail's send API first, then inserts the `messages` row with the outcome
already known (`status: 'sent'` + the real Gmail message id, or
`status: 'failed'` + the error). This avoids a window where the row exists but
we don't yet know if it actually went out, and means a failed send returns a
real error to the admin UI instead of silently looking like it succeeded.

## How it works (data flow)

1. Cron polls `in:inbox -category:promotions` every 2 minutes.
2. For each new message: find-or-create the `contact` by sender email
   (same dedup key as webchat), find-or-create the `conversation` by
   `provider_thread_id` (reopens a resolved thread rather than duplicating).
3. Insert the `messages` row (`provider: 'gmail'`, `provider_message_id` =
   Gmail's message id — the existing `UNIQUE` constraint on that column is the
   idempotency gate for re-polls, same exactly-once pattern as the Stripe
   webhook).
4. Call `draftShadowReply(conversationId, messageId)` — Ghost drafts a reply or
   booking proposal exactly as it would for a webchat message.
5. A human reviews the draft in `/admin/inbox`, edits if needed, and sends.
   For an email conversation, sending calls the Gmail API with proper
   `In-Reply-To`/`References` headers (looked up just-in-time from the
   original message, not stored redundantly) so the reply threads correctly
   in the customer's own mail client, not just Gmail's.

## Catering order auto-confirmation (supplier reply → status flip, no human click)

A narrow extension of the same pipeline: when a catering supplier (currently
just Pure Boats) replies to our order-request email confirming the order,
that confirmation is recorded automatically — no admin has to click anything.

**How it works:**

1. `src/lib/catering/send-catering-email.ts` now sends the order-request
   email via `sendNewEmail` (Gmail), not Resend, and stores the resulting
   Gmail `threadId` on `bookings.catering_thread_id`. A resend (the admin
   "resend" button, or an updated order) reuses that same `threadId` instead
   of starting a fresh thread — otherwise a supplier's reply to the resend
   wouldn't match anything.
2. `src/lib/gmail/sync.ts`, on every new inbound message, checks — BEFORE
   calling `draftShadowReply` — whether a booking exists with
   `catering_thread_id` equal to this message's thread AND
   `catering_confirmed_at IS NULL`. A match means this is a supplier reply
   about a still-pending catering order, not a customer-service conversation,
   so `draftShadowReply` is skipped for it entirely (a "draft a reply to the
   customer" doesn't make sense when there is no customer in this thread).
3. Instead, `src/lib/catering/detect-confirmation.ts`
   (`detectCateringConfirmation`) classifies the reply body as `'confirmed'`,
   `'needs_reply'`, or `'unclear'`. Only `'confirmed'` does anything: it sets
   `bookings.catering_confirmed_at` and emits an `ops_events` row
   (`eventType: 'catering_confirmed'`) with the supplier's email and the
   booking date. `'needs_reply'` and `'unclear'` — including out-of-office
   auto-replies — leave the booking untouched; the thread simply sits in the
   inbox as a normal, un-drafted email conversation for a human to open and
   handle manually. That's the intentional safe fallback, not a gap to fill.
4. Once `catering_confirmed_at` is set, later replies in the same thread stop
   being checked (the `IS NULL` filter), so a second supplier email ("thanks!")
   doesn't get re-classified or re-emit the event.

**Why this bypasses Ghost's kind/proposal/autonomy-ladder machinery.** Every
other AI-driven decision in this codebase that touches a booking goes through
a Ghost `kind` registered in `src/lib/ghost/agents.ts`: an `agent_proposals`
row, a tool-use loop, and (for anything consequential) a human-in-the-loop
review before anything happens. That machinery exists because those
decisions have two hard parts — "which booking/entity is this about" (often
itself uncertain, requiring search/reasoning) and "what should happen"
(open-ended, often money-moving or booking-creating, and not easily
reversible). Here, the first part isn't a judgment call at all — the Gmail
`threadId` match is a deterministic database lookup, decided before any AI
model is invoked. What's left is a single, narrow, three-way classification
of one email body — not open-ended reasoning. And the action taken
(`catering_confirmed_at` timestamp + one event) is a low-stakes, easily
reversible internal status update, not a booking, a payment, or an email to
a customer — nothing about it needs staged autonomy or a review queue. Adding
a full Ghost kind for a single boolean-ish classification would be pure
process overhead with no corresponding safety benefit, which is why Beer and
the lead engineer deliberately kept this as a standalone function instead.

**Key files (this extension):**

| File | Purpose |
|---|---|
| `supabase/migrations/109_catering_confirmation.sql` | Adds `bookings.catering_thread_id` + `bookings.catering_confirmed_at` |
| `src/lib/gmail/client.ts` | `sendNewEmail` widened to accept an optional `threadId` so a resend lands in the same thread |
| `src/lib/catering/send-catering-email.ts` | Sends via Gmail instead of Resend; stores the returned `threadId` |
| `src/lib/catering/detect-confirmation.ts` | The standalone classifier (`detectCateringConfirmation`) — tool-forced enum output, fails closed to `'unclear'` on any error |
| `src/lib/gmail/sync.ts` | `handlePendingCateringReply` — the threadId match + branch that skips `draftShadowReply` for supplier replies |
| `src/lib/ops/events.ts` | New `OpsEventType` value: `'catering_confirmed'` |

## How to extend

- **Add another mailbox:** the code is single-mailbox (`GMAIL_USER`). Supporting
  a second address would mean parameterizing the sync/send functions by
  mailbox and running the cron per-mailbox, or looping over a list.
- **The deferred OTA-log case:** once a real GetYourGuide/Viator
  FareHarbor-direct confirmation email exists, the natural extension point is
  a new Ghost `kind` (e.g. `ota_booking_log`) registered in
  `src/lib/ghost/agents.ts` — the `agent_proposals` schema needs no migration
  for a new kind, per the existing design.

## Dependencies

Depends on: `src/lib/chat/shadow-drafter.ts` (Ghost pipeline, unmodified),
`supabase/migrations/070_customer_chat.sql` (contacts/conversations/messages
schema), `src/lib/google-ads/auth.ts` (the OAuth pattern this mirrors).

Nothing in the existing webchat flow depends on this — it's purely additive.
