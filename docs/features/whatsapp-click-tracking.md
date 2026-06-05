# WhatsApp Click Tracking

## What was built

The site has several WhatsApp entry points — the floating green bubble on every
page, the phone number in the footer, and the "chat to book" button that shows
on timeslots that require a phone booking. We now record every tap as a
first-party tracking event (`whatsapp_click`) and surface the result on the
admin **Performance** page (`/admin/statistics`) as **"WhatsApp Chats Started"**,
with a breakdown of which button people used.

This reuses the existing first-party tracking system (sessions + funnel events in
Supabase) — no third-party analytics, no extra cookies.

### How it counts

- **Once per session, per source.** A visitor who taps the floating bubble twice
  counts once; a visitor who taps the floating bubble *and* the footer counts
  once for each source. The total counts each session once even if it used
  several buttons.
- **Sources:** `floating_button`, `footer`, `chat_to_book`.
- Same caveats as the rest of the funnel: it's client-side, so it under-counts
  visitors with ad blockers, and it does not record taps before cookie consent
  (consistent with every other tracked event).

## Key files

| File | What changed |
|------|--------------|
| `supabase/migrations/056_whatsapp_click_event.sql` | **New.** Adds `whatsapp_click` to the `tracking_events.event_name` CHECK constraint. **Must be applied** before events will persist (see below). |
| `src/lib/tracking/constants.ts` | Added `whatsapp_click` to `TRACKING_EVENTS`. Deliberately *not* added to `FUNNEL_STEPS` — it's a side engagement event, like `no_availability`. |
| `src/lib/tracking/client.ts` | `trackEvent` gained an optional `dedupeKey` (so the same event can be counted separately per source within a session). New `trackWhatsAppClick(source)` helper + `WhatsAppSource` type. |
| `src/components/layout/WhatsAppButton.tsx` | Floating bubble fires `trackWhatsAppClick('floating_button')` on click. |
| `src/components/layout/WhatsAppLink.tsx` | **New.** Small client component for a tracked WhatsApp link, so server components (the footer) can keep server-rendering while the click is still tracked. |
| `src/components/layout/Footer.tsx` | Footer phone link now uses `<WhatsAppLink source="footer">`. |
| `src/components/booking/TimeSlotStep.tsx` | "Chat to book" timeslots fire `trackWhatsAppClick('chat_to_book')` before opening WhatsApp. |
| `src/lib/tracking/queries.ts` | New `aggregateWhatsAppClicks()` (pure, tested) + `getWhatsAppClicks()` query → unique-session counts total and per source. |
| `src/lib/tracking/queries.test.ts` | **New.** Unit tests for the aggregation logic. |
| `src/app/api/admin/tracking/overview/route.ts` | Overview endpoint now returns `whatsAppClicks`. |
| `src/app/[locale]/admin/statistics/page.tsx` | New "WhatsApp Chats Started" card with per-source breakdown bars. |

## Architecture decisions

- **Reuse the funnel system, not a new mechanism.** Off Course already has a
  privacy-conscious, first-party tracking pipeline (`sendBeacon` → `/api/tracking/event`
  → Supabase `tracking_events`). Adding one event name is far less surface area
  than wiring up a separate counter, and it inherits the existing bot filter,
  rate limiting, and consent handling for free.
- **`dedupeKey` instead of removing dedup.** Funnel events dedup to once per
  session by event name. WhatsApp needed once-per-session-*per-source*, so
  `trackEvent` now accepts an optional `dedupeKey` (default = event name). This
  keeps the existing behaviour untouched for every other caller.
- **Count unique sessions, not raw taps.** Matches how the rest of the funnel
  reads ("X sessions reached this step") so the number is comparable to the
  other dashboard metrics. Counting is done server-side over distinct
  `session_id`s, so it's robust even if a client somehow sends duplicates.
- **Pure aggregation split out.** `aggregateWhatsAppClicks()` is a pure function
  so the counting logic is unit-tested without mocking Supabase (per the project
  testing rules: test the logic, not the DB).

## How it works (data flow)

1. Visitor taps a WhatsApp button → `trackWhatsAppClick(source)` →
   `trackEvent('whatsapp_click', { source, path }, 'whatsapp_click:<source>')`.
2. `sendBeacon` posts to `/api/tracking/event`, which validates the event name
   against `TRACKING_EVENTS` and inserts a row into `tracking_events`.
3. Admin opens `/admin/statistics` → `/api/admin/tracking/overview` calls
   `getWhatsAppClicks()` → `aggregateWhatsAppClicks()` returns
   `{ total, bySource[] }`.
4. The page renders the total + a bar per source.

## How to extend

- **Add another WhatsApp entry point:** add a value to the `WhatsAppSource`
  union in `client.ts`, call `trackWhatsAppClick('<new_source>')` from the new
  button (or use `<WhatsAppLink source="<new_source>">`), and add a friendly
  label to `WHATSAPP_SOURCE_LABELS` in the statistics page. No DB change needed —
  the source lives in `metadata`.
- **Track a different outbound action** (e.g. phone-call taps): add the event
  name to `TRACKING_EVENTS` *and* a migration extending the CHECK constraint,
  then follow the same `trackEvent(..., dedupeKey)` pattern.

## Dependencies

- **Depends on:** the first-party tracking system (Track A) — sessions,
  `tracking_events`, consent cookies, `/api/tracking/event`.
- **Depended on by:** the admin Performance dashboard.

## ⚠️ Deployment note — apply the migration

`056_whatsapp_click_event.sql` must run against Supabase before clicks will be
stored. Until then the API silently rejects the new event (the CHECK constraint
fails and the insert is swallowed — tracking never breaks the UX). Apply it via
the Management API as described in `CLAUDE.md` (the `SUPABASE_MANAGEMENT_TOKEN`
was not available in the session that wrote this code, so it was not auto-applied).
No TypeScript type regen is needed — `event_name` is typed as `string`.
