# Customer Chat & Unified Inbox (Phase 1 — webchat)

## What was built

The first slice of the unified inbox from `docs/plans/unified-inbox-and-comms.md`:
a **customer chat widget** on the public site, and a **three-pane inbox** in the
admin where those conversations land. The data model is channel-agnostic on
purpose — email, WhatsApp, and voice (the plan's later phases) plug into the
same tables and the same UI as new `channel` values, not new features.

Think of it as a mailroom with many doors: this phase builds the mailroom
(contacts, conversations, messages + the inbox screens) and opens the first
door (webchat). Later doors reuse everything.

## Key files

| File | What it does |
|---|---|
| `supabase/migrations/070_customer_chat.sql` | `contacts`, `conversations`, `messages` tables; RLS on, no policies (service-role only) |
| `src/lib/chat/validate.ts` | Pure input validation for the public API (length caps, email/UUID shape) |
| `src/app/api/chat/start/route.ts` | Public: open a conversation (find-or-create contact by email, reuse open thread) |
| `src/app/api/chat/[token]/route.ts` | Public: poll messages / send a message, authenticated by the `webchat_token` URL secret |
| `src/components/chat/ChatWidget.tsx` | Floating chat bubble on the public site (all 7 locales; hidden on /admin + /captain) |
| `src/app/api/admin/inbox/conversations/route.ts` | Admin: conversation list with contact + latest-message snippet |
| `src/app/api/admin/inbox/conversations/[id]/route.ts` | Admin: full thread + contact + their bookings; PATCH status |
| `src/app/api/admin/inbox/conversations/[id]/messages/route.ts` | Admin: send a reply (`out`) or internal note (`note`) |
| `src/app/api/admin/inbox/open-count/route.ts` | Admin: open-conversation count for the sidebar badge |
| `src/app/[locale]/admin/inbox/page.tsx` | The three-pane shell (list · thread · customer), mobile drill-in |
| `src/app/[locale]/admin/inbox/ConversationList.tsx` | Left pane: status filter chips, unread dots, channel icons |
| `src/app/[locale]/admin/inbox/ThreadPane.tsx` | Middle pane: bubbles, amber internal notes, Reply/Note composer |
| `src/app/[locale]/admin/inbox/ContextPane.tsx` | Right pane: contact card, booking history, status workflow |
| `src/hooks/useAdminFetch.ts` | Gained optional `{ refreshInterval }` so the inbox polls itself fresh |
| `src/lib/utils.ts` | Gained `timeAgoShort()` ("2m", "1h", "3d") |

## Architecture decisions

- **Token-as-session for the widget.** The customer gets a `webchat_token`
  (UUID) stored in localStorage; knowing it = owning the conversation. Same
  pattern as the staff calendar feed — no accounts, no cookies, no login.
- **Internal notes live in `messages`** with `direction='note'` instead of a
  separate table. One thread query returns everything; the public API
  hard-filters to `in`/`out` so notes can never leak to the customer.
- **Polling, not Realtime (yet).** Widget polls every 5s, inbox list every
  10s, open thread every 5s. At Off Course volume this is indistinguishable
  from live and avoids the Realtime + RLS setup. The plan's Realtime upgrade
  can replace the intervals later without touching the data model.
- **`unread_count` is maintained, not computed.** Inbound writes increment
  it; opening the thread resets it. Cheaper than counting per-row read
  states, and one conversation has one reader team anyway.
- **Status workflow is automatic where it can be** (plan §8b): a reply flips
  `open → pending`, any customer message flips back to `open`. Resolved stays
  resolved until the customer writes again.
- **Bookings matched at read time** by contact email/phone against
  `bookings.customer_email/customer_phone` — no FK to maintain; history shows
  up even for bookings made before the chat existed.

## How it works

```
visitor → ChatWidget → POST /api/chat/start ──┐
        ← token (localStorage) ←──────────────┤ contacts (find-or-create by email)
visitor → POST /api/chat/{token} ─────────────┤ conversations (reuse open webchat thread)
widget  ← GET  /api/chat/{token} (poll 5s) ←──┘ messages (direction in/out — notes excluded)

admin   → /admin/inbox (poll 10s list, 5s thread)
        → POST …/{id}/messages {direction:'out'|'note'}   ← reply or margin note
        → PATCH …/{id} {status}                            ← open|pending|resolved
sidebar → GET /api/admin/inbox/open-count (badge, 30s)
```

## How to extend (adding a channel — the whole point)

1. Ingest: new webhook/cron writes to the same tables — upsert `contacts`
   (by email or phone), find-or-create a `conversations` row with the new
   `channel`, insert `messages` with `provider` + `provider_message_id`
   (the UNIQUE idempotency key — duplicate deliveries become no-ops).
2. Outbound: a send path keyed off `conversation.channel` in the messages
   POST route (webchat = store only; WhatsApp = Twilio call; email = Gmail).
3. UI: the panes already render any channel — add an icon in
   `ConversationList.tsx`'s `CHANNEL_ICON` map and channel-specific bubble
   touches in `ThreadPane.tsx` if needed.

## Dependencies

- Depends on: `requireAdmin`, `createAdminClient`, `apiOk/apiError`,
  `useAdminFetch`/`adminMutate`, bookings table (for history matching),
  next-intl messages (widget strings in all 7 locale files).
- Depended on by: future phases of the inbox plan (Gmail ingestion, AI
  booking agent, WhatsApp, voice) — all designed to land on these tables.
