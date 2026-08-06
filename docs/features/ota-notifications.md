# OTA Notification Emails (Withlocals, GetMyBoat, GetYourGuide)

## What was built

Withlocals and GetMyBoat send transactional notification emails to the shared
inbox (`info@withlocals.com` etc.) when a guest requests or confirms a booking
through their platform. FareHarbor itself sends a *third* kind of notification
(`messages@fareharbor.com`) whenever a 3rd-party API integration — so far,
GetYourGuide — creates a booking directly inside FareHarbor with no website
checkout involved. Before this feature, Gmail sync treated every inbound
email the same way: create/find a contact for the sender, then hand it to
Ghost's `draftShadowReply` to draft a reply "the team would send."

That's wrong for all three on two counts:
1. **The sender is not the customer.** `info@withlocals.com`/
   `messages@fareharbor.com` are relay/system addresses — the actual guest is
   unknown (Withlocals), only a first name (GetMyBoat), or fully named but
   never the sender (FareHarbor's own notification).
2. **There's nothing to reply to.** You act on the platform, or on our own
   database — not by sending an email. Drafting a "reply you'd send" for
   these is meaningless — an earlier version of this feature did exactly that
   before being corrected.

Now, these emails are detected, grouped by booking reference (not by Gmail
thread — see below), and produce a **read-only fact block plus, where there's
a real action, a one-click button** in `agent_proposals` instead of a reply
draft:
- A **new booking request** (Withlocals/GetMyBoat) → live FareHarbor
  availability is checked for the requested date/guest count, written as an
  `ota_availability` proposal.
- A **booking confirmed** on Withlocals/GetMyBoat (guest already paid on the
  platform, nothing exists in FareHarbor yet) → an `ota_booking_ready`
  proposal with a **"Create booking"** button that deep-links into the manual
  booking tool, pre-filled with what's already known.
- A **FareHarbor-native booking** (GetYourGuide today) — the booking already
  exists in FareHarbor, just not in our own database — → a
  `fh_booking_import_ready` proposal with an **"Import booking"** button that
  inserts the matching row directly, no FareHarbor round trip. See
  `src/lib/fareharbor/import-booking.ts`.

The inbox sidebar (`ConversationList`) shows a **Chat / OTA** toggle (each
independently on/off, with a live count) so these notifications don't clutter
the real-customer conversation list, and OTA rows get a clock (waiting),
checkmark (confirmed), or download (needs import) icon instead of the plain
channel icon.

## Key files

- `src/lib/ota/detect.ts` — `detectOtaEmail()`. Recognizes Withlocals/GetMyBoat/
  FareHarbor notification emails by sender + subject/body pattern, hand-built
  per platform and grounded in real emails already seen (not guessed from
  documentation). Extracts `bookingRef`, `guestName`, `guestEmail`,
  `guestPhone`, `endTime`, `parsed` (date, time, `dateISO`, guests,
  `experienceName`). The last four fields only `detectFareharborNotification`
  populates — they're what `import-booking.ts` needs to build a `bookings` row
  without a live FareHarbor call.
- `src/lib/ota/check-availability.ts` — `checkOtaAvailability()`. Reuses the
  same `fetchSearchResults`/`compactAvailability` Ghost's own chat tool uses —
  no separate availability logic to maintain. Only used for `new_request`.
- `src/lib/ota/handle-message.ts` — `handleOtaMessage()`. The actual branch:
  `new_request` → check availability + `ota_availability` proposal + stamp
  `conversations.ota_status = 'waiting'`; `confirmed` → `ota_booking_ready`
  proposal + `ota_status = 'confirmed'`; `needs_import` →
  `fh_booking_import_ready` proposal + `ota_status = 'needs_import'`; `other`
  → no action, left as a plain undrafted conversation for a human to handle.
- `src/lib/fareharbor/import-booking.ts` — `importFareharborBooking()`. Builds
  a `bookings` row straight from a `needs_import` notification's own fields.
  Deliberately does NOT re-fetch the booking live from FareHarbor first — the
  only endpoint that could (`FareHarborClient.getBookings()`, the date-range
  list) 404s against the real API, a pre-existing bug invisible until this
  feature became its first caller that doesn't silently swallow the error (its
  other caller, `findExistingBooking` in `client.ts`, does exactly that).
  `booking_uuid` is left null and the FareHarbor pk goes in `external_id`
  instead, since fh-consistency's `getBooking(uuid)` would 404 on a pk
  mistaken for a uuid. Money is left at 0 — see Architecture decisions.
