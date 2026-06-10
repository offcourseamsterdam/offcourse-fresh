# Plan — Unified Inbox, AI Booking Agent & Customer Support (Email · WhatsApp · Voice)

**Status:** plan, not yet built. **Owner decisions needed:** §10.
**Prerequisite:** Foundation phase (§2) — the job queue and webhook plumbing the
June 10 audit flagged as the #1 gate for async features.

---

## 1. The big picture

One **inbox** inside the admin where everything a customer (or OTA) sends you
lands as a *conversation*: GetYourGuide/TripAdvisor/Withlocals booking emails,
WhatsApp messages, phone calls (as recordings + transcripts), and later
web chat. On top of it, an **AI booking agent** that reads OTA emails, checks
real FareHarbor availability, and asks a human: *"GYG booking, 4 guests,
Sat 21 June 14:00 — Diana is free. Confirm?"* One click → booking created
through the **existing** booking endpoint.

```
GYG / TripAdvisor / Withlocals ──email──▶ Gmail ─┐
Customer ──WhatsApp──▶ Twilio ───────webhook──┐  │ (API poll or forward)
Customer ──phone call──▶ Twilio Voice ──webhook─┤  │
                                              ▼  ▼
                                   ┌─────────────────────┐
                                   │  webhook_logs (raw,  │  ← idempotency
                                   │  signature-verified) │
                                   └──────────┬──────────┘
                                              ▼  (queue job)
                                   ┌─────────────────────┐
                                   │ conversations +      │ ← Supabase
                                   │ messages + contacts  │   Realtime → UI
                                   └──────────┬──────────┘
                              ┌───────────────┼────────────────┐
                              ▼               ▼                ▼
                       /admin/inbox     AI booking agent   Slack alert
                       (reply, assign)  (parse → check FH  (approve link)
                                         → propose)
                                              ▼ human clicks Confirm
                                   POST /api/admin/booking-flow/book
                                   bookingSource: 'getyourguide' (EXISTS)
```

### What we already own (verified in code)

| Need | Already exists |
|---|---|
| Create OTA booking (FH + Supabase + Slack + email) | `api/admin/booking-flow/book` — `PLATFORM_SOURCES = ['withlocals','clickandboat','getyourguide','tripadvisor']` (route.ts:33), behind `requireAdmin` |
| Availability check | `getFilteredAvailability(listingId, date, guests)` in `lib/fareharbor/availability.ts` |
| AI text parsing | `@anthropic-ai/sdk` wired in `lib/ai/*` (Claude, server-only) |
| Google OAuth refresh-token flow | `lib/google-ads/auth.ts` — same pattern for Gmail API scope |
| Live UI updates | Supabase Realtime (on the stack, unused so far) |
| Inbound-webhook audit table | `webhook_logs` — typed in `lib/supabase/types.ts`, table not yet created (orphaned scaffolding the audit said to wire) |
| Alerting | `postSlackText` + `alertCronFailure` |
| Webhook signature reference | Stripe + Outscraper verifiers (per-provider pattern to generalize into `src/lib/webhooks/`) |

---

## 2. Phase 0 — Foundation (build FIRST, ~1 week)

Everything below is asynchronous and external. Without this layer it will
*mostly* work and silently lose messages when it doesn't.

1. **Job queue — Inngest** (recommended over QStash: built-in retries,
   step functions, delayed jobs, dev UI; free tier covers this volume).
   Every inbound webhook handler does only: verify signature → insert
   `webhook_logs` row → enqueue job → return 200 in <2s. All real work
   (AI parsing, sending, FH calls) happens in jobs with automatic retries
   and dead-letter alerts to Slack.
2. **`webhook_logs` table** (migration; the generated type already matches):
   `provider`, `provider_event_id` (UNIQUE — dedupe key), `payload` jsonb,
   `signature_valid`, `processed_at`, `error`. Twilio retries on non-2xx and
   Gmail can deliver duplicates — this table is what makes retries harmless.
3. **`src/lib/webhooks/` verifiers**: `verifyTwilio(request)` (HMAC-SHA1 of
   exact public URL + sorted POST params, `X-Twilio-Signature`),
   `verifyPostmark/Mailgun` (if inbound email provider is used). Same
   fail-closed style as `require-cron-secret.ts`.
