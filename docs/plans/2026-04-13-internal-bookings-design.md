# Design: Internal Bookings + Extras Display in Admin

## Context
The admin bookings page needs two enhancements:
1. **Internal bookings** — comp/free bookings for family, social media, third-party platforms. Books in FareHarbor at full price (accepting 2% commission for now — can switch to €0 rates later). Skips Stripe payment entirely.
2. **Extras display** — show which extras each booking includes, grouped by category, in expandable rows.

## Feature 1: Internal Bookings

### Flow
Same as the existing admin booking flow (date → time → guests → extras) with these differences:
- Toggle at the top: **"Regular"** / **"Internal"** (defaults to Regular)
- When Internal is selected:
  - Uses the same customer type rates as regular bookings (full price in FareHarbor)
  - Skips Stripe payment step entirely — no PaymentIntent created
  - Adds an optional "Internal note" field (e.g. "Family of Beer", "Instagram collab with @user")
  - Books directly in FareHarbor after the extras step
  - Saved to `bookings` table with `booking_type = 'internal'` and `stripe_amount = 0`

### Booking Sources (hardcoded in constants.ts)
```typescript
export const BOOKING_SOURCES = [
  { value: 'website', label: 'Website (regular)' },
  { value: 'complimentary', label: 'Complimentary' },
  { value: 'withlocals', label: 'Withlocals' },
  { value: 'clickandboat', label: 'Click&Boat' },
] as const

export type BookingSource = typeof BOOKING_SOURCES[number]['value']
```
Adding a platform = add one line to this array.

### DB Changes
```sql
ALTER TABLE bookings ADD COLUMN booking_source text NOT NULL DEFAULT 'website';
-- Values: 'website' | 'complimentary' | 'withlocals' | 'clickandboat' | ...
ALTER TABLE bookings ADD COLUMN deposit_amount_cents integer;
-- What the platform deposits (null for website bookings, 0 for comp, >0 for platforms)
```

### API Changes
- `POST /api/admin/booking-flow/book` — accept `bookingSource` and `depositAmountCents`
  - When source ≠ 'website': skip Stripe payment validation
  - Save with `booking_source`, `deposit_amount_cents`, `payment_status = 'comp'`
- `POST /api/admin/booking-flow/create-intent` — skip entirely for non-website bookings

### UI Changes
- Admin booking flow gets a **booking source dropdown** at the top (defaults to "Website")
- When source ≠ "Website":
  - **Deposit amount field** appears after guest info
    - For "Complimentary": auto-set to €0, field hidden or disabled
    - For platforms (Withlocals, Click&Boat): editable field
    - Label: "Deposit amount"
    - Helper: *"Amount deposited to your account after platform fees."*
    - Input in euros, stored as cents
  - **Extras step** works normally — values tracked but labeled "not charged"
  - **Payment step replaced** with "Confirm Booking" button (no Stripe)
  - **Price summary** shows: deposit amount + extras value (informational)
  - **Booking confirmation** shows source badge (e.g. "Withlocals", "Comp")

### Admin Booking Flow Steps (non-website source)
1. **Select source** (dropdown: Complimentary / Withlocals / Click&Boat)
2. Pick listing → 3. Pick date → 4. Pick time → 5. Pick boat+duration / tickets
6. Guest info (name, email, phone, note)
7. **Deposit amount** (auto €0 for comp, manual for platforms)
8. Extras (tracked, not charged)
9. **Confirm** (books in FareHarbor, saves to DB, no Stripe)

## Feature 2: Extras Display in Bookings List

### Approach: Expandable Row
Click any booking row → expands to show details including extras grouped by category.

### API Changes
- `GET /api/admin/bookings/local` — add `extras_selected`, `base_amount_cents`, `extras_amount_cents`, `booking_type` to the SELECT

### UI Changes
- Each booking row becomes clickable → expands a detail panel below
- Detail panel shows:
  - **Guest info**: name, email, phone, note
  - **Price breakdown**: base price, extras total, VAT, grand total
  - **Extras by category**: grouped display (Food & Drinks: Bites Box €19.50, City Tax: €2.60/person, etc.)
  - **Booking type badge**: "Regular" (default) or "Internal" (purple badge)
- Table gets a new "Type" column showing Regular/Internal badge
- Filter: dropdown to show All / Regular / Internal bookings

## Files to Modify

### New files
- `src/components/admin/BookingDetailRow.tsx` — expandable booking detail (extras, guest info, price breakdown)

### Modified files
- `src/lib/constants.ts` — add `BOOKING_SOURCES` array
- `src/app/[locale]/admin/bookings/page.tsx` — expandable rows, source filter, extras display
- `src/app/api/admin/bookings/local/route.ts` — add `extras_selected`, `booking_source`, `deposit_amount_cents`, price columns to SELECT
- `src/app/api/admin/booking-flow/book/route.ts` — accept `bookingSource` + `depositAmountCents`, skip Stripe validation for non-website
- `src/components/booking/CheckoutFlow.tsx` (admin booking flow) — source dropdown, deposit field, skip payment step for non-website

### Migration
- `supabase/migrations/016_booking_sources.sql` — add `booking_source` + `deposit_amount_cents` columns

## Verification
1. Create an internal booking: date → time → guests → extras → confirm (no payment)
2. Verify it appears in FareHarbor with €0 total
3. Verify it appears in admin bookings with "Internal" badge
4. Click to expand → verify extras are shown grouped by category
5. Create a regular booking → verify it still works with Stripe payment
6. Filter bookings by type → verify filtering works
7. `npm test` — all tests pass