- `src/lib/utils.ts` — `amsterdamTimeToUtcIso()`. The reverse of
  `formatAmsterdamTime`: wall-clock Amsterdam date+time (what a
  human-readable notification gives us) → correct UTC ISO, DST-aware.
- `src/lib/gmail/sync.ts` — `findOrCreateConversation()` groups by
  `(ota_source, ota_booking_ref)` instead of Gmail's `threadId` when a booking
  ref is present; `syncGmailInbox()` calls `handleOtaMessage` instead of
  `draftShadowReply` whenever `detectOtaEmail()` returns non-null.
- `src/app/[locale]/admin/inbox/ConversationList.tsx` — Chat/OTA toggle pill +
  clock/checkmark/download row icon; the `Pending` status tab now displays as
  "Waiting" (label only — the underlying `status` value is still `pending`).
- `src/app/[locale]/admin/inbox/ContextPane.tsx` — `OtaBookingReadyCard`
  ("Create booking", deep-links into the manual tool) and `FhImportReadyCard`
  ("Import booking", calls the `import_fh_booking` proposal action directly).
- `src/app/api/admin/ghost/proposals/[id]/route.ts` — the `import_fh_booking`
  action: same atomic-claim shape (`shadow`→`booking`→`executed`, released
  back to `shadow` on failure) as `book`/`correct_booking`. On success, fires
  `syncShiftsForRange` for the imported date via `after()` so Scheduling picks
  it up immediately.
- `supabase/migrations/112_ota_conversations.sql`, `113_ota_guest_name.sql`,
  `114_ota_status.sql` — `conversations.ota_source`, `ota_booking_ref`,
  `ota_guest_name`, `ota_status`.

## Architecture decisions

**Why booking-reference grouping instead of Gmail threading?** A single
real-world booking generates multiple *separate* (non-threaded) Gmail
messages from the same OTA — a request, then later a confirmation. Threading
by Gmail's `threadId` would put them in two different inbox conversations,
losing the connection between "someone asked" and "someone paid." Grouping by
`(ota_source, ota_booking_ref)` collapses them into one conversation instead.
GetMyBoat exposes no clean reference, so it falls back to normal thread-based
grouping (its emails naturally thread via "RE:").

**Why hand-built regex detection instead of an LLM classifier?** Per Beer:
"I will slowly teach you how I should reference them" — this is deliberately
an evolving, human-curated pattern library, one real email at a time, not a
free-form classifier. Recognizing *which* email this is needs to be 100%
predictable (like a mailroom clerk sorting by letterhead); Ghost's actual AI
reasoning is reserved for deciding what to do once sorted (checking real
availability), which is where an LLM genuinely adds value.

**Why no LLM call, no `draftShadowReply`, for either OTA kind?** Both
proposal kinds are built directly from data already fully structured by
`detectOtaEmail()` plus a live FareHarbor lookup — there's no ambiguity for an
LLM to resolve, and (per the "what was built" section above) there's no
customer-facing reply to draft. Keeping this path deterministic also means
it's cheap and instant, unlike the agentic loop.

**Why a persisted `ota_status` column instead of deriving it from
`agent_proposals` on every list poll?** The inbox list is polled every 10s;
joining/aggregating proposal history per row on every poll would be needless
work for a fact that only changes twice (request → confirmed) per booking.
`handleOtaMessage` stamps it directly on the conversation row it already
knows about.

## How it works

1. Gmail sync fetches a new message, calls `detectOtaEmail({fromEmail,
   subject, bodyText})`.
2. If it matches a known OTA pattern, `findOrCreateConversation` groups it by
   booking reference (or thread, for GetMyBoat) and stamps
   `ota_source`/`ota_booking_ref`/`ota_guest_name` on the conversation.
