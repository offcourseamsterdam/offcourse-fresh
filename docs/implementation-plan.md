# Off Course Amsterdam — Next.js Rebuild Implementation Plan

**Version:** 1.0
**Date:** 2026-04-03
**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase · Stripe · FareHarbor API · Claude Sonnet (text) · Google Gemini (vision) · Vercel

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                    Vercel                         │
│  ┌─────────────────────────────────────────────┐ │
│  │           Next.js App (App Router)           │ │
│  │                                              │ │
│  │  /app                                        │ │
│  │    /(public)    → website pages + booking     │ │
│  │    /api         → API routes (incl. search)  │ │
│  │    /admin       → protected admin panel      │ │
│  └──────┬──────────┬──────────┬────────────────┘ │
└─────────┼──────────┼──────────┼──────────────────┘
          │          │          │
    ┌─────▼──┐  ┌───▼────┐  ┌─▼──────────┐  ┌──────────┐  ┌──────────┐
    │Supabase│  │ Stripe │  │ FareHarbor │  │  Claude  │  │  Google  │
    │  (DB)  │  │(Payments│  │  (Booking  │  │  Sonnet  │  │  Gemini  │
    │        │  │ native) │  │   API v1)  │  │  (text)  │  │ (vision) │
    └────────┘  └────────┘  └────────────┘  └──────────┘  └──────────┘
```

**Key architectural decisions:**

1. **App Router with RSC** — Server Components for SEO-critical pages, Client Components only where interactivity is needed (booking flow, admin).
2. **API routes as proxy** — All FareHarbor and Stripe calls go through Next.js API routes. Never expose API keys client-side.
3. **Supabase direct + RLS** — Public reads (cruises, boats, merch) via Supabase client with Row Level Security. Writes through API routes.
4. **ISR for content pages** — Incremental Static Regeneration for cruise pages, homepage, merch. Revalidate on admin content changes.
5. **Edge middleware** — i18n routing, admin auth check, rate limiting.

---

## Phasing Strategy

### Phase 1 — MVP: Public Website + Booking + Payments
**Goal:** Replace Lovable site. Go live with custom booking flow and Stripe checkout.
**Timeline estimate:** 4-6 weeks in Claude Code

### Phase 2 — Admin Backend + Operations
**Goal:** Internal tooling for day-to-day operations.
**Timeline estimate:** 3-4 weeks in Claude Code

### Phase 3 — Slack, AI Tools, SEO, Dev Tools
**Goal:** Automation, content generation, developer experience.
**Timeline estimate:** 3-4 weeks in Claude Code

---

## Phase 1 — MVP (Detailed)

### 1.1 Project Scaffolding

```bash
npx create-next-app@latest offcourse-amsterdam \
  --typescript --tailwind --eslint --app --src-dir
```

**Dependencies:**
```json
{
  "@supabase/supabase-js": "^2.x",
  "@supabase/ssr": "^0.x",
  "stripe": "^14.x",
  "@stripe/stripe-js": "^2.x",
  "@stripe/react-stripe-js": "^2.x",
  "next-intl": "^3.x",
  "framer-motion": "^11.x",
  "sharp": "^0.33.x",
  "zod": "^3.x",
  "date-fns": "^3.x",
  "@anthropic-ai/sdk": "^0.x",
  "@google/generative-ai": "^0.x"
}
```

**Folder structure:**
```
src/
├── app/
│   ├── [locale]/
│   │   ├── page.tsx                    # Homepage
│   │   ├── cruises/
│   │   │   ├── [slug]/page.tsx         # Cruise listing detail (virtual product)
│   │   ├── book/
│   │   │   ├── [slug]/page.tsx         # Booking flow for any listing (filters applied per listing)
│   │   │   ├── checkout/page.tsx       # Stripe checkout
│   │   │   ├── confirmation/page.tsx   # Post-payment
│   │   ├── merch/page.tsx              # Merch store
│   │   ├── crew/page.tsx               # The Cozy Crew
│   │   ├── privacy/page.tsx            # Privacy policy (currently 404!)
│   │   ├── terms/page.tsx              # Terms of service (currently 404!)
│   │   └── layout.tsx                  # Public layout
│   ├── api/
│   │   ├── fareharbor/
│   │   │   ├── availability/route.ts
│   │   │   ├── booking/route.ts
│   │   │   └── webhook/route.ts
│   │   ├── stripe/
│   │   │   ├── create-payment-intent/route.ts
│   │   │   ├── webhook/route.ts
│   │   │   └── confirm/route.ts
│   │   └── revalidate/route.ts         # On-demand ISR
│   ├── admin/                          # Phase 2
│   └── layout.tsx                      # Root layout
├── components/
│   ├── booking/                        # Booking flow components
│   ├── ui/                             # Shared UI primitives
│   ├── layout/                         # Nav, Footer, WhatsApp button
│   └── sections/                       # Homepage sections
├── lib/
│   ├── supabase/
│   │   ├── client.ts                   # Browser client
│   │   ├── server.ts                   # Server client
│   │   └── types.ts                    # Generated DB types
│   ├── fareharbor/
│   │   ├── client.ts                   # API wrapper
│   │   ├── types.ts                    # FH response types
│   │   └── config.ts                   # Customer types, boat config
│   ├── stripe/
│   │   ├── client.ts                   # Server-side Stripe
│   │   └── products.ts                 # Product/price mapping
│   ├── ai/
│   │   ├── context.ts                  # Off Course company context prompt
│   │   ├── translate.ts                # Claude Sonnet translation service
│   │   ├── vision.ts                   # Google Gemini image analysis
│   │   └── blog.ts                     # Claude Sonnet blog generation
│   ├── analytics/
│   │   └── tracker.ts                  # First-party analytics tracker (~2KB)
│   └── i18n/
│       ├── config.ts                   # Supported locales
│       └── messages/                   # Translation JSON files (AI-generated)
├── hooks/                              # Custom React hooks
└── types/                              # Shared TypeScript types
```

### 1.2 Supabase Integration

**Existing tables to reuse directly (no changes needed):**
- `boats` — boat data + multi-lang descriptions
- `cruise_benefits`, `cruise_cancellation_policies`, `cruise_faqs`, `cruise_highlights`, `cruise_images`, `cruise_inclusions` — all cruise sub-content (will be linked to cruise_listings instead)
- `hero_carousel_items` — homepage hero
- `homepage_tour_cards` — homepage tour section
- `social_proof_reviews` — reviews with translations
- `team_members` — crew page
- `float_fam_members` — community members
- `merch_products`, `merch_images` — merch store
- `bookings` — FareHarbor booking records
- `webhook_logs` — webhook processing
- `analytics_sessions` — first-party visitor tracking (foundation for own analytics)
- `campaigns`, `campaign_links`, `campaign_clicks`, `campaign_sessions` — UTM/partner tracking
- `webp_conversion_log` — image processing log

**Tables to REMOVE (not migrated):**
- `stage_config` — AARRR pirate metrics config (not needed)
- `weekly_entry` — AARRR weekly tracking (not needed)
- `weekly_awareness_sources` — AARRR awareness sources (not needed)

**Tables to RESTRUCTURE — Virtual Product Layer:**

The `cruises` table evolves into a two-tier architecture:

```
FareHarbor (keep simple)              Off Course Database
─────────────────────                 ────────────────────────────────

