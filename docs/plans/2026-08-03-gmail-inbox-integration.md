# Gmail Inbox Integration — Implementation Plan

**Goal:** Add Gmail as a new inbound/outbound channel for the existing customer-chat
inbox, so email lands as a `conversation` and the existing, unmodified Ghost
(`draftShadowReply`) pipeline drafts replies/booking proposals for it exactly like
it already does for webchat.

**Architecture:** A 2-minute cron polls `cruise@offcourseamsterdam.com` via the raw
Gmail REST API (no `googleapis` SDK — matches this repo's existing no-SDK OAuth
pattern in `google-ads/auth.ts`), finds-or-creates a `contact`/`conversation`
(channel `'email'`, grouped by Gmail `threadId`), inserts each new message
(`provider: 'gmail'`, `provider_message_id` = Gmail's message id, relying on the
existing `UNIQUE` constraint for idempotent re-polls), then calls the **existing**
`draftShadowReply()` — zero changes to Ghost's decision logic. Outbound replies get
one new branch in the existing "send message" route: when `conversation.channel ===
'email'`, send via the Gmail API instead of just storing a row.

**Explicitly out of scope (deferred):** the GetYourGuide/Viator "already booked in
FareHarbor via their direct connection, just log it with the right net-rate" case —
no existing code to hook into, matching key still unresolved (Beer: "not sure yet").
Ships as its own pass once a real example email exists.

**Tech stack:** raw Gmail REST API via `fetch` (no new npm dependency), Vitest,
Supabase.

---

### Task 1 — Migration: `conversations.provider_thread_id`

