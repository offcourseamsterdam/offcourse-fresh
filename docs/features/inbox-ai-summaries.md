# Inbox AI Summaries

## What was built

A one-line AI (Haiku) summary of each conversation's latest inbound email,
shown in the admin inbox list instead of the raw email body. Real emails —
especially OTA notifications from Withlocals/GetMyBoat — are full of
marketing boilerplate, tracking links, and unsubscribe footers that make a
raw-body snippet useless at a glance ("Booking requests - get my boss..." /
long tracking URLs). The summary focuses on concrete facts (date, time, guest
count, deadline) and folds in whatever Ghost's own pipeline already found or
did for that message (an availability check result, a drafted reply, a
catering classification), so the list reflects the full picture at a glance.

## Key files

- `src/lib/gmail/summarize.ts` — `summarizeInboundEmail({subject, bodyText,
  context})`. One Haiku call via `meteredMessage`, forced through a
  `submit_summary` tool for a structured, length-capped result. Fails closed
  (returns `null` on any error) — the list falls back to the raw snippet.
- `src/lib/gmail/sync.ts` — after the catering/OTA/reply-draft branch runs for
  a message, builds a `context` string from whatever that branch found (e.g.
  `handleOtaMessage`'s return value) and calls `summarizeInboundEmail`,
  writing the result to `conversations.ai_summary`.
- `supabase/migrations/115_ai_summary.sql` — `conversations.ai_summary text
  NULL`.
- `src/app/[locale]/admin/inbox/ConversationList.tsx` — renders `c.ai_summary
  ?? c.snippet`, plus a real checkmark/cross icon driven by
  `c.ota_available` (structured data, not AI prose) for OTA rows.

## Architecture decisions

**Why the prompt explicitly forbids restating the activity type or
availability in prose.** The inbox list already shows a separate "Booking
request · Withlocals" type label above the summary line, and a real
checkmark/cross icon next to it. Early versions of the summary said things
like "New booking request for Private Canal Cruise... Availability: ✓
bookable" — redundant with what's already on screen. The `submit_summary`
tool's field description now explicitly tells the model to skip both and lead
straight with the facts that aren't shown elsewhere (date, time, guest count,
deadline).

**Why the checkmark/cross icon is NOT part of the AI summary text.** Whether
a slot is bookable is a real tool result (`checkOtaAvailability`, see
`docs/features/ota-notifications.md`), not something worth trusting an LLM to
restate accurately in a sentence. `conversations.ota_available` is stamped
directly from that tool result and rendered as an icon — the summary text
never needs to say "bookable" at all.

**Why best-effort / fail-closed, not blocking ingestion.** A summarization
failure (rate limit, API hiccup) must never stop a real email from being
saved and processed — `summarizeInboundEmail` catches its own errors and
returns `null`; `syncGmailInbox` just skips the `ai_summary` update and the
list falls back to the raw snippet, same UX as before this feature existed.

## How it works

1. After a message is inserted and the catering/OTA/reply-draft branch runs,
   `syncGmailInbox` has a `ghostContext` string describing what happened
   (or `null` if nothing did).
2. `summarizeInboundEmail({subject, bodyText, context: ghostContext})` runs a
   single Haiku call with a forced tool call, returning a capped-length
   summary or `null`.
3. If non-null, `conversations.ai_summary` is updated for that conversation.
4. The inbox list reads `ai_summary ?? snippet` — no fallback logic needed on
   the client, the server always decides what's shown.

## How to extend

Adding a new fact type to the summary (e.g. surfacing catering line items
once that's parseable) means: build the richer `context` string in
`sync.ts`'s catering/OTA branch, and the existing prompt already knows to
fold in "what our own system already found/did about this" — no prompt
rewrite needed unless the new fact type also needs its own "don't restate
this in prose, it's shown as an icon" rule.

## Dependencies

- Depends on: `CLAUDE_DRAFTER_MODEL` (Haiku) + `meteredMessage` (existing AI
  cost-metering infra, same one every other Ghost drafter call uses).
- Depended on by: nothing else yet — this is purely a list-view convenience,
  not read by any other feature.
