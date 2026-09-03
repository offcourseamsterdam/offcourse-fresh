# City tax (Amsterdam day-trip tourist tax) reporting

## What was built

A "City Tax" tab on the admin Finance page (`/admin/finance`) that adds up
Amsterdam's day-trip city tax liability for a given calendar year, so Beer
knows what to remit to the gemeente.

The tax itself (€2.60 per guest) was **already being charged to every
customer at checkout** before this feature existed — it's baked into
`calculateQuote()`. What was missing was a place that totals it up across
every booking for the year.

**This is a v1 with known, honestly-surfaced gaps** — see "What it doesn't
count" below. It was built this way deliberately: the alternative (a single
confident-looking total) would have been worse than not having the feature
at all, because the underlying data has real completeness problems that
can't be fully closed yet.

## Key files

| File | What it does |
|---|---|
| `src/lib/booking/constants.ts` | Added `CITY_TAX_FREE_GUESTS_PER_YEAR = 250` next to the existing `CITY_TAX_CENTS_PER_GUEST = 260` |
| `src/lib/finance/city-tax.ts` | Pure aggregation function (`aggregateCityTaxSummary`) — de-dupes, filters, applies the exemption. No I/O, fully unit-testable |
| `src/lib/finance/city-tax.test.ts` | Unit tests for the exemption math, status filtering, and de-dup logic |
| `src/app/api/admin/finance/city-tax/summary/route.ts` | `GET ?year=2026` — reads `bookings` for the year, hands rows to the aggregator |
| `src/app/[locale]/admin/finance/page.tsx` | `CityTaxTab` component — year picker, 4 stat tiles, and a gap-disclosure banner |

## How it works

1. The tax is €2.60/guest, with the first 250 guests **fleet-wide, per
   calendar year** exempt (confirmed with Beer 2026-09-02; counting starts
   2026 — not per boat, not per listing).
2. The route reads every `bookings` row with a `booking_date` in the
   requested year.
3. `aggregateCityTaxSummary`:
   - **De-duplicates by `booking_uuid`.** The `bookings` table is written by
     two separate systems — this app's own routes, and a legacy external
     FareHarbor sync that runs outside this repo (see
     `supabase/migrations/086_dedupe_shadow_bookings.sql`). Both can leave a
     row for the same real booking. When both exist, the authoritative
     (non-shadow, `raw_payload IS NULL`) row wins. A row with no
     `booking_uuid` at all can't collide with anything and passes through
     as-is.
   - **Filters to active statuses only** — `'confirmed'` and `'booked'`
     (the legacy sync's own vocabulary for "a real, non-cancelled
     reservation" — see the comment on `BOOKING_STATUSES` in
     `booking/constants.ts`). Cancelled, rebooked, and pending-payment rows
     are excluded.
   - **Never guesses a guest count.** A booking that survives the above
     filters but has `guest_count IS NULL` is excluded from the total and
     counted separately as `excludedNoGuestCount` — it does NOT get counted
     as 0 or 1.
   - Applies the 250-guest exemption once, over the fleet-wide total, then
     multiplies the remainder by €2.60.
4. The tab shows the resulting total (`countedGuests`, `billableGuests`,
   `cityTaxOwedCents`) alongside an amber banner listing exactly what was
   excluded and why, whenever anything was excluded.

## What it doesn't count (read this before trusting the number for a filing)

- **Withlocals, Click & Boat, GetMyBoat, and Barqo bookings are invisible to
  this tab entirely.** Confirmed against production data (2026-09-02): these
  four sources have **zero rows, ever**, in the `bookings` table, in either
  the authoritative or legacy-shadow system. Staff enter these bookings
  straight into FareHarbor's own dashboard, bypassing this app completely.
  Check each source's own Finance tab for its booking count in the meantime.
- **Bookings with no `guest_count` on file** — a real, non-trivial number
  even among bookings this app DOES know about (some legacy-shadow rows,
  and some of this app's own older rows, have `guest_count IS NULL`). These
  show up as `excludedNoGuestCount` in the API response and the tab's
  banner, never silently assumed.
- **The ideal fix — reading company-wide from FareHarbor's own booking
  data — is currently blocked.** `getBookings(minDate, maxDate)` in
  `src/lib/fareharbor/client.ts` (used to enumerate every FareHarbor
  reservation regardless of which system created it) 404s against the real
  API even for known-good dates. This is tracked as its own bug (spawned
  2026-09-02, since it also affects the double-booking safety check
  during real bookings — a separate, more urgent problem than city tax).
  Once fixed, this feature could be extended to close the gap above by
  reading FareHarbor directly instead of relying solely on `bookings`.

## How to extend

- **Once the FareHarbor `getBookings()` bug is fixed**: extend
  `aggregateCityTaxSummary` (or add a second aggregator) to also read
  FareHarbor's own booking list for the year, matching against `bookings`
  by `booking_uuid` for the real guest count on private cruises (FareHarbor
  itself only knows "1 unit of a private-rate item was booked," never the
  real headcount — see the comment block at the top of `city-tax.ts`).
- **Automatic submission to the gemeente**: not built. Beer's own words —
  "once the gemeente comes through we will automatically submit the city
  tax amounts" — this is future work once that municipal process exists.
- **New untracked source discovered**: add its `booking_source` value to
  `CITY_TAX_UNTRACKED_SOURCES` in `city-tax.ts` so the tab's disclosure
  banner names it.

## Dependencies

- Depends on: `bookings` table (`guest_count`, `booking_uuid`, `status`,
  `raw_payload`, `booking_date` columns), `CITY_TAX_CENTS_PER_GUEST` /
  `CITY_TAX_FREE_GUESTS_PER_YEAR` constants, `BOOKING_STATUSES` contract.
- Depended on by: nothing yet (a future gemeente-submission integration
  would read this tab's numbers).