Gmail threads carry their own `threadId`; without storing it, every reply in an
email conversation would need to re-derive which thread it belongs to. One
additive column, nullable (webchat/whatsapp/voice conversations don't use it).

```sql
-- supabase/migrations/108_gmail_thread_id.sql
ALTER TABLE conversations ADD COLUMN provider_thread_id text NULL;
```

Apply via the Management API command in CLAUDE.md, then regenerate
`src/lib/supabase/types.ts` the same way.

### Task 2 — Env vars

Add to `src/env.ts` (next to the other Google vars, `z.string().optional()` like
`GOOGLE_ADS_REFRESH_TOKEN`) and `.env.example`:
- `GMAIL_REFRESH_TOKEN` — the refresh token for `cruise@offcourseamsterdam.com`,
  scoped to `gmail.readonly` + `gmail.send`. Reuses `GOOGLE_OAUTH_CLIENT_ID/SECRET`
  (same fallback pattern as `google-ads/auth.ts`).
- `GMAIL_USER` — the mailbox address (`cruise@offcourseamsterdam.com`), used as the
  Gmail API's `userId` path segment and the `From` header on sends.

### Task 3 — One-time OAuth consent script

**Files:** Create `scripts/gmail-oauth-setup.ts`

Neither existing Google OAuth client in this repo has ever had its consent step
scripted (confirmed — none exists for Ads or the never-built Reviews-reply
feature); the refresh tokens were obtained manually outside the codebase. This
script is the first one, and Beer needs to actually run it and click through
Google's consent screen — I cannot do that part.

```ts
// scripts/gmail-oauth-setup.ts
// One-time: run `npx tsx scripts/gmail-oauth-setup.ts` to get a URL, open it
// while logged into cruise@offcourseamsterdam.com, approve, then run again with
// the ?code= value from the redirect to exchange it for a refresh token.
import { createServer } from 'node:http'

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID!
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET!
const REDIRECT_URI = 'http://localhost:8945/oauth-callback'
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send']

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in your shell env first.')
  process.exit(1)
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
authUrl.searchParams.set('client_id', CLIENT_ID)
authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
authUrl.searchParams.set('response_type', 'code')
authUrl.searchParams.set('scope', SCOPES.join(' '))
authUrl.searchParams.set('access_type', 'offline')
authUrl.searchParams.set('prompt', 'consent') // force a refresh_token even on repeat consent

console.log('\n1. In Google Cloud Console, confirm this OAuth client has')
console.log(`   ${REDIRECT_URI} in its Authorized redirect URIs (add it if not).\n`)
console.log('2. Open this URL while logged into cruise@offcourseamsterdam.com:\n')
console.log(authUrl.toString())
console.log('\n3. Waiting for the redirect on http://localhost:8945 ...\n')

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, REDIRECT_URI)
  const code = url.searchParams.get('code')
  if (!code) {
    res.end('No code in redirect — check the console for errors.')
    return
  }
  res.end('Done — check your terminal for the refresh token.')
  server.close()

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  const json = await tokenRes.json()
  if (!tokenRes.ok) {
    console.error('Token exchange failed:', json)
    return
  }
  console.log('\nSUCCESS — paste this into .env.local as GMAIL_REFRESH_TOKEN:\n')
  console.log(json.refresh_token)
  console.log()
})
server.listen(8945)
```

**Step for Beer, not for me:** run this, add the redirect URI in Google Cloud
Console if prompted, approve consent as `cruise@offcourseamsterdam.com`, paste the
printed refresh token into `.env.local`.

### Task 4 — `src/lib/gmail/auth.ts`

Byte-for-byte the same shape as `google-ads/auth.ts` (module-cached access token,
single `fetch` to the token endpoint, fail loudly if unconfigured) — just reading
`GMAIL_REFRESH_TOKEN` instead of `GOOGLE_ADS_REFRESH_TOKEN`. No new test needed
beyond what mirrors `google-ads/auth.ts`'s own coverage (checked: it currently has
none either — consistent, not a gap I'm introducing).

### Task 5 — `src/lib/gmail/client.ts` (list, get, send, MIME)

Raw Gmail REST API (`https://gmail.googleapis.com/gmail/v1/users/{GMAIL_USER}/...`),
`Authorization: Bearer <getAccessToken()>`. Four functions:

- `listNewMessages(query: string): Promise<{id: string, threadId: string}[]>` —
  `GET .../messages?q=<query>`, paginate via `nextPageToken` if present.
- `getMessage(id: string): Promise<GmailMessage>` — `GET .../messages/{id}?format=full`.
  Parse `payload.headers` for `From`/`Subject`/`Message-ID`; walk `payload.parts`
  recursively for the first `text/plain` part (fallback: strip tags from
  `text/html` if no plain part), base64url-decode with `Buffer.from(data, 'base64url')`.
- `sendReply({threadId, to, subject, body, inReplyToMessageId}): Promise<{id: string}>` —
  looks up the original message's `Message-ID` header via `getMessage` (metadata
  format) if `inReplyToMessageId` given, composes a raw RFC 2822 message (`To`,
  `From`, `Subject`, `In-Reply-To`, `References`, `Content-Type: text/plain;
  charset=utf-8`, blank line, body), base64url-encodes it, `POST .../messages/send`
  with `{raw, threadId}`.
- `extractSenderEmail(fromHeader: string): {email: string, name: string}` — parses
  `"Jane Doe <jane@example.com>"` / bare `jane@example.com` forms.

**Test:** `src/lib/gmail/client.test.ts` — mock `fetch`, cover: plain-text body
extraction, HTML-only fallback, nested multipart (multipart/mixed containing
multipart/alternative), sender-header parsing (both forms), send composes the
correct raw message and includes `In-Reply-To`/`References` when given a source
message id.

### Task 6 — `src/lib/gmail/sync.ts`

```
export async function syncGmailInbox(): Promise<{ imported: number; skipped: number }>
```

1. `listNewMessages('in:inbox -category:promotions')` — per Beer: everything in
   the inbox except Promotions tab; Spam/Trash already excluded by `in:inbox`'s
   default search behavior.
2. For each message: `getMessage(id)`.
3. Find-or-create `contact` by sender email (mirrors `chat/start/route.ts:30-45`
   exactly — same dedup key, same "name may have changed" update).
4. Find-or-create `conversation`: first look for one with this `provider_thread_id`
   (any status — a resolved thread that gets a new reply should reopen, not
   duplicate); if none, fall back to an open/pending `channel:'email'` conversation
   for this contact (same fallback webchat uses); if still none, create new with
   `channel:'email'`, `provider_thread_id`, `subject` from the email Subject header.
