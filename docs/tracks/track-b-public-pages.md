# Track B: Public Pages

**Phase:** 1 (MVP)
**Dependencies:** Track A (layout, Supabase client, i18n)
**Parallel with:** Track C (FareHarbor)

## Objective
Build all public-facing pages that pull content from Supabase. These are ISR pages (Incremental Static Regeneration) — server-rendered, cached, revalidated on content changes.

## Steps

### B1. Homepage (`src/app/[locale]/page.tsx`)
Data sources: `hero_carousel_items`, `cruise_listings` (featured), `social_proof_reviews`

Sections (in order):
1. **Hero section** — full-width hero image/video with the **search bar** overlay
   - Search bar contains: date picker, guest count selector, "Search" button
   - On search → fetches availability for all listings → renders results below
2. **Search results section** (client-side, appears after search) — grid of `SearchResultCard` components
   - Each card: hero photo, cruise name, available departure times for that date, duration info, starting price
   - Only listings with actual availability for the selected date + guest count appear
   - Filtered through each listing's 3-layer filter system
   - Click a card → navigates to `/cruises/{slug}?date=YYYY-MM-DD&guests=N`
3. **Featured cruises** — shown by default (before search), polaroid-style cards from `cruise_listings` where `is_featured = true`
4. **Social proof** — review carousel from `social_proof_reviews`
5. **About section** — brief brand story ("your friend with a boat")

Use ISR for static content: `export const revalidate = 60`. Search results are client-side (real-time FareHarbor data).

### B2. Cruise Listing Page (`src/app/[locale]/cruises/[slug]/page.tsx`)
Data source: `cruise_listings` + `cruise_listing_images` + `cruise_listing_benefits` + `cruise_listing_faqs`

This is the virtual product page. Each listing has its own URL, photos, descriptions, SEO.

Sections:
1. **Hero image gallery** — from `cruise_listing_images`
2. **Title + tagline + price display**
3. **Description** (localized via `getLocalizedField`)
4. **Benefits list** — from `cruise_listing_benefits`
5. **What's included** — inclusions with icons
6. **FAQ accordion** — from `cruise_listing_faqs`
7. **Cancellation policy**
8. **Booking flow** — inline on the page (NOT a separate /book page). Date picker + guest count (pre-filled if coming from homepage search) → timeslots → duration/boat (private) → checkout
9. **Map embed** (departure location)

SEO: Use `generateMetadata()` with `seo_title` and `seo_meta_description` from the listing.

### B3. Merch Page (`src/app/[locale]/merch/page.tsx`)
Data source: `merch_products` + `merch_images`

- Product grid with images, names, prices
- Size selector (S/M/L/XL) with stock indicator
- "Add to cart" button (cart state in React context or localStorage)
- Link to merch checkout

### B4. The Cozy Crew Page (`src/app/[locale]/crew/page.tsx`)
Data source: `team_members` + `float_fam_members`

- Team member cards with photos and Q&A
- Float Fam community section

### B5. Privacy Policy + Terms of Service
- `src/app/[locale]/privacy/page.tsx`
- `src/app/[locale]/terms/page.tsx`
- Static content (MDX or hardcoded). These are currently 404 on the live site — create proper pages.

### B6. 404 Page
- `src/app/[locale]/not-found.tsx`
- On-brand 404 with navigation back to homepage

### B7. SEO Infrastructure
- `src/app/sitemap.ts` — dynamic sitemap from all published cruise_listings + static pages
- `src/app/robots.ts` — allow all, reference sitemap
- JSON-LD structured data on all pages:
  - Homepage: Organization, LocalBusiness
  - Cruise listing: Product, BreadcrumbList
  - All pages: BreadcrumbList
- Open Graph + Twitter Card meta tags via `generateMetadata()`
- `<link rel="alternate" hreflang="x">` for all locales

## Verification Checklist
- [ ] Homepage loads with hero, tour cards, reviews, CTA
- [ ] Each cruise listing page renders with full content
- [ ] Merch page shows products with images and sizes
- [ ] Crew page shows team members
- [ ] Privacy and Terms pages render (no more 404)
- [ ] 404 page works for unknown routes
- [ ] `generateMetadata()` produces correct title/description per page
- [ ] Sitemap accessible at `/sitemap.xml`
- [ ] All pages work in all 7 locales (content falls back to English if translation missing)
- [ ] Lighthouse SEO score > 90 on homepage
- [ ] Images use `next/image` with proper width/height/alt
