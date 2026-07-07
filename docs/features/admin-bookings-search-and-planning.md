# Admin bookings search + Planning week view

## What was built

Two additions to the admin bookings experience, both prompted by a real incident: a confirmed booking (Artem Khomenko's) wasn't visible in the admin Bookings list right after it came in.

1. **Search box** on the Bookings list (`/admin/bookings`) — filters by guest name, email, phone, cruise/listing title, FareHarbor booking UUID, or Stripe PaymentIntent id. Case-insensitive substring match.
2. **Planning** (`/admin/planning`) — a new week-calendar view: 7 day columns (Mon–Sun), each showing that day's departures as time-ordered blocks. Each block shows the boat + duration (customer type), and one row per booking on that departure with guest name, guest count, food/drinks extras, guest note, and source — clicking a row opens the same booking-detail view used on the Bookings list, in a modal. Same-slot bookings (same date, time, listing, category, and customer type — e.g. several parties on one shared departure) collapse into a single block instead of one card each. Prev/next week navigation and a "Today" jump button. The "confirmed"/"booked" status badge is hidden since it's the default case for everything shown here; other statuses (e.g. still-processing) still show.

Also fixed: the Bookings list only refetched on a manual "Refresh" click (`revalidateOnFocus: false`, no polling) — a booking created while the page was already open, like Artem's, simply wouldn't appear until someone clicked Refresh. Both the Bookings list and Planning now update live, **event-based**: the moment the server actually writes to `bookings` (a webhook, an admin action, the recovery cron), it pings any open page over Supabase Realtime and the page refetches. No polling interval.

## Why the booking looked "missing"

It wasn't a data bug — the row was correctly in Supabase (`confirmed`, `paid`, created at 14:10). What the admin actually hit was the browser's own Cmd+F find-in-page, which searches whatever's currently in the DOM — and the DOM was showing a stale SWR-cached list from before the booking existed, because nothing was telling the page to refetch. Two fixes address this: the search box (a real, app-level search that always reflects current filtered data) and the event-based live update (so the underlying data itself doesn't go stale while the page sits open).

## Key files

