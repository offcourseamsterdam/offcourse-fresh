# Extras & Add-ons Feature Design

**Date:** 2026-04-06
**Status:** Approved
**Scope:** Public booking flow + admin booking flow + admin management UI

---

## Context

Off Course Amsterdam wants to sell optional add-ons (snacks, drinks, experience upgrades) and required charges (city tax) alongside cruise bookings. Extras must be reflected in the Stripe charge, stored in full detail on the booking record for accounting/VAT reporting, and manageable by admin without touching code.

Two types of extras exist:
- **Global** — automatically apply to all listings of a given category (e.g., cancellation insurance for all private cruises)
- **Per-listing** — manually attached to specific listings (e.g., a prosecco package only on one cruise)

---

## Decisions

- **Approach A** — global + per-listing extras with a junction table for overrides
- Prices are **inclusive of VAT** throughout (FareHarbor rates and extras alike)
- VAT is **back-calculated**: `vat_amount = price_incl_vat × rate / (100 + rate)`
- Base cruise VAT rate = **9%** (hard-coded)
- Each extra has its own VAT rate (0, 9, or 21)
- City tax = **€2.60/person**, `is_required = true`, VAT = 0%
- City tax `guestCount` ≠ FareHarbor `quantity` — private cruises always use `quantity: 1` for FareHarbor but city tax uses the actual number of guests on board
- Insurance calculates on **subtotal before percentage extras** (base + required + fixed), never on itself
- Admin refunds for cancellation insurance are **manual** (processed in the Off Course admin dashboard)
- Extras are **English-only** in admin for now; translation columns exist in DB for a future Translation section
- All extras are **optional** except `is_required` ones (city tax)
- Extras images are optional; fall back to category icon

---

## Data Model

### New table: `extras`

```sql
CREATE TABLE extras (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  -- translation columns exist but not surfaced in admin yet:
  name_nl               text, name_de text, name_fr text,
  name_es               text, name_pt text, name_zh text,
  description           text,
  description_nl        text, description_de text, description_fr text,
  description_es        text, description_pt text, description_zh text,
  image_url             text,                        -- optional thumbnail for checkout UI
  category              text NOT NULL,               -- 'food'|'drinks'|'protection'|'experience'|'tax'
  scope                 text NOT NULL,               -- 'global'|'per_listing'
  applicable_categories text[],                      -- for global extras: ['private','shared'] etc.
  price_type            text NOT NULL,               -- 'fixed_cents'|'percentage'|'per_person_cents'
  price_value           integer NOT NULL,            -- cents (2500=€25) | whole % (15) | cents/person (260)
  vat_rate              integer NOT NULL DEFAULT 9,  -- 0 | 9 | 21
  is_required           boolean NOT NULL DEFAULT false, -- auto-included, not deselectable
  is_active             boolean NOT NULL DEFAULT true,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);
```

### New table: `listing_extras`

```sql
CREATE TABLE listing_extras (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES cruise_listings(id) ON DELETE CASCADE,
  extra_id   uuid NOT NULL REFERENCES extras(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true, -- false = disable a global extra for this listing
  created_at timestamptz DEFAULT now(),
  UNIQUE (listing_id, extra_id)
);
```

**How extras are resolved for a listing:**
1. All `global` extras where `applicable_categories @> ARRAY[listing.category]` AND `is_active = true`
2. Check `listing_extras` for overrides — `is_enabled = false` suppresses a global extra for this listing
3. All `per_listing` extras linked via `listing_extras` where `is_enabled = true`

### Modified table: `bookings` (new columns)

```sql
ALTER TABLE bookings
  ADD COLUMN base_amount_cents      integer,   -- cruise price incl. VAT (from FareHarbor)
  ADD COLUMN base_vat_rate          integer DEFAULT 9,
  ADD COLUMN base_vat_amount_cents  integer,   -- back-calc: base × 9/109
  ADD COLUMN extras_amount_cents    integer DEFAULT 0,  -- sum of all extras incl. VAT
  ADD COLUMN extras_vat_amount_cents integer DEFAULT 0, -- sum of VAT portions on all extras
  ADD COLUMN total_vat_amount_cents integer DEFAULT 0,  -- base_vat + extras_vat (for reporting)
  ADD COLUMN extras_selected        jsonb DEFAULT '[]'; -- full snapshot (see below)
```

