# Post-cruise review & recommendations SMS (Twilio)

## What was built

A branded SMS sent to guests after their cruise: a curated map of Amsterdam food & drink
spots, plus a direct link to leave a TripAdvisor review — in English, always, with a
personalized first-name greeting. It can be triggered two ways:

- **Manual** — a "Review SMS" button on any booking row in `/admin/bookings` opens a modal
  showing the exact rendered message and phone number, editable before sending.
- **Automatic** — a daily cron finds cruises that just ended and either sends the SMS itself
  (if `review_sms_auto_send` is on) or posts a Slack DM proposal to Beer listing what's ready
  (the default).

Both links in the message (`/r/map`, `/r/review`) are first-party branded short URLs that
302-redirect to admin-configurable destinations and log click analytics — so the destinations
can change without ever re-sending old messages, and clicks are trackable.

## Key files

- [`supabase/migrations/112_review_sms_and_short_urls.sql`](../../supabase/migrations/112_review_sms_and_short_urls.sql) —
  adds `recommendations_map_url`, `tripadvisor_review_url`, `review_sms_template`,
  `review_sms_enabled`, `review_sms_auto_send` to `google_reviews_config`; adds
  `review_sms_sent_at`, `review_sms_phone`, `review_sms_sid` to `bookings` (idempotency +
  audit trail); creates `short_url_clicks` (RLS on, service-role only).
- [`src/lib/sms/format-message.ts`](../../src/lib/sms/format-message.ts) — `formatReviewSms()`
  renders the template (`{firstName}`, `{listingTitle}`, `{mapUrl}`, `{reviewUrl}` tokens) and
  `extractFirstName()` (first word of `customer_name`, falls back to `"there"`). Always English,
  regardless of the booking's locale.
- [`src/lib/sms/urls.ts`](../../src/lib/sms/urls.ts) — the two branded short-link constants
  (`SITE_MAP_URL`, `SITE_REVIEW_URL`), shared by the admin route and the cron so both embed
  identical links.
- [`src/lib/twilio/client.ts`](../../src/lib/twilio/client.ts) — `sendTwilioSms()` (Basic Auth
  REST call to the Messages API; mocks the send and logs to console when
  `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` aren't set, so local dev never needs real
  credentials) and `normalizePhoneNumber()` (E.164 normalization — handles Dutch `06...`,
  `00` international prefix, and already-formatted numbers with spaces/hyphens/parens).
- [`src/app/r/[code]/route.ts`](../../src/app/r/[code]/route.ts) — the `/r/map` and `/r/review`
  redirector. Reads the destination from `google_reviews_config` at request time and logs a
  row to `short_url_clicks` (slug, destination, hashed IP, user agent) before 302-ing.
- [`src/app/api/admin/reviews/route.ts`](../../src/app/api/admin/reviews/route.ts) +
  [`src/components/admin/GoogleConfigBar.tsx`](../../src/components/admin/GoogleConfigBar.tsx) —
  admin settings: the two destination URLs, the SMS template editor (blank = hardcoded
  default), and the enabled/auto-send toggles.
- [`src/app/api/admin/bookings/[id]/review-sms/route.ts`](<../../src/app/api/admin/bookings/[id]/review-sms/route.ts>) —
  `GET` returns a rendered preview (message, normalized phone, already-sent status) for one
  booking; `POST` sends via Twilio and stamps `review_sms_sent_at` as an idempotency guard
  (409 on a second send unless `force: true` is passed).
- [`src/components/admin/booking-actions/SendReviewSmsModal.tsx`](../../src/components/admin/booking-actions/SendReviewSmsModal.tsx) —
  the manual-send modal, wired into
  [`BookingDetailRow.tsx`](../../src/components/admin/BookingDetailRow.tsx) alongside the
  existing Edit/Reschedule/Catering/Cancel actions.
- [`src/app/api/cron/post-cruise-sms/route.ts`](../../src/app/api/cron/post-cruise-sms/route.ts) —
  the daily cron (registered in [`vercel.json`](../../vercel.json), `0 21 * * *`, 21:00 UTC ≈
  late evening Amsterdam, after same-day cruises have ended).

## Architecture decisions

**Two branded short links instead of raw URLs in the SMS.** `/r/map` and `/r/review` resolve
their destinations from `google_reviews_config` at click time, not at send time. This means
the recommendations map or the review URL can be updated later — swap the TripAdvisor link
for a Google Business Profile link, change the curated map — without touching a single SMS
already sent. Click analytics (`short_url_clicks`) come for free as a side effect of owning
the redirect.

**Idempotency on the booking, not a separate log table.** `bookings.review_sms_sent_at` is the
single source of truth for "was this SMS sent" — both the manual route and the cron check and
set it. A `force: true` override on the manual `POST` allows a deliberate resend (e.g. the
first attempt bounced) without needing a separate "allow resend" flag.