Item (PK)                             fareharbor_items (synced)
  └── Resources (boat PKs)              └── fareharbor_resources (synced)
  └── Customer Types (PKs)              └── fareharbor_customer_types (synced)
        │                                       │
        │                                cruise_listings (many per FH item)
        │                                  ├── "Hidden Gems Private Tour"
        │                                  │     allowed_resource_pks: [all]
        │                                  │     allowed_customer_type_pks: [all]
        │                                  │     filters: {}
        │                                  ├── "Amsterdam Night Festival"
        │                                  │     allowed_resource_pks: [all]
        │                                  │     allowed_customer_type_pks: [all]
        │                                  │     filters: { time_after: "17:00" }
        │                                  ├── "Romantic Cruise for Two"
        │                                  │     allowed_resource_pks: [diana_pk]
        │                                  │     allowed_customer_type_pks: [1.5h, 2h]
        │                                  │     filters: { max_guests_override: 2 }
        │                                  ├── "Sunset Tour"
        │                                  │     allowed_resource_pks: [all]
        │                                  │     allowed_customer_type_pks: [all]
        │                                  │     filters: { sunset_offset: -60 }
        │                                  └── "Early Morning Cruise"
        │                                        allowed_resource_pks: [all]
        │                                        allowed_customer_type_pks: [all]
        │                                        filters: { time_before: "12:00" }
        │
        │  Each listing has:
        │  - own photos, descriptions, SEO, slug/URL
        │  - Layer 1: locked resources (which boats)
        │  - Layer 2: locked customer types (which durations)
        │  - Layer 3: time/date/sunset/seasonal rules
```

**Why this matters:**
- FareHarbor stays clean (few items, shared availability pool)
- Website gets unlimited SEO-rich product pages
- 3-layer filtering: resources (boats) → customer types (durations) → time/date rules
- Admin locks exactly which boats + durations appear per listing during setup
- One FareHarbor booking blocks the slot for ALL listings that share that item/resource
- Admin can create new listings without touching FareHarbor — just select, filter, publish

```sql
-- FareHarbor items (synced from API, source of truth for availability)
CREATE TABLE public.fareharbor_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  fareharbor_pk bigint NOT NULL UNIQUE,
  name text NOT NULL,
  shortname text NOT NULL DEFAULT 'offcourse',
  item_type text NOT NULL CHECK (item_type IN ('private', 'shared')),
  is_active boolean DEFAULT true,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT fareharbor_items_pkey PRIMARY KEY (id)
);

-- FareHarbor resources (boats) — synced from API per item
-- Each resource has its own capacity in FareHarbor
CREATE TABLE public.fareharbor_resources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  fareharbor_item_id uuid NOT NULL REFERENCES public.fareharbor_items(id),
  fareharbor_pk bigint NOT NULL UNIQUE,
  name text NOT NULL,                   -- "Diana", "Curaçao"
  capacity integer NOT NULL DEFAULT 1,  -- resource capacity (1 per boat)
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT fareharbor_resources_pkey PRIMARY KEY (id)
);

-- FareHarbor customer types — synced from API per item
-- Each customer type = a boat + duration combination
CREATE TABLE public.fareharbor_customer_types (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  fareharbor_item_id uuid NOT NULL REFERENCES public.fareharbor_items(id),
  fareharbor_pk bigint NOT NULL UNIQUE,
  name text NOT NULL,                   -- "Diana 1.5h", "Curaçao 2h", etc.
  boat_name text NOT NULL,              -- "diana" or "curacao" (derived/mapped)
  duration_minutes integer NOT NULL,    -- 90, 120, 180
  max_guests integer NOT NULL,          -- 8 for Diana, 12 for Curaçao
  price_cents integer,                  -- base price in cents (synced from FH)
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT fareharbor_customer_types_pkey PRIMARY KEY (id)
);

-- Cruise listings = the "virtual product" layer
-- Many listings can point to the same FareHarbor item
CREATE TABLE public.cruise_listings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  fareharbor_item_id uuid NOT NULL REFERENCES public.fareharbor_items(id),
  slug text NOT NULL UNIQUE,

  -- Content (all multi-lang, AI-translated)
  title text NOT NULL,
  title_nl text, title_de text, title_fr text,
  title_es text, title_pt text, title_zh text,
  tagline text,
  tagline_nl text, tagline_de text, tagline_fr text,
  tagline_es text, tagline_pt text, tagline_zh text,
  description text,
  description_nl text, description_de text, description_fr text,
  description_es text, description_pt text, description_zh text,

  -- Pricing display (for the listing card, actual price comes from FareHarbor)
  price_display text,               -- e.g. "From €165/hr" or "€35 p.p."
  price_label text,                 -- e.g. "per hour", "per person"
  starting_price numeric,

  -- SEO
  seo_title text,
  seo_meta_description text,
  seo_title_nl text, seo_title_de text, seo_title_fr text,
  seo_title_es text, seo_title_pt text, seo_title_zh text,
  seo_meta_description_nl text, seo_meta_description_de text, seo_meta_description_fr text,
  seo_meta_description_es text, seo_meta_description_pt text, seo_meta_description_zh text,

  -- ═══════════════════════════════════════════════════════
  -- ADVANCED FILTERING SYSTEM (3 layers)
  -- ═══════════════════════════════════════════════════════

  -- Layer 1: Resource (boat) filter
  -- Which FareHarbor resources (boats) are allowed for this listing?
  -- NULL = all resources from the linked item. Array = only these specific ones.
  -- Values are FareHarbor resource PKs, selected in admin during listing setup.
  allowed_resource_pks bigint[],    -- e.g. [12345] for Diana-only, NULL for all

  -- Layer 2: Customer type filter
  -- Which FareHarbor customer types (boat+duration combos) are allowed?
  -- NULL = all customer types from the linked item. Array = only these specific ones.
  -- Values are FareHarbor customer type PKs, selected in admin during listing setup.
  allowed_customer_type_pks bigint[], -- e.g. [111, 222] for only 1.5h+2h, NULL for all

  -- Layer 3: Availability (time/date) filter rules
  -- JSON rules applied on top of the resource + customer type filtering.
  availability_filters jsonb DEFAULT '{}',
  /*
    Examples of availability_filters:

    Standard (no extra filtering):
    {}

    Night Festival (only after 17:00):
    { "time_after": "17:00" }

    Early Morning (only until 12:00):
    { "time_before": "12:00" }

    Sunset Tour (dynamic — fetches sunset time per day):
    { "sunset_offset_minutes": -60, "sunset_window_minutes": 120 }

    Romantic for Two (guest cap override):
    { "max_guests_override": 2 }

    Seasonal (only available in certain months):
    { "months": [6, 7, 8] }

    Weekend only:
    { "days_of_week": [5, 6] }

    Combined (Night Festival, summer weekends only):
    { "time_after": "17:00", "months": [5, 6, 7, 8, 9], "days_of_week": [4, 5, 6] }
  */

  -- Display
  display_order integer DEFAULT 0,
  is_published boolean DEFAULT false,
  is_featured boolean DEFAULT false, -- show on homepage
  category text DEFAULT 'standard', -- 'standard', 'special', 'seasonal', 'event'

  -- Metadata
  departure_location text DEFAULT 'Keizersgracht 62, Amsterdam',
  google_maps_link text,
  minimum_duration_hours numeric,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT cruise_listings_pkey PRIMARY KEY (id)
);