- [`src/lib/admin/booking-search.ts`](../../src/lib/admin/booking-search.ts) — `matchesBookingSearch(booking, query)`, pure predicate, unit tested.
- [`src/lib/admin/week.ts`](../../src/lib/admin/week.ts) — week-boundary math (`getWeekStart`, `addDays`, `weekDateStrings`, `formatWeekRangeLabel`), all Amsterdam-local. Unit tested, including a precise-instant regression test (see below).
- [`src/app/[locale]/admin/planning/page.tsx`](../../src/app/[locale]/admin/planning/page.tsx) — the new week view. Reuses `/api/admin/bookings/local` (same data source, same SWR cache key as the Bookings list) and the existing `BookingDetailRow` component for the modal.
- [`src/lib/admin/planning-groups.ts`](../../src/lib/admin/planning-groups.ts) — `groupBookingsForPlanning(bookings)`, pure, unit tested. Groups by `(booking_date, start_time, listing_id, category, customer_type_name)` — applies uniformly to private and shared; private charters just end up as groups of one since there's no sibling booking on the same slot.
- [`src/app/[locale]/admin/bookings/page.tsx`](../../src/app/[locale]/admin/bookings/page.tsx) — added the search input and a "Week view" link to Planning.
- [`src/app/[locale]/admin/layout.tsx`](../../src/app/[locale]/admin/layout.tsx) — Planning nav item's `comingSoon` flag removed; it was a placeholder for exactly this feature.
- [`src/lib/realtime/bookings-channel.ts`](../../src/lib/realtime/bookings-channel.ts) — the shared channel/event name constants (safe for both server and client).
- [`src/lib/realtime/notify-bookings-changed.ts`](../../src/lib/realtime/notify-bookings-changed.ts) — server-side sender. A single fire-and-forget-shaped (but awaited) HTTP POST to Supabase Realtime's broadcast REST endpoint — no websocket held open inside the short-lived API route. Called from every place `bookings` is actually written: the Stripe webhook (payment_intent.succeeded × 2 — insert and confirm-flip —, checkout.session.completed, checkout.session.expired, charge.refunded), the admin booking-flow `/book` route, the `pending-fh-sweep` recovery cron (both the completed and refund-cancelled branches), and the admin cancel/rebook routes.
- [`src/hooks/useBookingsChangedSignal.ts`](../../src/hooks/useBookingsChangedSignal.ts) — client-side subscriber. Subscribes once per mount (via a ref, so an unstable `onChange` identity across renders doesn't cause resubscribes) and calls the provided callback on every `bookings_changed` broadcast.

## Bugs found and fixed while building this

**Week-boundary date math could produce `Invalid Date`.** Both the new `week.ts` and the pre-existing `date-filter.ts` (same author pattern, copied when I wrote `week.ts`) build a "midnight Amsterdam" `Date` from a Y/M/D by first constructing an ISO string like `2026-07--1T00:00:00`. That's invalid whenever `day` goes to 0 or negative — which happens in the `week` case whenever "today" is the 1st or 2nd of the month on the right weekday (`day - daysBack < 1`). An `Invalid Date` compared with `<` always evaluates `false`, so `date-filter.ts`'s "This week" filter would silently show *everything* instead of just this week on those dates — a real, if infrequent (a few days a year), silent bug. Fixed both by switching to the multi-arg `Date` constructor (`new Date(y, m, d)`), which normalizes out-of-range days correctly and needs no format string. Regression-tested in both `week.test.ts` and `date-filter.test.ts` with the exact failing date.

**A first version of the fix used `Date.UTC` instead** — which looked right (all tests passed) but was actually computing the wrong instant, just one that happened to still map to the correct calendar date in the coarse date-string tests I'd initially written. It broke silently for every *other* case once applied for real, because the dev machine's timezone is `Europe/Amsterdam`, not UTC, and the original code's offset trick depends on the runtime's local timezone matching how the string is parsed. Caught by running the full `date-filter.test.ts` suite (7 pre-existing tests failed), which is why the final fix uses the local multi-arg constructor instead. Added a precise-instant assertion (not just a date-string comparison) to `week.test.ts` so a similar wrong-but-same-looking-string bug can't slip through silently again.

**`BookingDetailRow` doesn't fit in a narrow container.** It's a wide, multi-column layout built for a full-width table row (`colSpan={10}` on the Bookings list). Reusing it inline inside a ~250px week-day column visually overlapped and was unreadable. Fixed by opening it in a modal instead (same overlay pattern as `AddCateringModal`), rather than trying to make the component itself responsive down to that width.

## Why broadcast, not Postgres Changes CDC

Supabase Realtime has two ways to do this: subscribe directly to `bookings` row changes (Postgres Changes / CDC), or have the server send an opaque "something changed" ping (Broadcast) that the client reacts to by refetching through the existing API route. Postgres Changes was ruled out: `bookings` has RLS enabled with exactly one policy (`service_role` only — verified via the Management API before writing any code), so wiring CDC would mean adding `bookings` to the `supabase_realtime` publication *and* adding a new RLS SELECT policy just to let the browser receive change events — a real, if narrowly-scoped, widening of a table that today is completely unreachable from client code. Broadcast needs neither: it's a separate pub/sub channel, carries no row data (just an empty ping), and the browser still only ever gets booking data through the already-`requireAdmin()`-gated `/api/admin/bookings/local` route. `bookings`'s security posture is unchanged.

Verified end-to-end against the real project before wiring it into application code: sent a broadcast via `curl` to `{SUPABASE_URL}/realtime/v1/api/broadcast` with the service-role key, confirmed a browser client subscribed with the anon key received it. Then verified the actual client hook the same way — instrumented `window.fetch`, sent one broadcast, confirmed exactly one refetch of `/api/admin/bookings/local` (not zero, not a duplicate).

## How to extend

- Any other admin list view that wants live updates can call `useBookingsChangedSignal(refresh)` — no changes needed elsewhere, and no new server-side work if it also reads from `bookings`.
- If a new code path writes to `bookings` in a way that should be visible on these views, call `await notifyBookingsChanged()` right after the write succeeds — see `notify-bookings-changed.ts`'s call sites for the pattern (only fire on a *successful* write; skip on error/no-op branches like a 23505 dedup).
- Planning currently reuses the Bookings list's `status IN (confirmed, booked, pending_payment, paid_pending_fh)` filter (inherited from the shared API route) — cancelled bookings never appear on the calendar.
- The grouping key is `(booking_date, start_time, listing_id, category, customer_type_name)`, matched on the display name rather than the raw FareHarbor rate pk (which isn't in the `AdminBooking` type). If that name is ever changed to be non-unique per product, grouping would need to switch to the raw pk instead.

## Note: dev-server stale bundle during this work

While building the grouped-card redesign, the dev server started throwing `ReferenceError: dayGroups is not defined` at a line number past the end of the actual file — a stale/corrupted webpack HMR bundle, not a real code bug (confirmed via `tsc`, the full test suite, and reading the source directly). Reloading and even navigating to a fresh preview server instance didn't clear it; only `pkill -f "next dev" && rm -rf .next` followed by a real restart did. Mentioned here in case it recurs — the fix is a full process + `.next` restart, not just a browser reload.

## Dependencies

- Depends on `/api/admin/bookings/local` (pre-existing, unchanged) and `BookingDetailRow` (pre-existing, unchanged — reused as-is inside the new modal).
- Depends on Supabase Realtime's broadcast REST API (`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, both pre-existing env vars). No schema changes, no new RLS policies, no new environment variables.