4. **Sentry** — the audit's standing recommendation; non-negotiable once
   customer messages flow through background jobs.

---

## 3. Data model (one migration)

```
contacts        id, name, email, phone_e164, locale, notes,
                created_at — UNIQUE on email, UNIQUE on phone_e164
conversations   id, channel ('email'|'whatsapp'|'voice'|'webchat'),
                contact_id FK, subject, status ('open'|'pending'|'resolved'),
                assignee_profile_id, ota_source null|'getyourguide'|…,
                booking_id FK null, wa_window_expires_at timestamptz null,
                last_message_at — indexes on (status,last_message_at), contact_id
messages        id, conversation_id FK, direction ('in'|'out'),
                body, html null, media jsonb null,
                provider ('gmail'|'twilio_wa'|'twilio_voice'|…),
                provider_message_id UNIQUE null,   ← idempotency
                status ('received'|'queued'|'sent'|'delivered'|'read'|'failed'),
                error null, created_at — index (conversation_id, created_at)
agent_proposals id, conversation_id FK, extracted jsonb (zod-validated),
                listing_id FK, avail_pk, availability_result jsonb,
                status ('proposed'|'approved'|'rejected'|'expired'|'booked'),
                approved_by, booking_id FK null, created_at
ota_product_mappings  ota ('getyourguide'|…), ota_product_ref text,
                listing_id FK, default_customer_type_name text
                — UNIQUE (ota, ota_product_ref)
```

RLS on all; service-role only (same posture as bookings). Calls are
conversations with channel='voice'; each call is one message with
`media = { recording_url, duration, transcript }`.

---

## 4. Email ingestion (Gmail)

**Recommended: Gmail API polling, every 2 minutes, via cron + existing OAuth.**

- Reuse the `google-ads/auth.ts` refresh-token pattern with scope
  `gmail.readonly` (+ `gmail.send` for replies). One-time consent for the
  support Gmail account; store the refresh token server-side (NOT in a
  table with anon access — lesson from audit finding #3, since fixed).
- Cron (`requireCronSecret`) lists messages matching
  `from:(getyourguide.com OR tripadvisor.com OR withlocals.com) OR label:support`,
  newer than the last sync cursor. Each Gmail `message.id` →
  `messages.provider_message_id` (UNIQUE) so re-polls are no-ops.
- Replies are sent **through the Gmail API** (not Resend) so they thread
  correctly and come from the same address the customer wrote to.

Why polling, not push: Gmail push needs Google Cloud Pub/Sub plus a watch
that expires every 7 days (one more thing to break silently). A 2-minute
poll is indistinguishable from instant for OTA bookings and support email,
and it reuses crons + OAuth we already run. Revisit push only if volume
makes polling wasteful.

*Alternative (no Gmail API at all):* Gmail filter → auto-forward to an
inbound address at Postmark/Mailgun → webhook. Simpler to start, but replies
won't come from the Gmail address and forwarding mangles some OTA emails —
acceptable fallback, not the recommendation.

---

## 5. AI booking agent (human-in-the-loop)

Pipeline per inbound email (one Inngest job chain):

1. **Classify** (Claude, cheap call): `booking_request | booking_change |
   cancellation | question | other`. Non-booking → plain inbox item.
2. **Extract** (Claude with strict JSON schema, zod-parsed — same rigor as
   the money path): `{ ota, ota_ref, product_ref, date, time, party_size,
   customer: {name,email,phone}, notes, confidence }`. Low confidence or
   schema failure → inbox item flagged "needs human read", never guessed.
3. **Map product** via `ota_product_mappings` (unmapped → flag + Slack;
   admin adds the mapping once, agent retries).
4. **Check availability**: `getFilteredAvailability(listing_id, date,
   party_size)` — the same 3-layer-filtered truth the website uses.
5. **Propose**: insert `agent_proposals`, then notify with full context:
   - **Slack**: "📧 GYG · 4 guests · Sat 21 Jun 14:00 · Diana free at 14:00
     → [Review & confirm](admin/inbox/…)" (link, not button — no Slack
     interactive-app surface needed in v1).
   - **Inbox**: proposal card on the conversation: extracted fields, the
     matching FH slots, one **Confirm booking** button + editable fields.