-- Listing images (each listing has its own photos)
CREATE TABLE public.cruise_listing_images (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.cruise_listings(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  alt_text text,
  alt_text_nl text, alt_text_de text, alt_text_fr text,
  alt_text_es text, alt_text_pt text, alt_text_zh text,
  sort_order integer DEFAULT 0,
  is_hero boolean DEFAULT false,
  media_type text DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT cruise_listing_images_pkey PRIMARY KEY (id)
);

-- Listing benefits, FAQs, etc. — same pattern as existing cruise sub-tables
-- but linked to cruise_listings instead of cruises
CREATE TABLE public.cruise_listing_benefits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.cruise_listings(id) ON DELETE CASCADE,
  benefit_text text NOT NULL,
  benefit_text_nl text, benefit_text_de text, benefit_text_fr text,
  benefit_text_es text, benefit_text_pt text, benefit_text_zh text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT cruise_listing_benefits_pkey PRIMARY KEY (id)
);

CREATE TABLE public.cruise_listing_faqs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.cruise_listings(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text NOT NULL,
  question_nl text, question_de text, question_fr text,
  question_es text, question_pt text, question_zh text,
  answer_nl text, answer_de text, answer_fr text,
  answer_es text, answer_pt text, answer_zh text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT cruise_listing_faqs_pkey PRIMARY KEY (id)
);

-- Sunset times cache (for sunset-based availability filtering)
CREATE TABLE public.sunset_times (
  date date NOT NULL,
  city text NOT NULL DEFAULT 'amsterdam',
  sunset_time time NOT NULL,
  sunrise_time time,
  fetched_at timestamptz DEFAULT now(),
  CONSTRAINT sunset_times_pkey PRIMARY KEY (date, city)
);
```

**3-Layer filter engine (`src/lib/fareharbor/filters.ts`):**

```typescript
// ── Types ──────────────────────────────────────────────
interface ListingFilterConfig {
  allowed_resource_pks: bigint[] | null;      // Layer 1
  allowed_customer_type_pks: bigint[] | null; // Layer 2
  availability_filters: AvailabilityFilters;  // Layer 3
}

interface AvailabilityFilters {
  time_after?: string;              // "17:00"
  time_before?: string;             // "12:00"
  sunset_offset_minutes?: number;   // -60 = 60min before sunset
  sunset_window_minutes?: number;   // 120 = window size
  max_guests_override?: number;     // cap guests below boat max
  months?: number[];                // [6,7,8]
  days_of_week?: number[];          // [5,6] = Fri+Sat
}

// ── Main filter pipeline ───────────────────────────────
async function applyAllFilters(
  availabilities: Availability[],
  listing: ListingFilterConfig,
  guestCount: number,
  date: Date
): Promise<Availability[]> {
  let result = [...availabilities];

  // ▸ Layer 1: Resource filter (which boats)
  // Strip out customer_type_rates that belong to non-allowed resources
  if (listing.allowed_resource_pks?.length) {
    result = result.map(avail => ({
      ...avail,
      customer_type_rates: avail.customer_type_rates.filter(rate =>
        // Keep only rates whose resource PK is in the allowed list
        rate.resource_pks?.some(rpk => listing.allowed_resource_pks!.includes(rpk))
        ?? true // if no resource info on rate, keep it
      ),
    })).filter(avail => avail.customer_type_rates.length > 0);
  }

  // ▸ Layer 2: Customer type filter (which boat+duration combos)
  // Strip out customer_type_rates not in the allowed list
  if (listing.allowed_customer_type_pks?.length) {
    result = result.map(avail => ({
      ...avail,
      customer_type_rates: avail.customer_type_rates.filter(rate =>
        listing.allowed_customer_type_pks!.includes(rate.customer_type.pk)
      ),
    })).filter(avail => avail.customer_type_rates.length > 0);
  }

  // ▸ Layer 3a: Date/time filters
  const filters = listing.availability_filters;

  // Month filter (early exit — no point filtering slots if wrong month)
  if (filters.months?.length && !filters.months.includes(date.getMonth() + 1)) {
    return [];
  }

  // Day of week filter
  if (filters.days_of_week?.length && !filters.days_of_week.includes(date.getDay())) {
    return [];
  }

  // Time-of-day filters
  if (filters.time_after) {
    result = result.filter(a => getTimeFromAvailability(a) >= filters.time_after!);
  }
  if (filters.time_before) {
    result = result.filter(a => getTimeFromAvailability(a) <= filters.time_before!);
  }

  // Sunset filter (dynamic per day)
  if (filters.sunset_offset_minutes !== undefined) {
    const sunsetTime = await getSunsetTime(date); // from sunset_times table or API
    const windowStart = addMinutes(sunsetTime, filters.sunset_offset_minutes);
    const windowEnd = addMinutes(windowStart, filters.sunset_window_minutes ?? 120);
    result = result.filter(a => {
      const time = getTimeFromAvailability(a);
      return time >= formatTime(windowStart) && time <= formatTime(windowEnd);
    });
  }

  // ▸ Layer 3b: Guest count (PRD logic — applied last)
  // Uses max_guests_override if set, otherwise falls back to customer type maxGuests
  const effectiveMaxGuests = filters.max_guests_override;
  result = result.filter(avail =>
    avail.customer_type_rates.some(rate => {
      const config = CUSTOMER_TYPES[rate.customer_type.pk];
      if (!config) return false;
      const maxG = effectiveMaxGuests ?? config.maxGuests;
      if (maxG < guestCount) return false;
      if ((rate.capacity ?? 0) < 1) return false;
      return true;
    })
  );

  return result;
}
```

**How it flows in the booking UI:**
1. User visits `/cruises/amsterdam-night-festival` (a cruise_listing)
2. Page loads listing content (photos, description, etc.) from Supabase
3. Page also loads the listing's filter config: `allowed_resource_pks`, `allowed_customer_type_pks`, `availability_filters`
4. User picks a date → API fetches FareHarbor availabilities for the linked item
5. **3 filter layers applied in sequence:**
   - Layer 1: Resource filter → removes boats not allowed for this listing
   - Layer 2: Customer type filter → removes duration/boat combos not allowed
   - Layer 3: Time/date + guest count filters → removes slots outside the time window + PRD capacity logic
6. User sees only the timeslots that pass ALL 3 layers
7. Booking UI adapts: if only 1 boat remains after filtering, skip boat selection step
8. Rest of booking flow: select duration → checkout

**Example: "Romantic Cruise for Two" on Diana only, 1.5h or 2h:**
```json
{
  "allowed_resource_pks": [12345],
  "allowed_customer_type_pks": [111, 222],
  "availability_filters": { "max_guests_override": 2 }
}
```
→ Only Diana shows, only 1.5h and 2h duration options, max 2 guests regardless of Diana's actual 8-person capacity.

**Tables to ADD in Phase 1:**

```sql
-- Stripe payment tracking (extends existing bookings table)
ALTER TABLE public.bookings
  ADD COLUMN stripe_payment_intent_id text,
  ADD COLUMN stripe_payment_status text DEFAULT 'pending',
  ADD COLUMN stripe_amount integer,
  ADD COLUMN stripe_currency text DEFAULT 'eur',
  ADD COLUMN boat_name text,
  ADD COLUMN duration_minutes integer,
  ADD COLUMN guest_count integer,
  ADD COLUMN fareharbor_availability_pk bigint;

