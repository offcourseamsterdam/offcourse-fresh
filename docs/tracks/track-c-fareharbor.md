# Track C: FareHarbor Integration + Listing Filter Layer

**Phase:** 1 (MVP)
**Dependencies:** Track A (Supabase client, env vars)
**Parallel with:** Track B
**Must complete before:** Track D (Stripe checkout needs booking data)

## Objective
Build the FareHarbor API client, the 3-layer filter engine, and the unified booking flow UI. This is the most complex track in Phase 1.

**READ BEFORE STARTING:**
- `docs/fareharbor-api.md` — API endpoints and auth
- `docs/prd-booking-flow.md` — complete booking flow PRD with edge cases
- `docs/implementation-plan.md` section 1.3–1.5 — FareHarbor integration details

## Steps

### C1. FareHarbor API Client (`src/lib/fareharbor/client.ts`)

Type-safe wrapper around FareHarbor External API v1.

```typescript
class FareHarborClient {
  getItems(): Promise<Item[]>
  getAvailabilities(itemPk: number, date: string): Promise<MinimalAvailability[]>
  getAvailabilityDetail(availPk: number): Promise<Availability>
  validateBooking(availPk: number, data: BookingRequest): Promise<ValidationResult>
  createBooking(availPk: number, data: BookingRequest): Promise<Booking>
}
```

Requirements:
- Auth headers on EVERY request (from env vars)
- Use minimal availability endpoint for date browsing
- Request queue with rate limiting (30 req/sec)
- In-memory cache for availabilities (60s TTL)
- Proper error handling (400, 403, 404, 429)
- TypeScript types for all FH response objects in `src/lib/fareharbor/types.ts`

### C2. FareHarbor Sync Engine

API routes that sync FareHarbor data to local Supabase tables:

- `POST /api/fareharbor/sync` — fetches items, resources, customer_types from FH → upserts into `fareharbor_items`, `fareharbor_resources`, `fareharbor_customer_types`
- Run on demand from admin + scheduled via Vercel cron (nightly)
- This populates the data that the listing creation wizard uses

### C3. Customer Types Config (`src/lib/fareharbor/config.ts`)

```typescript
// Map FareHarbor customer type PKs to our config
// PKs are fetched from the synced fareharbor_customer_types table
export interface CustomerTypeConfig {
  boat: 'diana' | 'curacao';
  duration: 90 | 120 | 180;
  maxGuests: number;
  priority: number;
}
```

**Important:** The actual PK values come from the FH API and are stored in `fareharbor_customer_types`. The config should be loaded dynamically from Supabase, not hardcoded. The PRD shows hardcoded PKs as placeholders.

### C4. 3-Layer Filter Engine (`src/lib/fareharbor/filters.ts`)

Implement `applyAllFilters()` exactly as specified in `docs/implementation-plan.md`:

1. **Layer 1: Resource filter** — remove customer_type_rates from disallowed resources
2. **Layer 2: Customer type filter** — remove customer_type_rates not in allowed list
3. **Layer 3: Time/date rules** — time_after, time_before, sunset, months, days_of_week, max_guests_override

Also implement the PRD filter functions:
- `getValidTimeSlots()` — filter by guest count + capacity (from PRD)
- `getAvailableDurations()` — available durations for a boat at a timeslot
- `getBoatStatus()` — 'available' | 'sold_out' | 'too_many_guests' | 'unavailable'

The PRD functions are applied AFTER the 3-layer listing filters.

### C5. Sunset Times Service (`src/lib/fareharbor/sunset.ts`)

- Fetch sunrise/sunset times for Amsterdam from sunrise-sunset.org API (or similar free API)
- Cache in `sunset_times` Supabase table (one row per date)
- Pre-seed: fetch next 90 days on first run
- Used by Layer 3 sunset filter

### C6. Availability API Route (`src/app/api/fareharbor/availability/route.ts`)

```
GET /api/fareharbor/availability?listing_id={uuid}&date={YYYY-MM-DD}&guests={n}
```

This route:
1. Loads the listing from Supabase (including filter config)
2. Gets the linked FareHarbor item PK
3. Fetches availabilities from FH minimal endpoint
4. Applies all 3 filter layers + PRD filters
5. Returns filtered availabilities to the client

### C7. Homepage Search Bar + Results

The **primary entry point** for booking. Lives on the homepage hero.

**Components:**
```
src/components/search/
├── SearchBar.tsx              # Date picker + guest count + Search button
├── SearchResults.tsx          # Results grid container
└── SearchResultCard.tsx       # Per-listing result: photo, name, times, duration, price
```

**Search flow:**
1. User selects date + guest count → clicks Search
2. API route fetches FareHarbor availability for ALL active `cruise_listings` for that date
3. Each listing's 3-layer filter is applied server-side
4. Only listings with remaining availability are returned
5. Client renders `SearchResultCard` for each, showing filtered departure times + starting price
6. Click a card → navigate to `/cruises/{slug}?date=YYYY-MM-DD&guests=N`

**API route:** `src/app/api/search/route.ts` — accepts `date` + `guests` query params, returns array of `{ listing, availabilities, startingPrice }`.

### C8. Per-Listing Booking Flow UI

Booking flow is **inline on the cruise detail page** (`src/app/[locale]/cruises/[slug]/page.tsx`), NOT a separate `/book/` page. Adapts based on listing type.

**Components:**
```
src/components/booking/
├── BookingFlow.tsx            # Main orchestrator (state machine)
├── DatePicker.tsx             # Calendar with availability indicators (pre-filled from search)
├── GuestCounter.tsx           # Guest count selector (pre-filled from search)
├── TimeSlotGrid.tsx           # Available timeslots (post-filter)
├── BoatCard.tsx               # Boat display with status badge
├── DurationSelector.tsx       # 1.5h / 2h / 3h options
├── BookingSummary.tsx         # Price + details summary
└── ContactForm.tsx            # Name, email, phone
```

**Private listing flow:**
Date → Guests → TimeSlot → Boat Card → Duration → Summary → Contact → Checkout

**Shared listing flow:**
Date → Persons → TimeSlot → Summary → Contact → Checkout

**Pre-fill from homepage search:** If URL has `?date=` and `?guests=` params, auto-fill those fields and immediately load timeslots.

**Smart UI behavior:**
- If only 1 boat available after filtering → skip boat selection, show directly
- If only 1 duration available → skip duration selector
- Show "Sold out" badge on unavailable boats (don't hide them)
- Show reason codes from PRD edge case table (29 cases)

### C8. FareHarbor Webhook Handler (`src/app/api/fareharbor/webhook/route.ts`)

- Receive webhooks: `booking.created`, `booking.updated`, `booking.cancelled`
- Log raw payload to `webhook_logs` table
- Update `bookings` table accordingly
- Trigger notification events (used by Slack in Phase 3)

## Verification Checklist
- [ ] FH client can fetch items from demo API
- [ ] FH client can fetch availabilities for a date
- [ ] Sync engine populates `fareharbor_items`, `fareharbor_resources`, `fareharbor_customer_types`
- [ ] 3-layer filter correctly removes disallowed resources/customer types
- [ ] Sunset filter works with cached sunset times
- [ ] Availability API route returns filtered results
- [ ] Booking flow renders for a private listing with date → timeslot → boat → duration
- [ ] Booking flow renders for a shared listing with simpler flow
- [ ] Sold out timeslots show correctly
- [ ] PRD edge cases handled (test at least 10 of the 29 cases)
- [ ] Webhook endpoint receives and logs test webhook
- [ ] All FH API calls go through server-side routes (no client-side API key exposure)