**Once-daily cron, not the 15–30 min cadence the original design assumed.** This project is on
the Vercel Hobby plan, which caps cron frequency at once/day (the same constraint documented in
`pending-fh-sweep`). A tight rolling window would miss most cruises entirely, so the cron looks
back 48 hours instead of a narrow few minutes — wide enough to survive a missed run, safe
because `review_sms_sent_at` prevents any double-send no matter how many times a booking falls
inside that window across successive daily runs.

**Slack proposal is DM-only text with a link into `/admin/bookings`, not a Block Kit button.**
`postSlackOps()` (see the "Slack Notification Routing" section of the root `CLAUDE.md`) posts
plain text to Beer's DM. There's no admin-authenticated one-click send from inside Slack itself
— "one-click" in the original design means one click to land on `/admin/bookings`, where the
existing "Review SMS" button does the rest. Building a true Slack-button send flow (with its
own signature verification) was out of scope.

**No alphanumeric Sender ID.** The Twilio client's fallback chain
(`TWILIO_FROM_NUMBER || TWILIO_SENDER_ID || 'Off Course'`) exists in case the account ever
registers `"Off Course"` as an alphanumeric sender, but as of this build no such sender ID is
registered in the Twilio account. `TWILIO_FROM_NUMBER` is always set (a real Dutch number,
`+3197006532242` — the same number already earmarked for voice + WhatsApp, at Beer's request
to consolidate on one number rather than juggling several), so the alphanumeric fallback is
currently dead code that only activates if `TWILIO_FROM_NUMBER` is ever unset.

**Migration written well before it was actually applied.** `112_review_sms_and_short_urls.sql`
existed on disk (uncommitted) for a while before this session ran it against the live database
via the Supabase Management API — `src/lib/supabase/types.ts` had already been generated
against the intended schema, which masked the gap until the manual-send modal returned
"Booking not found" for every real booking (the `review_sms_*` columns genuinely didn't exist
yet, so the Postgres error was swallowed by the route's generic 404). Fixed by running the
migration for real and adding a `console.error` on the swallowed query-error branch in the
route so a future schema mismatch surfaces instead of reading as "not found."

## How it works

```
Manual (admin):
  "Review SMS" button on a booking row
    → GET .../review-sms → preview: rendered message, normalized phone, already-sent?
    → admin edits phone/message if needed → POST .../review-sms
    → sendTwilioSms() → stamp review_sms_sent_at/phone/sid on the booking

Automatic (cron, daily 21:00 UTC):
  SELECT bookings
    WHERE status IN (confirmed, booked)
      AND review_sms_sent_at IS NULL
      AND end_time BETWEEN (now - 48h) AND now
  → review_sms_enabled = false?  → skip entirely, no Slack noise
  → review_sms_auto_send = true? → sendTwilioSms() per booking, stamp columns,
                                    one Slack summary (sent N, M failed) if anything happened
  → review_sms_auto_send = false (default)
                                 → one Slack DM: "N cruises finished — review SMS ready to
                                   send" + a link into /admin/bookings, listing each guest
```

`/r/map` and `/r/review` (hit whenever a guest taps a link in the SMS):

```
GET /r/[code] → look up destination in google_reviews_config
             → log a row to short_url_clicks (slug, destination, ip_hash, user_agent)
             → 302 redirect
```

## How to extend

- **Change the default SMS copy** — edit `DEFAULT_SMS_TEMPLATE` in `format-message.ts`, or set
  a custom template per-account via the admin Reviews settings (blank reverts to the hardcoded
  default).
- **Add a new short link** — extend the `/r/[code]` route's slug handling and add the matching
  destination column to `google_reviews_config`; follow the same pattern as
  `recommendations_map_url`/`tripadvisor_review_url`.
- **Move to true auto-send** — flip `review_sms_auto_send` on in the admin Reviews tab. No code
  change needed; the cron already branches on it.
- **Tighten the send window** — if the Vercel plan ever moves off Hobby and cron can run more
  than once/day, shrink `LOOKBACK_MS` in the cron route accordingly (currently 48h to survive a
  missed once-daily run).

## Dependencies

- Depends on `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (live in
  `.env.local`; `TWILIO_SENDER_ID` is defined but currently unused — see the Architecture
  Decisions note above) and `CRON_SECRET` (pre-existing, shared with every other cron).
- Depends on `postSlackOps()` from `src/lib/slack/send-notification.ts` (Beer's DM only, per
  the project's Slack routing rules) and `notifyBookingsChanged()` for realtime admin refresh
  after an auto-send.
- The admin Reviews tab ([`admin-performance.md`](admin-performance.md) area,
  [`src/app/[locale]/admin/reviews/`](<../../src/app/[locale]/admin/reviews/>)) is the only
  place the two destination URLs, the template, and the two toggles are configured — there's no
  seed/default row assumption beyond the migration's column defaults
  (`review_sms_enabled = true`, `review_sms_auto_send = false`).