-- Merch orders (separate from cruise bookings)
CREATE TABLE public.merch_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  stripe_payment_intent_id text NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  shipping_address jsonb NOT NULL,
  items jsonb NOT NULL,  -- [{product_id, size, quantity, price}]
  total_amount integer NOT NULL,
  currency text DEFAULT 'eur',
  status text DEFAULT 'pending',
  tracking_number text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT merch_orders_pkey PRIMARY KEY (id)
);
```

**Generate TypeScript types:**
```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/lib/supabase/types.ts
```

### 1.3 FareHarbor API Integration

**Company shortname:** `offcourse`
**Auth headers on every request:**
```typescript
const FH_HEADERS = {
  'X-FareHarbor-API-App': process.env.FAREHARBOR_API_APP!,
  'X-FareHarbor-API-User': process.env.FAREHARBOR_API_USER!,
};
```

**API wrapper (`src/lib/fareharbor/client.ts`):**

Core methods needed:
1. `getItems()` → GET `/api/v1/companies/offcourse/items/`
2. `getAvailabilities(itemPk, date)` → GET `/api/v1/companies/offcourse/items/{pk}/minimal/availabilities/date/{date}/` (use minimal endpoint for performance)
3. `getAvailabilityDetail(availPk)` → GET `/api/v1/companies/offcourse/availabilities/{pk}/`
4. `validateBooking(availPk, data)` → POST `/api/v1/companies/offcourse/availabilities/{pk}/bookings/validate/`
5. `createBooking(availPk, data)` → POST `/api/v1/companies/offcourse/availabilities/{pk}/bookings/`

**Rate limiting strategy:**
- Max 30 req/sec, 3000 req/5min per IP
- Implement server-side request queue with exponential backoff
- Cache availability data in memory (60s TTL) — availabilities don't change that frequently
- Use minimal availability endpoint where possible (much smaller payloads)
- Batch date range requests (max 7 days per request)

**Customer Types Config (from PRD):**
```typescript
// src/lib/fareharbor/config.ts
export const CUSTOMER_TYPES: Record<number, CustomerTypeConfig> = {
  [DIANA_1H5_PK]:    { boat: 'diana',   duration: 90,  maxGuests: 8,  priority: 1 },
  [DIANA_2H_PK]:     { boat: 'diana',   duration: 120, maxGuests: 8,  priority: 1 },
  [DIANA_3H_PK]:     { boat: 'diana',   duration: 180, maxGuests: 8,  priority: 1 },
  [CURACAO_1H5_PK]:  { boat: 'curacao', duration: 90,  maxGuests: 12, priority: 2 },
  [CURACAO_2H_PK]:   { boat: 'curacao', duration: 120, maxGuests: 12, priority: 2 },
  [CURACAO_3H_PK]:   { boat: 'curacao', duration: 180, maxGuests: 12, priority: 2 },
};
```
> **Note:** The actual PKs need to be retrieved from the FareHarbor API during setup. Use the demo API first, then swap to live keys.

### 1.4 Booking Flow (Search-First, Unified Per Listing Type)

The booking flow starts with **search availability** — users never browse blindly. Two entry points feed into the same per-listing booking flow.

#### Entry Point 1: Homepage Search Bar (primary user journey)
1. Homepage hero contains a **search bar**: date picker + guest count + "Search" button
2. User picks date & number of guests → clicks Search
3. **Search results section** appears below the hero, showing all matching `cruise_listings` for that date
4. Each result card shows: hero photo, cruise name, available departure times, duration info, starting price
5. Results are filtered through each listing's 3-layer filter system — only listings with actual availability appear
6. User clicks a result → navigates to `/cruises/{slug}?date=YYYY-MM-DD&guests=N` (pre-filled)

#### Entry Point 2: Direct Cruise Page (SEO / ads / links)
1. User lands on `/cruises/{slug}` from Google, ad, Instagram, etc.
2. Cruise detail page has its own date picker + guest count
3. Same booking flow from there

#### Per-Listing Booking Flow (on cruise detail page)
**Private listing:** Date → Guests → Timeslot (filtered by listing rules + PRD) → Boat card → Duration → Checkout
**Shared listing:** Date → Persons → Timeslot (filtered by listing rules) → Checkout

**Components:**
```
booking/
├── SearchBar.tsx            # Homepage search: date + guests + search button
├── SearchResults.tsx        # Grid of matching cruise listing cards
├── SearchResultCard.tsx     # Photo, name, times, duration, price
├── DatePicker.tsx           # Calendar with availability indicators
├── GuestCounter.tsx         # Guest count selector
├── TimeSlotGrid.tsx         # Available time slots (filtered by PRD logic)
├── BoatCard.tsx             # Boat display with status (available/sold out)
├── DurationSelector.tsx     # 1.5h / 2h / 3h options per boat
├── BookingSummary.tsx        # Price breakdown + details
├── CheckoutForm.tsx         # Stripe Elements form
└── ConfirmationView.tsx     # Post-payment success
```

**Filter logic (from PRD — implement exactly):**

```typescript
function getValidTimeSlots(availabilities: Availability[], guestCount: number) {
  return availabilities.filter(a =>
    a.customer_type_rates.some(rate => {
      const config = CUSTOMER_TYPES[rate.customer_type.pk];
      if (!config) return false;
      if (config.maxGuests < guestCount) return false;
      if ((rate.capacity ?? 0) < 1) return false;
      return true;
    })
  );
}

function getAvailableDurations(availability: Availability, boat: string, guestCount: number) {
  return availability.customer_type_rates
    .filter(rate => {
      const config = CUSTOMER_TYPES[rate.customer_type.pk];
      return config?.boat === boat
        && config.maxGuests >= guestCount
        && (rate.capacity ?? 0) >= 1;
    })
    .map(rate => CUSTOMER_TYPES[rate.customer_type.pk].duration)
    .sort((a, b) => a - b);
}

function getBoatStatus(availability: Availability, boat: string, guestCount: number) {
  const rates = availability.customer_type_rates.filter(rate => {
    const config = CUSTOMER_TYPES[rate.customer_type.pk];
    return config?.boat === boat;
  });
  if (rates.length === 0) return 'unavailable';
  const hasCapacity = rates.some(r => (r.capacity ?? 0) >= 1);
  if (!hasCapacity) return 'sold_out';
  const fitsGuests = rates.some(r => CUSTOMER_TYPES[r.customer_type.pk].maxGuests >= guestCount);
  if (!fitsGuests) return 'too_many_guests';
  return 'available';
}
```

**Critical:** Resource capacity = 1 per boat in FareHarbor. `capacity >= 1` means available, `capacity < 1` means booked.

### 1.5 Listing-Type Variants

The booking flow component auto-detects private vs. shared from the listing's linked `fareharbor_item.item_type`:

**Private listings** (e.g. "Hidden Gems", "Night Festival", "Romantic Cruise"):
- Boat selection shown (Diana/Curaçao cards)
- Duration selector (1.5h / 2h / 3h)
- Per-hour pricing
- PRD filter logic applies (capacity, guest count, boat)
- Listing filters applied first (time-of-day, sunset, seasonal)

**Shared listings** (e.g. "Shared Canal Experience"):
- No boat selection (assigned by Off Course)
- Per-person pricing (€35 p.p.)
- Max 6 persons per booking
- Simpler flow — fewer decision points
- Listing filters still apply (if any)

Both types use the same FareHarbor availability endpoints under the hood. The listing's `fareharbor_item_id` determines which FH item to query.

### 1.6 Stripe Native Checkout

**Why native (Payment Intents) instead of Checkout Sessions:**
- Full control over the checkout UI for Google Ads conversion tracking
- `purchase` event fires on YOUR domain, not stripe.com
- Custom dataLayer push with booking details for Google Ads Enhanced Conversions

**Flow:**
```
1. User completes booking form
2. Client → POST /api/stripe/create-payment-intent
   - Server creates PaymentIntent with metadata (booking details)
   - Server creates FareHarbor booking with status=pending (via validate endpoint)
   - Returns clientSecret to client