**`extras_selected` jsonb schema (one object per extra):**

```json
[
  {
    "extra_id": "uuid",
    "name": "City Tax",
    "category": "tax",
    "price_type": "per_person_cents",
    "price_value": 260,
    "vat_rate": 0,
    "guest_count": 8,
    "amount_cents": 2080,
    "vat_amount_cents": 0
  },
  {
    "extra_id": "uuid",
    "name": "Cancellation Insurance",
    "category": "protection",
    "price_type": "percentage",
    "price_value": 15,
    "vat_rate": 21,
    "amount_cents": 2783,
    "vat_amount_cents": 484
  },
  {
    "extra_id": "uuid",
    "name": "Prosecco Bottle",
    "category": "drinks",
    "price_type": "fixed_cents",
    "price_value": 2500,
    "vat_rate": 9,
    "amount_cents": 2500,
    "vat_amount_cents": 206
  }
]
```

The snapshot is immutable after booking — changes to extras catalog do not affect past bookings.

The existing `stripe_amount` = `base_amount_cents + extras_amount_cents` (grand total charged to card).

---

## Calculation Logic

```typescript
function calculateExtrasTotal(
  baseAmountCents: number,
  guestCount: number,
  selectedExtras: Extra[]
): { extrasCents: number; breakdown: ExtraLineItem[] } {
  const breakdown: ExtraLineItem[] = []
  let subtotal = baseAmountCents

  // 1. Required per_person extras (city tax)
  for (const extra of selectedExtras.filter(e => e.is_required && e.price_type === 'per_person_cents')) {
    const amount = extra.price_value * guestCount
    const vat = Math.round(amount * extra.vat_rate / (100 + extra.vat_rate))
    breakdown.push({ ...extra, guest_count: guestCount, amount_cents: amount, vat_amount_cents: vat })
    subtotal += amount
  }

  // 2. Selected fixed extras
  for (const extra of selectedExtras.filter(e => e.price_type === 'fixed_cents')) {
    const vat = Math.round(extra.price_value * extra.vat_rate / (100 + extra.vat_rate))
    breakdown.push({ ...extra, amount_cents: extra.price_value, vat_amount_cents: vat })
    subtotal += extra.price_value
  }

  // 3. Percentage extras (on subtotal before themselves)
  for (const extra of selectedExtras.filter(e => e.price_type === 'percentage')) {
    const amount = Math.round(subtotal * extra.price_value / 100)
    const vat = Math.round(amount * extra.vat_rate / (100 + extra.vat_rate))
    breakdown.push({ ...extra, amount_cents: amount, vat_amount_cents: vat })
    subtotal += amount
  }

  return {
    extrasCents: subtotal - baseAmountCents,
    breakdown
  }
}
```

All calculation happens **server-side** in the `create-intent` route — client amounts are never trusted.

---

## API Changes

### New endpoint
```
GET /api/admin/cruise-listings/[id]/extras?guestCount=4
```
Returns resolved extras for the listing (global + per-listing, with overrides applied).
Pre-calculates city tax amount using `guestCount`.

### Modified: `POST /api/admin/booking-flow/create-intent`
```typescript
// New fields in request body:
selectedExtraIds: string[]
guestCount: number

// Server recalculates total — never trusts client amountCents for extras
// Returns: { clientSecret, totalAmountCents, breakdown }
```

### Modified: `POST /api/admin/booking-flow/book`
```typescript
// New fields in request body:
selectedExtraIds: string[]
guestCount: number

// Stores all new bookings columns
// Slack notification + confirmation email include extras line items + total VAT
```

---

## Admin Interface

### New page: `/admin/extras`
- Sidebar entry under **Content** section
- List view grouped by category with inline active toggle
- Create/edit form fields:
  - Name, Description (English only — translation section handles other languages later)
  - Image upload (optional)
  - Category, Scope, Applicable categories (if global)
  - Price type + Price value
  - VAT rate (0% / 9% / 21%)
  - Is required, Is active, Sort order

