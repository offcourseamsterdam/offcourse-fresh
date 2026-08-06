# WhatsApp inbox channel (Twilio)

WhatsApp is now a third channel in the unified inbox, alongside webchat and
email — same `contacts` / `conversations` / `messages` tables (no new schema:
`channel = 'whatsapp'` and `phone_e164` were already there, per
`docs/plans/unified-inbox-and-comms.md` §3, written before any of this was
built), same Ghost drafting pipeline, same admin UI.

**Status: Sandbox only.** Off Course hasn't gone through Meta business
verification yet, so this runs on Twilio's **WhatsApp Sandbox** — a shared
test number every Twilio account can use immediately, no approval needed.
Production WhatsApp (a dedicated number, Off Course's own display name) is a
separate, later step — see "Going to production" below.

## What was built

- **Inbound**: `src/app/api/webhooks/twilio-whatsapp/route.ts` — Twilio POSTs
  here for every message sent to the sandbox number. Verifies the
  `X-Twilio-Signature`, upserts the contact by phone, finds-or-creates the
  WhatsApp conversation for that contact, saves the message, and hands off to
  the same `draftShadowReply` every other channel uses — Ghost drafts a reply,
  a human approves/sends it in `/admin/inbox`, exactly like email and webchat.
- **Outbound**: `src/lib/whatsapp/client.ts` (`sendWhatsappMessage`), wired
  into the existing reply endpoint
  (`src/app/api/admin/inbox/conversations/[id]/messages/route.ts`) as a third
  branch alongside webchat and Gmail.
- **Signature verification**: `src/lib/twilio/verify-signature.ts` (shared —
  originally built here, since moved to a Twilio-generic location when the
  Voice channel needed the identical function; see
  `voice-twilio-integration.md`). Uses the `twilio` npm package's own
  `validateRequest` for this one function — the rest of the codebase avoids
  provider SDKs (Gmail, FareHarbor, Google Ads are all raw `fetch`), but
  Twilio's own docs explicitly warn against a manual implementation: they add
  webhook params without notice, and URL/query-string encoding edge cases are
  the most common cause of "signature invalid" bugs. Getting this wrong
  either lets forged requests through or locks out every real one, so this is
  the one place a small, targeted dependency was worth it over hand-rolling
  it. (Confirmed to have a lean footprint — `twilio` added ~22 packages; it
  does not introduce any new high/critical `npm audit` findings, which are
  all pre-existing in the Vercel CLI toolchain.)

## Key files

- `src/lib/twilio/verify-signature.ts` + `.test.ts` — `verifyTwilioSignature()`
  (shared with Voice).
- `src/lib/whatsapp/client.ts` + `.test.ts` — `sendWhatsappMessage()`,
  `WhatsappWindowClosedError`.
- `src/lib/whatsapp/window.ts` + `.test.ts` — `formatWindowRemaining()`, the
  24h-countdown formatter shown in the inbox.
- `supabase/migrations/110_whatsapp_window.sql` — `conversations.wa_window_expires_at`.
- `src/app/api/webhooks/twilio-whatsapp/route.ts` + `.test.ts` — inbound webhook.
- `src/app/api/admin/inbox/conversations/[id]/messages/route.ts` — outbound
  `whatsapp` branch (mirrors the existing `email` branch).

## How it works

### Inbound

1. Twilio POSTs form-encoded params (`From`, `Body`, `MessageSid`,
   `ProfileName`, …) to `/api/webhooks/twilio-whatsapp`.
2. The signature is checked against the **exact** URL configured in the
   Twilio console (`NEXT_PUBLIC_SITE_URL` + this path) — a mismatch (trailing
   slash, wrong domain) fails closed with 403 before anything is written.
3. Contact matched/created by `phone_e164` (the `whatsapp:` prefix is
   stripped). Conversation matched by `(contact_id, channel='whatsapp')` — WhatsApp has no
   thread concept like Gmail, so it's one continuous conversation per phone
   number, not per message thread.
4. The message is inserted with `provider_message_id = MessageSid` — the same
   UNIQUE-constraint idempotency gate as Gmail and Stripe. Twilio retries
   non-2xx responses, so redelivery is expected and must be free; a duplicate
   `MessageSid` returns 200 immediately without re-drafting.
5. `draftShadowReply` runs via `after()`, **not** inline — Twilio's webhook
   timeout is 15s and the Ghost's agentic loop can take several seconds. Gmail
   can afford to await it inline because that pipeline is a cron poll, not a
   live webhook with a clock running.
6. Every attempt (valid or not) is recorded via `logWebhookEvent` into
   `webhook_logs` — the same audit trail Stripe and Outscraper already write,
   so "did Twilio actually deliver this?" is answerable from our own DB.

### Outbound

The admin inbox reply endpoint already branched on `conversation.channel` for
Gmail; WhatsApp is now a second branch with the same shape: look up the
contact's phone, send, store the provider id, mark `failed` (not a silent
200) if the send throws.

