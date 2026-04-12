# Codebase Audit — April 12, 2026

Site-wide review of 186 files (~17K lines) across three dimensions: code reuse, code quality, and efficiency. 61 findings total, deduplicated and prioritized below.

---

## CRITICAL — Payment/Booking Bugs (fix before going live)

### 1. iDEAL redirect loses contact info
**File:** `src/components/checkout/CheckoutFlow.tsx:233-257`
**Bug:** After iDEAL bank redirect, the component re-mounts with fresh state. `contact` is `null`, so the booking is created with empty name/email. Confirmation email goes nowhere.
**Fix:** Persist contact info to sessionStorage before the redirect (alongside `offcourse_booking`). On return, read it back.

### 2. Silent booking failure on payment success
**File:** `src/components/checkout/CheckoutFlow.tsx:233-276`
**Bug:** `handlePaymentSuccess` calls `/api/booking-flow/book` but never checks the response. On failure, the catch block still redirects to the confirmation page. Customer pays Stripe but may have no FareHarbor booking.
**Fix:** Check API response. On failure, show an error state instead of redirecting. Add Stripe webhook as reconciliation fallback.

### 3. No idempotency on booking endpoint
**File:** `src/app/api/admin/booking-flow/book/route.ts`
**Bug:** If client retries (timeout, double-click), the same booking is created twice in FareHarbor. No check for existing `stripe_payment_intent_id`.
**Fix:** Query Supabase for existing booking with same `stripe_payment_intent_id` before calling FareHarbor.

### 4. Client-provided price not validated server-side
**File:** `src/app/api/*/booking-flow/create-intent/route.ts`
**Bug:** `basePriceCents` comes from sessionStorage (client-side). The server uses it directly to calculate the Stripe charge. A user can modify sessionStorage to pay less.
**Fix:** Look up the actual FareHarbor rate server-side (from `customerTypeRatePk`) rather than trusting the client.

---

## HIGH — Performance & Architecture

### 5. N+1 FareHarbor API calls on search
**File:** `src/app/[locale]/search/page.tsx:29-34`, `src/lib/fareharbor/availability.ts`
**Issue:** Each listing calls `getFilteredAvailability()` independently. Multiple virtual listings share the same `fareharbor_item_pk`, causing duplicate API calls. 6 listings = 6 FH calls instead of 2.
**Fix:** Group listings by `fareharbor_item_pk`, fetch raw availability once per unique item, then apply per-listing filters using `applyListingFilters()`.

### 6. Two identical create-intent API routes
**Files:** `src/app/api/booking-flow/create-intent/route.ts` + `src/app/api/admin/booking-flow/create-intent/route.ts`
**Issue:** ~95% identical code. Bug fixes must be applied twice (already caused issues this session).
**Fix:** Extract shared logic into a service function. Have both routes call it.

### 7. Unbounded in-memory FH client cache
**File:** `src/lib/fareharbor/client.ts:62-81`
**Issue:** `cache` Map has no size limit. Expired entries only removed on re-read. Over weeks, thousands of stale entries accumulate.
**Fix:** Add max-size cap (~500 entries) with LRU eviction, or periodic sweep.

### 8. Duplicate Supabase query in cruise detail page
**File:** `src/app/[locale]/cruises/[slug]/page.tsx:28-36, 58-63`
**Issue:** `generateMetadata()` and the page component both query same listing. Not deduplicated because each creates a new Supabase client.
**Fix:** Use React `cache()` to wrap the fetch.

### 9. Nav listings fetched on every page load
**File:** `src/app/[locale]/layout.tsx:52-58`
**Issue:** Locale layout queries `cruise_listings` on every navigation with no caching.
**Fix:** Use `unstable_cache` with 5-minute TTL.

### 10. Re-fetches data the caller already has
**File:** `src/lib/fareharbor/availability.ts:26-51`
**Issue:** `getFilteredAvailability()` re-queries the listing from Supabase even though the search page already fetched it. Also creates a fresh Supabase client per call.
**Fix:** Accept already-fetched listing config as parameters.

### 11. Widespread `as any` from stale Supabase types
**Files:** 15+ occurrences across `sunset.ts`, `page.tsx`, `book/route.ts`, etc.
**Issue:** Tables `sunset_times` and `hero_slides` exist in DB but not in generated types.
**Fix:** Run `curl -s "https://api.supabase.com/v1/projects/fkylzllxvepmrtqxisrn/types/typescript" -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['types'])" > src/lib/supabase/types.ts`

---

## MEDIUM — Code Duplication

### 12. Three different price formatting functions
- `src/components/booking/TicketStep.tsx:17` — `fmtPrice()` with 2 decimals
- `src/components/booking/BoatDurationStep.tsx:32` — `Math.round()` (integer)
- `src/components/admin/fareharbor/helpers.ts:9` — `toFixed(0)`
**Fix:** Use `fmtEuros()` from `src/lib/utils.ts`. Add `fmtEurosRounded()` for integer display.