3. Client renders Stripe Elements (PaymentElement)
4. User submits payment
5. stripe.confirmPayment() → redirects to /book/confirmation?payment_intent={id}
6. Confirmation page verifies payment status
7. Stripe webhook (payment_intent.succeeded) →
   - Confirm FareHarbor booking (POST to bookings endpoint)
   - Update Supabase bookings table
   - Fire any notifications
```

**Google Ads tracking integration:**
```typescript
// On confirmation page, after verifying payment:
window.dataLayer?.push({
  event: 'purchase',
  ecommerce: {
    transaction_id: paymentIntent.id,
    value: amount / 100,
    currency: 'EUR',
    items: [{
      item_name: `${boatName} - ${duration}min`,
      item_category: cruiseType,
      price: amount / 100,
      quantity: 1,
    }],
  },
});
```

### 1.7 Internationalization (i18n) — AI-Powered via Claude Sonnet

**Strategy:** Use `next-intl` for routing + rendering. All translations (both dynamic content and static UI strings) are generated automatically by Claude Sonnet. No manual translation work.

**Supported locales:** `en` (default), `nl`, `de`, `fr`, `es`, `pt`, `zh`

The existing schema already has `_nl`, `_de`, `_fr`, `_es`, `_pt`, `_zh` columns on all content tables — these become the storage layer for AI-generated translations.

**How AI translation works:**

1. Admin creates/edits content in English (or Dutch)
2. On save → API route calls Claude Sonnet with company context system prompt + source text
3. Claude returns translations for all 6 target languages in one batch call (JSON response)
4. Translations are written to the corresponding `_nl`, `_de`, etc. columns in Supabase
5. Admin can review/override any translation before publishing

**Claude Sonnet translation service (`src/lib/ai/translate.ts`):**
```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const COMPANY_CONTEXT = `You are translating content for Off Course Amsterdam,
a premium electric boat tour company in Amsterdam. The brand voice is warm,
adventurous, and informal but professional. Key terms to preserve:
- "Off Course" = always keep as "Off Course" (brand name, never translate)
- "Diana" and "Curaçao" = boat names, never translate
- "hidden gems" = core brand concept, translate the meaning not literally
- "skipper" = use local equivalent (schipper in NL, Kapitän in DE, etc.)
Maintain the playful, exploratory tone of the brand.`;

async function translateContent(
  sourceText: string,
  sourceLang: string,
  targetLangs: string[]
): Promise<Record<string, string>> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: COMPANY_CONTEXT,
    messages: [{
      role: 'user',
      content: `Translate the following ${sourceLang} text into these languages: ${targetLangs.join(', ')}. Return ONLY valid JSON with language codes as keys, nothing else.\n\n${sourceText}`
    }],
  });
  return JSON.parse(response.content[0].type === 'text' ? response.content[0].text : '{}');
}
```

**Static UI strings** also AI-generated: a build script runs Claude Sonnet on the English `messages/en.json` and generates `messages/{locale}.json` for all other locales. These are committed to the repo (not generated at runtime) for performance.

**Locale helper (unchanged — reads from Supabase columns):**
```typescript
export const locales = ['en', 'nl', 'de', 'fr', 'es', 'pt', 'zh'] as const;
export const defaultLocale = 'en' as const;

export function getLocalizedField(row: any, field: string, locale: string): string {
  if (locale === 'en') return row[field] ?? '';
  return row[`${field}_${locale}`] ?? row[field] ?? '';
}
```

### 1.8 SEO Fundamentals

- `generateMetadata()` on all pages using Supabase `seo_title` and `seo_meta_description` fields (already multi-lang)
- Structured data (JSON-LD) for: Organization, LocalBusiness, Product (cruises), BreadcrumbList
- `sitemap.xml` and `robots.txt` via Next.js metadata API
- Open Graph + Twitter Card meta tags
- Canonical URLs per locale
- `<link rel="alternate" hreflang="x">` for all supported languages

### 1.9 Public Pages Breakdown

| Page | Data Source | Rendering |
|------|-----------|-----------|
| Homepage | `hero_carousel_items` + search bar (date/guests) + `cruise_listings` (featured) + `social_proof_reviews` | ISR (revalidate 60s), search results client-side |
| Search results (on homepage) | `cruise_listings` + FareHarbor API (real-time availability per listing, filtered by 3-layer system) | Client-side (triggered by search) |
| Cruise listing detail | `cruise_listings` + listing sub-tables (images, benefits, FAQs) + booking flow | ISR (revalidate 60s), booking flow client-side |
| Checkout | Stripe (client-side) | Client-side |
| Merch | `merch_products` + `merch_images` | ISR (revalidate 60s) |
| The Cozy Crew | `team_members` + `float_fam_members` | ISR (revalidate 300s) |
| Privacy / Terms | Static MDX or Supabase | Static |

### 1.10 Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# FareHarbor
FAREHARBOR_API_APP=         # App-level key
FAREHARBOR_API_USER=        # User-level key
FAREHARBOR_API_BASE=https://fareharbor.com/api/v1

# Stripe
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

# Vercel
NEXT_PUBLIC_SITE_URL=https://offcourseamsterdam.com

# AI — Claude Sonnet (text) + Google Gemini (vision)
ANTHROPIC_API_KEY=          # Claude Sonnet: translations, blog writing, content
GOOGLE_AI_API_KEY=          # Gemini: image analysis, labeling, scene detection

# Optional
REVALIDATION_SECRET=        # For on-demand ISR
```

---

## Phase 2 — Admin Backend + Operations

### 2.1 Admin Authentication

**New tables:**
```sql
CREATE TABLE public.admin_users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  is_active boolean DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT admin_users_pkey PRIMARY KEY (id)
);
```

**Auth strategy:** Supabase Auth with magic link (no passwords). Admin middleware checks `admin_users` table and role before granting access.

### 2.2 Admin Dashboard Pages

