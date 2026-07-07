# Admin bookings search + Planning week view

## What was built

Two additions to the admin bookings experience, both prompted by a real incident: a confirmed booking (Artem Khomenko's) wasn't visible in the admin Bookings list right after it came in.

1. **Search box** on the Bookings list (`/admin/bookings`) — filters by guest name, email, phone, cruise/listing title, FareHarbor booking UUID, or Stripe PaymentIntent id. Case-insensitive substring match.
2. **Planning** (`/admin/planning`) — a new week-calendar view: 7 day columns (Mon–Sun), each showing that day's bookings as time-ordered cards. Prev/next week navigation, a "Today" jump button, and clicking a card opens the same booking-detail view used on the Bookings list, in a modal.

Also fixed: the Bookings list only refetched on a manual "Refresh" click (`revalidateOnFocus: false`, no polling) — a booking created while the page was already open, like Artem's, simply wouldn't appear until someone clicked Refresh. Both the Bookings list and Planning now poll every 60s in the background.

## Why the booking looked "missing"

It wasn't a data bug — the row was correctly in Supabase (`confirmed`, `paid`, created at 14:10). What the admin actually hit was the browser's own Cmd+F find-in-page, which searches whatever's currently in the DOM — and the DOM was showing a stale SWR-cached list from before the booking existed, because nothing was telling the page to refetch. Two independent fixes address this: the search box (a real, app-level search that always reflects current filtered data) and the background poll (so the underlying data itself doesn't go stale while the page sits open).

## Key files

- [`src/lib/admin/booking-search.ts`](../../src/lib/admin/booking-search.ts) — `matchesBookingSearch(booking, query)`, pure predicate, unit tested.
- [`src/lib/admin/week.ts`](../../src/lib/admin/week.ts) — week-boundary math (`getWeekStart`, `addDays`, `weekDateStrings`, `formatWeekRangeLabel`), all Amsterdam-local. Unit tested, including a precise-instant regression test (see below).
- [`src/app/[locale]/admin/planning/page.tsx`](../../src/app/[locale]/admin/planning/page.tsx) — the new week view. Reuses `/api/admin/bookings/local` (same data source, same SWR cache key as the Bookings list) and the existing `BookingDetailRow` component for the modal.
- [`src/app/[locale]/admin/bookings/page.tsx`](../../src/app/[locale]/admin/bookings/page.tsx) — added the search input and a "Week view" link to Planning.
- [`src/hooks/useAdminFetch.ts`](../../src/hooks/useAdminFetch.ts) — added an opt-in `refreshIntervalMs` option (default unset, so every other caller keeps its exact prior behavior).
- [`src/app/[locale]/admin/layout.tsx`](../../src/app/[locale]/admin/layout.tsx) — Planning nav item's `comingSoon` flag removed; it was a placeholder for exactly this feature.

## Bugs found and fixed while building this

**Week-boundary date math could produce `Invalid Date`.** Both the new `week.ts` and the pre-existing `date-filter.ts` (same author pattern, copied when I wrote `week.ts`) build a "midnight Amsterdam" `Date` from a Y/M/D by first constructing an ISO string like `2026-07--1T00:00:00`. That's invalid whenever `day` goes to 0 or negative — which happens in the `week` case whenever "today" is the 1st or 2nd of the month on the right weekday (`day - daysBack < 1`). An `Invalid Date` compared with `<` always evaluates `false`, so `date-filter.ts`'s "This week" filter would silently show *everything* instead of just this week on those dates — a real, if infrequent (a few days a year), silent bug. Fixed both by switching to the multi-arg `Date` constructor (`new Date(y, m, d)`), which normalizes out-of-range days correctly and needs no format string. Regression-tested in both `week.test.ts` and `date-filter.test.ts` with the exact failing date.

**A first version of the fix used `Date.UTC` instead** — which looked right (all tests passed) but was actually computing the wrong instant, just one that happened to still map to the correct calendar date in the coarse date-string tests I'd initially written. It broke silently for every *other* case once applied for real, because the dev machine's timezone is `Europe/Amsterdam`, not UTC, and the original code's offset trick depends on the runtime's local timezone matching how the string is parsed. Caught by running the full `date-filter.test.ts` suite (7 pre-existing tests failed), which is why the final fix uses the local multi-arg constructor instead. Added a precise-instant assertion (not just a date-string comparison) to `week.test.ts` so a similar wrong-but-same-looking-string bug can't slip through silently again.

**`BookingDetailRow` doesn't fit in a narrow container.** It's a wide, multi-column layout built for a full-width table row (`colSpan={10}` on the Bookings list). Reusing it inline inside a ~250px week-day column visually overlapped and was unreadable. Fixed by opening it in a modal instead (same overlay pattern as `AddCateringModal`), rather than trying to make the component itself responsive down to that width.

## How to extend

- To change the auto-refresh cadence, adjust `REFRESH_INTERVAL_MS` in either page — it's a plain constant, not shared, since the two pages could reasonably want different cadences later.
- Any other admin list view that wants the same "poll in the background" behavior can pass `{ refreshIntervalMs }` to `useAdminFetch` — no changes needed elsewhere.
- Planning currently reuses the Bookings list's `status IN (confirmed, booked, pending_payment, paid_pending_fh)` filter (inherited from the shared API route) — cancelled bookings never appear on the calendar.

## Dependencies

- Depends on `/api/admin/bookings/local` (pre-existing, unchanged) and `BookingDetailRow` (pre-existing, unchanged — reused as-is inside the new modal).
- No new environment variables or schema changes.