### 13. Two duration formatters + inline duration math
- `src/components/booking/BoatDurationStep.tsx:36` — "1.5h"
- `src/components/checkout/BookingSummary.tsx:28` — "1h 30min"
- `src/lib/utils.ts:52` — `formatDuration()` "1h 30m" (canonical)
- BookingPanel.tsx:250, CheckoutFlow.tsx:304 — inline `Math.floor(min/60)`
**Fix:** Use `formatDuration()` from utils. Add compact variant if needed.

### 14. `toDateStr()` + `getToday()` duplicated
- `src/components/search/SearchBar.tsx:14-25`
- `src/components/booking/DateStep.tsx:14-25`
- `src/lib/fareharbor/sunset.ts:6` (`formatDateStr()`)
**Fix:** Move to `src/lib/utils.ts`.

### 15. Local `formatDate()` shadows existing utility
- `SearchResultsPage.tsx:34`, `BookingSummary.tsx:23`, `SearchBar.tsx:27`, `BookingPanel.tsx:238`
**Fix:** Use `formatDate()` from `src/lib/utils.ts`.

### 16. `CITY_TAX_PER_PERSON_CENTS = 260` still hardcoded
**File:** `src/components/booking/TicketStep.tsx:7`
**Issue:** City tax is supposed to be DB-driven (required extra). This constant can drift.
**Fix:** Get city tax from the extras calculation result.

### 17. Stepper +/- button pattern copied 3 times
**Files:** `GuestStep.tsx`, `DateStep.tsx`, `TicketStep.tsx`
**Fix:** Extract `<NumberStepper min max value onChange />` component.

### 18. `customerTypeRatePk` derivation duplicated within same file
**File:** `src/components/checkout/CheckoutFlow.tsx:200-201` and `:239-240`
**Fix:** Compute once at the top of the function.

### 19. Inline checkmark SVG repeated 3x on cruise detail page
**File:** `src/app/[locale]/cruises/[slug]/page.tsx:216,237,258`
**Fix:** Extract `<CheckIcon />` or use `lucide-react`'s `Check`.

### 20. Session storage key `'offcourse_booking'` in 5 places
**Fix:** Add `SESSION_BOOKING_KEY` to `src/lib/constants.ts`.

---

## LOW — Cleanup

### 21. Dead code in Navbar
- `cruisesOpen` state never set to `true`
- `cruisesRef` only used by dead click-outside handler
**Fix:** Delete both + the useEffect.

### 22. Inline `NavLinks` component in Navbar
**File:** `src/components/layout/Navbar.tsx:66`
**Issue:** Defined inside render body — recreated every render.
**Fix:** Extract to standalone component above `Navbar`.

### 23. `const mode = category` alias in BookingPanel
**File:** `src/components/booking/BookingPanel.tsx:169`
**Fix:** Use `category` directly.

### 24. Fragile duration formatting formula
**File:** `src/components/booking/BookingPanel.tsx:250`
**Issue:** `Math.round((min % 60) / 6)` breaks for durations not divisible by 6.
**Fix:** Use `formatDuration()` from utils.

### 25. Hardcoded ticket labels
**File:** `src/components/booking/BookingPanel.tsx:274`
**Issue:** `i === 0 ? 'Adult' : 'Child'` assumes ordering.
**Fix:** Use FareHarbor customer type name.

### 26. Dead code in FeaturedCruises
**File:** `src/components/sections/FeaturedCruises.tsx:90-93`
**Issue:** `(listing as any).minimum_duration_hours` — property doesn't exist on type.

### 27. `transition-all` in HeroSection
**File:** `src/components/sections/HeroSection.tsx:129`
**Fix:** Use `transition-[transform,opacity]` for less compositor work.

### 28. `Resend` client re-instantiated per booking
**File:** `src/app/api/admin/booking-flow/book/route.ts:277`
**Fix:** Module-level singleton like `getStripe()`.

### 29. Error message extraction repeated 10+ times
**Pattern:** `err instanceof Error ? err.message : 'Unknown error'`
**Fix:** Add `getErrorMessage(err)` helper to utils.

### 30. Pluralization logic repeated inline
**Pattern:** `guests === 1 ? 'guest' : 'guests'` in 4+ places
**Fix:** Add `pluralize(n, singular, plural)` to utils.

---

## Recommended Fix Order

| Priority | Findings | Effort | Impact |
|----------|----------|--------|--------|
| **P0 — Before launch** | #1, #2, #3, #4 | 1 day | Prevents financial bugs |
| **P1 — This sprint** | #5, #6, #7, #11 | 1 day | Performance + type safety |
| **P2 — Next sprint** | #8, #9, #10, #12-16 | 1 day | DRY + maintainability |
| **P3 — Backlog** | #17-30 | 0.5 day | Cleanup |