5. Insert `messages` row: `direction:'in'`, `provider:'gmail'`,
   `provider_message_id: gmailId`. On a `23505` unique-violation (already ingested
   this message — a re-poll), catch and skip silently, don't count as an error
   (same pattern as the booking route's race-loser handling).
6. On successful insert, `await draftShadowReply(conversationId, insertedId)` —
   awaited directly (this runs inside a cron, not a request handler, so there's no
   `after()` available/needed — set `export const maxDuration = 60` on the cron
   route the same way the Stripe webhook does, since Ghost's LLM call can take a
   few seconds per message).
7. Update `conversations.last_message_at`/`unread_count`/`status:'open'` (reopens a
   resolved thread on a new inbound reply, matching the plan's stated workflow:
   "an inbound message reopens").

**Test:** `src/lib/gmail/sync.test.ts` — mock `@/lib/gmail/client` and
`@/lib/chat/shadow-drafter`, cover: new contact + new conversation + calls
draftShadowReply; existing contact reuses it; existing thread reuses conversation
by `provider_thread_id` even if status was `resolved` (reopens); duplicate
`provider_message_id` is skipped without calling draftShadowReply a second time;
promotions-category messages are never fetched (query string assertion).

### Task 7 — Cron route

**Files:** Create `src/app/api/cron/gmail-inbox-sync/route.ts` — copy the exact
shape of `getyourguide-reviews/route.ts` (`requireCronSecret` → try/catch →
`alertCronFailure`), delegating to `syncGmailInbox()`. Add `export const
maxDuration = 60`.

**Test:** `route.test.ts` mirroring `getyourguide-reviews`'s own test conventions
(or `pending-fh-sweep`'s `vi.hoisted` table-aware mock style, whichever the actual
GYG test file — if one exists — already uses; check before writing to avoid a
second, inconsistent convention).

Register in `vercel.json`:
```json
{ "path": "/api/cron/gmail-inbox-sync", "schedule": "*/2 * * * *" }
```

### Task 8 — Outbound send via Gmail

**Files:** Modify `src/app/api/admin/inbox/conversations/[id]/messages/route.ts`

- Widen the conversation `select` to `id, status, channel, provider_thread_id` and
  join `contacts.email` (need the recipient address) — check how the existing
  `conversation_id` → contact join is done elsewhere in this file/admin routes for
  the right query shape (a `contacts!inner(email)` embed or a second query).
- After inserting the `messages` row (still `direction:'out'`), if
  `conversation.channel === 'email'`: look up the most recent inbound message's
  `provider_message_id` in this conversation (for `In-Reply-To`), call
  `sendGmailReply({ threadId: conversation.provider_thread_id, to: contactEmail,
  subject: conversation.subject, body: parsed.message, inReplyToMessageId })`. On
  success, `UPDATE messages SET provider='gmail', provider_message_id=<sent id>,
  status='sent' WHERE id=<inserted id>`. On failure, `UPDATE ... SET
  status='failed', error=<message>` and surface the failure to the caller (`apiError`)
  rather than silently pretending it sent — an email reply that silently doesn't
  send is the exact failure mode the original inbox plan calls out as worst-case.
- Webchat/other channels: completely unchanged (existing early-return-style logic
  stays as the default path).

**Test:** extend the existing test file for this route (check if one already
exists at this path first) with: email-channel send success → Gmail send called
with the right thread/recipient, message row updated with the returned id;
email-channel send failure → message row marked `failed`, route returns an error
(not a silent 200); webchat-channel behavior is byte-identical to before (regression
guard — this is the one existing test suite this change could break).

### Task 9 — Docs

Per CLAUDE.md's mandatory rule: `docs/features/gmail-inbox-integration.md` +
`docs/features/README.md` entry, before considering this done.

### Task 10 — Verification

1. `npm test` — full suite green.
2. `npx tsc --noEmit` — clean.
3. Beer completes the OAuth consent step (Task 3), fills in `GMAIL_REFRESH_TOKEN`.
4. Manually trigger the cron once against a real test email sent to
   `cruise@offcourseamsterdam.com`, confirm it appears in `/admin/inbox` as an
   email conversation with a Ghost-drafted reply proposal, and that clicking
   "send" actually delivers to the real inbox and threads correctly.