6. **Human clicks Confirm** → POST the **existing**
   `/api/admin/booking-flow/book` with `bookingSource: 'getyourguide'` etc.
   All FH validation, Supabase save, Slack notify, dedupe and alerting in
   that route are reused, untouched. Proposal → `booked`, conversation
   linked to the booking.
7. **No availability** → proposal card says so and offers nearest
   alternative slots; reply to the OTA stays human (v1).

**Autonomy ladder** (later, per-OTA setting): v1 always-ask → v2 auto-confirm
when confidence ≥ threshold AND availability unambiguous AND party ≤ N,
still posting to Slack with a 10-minute undo window → v3 auto-reply to OTA.
The ladder exists so trust is earned with an audit trail (`agent_proposals`
keeps every decision).

---

## 6. WhatsApp integration (the reliability deep-dive)

**Recommendation: WhatsApp through Twilio** (not Meta Cloud API directly).
One provider for WhatsApp + Voice + SMS = one signature scheme, one SDK, one
console, one status-callback pattern. Costs slightly more per conversation
than Meta direct; worth it at this volume.

**Setup reality (start this FIRST — it has lead time):** WhatsApp Business
requires a **dedicated phone number** (cannot be a number already bound to a
personal/Business-app WhatsApp) and **Meta business verification** of
Off Course, done through Twilio's console. Verification takes days to weeks.
Buy a Twilio number for it (or port a spare); display name approval is part
of the flow.

