# Track B: Public Pages

**Track:** B — Phase 1 (MVP)
**PR:** Track B: Public pages + SEO
**Status:** Done
**Depends on:** Track A

---

## What was built

All public-facing pages of the website, including the homepage with live search, all cruise listing detail pages, merch store, the crew page, legal pages, 404, and full SEO infrastructure (sitemap, robots, JSON-LD, hreflang).

---

## Key files

### Pages

| File | Description |
|------|-------------|
| `src/app/[locale]/page.tsx` | Homepage — ISR, fetches featured listings + reviews from Supabase. Renders HeroSection (client), FeaturedCruises, ReviewsSection, AboutSection |
| `src/app/[locale]/cruises/[slug]/page.tsx` | Cruise listing detail — ISR, fetches listing + images + benefits + FAQs, renders BookingWidget (client) |
| `src/app/[locale]/merch/page.tsx` | Merch store — ISR, fetches published products with images |
| `src/app/[locale]/crew/page.tsx` | The Cozy Crew — ISR, fetches team_members + float_fam_members |
| `src/app/[locale]/privacy/page.tsx` | Privacy policy — static content |
| `src/app/[locale]/terms/page.tsx` | Terms of service — static content |
| `src/app/[locale]/not-found.tsx` | 404 page — on-brand, links back to homepage |

### SEO

| File | Description |
|------|-------------|
| `src/app/sitemap.ts` | Dynamic sitemap — all locales × (static pages + published cruise listings) |
| `src/app/robots.ts` | Robots.txt — allow all, disallow /admin + /api |
| `src/app/[locale]/layout.tsx` | Updated — adds Organization JSON-LD + hreflang alternates to every page |
| Cruise listing page | Adds Product JSON-LD structured data per listing |

### Search

| File | Description |
|------|-------------|
| `src/app/api/search/route.ts` | GET `/api/search?date=YYYY-MM-DD&guests=N` — returns published listings. Track C adds FareHarbor filtering |
| `src/app/api/search/slots/route.ts` | GET `/api/search/slots?slug=...&date=...&guests=N` — returns availability slots per listing. Track C adds FareHarbor logic |

### Sections (Server Components)

| File | Description |
|------|-------------|
| `src/components/sections/HeroSection.tsx` | Client component — hero banner + search bar + inline search results |
| `src/components/sections/FeaturedCruises.tsx` | Server component — polaroid-style grid of featured listings |
| `src/components/sections/ReviewsSection.tsx` | Server component — review card grid |
| `src/components/sections/AboutSection.tsx` | Server component — brand story + CTA to crew page |

### Search UI (Client Components)

| File | Description |
|------|-------------|
| `src/components/search/SearchBar.tsx` | Date picker + guest count + search button |
| `src/components/search/SearchResults.tsx` | Results section wrapper with loading skeleton |
| `src/components/search/SearchResultCard.tsx` | Individual result card — image, times, price |

### Booking

| File | Description |
|------|-------------|
| `src/components/booking/BookingWidget.tsx` | Client component — embedded on cruise detail page. Date/guests → time slots → proceed to checkout. Track D (Stripe) hooks in at the checkout button |

### UI Primitives

| File | Description |
|------|-------------|
| `src/components/ui/Button.tsx` | Reusable button — variants: primary, secondary, ghost, outline. Sizes: sm, md, lg |
| `src/components/ui/StarRating.tsx` | 5-star rating display |

---

## Architecture decisions

### Search flow: client-side results on homepage
The homepage hero is a Client Component (`HeroSection`) that manages search state. After a search, results appear inline below the hero without a page reload. `FeaturedCruises`, `ReviewsSection`, and `AboutSection` remain Server Components and are always shown.

**Why not URL search params?** The track spec says "client-side (real-time FareHarbor data)." Inline state avoids a full page reload for each search and is a better UX for quick iteration.

### Booking widget on cruise page, not separate /book route
The booking form is embedded directly on the cruise listing page via `<BookingWidget>`. This reduces navigation friction — users never leave the product page until they hit "Proceed to checkout." Track D will implement the `/book/[slug]/checkout` URL that the widget navigates to.

### API routes as Track C placeholders
`/api/search` and `/api/search/slots` return empty slot arrays now. Track C fills in the FareHarbor availability logic. All UI already handles the empty state (shows "No slots available for this date" message).

### ISR with `revalidate = 60`
All content pages use `export const revalidate = 60`. Content changes in Supabase propagate within 60 seconds without a redeploy. Track J will add an on-demand revalidation webhook (`/api/revalidate`).

### Supabase types extended
Added to `src/lib/supabase/types.ts`:
- `cruise_listing_images`
- `cruise_listing_benefits`
- `cruise_listing_faqs`
- `hero_carousel_items`
- `float_fam_members`
- `merch_images`
- Updated `merch_products` to include `sizes: string[]` and `display_order`
- Updated `cruise_listings` to include `hero_image_url`

---

## How it works

### Homepage flow
```
Server renders: HeroSection + FeaturedCruises + ReviewsSection + AboutSection
↓
Supabase queries: cruise_listings (featured) + social_proof_reviews (6 latest)
↓
User types date + guests → clicks Search
↓
Client: fetch /api/search?date=X&guests=N
↓
Track C returns FareHarbor-filtered listings with available slots
↓
SearchResults grid appears below hero
```

### Cruise detail flow
```
URL: /[locale]/cruises/[slug]?date=X&guests=N
↓
Server renders: hero image, description, benefits, FAQs, map link
↓
BookingWidget picks up ?date + ?guests from URL
↓
Client: fetch /api/search/slots?slug=...&date=...&guests=...
↓
Track C returns time slots for this specific listing
↓
User picks time → "Proceed to checkout" → /book/[slug]/checkout?slot=...
↓
Track D (Stripe) handles checkout
```

### SEO
- `sitemap.ts`: generates sitemap entries for every locale × published listing + static pages
- `robots.ts`: disallows admin and API routes
- Locale layout: Organization JSON-LD on every page
- Cruise listing page: Product JSON-LD per listing
- All pages: `generateMetadata()` with localized title/description, hreflang alternates

---

## How to extend

### Add a new homepage section
Create `src/components/sections/YourSection.tsx` as a Server Component, fetch from Supabase in `page.tsx` and pass data as props.

### Add content to cruise listings
Add to `cruise_listing_benefits`, `cruise_listing_faqs`, or `cruise_listing_images` in Supabase. No code changes needed — the page queries these tables automatically.

### Enable real availability in search
Track C will replace the empty returns in `/api/search/route.ts` and `/api/search/slots/route.ts` with actual FareHarbor availability calls.

---

## Dependencies

**This track depends on:** Track A (layout, i18n, Supabase client, types, utilities)

**The following tracks depend on this:**
- Track C (FareHarbor) — fills in the search API routes
- Track D (Stripe) — implements `/book/[slug]/checkout` destination
