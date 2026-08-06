# Voice inbox channel (Twilio)

Voice is the fourth channel in the unified inbox, alongside webchat, email,
and WhatsApp. v1 scope is deliberately simple, per
`docs/plans/unified-inbox-and-comms.md` §7: **"no missed customer, every call
logged" — not a call center.**

## What it does

A customer calls `TWILIO_VOICE_NUMBER`. Twilio rings **two things at once**:
Beer's laptop (a browser softphone built into the admin panel) and his real
phone (`TWILIO_MY_PHONE_NUMBER`). Whoever answers first gets the call; the
other stops ringing. If neither answers, the caller hears a short greeting
and can leave a voicemail, which gets transcribed and dropped into
`/admin/inbox` as a conversation — same as every other channel, matched to
the caller's contact by phone number.

**Status: code complete, no live number yet.** Unlike WhatsApp, Twilio has no
free "sandbox" number for Voice — buying one is a real purchase (~$1–8/mo
depending on country), which is Beer's call to make, not something done
automatically. Everything else (webhooks, the browser softphone, the Access
Token endpoint, the TwiML App) is built and already verified against Twilio's
real API — the softphone registers successfully right now, it just has no
phone number routed to it yet.

## Key files

- `src/lib/twilio/verify-signature.ts` — shared signature check, originally
  built for WhatsApp, now used by every Twilio webhook (Voice included).
- `src/lib/twilio/canonical-url.ts` — reconstructs the exact request URL
  (path + query string) for signature verification. WhatsApp's webhook has no
  query params so it kept its own fixed-path version; Voice's status/recording
  callbacks carry a `conversationId` query param, so they need the real
  request URL, not a hardcoded one.
- `src/lib/twilio/inbox-match.ts` — `findOrCreateContactByPhone` /
  `findOrCreateConversationByContact`, shared by WhatsApp and Voice (both are
  phone-based channels with no thread concept — one continuous conversation
  per contact, not per message/call).
- `src/app/api/webhooks/twilio-voice/route.ts` — "a call comes in" webhook.
  Logs the call, returns `<Dial><Client>beer</Client><Number>...</Number></Dial>`.
- `src/app/api/webhooks/twilio-voice/status/route.ts` — the `<Dial>`'s
  `action` callback. `completed` → log how long the call lasted. Anything
  else (no-answer/busy/failed/canceled) → voicemail greeting + `<Record>`.
- `src/app/api/webhooks/twilio-voice/recording/route.ts` — handles both the
  recording-ready callback (saves `messages.recording_url`) and the
  transcription-ready callback (voicemail only — replaces the placeholder
  message body with the transcript, then hands the conversation to
  `draftShadowReply` like any other inbound message).
- `src/app/api/admin/voice/token/route.ts` — issues a Twilio Voice Access
  Token (`identity: 'beer'`, hardcoded — see below) for the browser softphone.
- `src/components/admin/VoicePhone.tsx` — the softphone itself, mounted once
  in the admin layout so it's live on every admin page. Invisible until a
  call actually rings; shows Answer/Decline, then Mute/Hang up once connected.
- `supabase/migrations/111_voice_calls.sql` — `messages.recording_url`.

## Why `identity: 'beer'` is hardcoded

This is a one-person softphone, not a multi-agent call center — Beer
explicitly scoped ring-through to "just my phone," not multiple staff lines.
A real per-admin identity scheme (so a skipper could also answer from their
own laptop) is a v2 concern if that need shows up; not worth the complexity
until it does.

## Why the `twilio` npm package is used here too

Already justified for WhatsApp's signature verification (see
`whatsapp-twilio-integration.md`); Voice reuses the same rationale for TWO
more things: `twilio.validateRequest` (identical signature check, now
shared), and `twilio.jwt.AccessToken` / `VoiceGrant` for the browser
softphone's token. Hand-rolling a JWT signer for the second one would be
pure risk for zero benefit — this is the officially documented, primary use
case for the client-side half of the `twilio` package.

## Setting up a real number (what Beer needs to do)

1. **Buy a voice-capable number** — Twilio Console → Phone Numbers → Buy a
   number. Netherlands mobile numbers are ~$7.70/mo and need an address on
   file (standard Dutch regulatory requirement); US local numbers are ~$1.15/mo
   with no address requirement but are a foreign number for Amsterdam
   customers. Your call.
2. **Point the number's "A call comes in" webhook** at
   `https://<your-domain>/api/webhooks/twilio-voice` (POST) — same
   public-HTTPS-URL requirement as the WhatsApp sandbox webhook.
3. **Set the env vars** (`.env.local`):
   ```
   TWILIO_VOICE_NUMBER=+31...          # the number you just bought
   TWILIO_MY_PHONE_NUMBER=+31...       # your real mobile — the ring-through target
   ```
   `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` / `TWILIO_TWIML_APP_SID` are
   already provisioned (created via the REST API during this build, not the
   console) — no action needed unless they're rotated/deleted.
4. Call the number — it should ring the browser softphone (if an admin tab is
   open) and `TWILIO_MY_PHONE_NUMBER` at the same time.

## Known limitations (deliberate, deferred)

- **No outbound calling UI.** The softphone can *receive* calls but there's no
  "call this customer back" button yet — the TwiML App's `VoiceUrl` and
  `outgoingApplicationSid` grant are wired for it, but the UI isn't built.
- **No business-hours logic.** Calls ring through 24/7; the plan's
  "business hours vs. after-hours voicemail" distinction isn't implemented —
  every unanswered call goes to voicemail regardless of time.
- **Single ring target.** Only `TWILIO_MY_PHONE_NUMBER` — no ring group for
  multiple skippers (Beer explicitly scoped this to "just my phone" for v1).
- **No call-quality monitoring** (Twilio's per-number quality rating, dropped
  calls, etc.) — fine at this volume, worth watching once real traffic shows up.

## Tests

- `src/app/api/webhooks/twilio-voice/route.test.ts` — happy path (logs the
  call, TwiML rings Client + configured number), invalid signature (403),
  missing From/CallSid (400), unconfigured ring target (apology TwiML, never
  attempts to log the call), duplicate CallSid on retry (still rings through).
- `src/app/api/webhooks/twilio-voice/status/route.test.ts` — `completed`
  logs duration; `no-answer`/`busy`/`failed`/`canceled` all fall back to a
  voicemail `<Record>`; invalid signature and missing `conversationId` guards.
- `src/app/api/webhooks/twilio-voice/recording/route.test.ts` — transcript
  saved + Ghost invoked; failed transcription still logs a fallback note
  without invoking Ghost; a plain recording-ready callback (no transcription)
  saves just the URL; invalid signature and missing `conversationId` guards.
- `src/app/api/admin/voice/token/route.test.ts` — token issuance with the
  right grant shape, the admin auth guard, and the unconfigured-env 503.