### Inbound (customer → you)
- Webhook `/api/webhooks/twilio/whatsapp`:
  1. `verifyTwilio()` — HMAC-SHA1 over the **exact public URL** (mind
     trailing slashes/query strings — the #1 cause of "signature invalid")
     + sorted POST params. Fail-closed.
  2. Upsert `webhook_logs` on `MessageSid` (UNIQUE) — Twilio retries
     non-2xx deliveries, so duplicates are expected, and this makes them free.
  3. Enqueue job; **return 200 immediately** (Twilio timeout is 15s; never
     do AI/DB-heavy work inline).
  4. Job: upsert contact by phone, find-or-create open conversation, insert
     message, **set `wa_window_expires_at = now() + 24h`** (every inbound
     message reopens the free-form reply window), Realtime pushes it to the
     inbox UI, optional Slack ping if no agent online.
- Media (images/voice notes): Twilio media URLs require auth and expire —
  job downloads and re-stores in Supabase Storage, link in `messages.media`.

### Outbound (you → customer) — where reliability is won or lost
- **All sends are queue jobs**, never direct from the request handler:
  retry ×3 with exponential backoff on 5xx/timeouts; permanent-error codes
  short-circuit; final failure → message `status='failed'` + Slack alert
  (a support reply that silently doesn't send is the worst failure mode).
- **The 24-hour window rule** (the thing that breaks naive integrations):
  you may send free-form messages only within 24h of the customer's last
  inbound message. Outside it, only **pre-approved templates**.
  - UI enforces it: composer checks `wa_window_expires_at`; expired →
    free-form disabled, template picker shown ("Sorry we missed you…",
    "About your booking on {{date}}…"). Submit templates for approval
    during setup week — approval takes a few days.
  - Belt-and-braces: the send job also checks, and maps Twilio error
    63016 (outside window) → flag conversation "window expired — template
    needed" instead of dumb retries.
- **Status callbacks**: every send includes a `StatusCallback` URL; handler
  updates `queued→sent→delivered→read` / `failed` on `messages` by
  `MessageSid`. Callbacks arrive **out of order** — only ever move status
  forward (rank statuses, ignore regressions). Agents see ✓✓ like in the
  real app; `failed` shows inline with the error reason.
- **Quality rating**: Meta scores the number; mass unsolicited templates →
  rate-limited or blocked. Templates only for service notifications, no
  marketing blasts from this number, monitor the rating in console weekly.

### Failure-mode table (what makes it "reliable")

| Failure | Handling |
|---|---|
| Vercel down when Twilio delivers | Twilio retries on error; plus configure the number's **fallback URL** (see §7) |
| Duplicate webhook delivery | `MessageSid` UNIQUE in `webhook_logs` + `messages` → no double messages |
| Send fails transiently | Queue retry w/ backoff |
| Send fails permanently | `failed` status visible in thread + Slack alert |
| Reply outside 24h window | UI prevents; job maps 63016 → template prompt |
| Status callbacks out of order | Forward-only status transitions |
| Media link expired | Downloaded to own storage at ingest time |
| Forged webhook | Signature verification, fail-closed |

---

## 7. Twilio Voice (phone calls)

**v1 scope — deliberately simple:** the goal is *no missed customer, every
call logged*, not a call center.

- **One Twilio number** (can be the same as WhatsApp's). Inbound call →
  `/api/webhooks/twilio/voice` returns TwiML:
  - Business hours: `<Dial>` Beer's/skipper's phones (simultaneous ring,
    20s timeout), `record="record-from-answer"` if announced in greeting.
  - No answer / after hours: voicemail — `<Say>` greeting (the brand voice:
    "you've reached your friend with a boat…") + `<Record>` with
    `transcribe` callback.
- **Every call becomes an inbox conversation** (channel='voice'): caller
  matched to contact by number, recording + Twilio transcription attached;
  optional Claude pass turns the transcript into a 2-line summary + intent
  ("wants Saturday, 6 people").
- **Missed-call automation** (queue job): no answer + no voicemail →
  auto-WhatsApp template "Hi, you just called Off Course — how can we
  help?" (this is also the cheapest way to convert phone leads into a
  written, AI-assistable channel).

### The voice reliability trick: static fallback
Webhooks for voice are *synchronous* — if your endpoint is slow or down,
**the call drops**. Two Twilio-native safeguards make this near-unkillable:

1. **Fallback URL** on the phone number → a **TwiML Bin** (static XML hosted
   *by Twilio*, zero dependency on Vercel) that simply forwards the call:
   `<Response><Dial>+31… </Dial></Response>`. Vercel deploy broken? Calls
   still ring your phone. This single setting is the difference between
   "outage = annoyed customers" and "outage = we take calls like before".
2. **Answer fast**: the voice webhook does signature check + return TwiML
   only; call logging/transcript handling happens via async status
   callbacks (`StatusCallback` + recording/transcription callbacks → queue).

Same idempotency story as WhatsApp: `CallSid` unique, callbacks
forward-only.

### 7b. Voice UI & answering model (how Beer actually picks up)

There are three ways a human can be on the other end of a Twilio call.
Be honest about what each can and cannot do:

| Mode | How it rings | Works away from laptop? | Verdict |
|---|---|---|---|
| **A. Forward to personal phone** (PSTN `<Dial><Number>`) | Native phone call: lock screen, ringtone, car Bluetooth, smartwatch | ✅ Always | **v1 default — the reliable backbone** |
| **B. Browser softphone** (Twilio Voice JS SDK / WebRTC in `/admin`) | Rings inside the open browser tab | ❌ Mobile browsers can't reliably ring: iOS/Android won't wake a background tab for an incoming WebRTC call, no native call screen, audio routes like a website not like a phone call | **Desktop-only, Phase 4b** |
| **C. Native app w/ CallKit** | Like a real phone app | ✅ | Overkill — not planned |

**Mobile browser reality check (the answer to "can I answer in the admin
on my phone?"):** no — and it's a platform limit, not an effort limit.
A web page can only receive a WebRTC call while it is open, foregrounded,
and awake. Phones aggressively freeze background tabs, and the web has no
access to the native incoming-call UI. Anyone selling "browser call
answering on mobile" is really selling missed calls. The personal-phone
leg (A) IS the mobile experience — and it's better than anything we could
build, because the OS treats it as what it is: a phone call.

**v1 — Mode A with two refinements:**

1. **Call screening (whisper).** The `<Dial>` to Beer's personal number
   uses a screening URL: when he picks up, *he* (not the customer) hears
   "Off Course call from +44… — press 1 to accept." Two reasons:
   - He knows it's business before saying "with Beer!" to a stranger.
   - **The voicemail-swallow gotcha:** without screening, if his phone is
     off, his *personal* voicemail "answers" the call — Twilio sees a
     human pickup, and the customer leaves a message in Beer's private
     voicemail instead of the business one. Screening means an answer
     only counts when a key is pressed; otherwise Twilio falls through to
     the business voicemail + transcript + inbox flow.
2. **Ring order config** stored in a small `voice_settings` table
   (editable in admin): list of numbers, simultaneous vs sequential,
   per-day business hours, holiday override ("all voicemail").

**Outbound from a phone — the callback trick (no WebRTC needed):**
"Call customer" button in the inbox, tapped on Beer's phone browser:
1. API asks Twilio to **call Beer's personal phone first** (native ring).
2. He answers — hears "connecting you to Sarah, GYG booking Saturday".
3. Twilio dials the customer and bridges the legs.
4. Customer's screen shows the **business number**, the call is recorded
   and logged to the conversation like any other.
So his personal phone is just the *handset*; identity, recording, and
logging stay with the business line. This works from any device that can
tap a button — no microphone-in-browser involved.

**Phase 4b — desktop softphone (nice-to-have, after everything else):**
Twilio Voice JS SDK in the admin shell. A presence toggle ("Available in
browser") includes a `<Client>` leg in the simultaneous ring alongside the
phone legs — whoever answers first wins, Twilio cancels the rest. Incoming-
call banner shows caller, matched contact, their bookings; answer/decline/
mute; notes typed during the call save to the conversation. If the tab is
closed nothing is lost — the phone leg still rings. The softphone is
sugar; the phone leg is the guarantee.



---

## 8. Admin inbox UI (`/admin/inbox`)

- **List pane**: conversations, filter chips (channel · status · assigned to
  me), unread counts; built on `useAdminFetch` + **Supabase Realtime**
  subscription on `messages` for live updates (first Realtime use in the
  app — client component subscribes to postgres_changes, no server infra).
- **Thread pane**: bubbles (in/out), per-message delivery status, call
  entries with audio player + transcript, internal notes (visible to team
  only), AI proposal cards with the Confirm flow (§5).
- **Composer**: channel-aware — email reply via Gmail API (threads
  correctly), WhatsApp free-form vs template picker per the 24h window,
  voice = click-to-call later.
- **Context sidebar**: contact, their bookings (match by email/phone),
  linked OTA proposal, quick links.
- Sidebar nav: replace the `customers` "coming soon" entry with **Inbox**
  (badge: open conversation count — same pattern as the catering badge).
- New modals/forms ride the `AdminFormModal` + `useAdminSave` foundation.

---

## 9. Phasing, effort, costs

| Phase | What | Effort | Blocked by |
|---|---|---|---|
| 0 | Inngest + Sentry + `webhook_logs` + `lib/webhooks` verifiers | ~1 wk | — |
| 0b | **Start in parallel, day 1:** Twilio account, number, WhatsApp sender + Meta business verification, template approval | clock time, not work time | — |
| 1 | Data model + `/admin/inbox` UI + Realtime | 1.5–2 wk | 0 |
| 2 | Gmail ingestion + AI booking agent (human-in-the-loop) | 1.5–2 wk | 1 |
| 3 | WhatsApp inbound/outbound + status callbacks + window logic | 1–1.5 wk | 0b, 1 |
| 4 | Voice: TwiML routing, voicemail, transcripts, missed-call → WhatsApp, fallback TwiML Bin | ~1 wk | 3 |
| 5 | Autonomy ladder v2 (auto-confirm w/ guardrails), AI reply drafts | ~1 wk | 2 live for a few weeks |

**Running costs (rough):** Twilio number ~$1–5/mo · WhatsApp conversations
~€0.05–0.15 each (Meta fees + Twilio markup) · Voice ~$0.01–0.02/min +
recording storage · Inngest free tier → ~$20/mo later · Claude parsing
pennies per email · Sentry free tier. Order of magnitude: **tens of euros
per month**, dominated by call minutes and WhatsApp volume.

---

## 10. Decisions needed from Beer

1. **WhatsApp number**: dedicated new number, or port something? (Cannot be
   a number already on personal/Business-app WhatsApp.)
2. **Which Gmail account** is the support inbox, and is it Google Workspace
   (smoother OAuth verification) or plain Gmail?
3. **Who gets the proposal pings** — Slack channel only, or also WhatsApp to
   you?
4. **Call routing**: whose phones ring, in what order, what are "business
   hours"?
5. **Confirm autonomy v1**: agent never books without a human click —
   agreed? (Plan assumes yes.)
6. Twilio-for-WhatsApp vs Meta direct: plan recommends Twilio (one
   provider); veto if you'd rather save per-message fees with Meta direct.