**The 24-hour window** is WhatsApp's core reliability rule: you can only send
free-form messages within 24h of the customer's last inbound message; outside
it, only pre-approved templates work (Twilio error 63016). This isn't
enforced pre-emptively in the UI yet (see Known limitations) — but
`sendWhatsappMessage` throws a distinguishable `WhatsappWindowClosedError`,
and the reply route turns that into a plain-English error ("Outside the
24-hour WhatsApp session window — the customer needs to message first...")
instead of a bare Twilio error code, so whoever's replying immediately
understands why it didn't send.

## Setting up the Sandbox (what Beer needs to do)

This is account setup on Twilio's own console — Claude Code can't create
accounts or log into third-party consoles, so these steps are yours:

1. **Create a Twilio account** at twilio.com (free trial is enough for
   sandbox testing).
2. **Activate the WhatsApp Sandbox**: Console → Messaging → Try it out → Send
   a WhatsApp message. It shows the sandbox number (usually
   `whatsapp:+14155238886` — the same for every Twilio account) and your
   account's unique join code (e.g. "join happy-tiger").
3. **Join the sandbox from your own WhatsApp**: send that join message to the
   sandbox number from your phone. This opts your number into the trial for
   ~72 hours — you'll need to re-send the join message if it expires and you
   want to keep testing from the same phone.
4. **Set the env vars** (`.env.local`, never commit these):
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_WHATSAPP_NUMBER=+14155238886
   ```
   (`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` are shared with the existing SMS
   feature — `src/lib/sms/send-sms.ts` — if you've already set those up for
   guest-move SMS, you only need to add `TWILIO_WHATSAPP_NUMBER`.)
5. **Point the sandbox's inbound webhook at us**: in the same sandbox
   settings page, set "WHEN A MESSAGE COMES IN" to
   `https://<your-domain>/api/webhooks/twilio-whatsapp` (POST). This needs a
   **public HTTPS URL** — a deployed Vercel preview/production URL works;
   `localhost` does not, unless you tunnel it (e.g. ngrok) for local testing.
6. Message the sandbox number from your phone — it should show up in
   `/admin/inbox` as a new WhatsApp conversation within a few seconds, with a
   Ghost-drafted reply ready to review.

## The 24h window countdown

`conversations.wa_window_expires_at` (migration `110_whatsapp_window.sql`) is
set to `now() + 24h` by the inbound webhook on every WhatsApp message —
never touched by outbound sends, only by what the customer actually sends.
`src/lib/whatsapp/window.ts` (`formatWindowRemaining`, pure + unit-tested)
turns that into "23h 42m to reply" or "Window closed — needs a template",
shown as a live-ticking badge in the `ThreadPane` header (updates every 30s,
no extra API polling) for WhatsApp conversations only. This closes the gap
where `WhatsappWindowClosedError` only told you the window closed *after* a
send failed — now it's visible before you try.

## Known limitations (deliberate, deferred)

- **No media support.** `MediaUrl0`/`NumMedia` aren't read yet — an image or
  voice note from a customer is silently dropped from `Body` (Twilio still
  delivers the webhook; we just don't store the attachment). Twilio media
  URLs need auth and expire, so this needs its own storage-download step —
  real work, not a quick add.
- **No 24h-window UI.** The composer doesn't show "window closes in Xh" or
  disable free-text proactively — you find out only when a send fails with
  the window-closed message. Fine for low-volume sandbox testing; worth
  building before real customer traffic.
- **No delivery status callbacks.** Outbound messages don't track
  queued→sent→delivered→read; the admin only sees "sent" or "failed" at send
  time, not later delivery/read receipts.
- **No template message support.** Every send is free-form; there's no
  template picker for replying outside the 24h window (would require Meta
  template approval anyway, which needs business verification first).

## Going to production (post Meta verification)

Once Off Course completes Meta business verification (via Twilio's console —
takes days to weeks, needs a dedicated number that's never been used with the
personal/Business WhatsApp app): swap `TWILIO_WHATSAPP_NUMBER` to the real
number, point its webhook at the same `/api/webhooks/twilio-whatsapp` URL, and
everything above keeps working unchanged — the sandbox and a real WhatsApp
sender look identical to this integration. The remaining gaps (media,
templates, status callbacks, the 24h-window UI) become worth closing once real
customer volume shows up.

## Tests

- `src/lib/twilio/verify-signature.test.ts` — validates against an
  independently-computed HMAC-SHA1 signature (Twilio's documented algorithm,
  computed with Node's `crypto` directly, not just trusting the library),
  tampered params, mismatched URL, wrong auth token, missing signature.
- `src/lib/whatsapp/client.test.ts` — request shape (whatsapp: prefixing,
  Basic Auth), the 63016 → `WhatsappWindowClosedError` mapping, generic
  failures, missing env vars.
- `src/lib/whatsapp/window.test.ts` — hours/minutes formatting, sub-1h
  (drops the hours part), closed exactly at/after expiry, rounds up rather
  than showing "0m" while time remains, null when no window is set.
- `src/app/api/webhooks/twilio-whatsapp/route.test.ts` — happy path (new
  contact/conversation, deferred draft), reusing an existing conversation,
  invalid signature (403, no DB writes), missing fields (400), duplicate
  `MessageSid` (200, no re-draft), unexpected DB error (500, so Twilio
  retries), `wa_window_expires_at` set to ~24h out on every inbound message.
- `src/app/api/admin/inbox/conversations/[id]/messages/route.test.ts` — the
  new `whatsapp` branch: successful send, the window-closed error message,
  missing phone number, notes never attempt a send.