### New tab on `/admin/cruises/[id]`: "Extras"
- **Global extras section** — read-only list of auto-applied extras with a per-listing enable/disable toggle (writes to `listing_extras.is_enabled`)
- **Per-listing extras section** — add/remove from catalog, drag to reorder
- **Preview strip** — shows exactly what customers will see in checkout

---

## Public & Admin Checkout UI

### Booking step order
```
1. Pick date & guests
2. Pick timeslot
3. Pick duration
4. Add extras        ← new step
5. Payment (Stripe)
```

### Extras step layout
- **Cruise hero image** displayed persistently at top of booking flow (from `cruise_listings.hero_image_url`)
- Required extras (city tax) shown as locked line items at top
- Optional extras grouped by category as selectable cards
- Cards with `image_url` show a small thumbnail; others show a category icon
- Running total updates instantly on selection, showing per-line breakdown + total VAT
- "Continue to payment" triggers server-side recalculation + PaymentIntent creation

### Same component for public + admin booking flow
The extras step is a shared React component — no duplication. Admin booking flow reuses it verbatim.

---

## Notifications & Reporting

### Confirmation email + Slack notification
Both include an extras summary table:
```
City Tax (8 guests)          €20.80
Prosecco Bottle              €25.00
Cancellation Insurance       €27.83
─────────────────────────────────────
Extras total                 €73.63
Cruise base                  €165.00
Grand total                  €238.63  (incl. €28.91 VAT)
```

### VAT reporting (future)
The stored columns make reporting a straight SQL query:
```sql
SELECT
  SUM(base_vat_amount_cents)   AS cruise_vat,
  SUM(extras_vat_amount_cents) AS extras_vat,
  SUM(total_vat_amount_cents)  AS total_vat
FROM bookings
WHERE booking_date BETWEEN '2026-01-01' AND '2026-03-31';
```

---

## Critical Files to Create / Modify

| Action | File |
|--------|------|
| Create | `supabase/migrations/011_extras.sql` |
| Create | `src/app/api/admin/extras/route.ts` (list + create) |
| Create | `src/app/api/admin/extras/[id]/route.ts` (get + update + delete) |
| Create | `src/app/api/admin/cruise-listings/[id]/extras/route.ts` (resolve extras for listing) |
| Create | `src/app/[locale]/admin/extras/page.tsx` |
| Create | `src/components/booking/ExtrasStep.tsx` (shared component) |
| Create | `src/lib/extras/calculate.ts` (calculation logic) |
| Modify | `src/app/api/admin/booking-flow/create-intent/route.ts` |
| Modify | `src/app/api/admin/booking-flow/book/route.ts` |
| Modify | `src/app/[locale]/admin/cruises/[id]/page.tsx` (add Extras tab) |
| Modify | `src/components/layout/DashboardSidebar.tsx` (add Extras nav item) |
| Modify | `supabase/migrations/010_bookings.sql` or new migration |
| Modify | `src/lib/supabase/types.ts` (regenerate after migration) |

---

## Verification

1. **DB migration** — run migration, confirm new tables and columns exist in Supabase
2. **Extras CRUD** — create a global extra (insurance), a per-listing extra (prosecco), and the city tax extra in admin
3. **Listing Extras tab** — confirm global extras auto-appear, can be disabled per listing, per-listing extras can be added
4. **Booking flow** — book a private cruise with 4 guests, select insurance + prosecco:
   - City tax = 4 × €2.60 = €10.40 (auto-included, locked)
   - Prosecco = €25.00
   - Insurance = 15% of (base + city tax + prosecco)
   - Total on Stripe PaymentIntent matches
5. **Booking record** — check Supabase: `extras_selected` jsonb is correct, all VAT columns populated
6. **Slack + email** — confirm extras line items appear in notification
7. **VAT check** — spot-check back-calculation: €165 at 9% → VAT = €165 × 9/109 = €13.62