3. After the message is saved, `syncGmailInbox` calls `handleOtaMessage`
   instead of `draftShadowReply`:
   - `new_request` → `checkOtaAvailability` hits real FareHarbor availability
     for the parsed date/guest count, writes an `ota_availability` proposal.
   - `confirmed` → writes an `ota_booking_ready` proposal (no availability
     check — the booking is already made on the OTA's side; nothing exists in
     FareHarbor yet).
   - `needs_import` → writes a `fh_booking_import_ready` proposal (no
     availability check either — the booking already exists in FareHarbor;
     the gap is our own database).
4. The inbox sidebar shows the conversation under the "OTA" toggle with a
   clock (waiting), checkmark (confirmed), or download (needs import) icon,
   independently togglable against "Chat" (real customer conversations), each
   with a live count.
5. For `ota_booking_ready`/`fh_booking_import_ready`, the Ghost co-pilot pane
   shows a button: "Create booking" deep-links into the manual FareHarbor
   tool (Withlocals/GetMyBoat — nothing exists yet, a human still picks the
   real listing/slot); "Import booking" calls `import_fh_booking` directly
   (GetYourGuide today — the booking already exists, so there's nothing to
   pick, just insert).

## Known gap (not yet built)

Boat Local's FareHarbor CSV export shows the same "Boat Local - API"
affiliate shape GetYourGuide's notification email uses, so its own
notification likely follows the same "New Booking ... Created by: ... API"
template — but that's UNVERIFIED until a real one arrives; `detect.ts`'s
`platformFromAffiliate` deliberately doesn't extend to it on that guess alone.

`FareHarborClient.getBookings()` (the date-range bookings list) 404s against
the real API. It's not on the hot path for anything today — `import-booking.ts`
was written to route around it entirely, and its only other caller
(`findExistingBooking`, used by `createBookingIdempotent`'s dedup check)
silently swallows the failure and falls through to `createBooking()` — so this
has likely been silently broken for a while. Worth its own investigation.

## How to extend

To add a new OTA platform whose guest pays THEM first (Withlocals/GetMyBoat
shape — nothing in FareHarbor yet):
1. Get one real notification email from it.
2. Add a `detectXyz()` function to `detect.ts` following the existing
   `detectWithlocals`/`detectGetMyBoat` pattern — sender check, subject/body
   regex extraction, grounded only in that real email.
3. Add a case to `detectOtaEmail()`'s dispatch, and add the new platform to
   `OTA_PLATFORM_NAME` (also in `detect.ts` — the one place that maps a
   platform id to its display name, read by both the inbox list and the
   co-pilot cards).
4. Add fixtures + tests to `detect.test.ts` using the real email body.
5. No changes needed to `handle-message.ts`, `sync.ts`, or the UI beyond step
   3 — they're otherwise platform-agnostic over `OtaDetection`.

To add a new 3rd-party-API affiliate FareHarbor already has the booking for
(the GetYourGuide/`needs_import` shape — Boat Local is the obvious next
candidate once a real email arrives):
1. Get one real "New Booking ... Created by: {X} API" email from FareHarbor.
2. Add the affiliate string match to `platformFromAffiliate` in `detect.ts`,
   and the platform to `OTA_PLATFORM_NAME`.
3. Add a fixture + tests to `detect.test.ts` (mirror the GetYourGuide one).
4. `handle-message.ts`, `import-booking.ts`, and the UI are already
   platform-agnostic — no changes needed beyond step 2, same as above.

## Dependencies

- Depends on: `src/lib/search/fetch-search-results.ts` +
  `src/lib/ghost/tools.ts`'s `compactAvailability` (availability check reuses
  Ghost's existing tool, not a parallel implementation) — `new_request` only.
- Depends on: `src/lib/scheduling/sync-shifts.ts`'s `syncShiftsForRange` — the
  `import_fh_booking` action fires it so an imported booking gets picked up by
  Scheduling immediately, same hook every other booking-confirmation path uses.
- Depended on by: nothing yet outside the inbox.