```
/admin
├── /dashboard          # KPI overview (bookings today, revenue, upcoming)
├── /bookings           # All bookings list + detail view
├── /planning           # Calendar view of all availabilities + crew
├── /crew               # Skipper management + shift assignment
├── /content
│   ├── /listings       # Cruise listing manager (create/edit virtual products)
│   │                   #   → Step 1: Select FareHarbor item
│   │                   #   → Step 2: Advanced filter setup (resources, customer types, time rules)
│   │                   #   → Step 3: Content (photos, descriptions, SEO)
│   │                   #   → Step 4: AI-translate all fields
│   ├── /fareharbor-items # View/sync FareHarbor items + resources + customer types
│   ├── /homepage       # Edit hero, tour cards, reviews
│   ├── /merch          # Product management
│   └── /team           # Team member management
├── /campaigns          # Campaign/partner link management
├── /analytics          # First-party analytics dashboard
└── /settings           # Admin users, API keys, config
```

### 2.3 Skipper Planning (FareHarbor Crew Members API)

**New tables:**
```sql
CREATE TABLE public.skippers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  fareharbor_crew_member_id bigint UNIQUE,
  name text NOT NULL,
  email text,
  phone text,
  slack_user_id text,              -- For Slack notifications
  is_active boolean DEFAULT true,
  certifications jsonb DEFAULT '[]',
  preferred_boat text,              -- 'diana' or 'curacao'
  max_shifts_per_week integer DEFAULT 5,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT skippers_pkey PRIMARY KEY (id)
);

CREATE TABLE public.shift_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  skipper_id uuid NOT NULL REFERENCES public.skippers(id),
  fareharbor_availability_pk bigint NOT NULL,
  boat_name text NOT NULL,
  shift_date date NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text DEFAULT 'assigned' CHECK (status IN ('assigned', 'confirmed', 'cancelled', 'completed')),
  notes text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT shift_assignments_pkey PRIMARY KEY (id)
);
```

**Integration with FareHarbor Crew Members API:**
- Sync skippers ↔ FareHarbor crew members
- When admin assigns skipper to shift → PUT to FareHarbor Crew Members endpoint to update availability assignment
- Webhook `crew-member.updated` keeps local DB in sync

### 2.4 First-Party Analytics (Replace GA4 Dependency)

Build your own cookie-less, privacy-friendly analytics on top of the existing `analytics_sessions` table. No third-party cookies, no GDPR consent banner needed for your own data.

**Extend existing schema:**
```sql
-- Page views (new — granular tracking per page)
CREATE TABLE public.analytics_pageviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id text NOT NULL REFERENCES public.analytics_sessions(id),
  path text NOT NULL,
  title text,
  referrer text,
  duration_ms integer,
  scroll_depth integer,           -- percentage 0-100
  created_at timestamptz DEFAULT now(),
  CONSTRAINT analytics_pageviews_pkey PRIMARY KEY (id)
);

-- Conversion events (booking started, checkout reached, payment completed)
CREATE TABLE public.analytics_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id text NOT NULL REFERENCES public.analytics_sessions(id),
  event_name text NOT NULL,       -- 'booking_started', 'checkout_reached', 'payment_completed', 'merch_added_to_cart'
  event_data jsonb DEFAULT '{}',  -- flexible payload
  page_path text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT analytics_events_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_analytics_events_name ON public.analytics_events(event_name);
CREATE INDEX idx_analytics_events_created ON public.analytics_events(created_at);
CREATE INDEX idx_analytics_pageviews_session ON public.analytics_pageviews(session_id);
```

**Tracking approach:**
- Lightweight client-side script (`src/lib/analytics/tracker.ts`) — ~2KB, no external dependencies
- Fingerprint-free: use session ID stored in sessionStorage (not a cookie)
- Track: page views, scroll depth, time on page, UTM params, referrer, device/browser
- Track conversion funnel: page visit → booking started → checkout → payment
- Campaign attribution via existing `campaign_sessions` table

**Admin analytics dashboard (`/admin/analytics`):**
- Visitors over time (daily/weekly/monthly)
- Top pages by views
- Conversion funnel visualization (visit → book → pay)
- Traffic sources breakdown (organic, direct, UTM campaigns, partner links)
- Device/browser/country breakdown
- Campaign performance (clicks → sessions → bookings → revenue)
- Real revenue attribution per campaign without relying on Google

**Why this matters:** You own 100% of your visitor data. No sampling, no cookie consent required for first-party analytics, no dependency on Google's changing policies. Campaign tracking ties directly to your `campaigns` and `campaign_sessions` tables for accurate ROI measurement.

### 2.5 Operations Calendar

Visual calendar showing:
- All FareHarbor availabilities (fetched daily, cached)
- Assigned skippers per slot
- Booking status per slot (open / booked / in progress)
- Color coding by boat (Diana = blue, Curaçao = orange)

---

## Phase 3 — Slack, AI, SEO Tools, Dev Tools

### 3.1 Slack Integration

**New tables:**
```sql
CREATE TABLE public.slack_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  message_type text NOT NULL,  -- 'shift_reminder', 'daily_briefing', 'new_booking', 'cancellation'
  payload jsonb NOT NULL,
  sent_at timestamptz,
  status text DEFAULT 'pending',
  error text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT slack_notifications_pkey PRIMARY KEY (id)
);
```

**Notification types:**
1. **Shift reminder** — Sent to skipper's DM 24h and 2h before shift
2. **New booking** — Posted to #bookings channel when payment confirmed
3. **Cancellation** — Posted to #bookings when FareHarbor webhook fires `booking.cancelled`
4. **Daily briefing** — Morning summary posted to #operations: today's bookings, assigned skippers, weather

**Implementation:** Slack Web API via `@slack/web-api` package. Triggered by:
- Vercel Cron jobs (daily briefing, shift reminders)
- Webhook handlers (new bookings, cancellations)

### 3.2 AI-Powered Tools (Claude Sonnet for Text + Google Gemini for Vision)

Two AI providers, each used for what they're best at:
- **Claude Sonnet** (Anthropic) → all text generation: translations, blog writing, SEO content, alt-text writing
- **Google Gemini** → all image understanding: photo analysis, labeling, scene detection, SEO filename generation from visual content

**Company context system prompt (shared across all Claude calls):**
```typescript
// src/lib/ai/context.ts
export const OFF_COURSE_SYSTEM_PROMPT = `You are the voice of Off Course Amsterdam.

WHO WE ARE:
Off Course is "your friend with a boat." Not a tour company — the friend who happens to have a boat and knows all the good spots. Founded by Jannah & Beer. Two electric boats: Diana (max 8 guests, intimate & cozy) and Curaçao (max 12 guests, spacious & social). We cruise Amsterdam's hidden gems — lesser-known canals, local rhythm, the real city.

OUR DNA:
- WHY: Being on the water feels like home.
- VISION: A world where more people find peace on the water. Where tourists feel like locals & locals feel like themselves.
- MISSION: We create boats with vibes so good, the effect is instant. You're relaxed, connected, and fully present.
- VALUES: Effortless, Local, Memorable, Chill.

POSITIONING:
Not your average canal tour. We sit between budget tourist boats and stiff luxury charters — quality, taste, and zero pretension. "We're down to water."

TONE OF VOICE:
Write like a laid-back, familiar friend with dry humor and warmth. Like your funniest friend who always has an extra towel. Follow these 5 pillars:
1. Warm & Welcoming — like greeting an old friend. "Come as you are" energy.
2. Unpolished on Purpose — slightly raw, slightly imperfect. Real over polished. Never corporate.
3. Dry Playful Humor — subtle, a wink not a punchline. Deadpan Amsterdam meets Brooklyn dry wit.
4. Relaxed Casual Flow — sentences can be short. Or long and winding. Like a canal.
5. Low-Key Poetic — sneak in beauty. "The light hits different from the water." Grounded, not flowery.

CONTENT RULES:
- NEVER sound corporate. No "embark on a journey", no "exclusive experience", no "book now to avoid disappointment."
- NEVER use luxury-coded language ("exclusive", "premium", "bespoke", "curated experience").
- NEVER be preachy about sustainability — it's just how we roll.
- DO sound like a friend texting about plans. Casual, warm, real.
- DO use humor sparingly and dryly — a wink, not a LOL.
- Useful phrases: "off the beaten path", "hidden gems", "the real Amsterdam", "local rhythm", "vibes are immaculate", "come as you are", "no dress code, no nonsense", "the city slows down from here."

TARGET AUDIENCE:
- Shared cruises: conscious travelers in their 30s-40s (think Austin/NYC/Berlin). Vibes over luxury. "No Heineken hats, no loud music."
- Private cruises: young expats and locals with taste. Hosting friends, dodging tourist chaos. Depth over hype.

PRACTICAL:
- Durations: 1.5h, 2h, 3h. Private cruises from €165/hour, shared from €35/person.
- Languages: English (primary), Dutch, German, French, Spanish, Portuguese, Chinese.
- All boats are electric — mention naturally, never as a selling point lecture.

TRANSLATION RULES:
- "Off Course" (brand name) → NEVER translate
- "Diana" and "Curaçao" (boat names) → NEVER translate
- "Hidden gems" → translate the MEANING, not literally
- "Skipper" → use local equivalent (schipper in NL, Kapitän in DE, capitán in ES, etc.)
- Keep the same casual, warm tone in every language. Don't formalize in translation.`;
```

**Image labeling + SEO naming (Google Gemini Vision):**
```typescript
// src/lib/ai/vision.ts
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);

async function analyzeImage(imageBuffer: Buffer, mimeType: string) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent([
    'Analyze this image in the context of Off Course Amsterdam boat tours. Return JSON with: description (1 sentence), tags (array of keywords), suggested_seo_filename (lowercase-hyphenated, descriptive), scene_type (boat/canal/guests/food/cityscape/sunset/other).',
    { inlineData: { data: imageBuffer.toString('base64'), mimeType } },
  ]);
  return JSON.parse(result.response.text());
}
```
- On image upload → Gemini analyzes the photo → returns description, tags, SEO filename
- Then Claude Sonnet generates alt-text in all 7 languages based on Gemini's description
- Auto-tag with categories: `['boat', 'canal', 'guests', 'sunset', 'drinks']`
- Store everything in `image_library` table

**Blog writing (Claude Sonnet + SEO keywords):**
- Admin selects target keyword(s) from uploaded `seo_keywords` table
- Claude Sonnet generates draft blog post using company context + keywords
- SEO-optimized with target keywords, meta description, structured headings
- Auto-translated to all 6 languages (also by Claude Sonnet)
- Admin reviews, edits, and publishes
- Stored in `blog_posts` table

**SEO Keywords management (Admin — Phase 2):**
- CSV/Excel upload of keyword research data (keyword, language, search volume, difficulty)
- Keywords serve as input for AI blog generation and content optimization
- Track which keywords have associated blog posts / pages

**Content translation (integrated into admin content editors):**
- Any content field edit → "Generate translations" button
- Calls Claude Sonnet with company context + source text
- Returns all 6 translations in one JSON response
- Admin can review/override before saving

**New tables:**
```sql
CREATE TABLE public.image_library (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  seo_filename text,
  webp_path text,
  file_size integer,
  width integer,
  height integer,
  ai_description text,
  ai_labels jsonb DEFAULT '[]',
  alt_text text,
  alt_text_nl text, alt_text_de text, alt_text_fr text,
  alt_text_es text, alt_text_pt text, alt_text_zh text,
  uploaded_by uuid,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT image_library_pkey PRIMARY KEY (id)
);

CREATE TABLE public.blog_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  title_nl text, title_de text, title_fr text,
  title_es text, title_pt text, title_zh text,
  content text NOT NULL,
  content_nl text, content_de text, content_fr text,
  content_es text, content_pt text, content_zh text,
  excerpt text,
  featured_image_id uuid REFERENCES public.image_library(id),
  seo_title text,
  seo_meta_description text,
  target_keywords text[],
  is_published boolean DEFAULT false,
  published_at timestamptz,
  author text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT blog_posts_pkey PRIMARY KEY (id)
);

CREATE TABLE public.seo_keywords (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  keyword text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  search_volume integer,
  difficulty integer,
  current_rank integer,
  target_page text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT seo_keywords_pkey PRIMARY KEY (id)
);
```

### 3.3 WebP Converter

Already partially implemented (existing `webp_conversion_log` table). Extend with:
- Supabase Edge Function or Next.js API route that triggers on storage upload
- Uses `sharp` to convert any uploaded image to WebP
- Updates all DB references to point to WebP version
- Keeps original as backup

### 3.4 FareHarbor API Dev Tools (Admin)

Admin page at `/admin/dev/fareharbor` with:
- **API Explorer** — Test any FareHarbor endpoint with live/demo keys
- **Availability Viewer** — Visual grid of all availabilities for a date range
- **Webhook Logs** — View incoming webhooks from `webhook_logs` table
- **Sync Status** — Show last sync time, any errors, data freshness
- **Key Toggle** — Switch between demo and live API keys for testing

---

## Parallel Workstreams for Claude Code

This is designed so multiple features can be developed independently in parallel Claude Code sessions.

### Phase 1 Parallel Tracks

```
Track A: Core Setup + Infra          Track B: Public Pages
─────────────────────────             ─────────────────────
1. Next.js scaffold                   1. Homepage (hero, tours, reviews)
2. Supabase client setup              2. Cruise detail page
3. i18n config                        3. Merch page
4. Layout (nav, footer, WhatsApp)     4. Cozy Crew page
5. Middleware (locale routing)         5. Privacy + Terms pages
                                      6. 404 page

Track C: FareHarbor + Listing Layer    Track D: Stripe + Checkout
───────────────────────────           ──────────────────────────
1. FH API client wrapper              1. Stripe server client
2. fareharbor_items sync              2. PaymentIntent API route
3. Availability API route             3. Stripe Elements checkout form
4. Listing filter engine              4. Confirmation page + verification
5. PRD filter logic (layer 2)         5. Stripe webhook handler
6. Unified booking flow UI            6. Google Ads dataLayer integration
7. FH webhook handler                 7. Merch checkout flow
8. Sunset times API + cache
```

**Dependency graph:**
```
Track A ──→ Track B (needs layout + supabase)
Track A ──→ Track C (needs supabase + env vars)
Track A ──→ Track D (needs supabase)
Track C ──→ Track D (checkout needs booking data from FH)
```

So: **Start with Track A**, then immediately split into **B + C in parallel**, then **D** once C has the booking flow data model defined.

### Phase 2 Parallel Tracks

```
Track E: Admin Shell + Auth           Track F: Operations
───────────────────────               ────────────────────
1. Admin layout + sidebar             1. Bookings list/detail
2. Supabase Auth integration          2. Planning calendar
3. Role-based middleware              3. Skipper management
4. Admin users CRUD                   4. Shift assignment UI
                                      5. FH Crew Members API sync

Track G: Content + Listing Management
──────────────────────────────────────
1. FareHarbor sync engine (items → resources → customer types)
2. Listing creation wizard (see below)
3. Advanced filter builder UI
4. Homepage content editor
5. Merch product editor
6. Team member editor
7. On-demand ISR trigger

### Listing Creation Wizard (Admin — Key Feature)

The admin listing editor is a multi-step wizard:

**Step 1: Select FareHarbor Item**
- Dropdown of synced FareHarbor items
- Shows item name, type (private/shared), number of linked listings

**Step 2: Advanced Filter Setup**
After selecting the FH item, the admin sees ALL available resources and
customer types for that item (fetched from local `fareharbor_resources`
and `fareharbor_customer_types` tables, originally synced from the API).

```
┌─────────────────────────────────────────────────────┐
│ RESOURCES (boats)                                    │
│                                                      │
│ ☑ Diana      (PK: 12345, capacity: 1, max 8 guests) │
│ ☑ Curaçao    (PK: 67890, capacity: 1, max 12 guests)│
│                                                      │
│ ⓘ Uncheck a resource to hide that boat for this     │
│   listing. Checked = available in booking flow.      │
├─────────────────────────────────────────────────────┤
│ CUSTOMER TYPES (boat + duration combos)              │
│                                                      │
│ ☑ Diana 1.5h    (PK: 111, €165, max 8)              │
│ ☑ Diana 2h      (PK: 222, €220, max 8)              │
│ ☐ Diana 3h      (PK: 333, €330, max 8)   ← disabled │
│ ☑ Curaçao 1.5h  (PK: 444, €195, max 12)             │
│ ☑ Curaçao 2h    (PK: 555, €260, max 12)             │
│ ☐ Curaçao 3h    (PK: 666, €390, max 12)  ← disabled │
│                                                      │
│ ⓘ Uncheck a customer type to remove that duration   │
│   option for this listing.                           │
├─────────────────────────────────────────────────────┤
│ TIME & DATE RULES                                    │
│                                                      │
│ Show slots after:  [17:00    ] (leave empty = all)   │
│ Show slots before: [          ] (leave empty = all)  │
│ Sunset mode:       ☐ Enable                          │
│   Offset:          [-60] min before sunset           │
│   Window:          [120] min                         │
│ Max guests override: [  ] (leave empty = use boat    │
│                            max)                      │
│ Months active: ☑All ☐Jan ☐Feb ... ☐Dec              │
│ Days active:   ☑All ☐Mon ☐Tue ... ☐Sun              │
└─────────────────────────────────────────────────────┘
```

The selections are stored as `allowed_resource_pks`, `allowed_customer_type_pks`,
and `availability_filters` on the `cruise_listings` row.

**Step 3: Content**
- Title, tagline, description (English)
- "Generate translations" button → Claude Sonnet fills all 6 language columns
- Photo upload (own set per listing, not shared)
- Benefits, FAQs, inclusions
- Pricing display text

**Step 4: SEO**
- SEO title + meta description
- AI-generate from content button
- Slug (auto-generated from title, editable)

**Step 5: Review & Publish**
- Preview card as it would appear on the website
- Toggle is_published, is_featured
- Set display_order and category
```

**E first**, then **F + G in parallel**.

### Phase 3 Parallel Tracks

```
Track H: Slack                        Track I: AI + SEO
──────────                            ─────────────────
1. Slack Web API setup                1. Image upload + WebP conversion
2. Shift reminder cron                2. Gemini image labeling + tagging
3. Booking notifications              3. Claude Sonnet blog generation
4. Daily briefing cron                4. SEO keyword upload + management
5. Admin notification config          5. Claude Sonnet alt-text + translations

Track J: Dev Tools
──────────────────
1. FH API explorer
2. Availability viewer
3. Webhook log viewer
4. Key toggle
```

**H, I, J all fully parallel** — zero dependencies between them.

---

## Critical Implementation Notes

### FareHarbor Specifics
- **Always use the minimal availability endpoint** for date browsing — the full endpoint returns too much data
- **Resource capacity = 1** per boat. This is the single most important config detail. `capacity >= 1` = available.
- **Date range max 7 days** per availability request. For calendar views, batch multiple requests.
- **Booking creation is a two-step**: validate first, then create. Never skip validation.
- **Webhooks need HTTPS endpoint** — Vercel provides this automatically.
- **Demo vs Live keys**: Use demo keys during development. The shortname `offcourse` works with both.

### Stripe Specifics
- **PaymentIntent amount in cents** — €165 = 16500
- **Metadata on PaymentIntent** — store booking_id, cruise_type, boat, duration, guest_count. This is your audit trail.
- **Idempotency keys** — use on PaymentIntent creation to prevent duplicate charges on retries.
- **Webhook signature verification** — always verify `stripe-signature` header.

### Supabase Specifics
- **Row Level Security** — enable on all tables. Public tables (cruises, boats, etc.) get `SELECT` for anon role. Bookings, admin tables get authenticated-only policies.
- **Generated types** — regenerate after any schema change: `supabase gen types typescript`
- **Realtime** — consider enabling for admin booking dashboard (live updates when new bookings come in).

### Vercel Specifics
- **Edge middleware** for i18n locale detection + admin auth check
- **Cron jobs** via `vercel.json` for daily briefing and shift reminders
- **ISR** with on-demand revalidation when admin updates content
- **Image optimization** — use `next/image` with Vercel's built-in image optimization

---

## Migration Plan (Lovable → Next.js)

1. **Develop in parallel** — Next.js site on staging subdomain (e.g., `new.offcourseamsterdam.com`)
2. **Content parity check** — verify all Supabase content renders correctly on new site
3. **FareHarbor testing** — full booking flow test with demo keys, then one live test booking
4. **Stripe testing** — test mode payment, then one real €1 charge
5. **DNS cutover** — point `offcourseamsterdam.com` to Vercel
6. **FareHarbor webhook URL update** — point to new `/api/fareharbor/webhook`
7. **Monitor** — watch error logs, Stripe dashboard, FareHarbor dashboard for 48h post-launch

---

## Open Questions to Resolve During Development

1. **FareHarbor customer type PKs** — Need to call the items endpoint with demo keys to get actual PK values for the 6 customer types.
2. **FareHarbor item structure** — How many items exist today? Is there already a separate item for shared cruises? The virtual product layer needs to know what items it maps to.
3. **Stripe product structure** — Create one Stripe product per listing? Or one per FareHarbor item? Recommendation: one Stripe product per FareHarbor item, with dynamic pricing passed via PaymentIntent amount (prices come from FareHarbor).
4. **Sunset API** — Use a free API like sunrise-sunset.org? Or pre-seed the `sunset_times` table for Amsterdam for the full season?
5. **Merch shipping** — Is merch shipped or pickup-only? Affects checkout flow.
6. **WhatsApp number** — Same number for all languages?
7. **Google Tag Manager** — Existing GTM container for Google Ads conversion tracking? (First-party analytics replaces GA4, but GTM is still needed for Google Ads.)
8. **Existing cruises table migration** — The current `cruises` table data needs to be migrated to `cruise_listings` + `fareharbor_items`. Plan a migration script.
