# Plan: Image Optimization — Follow-up (Wire Display Components)

## Context

The image optimization pipeline is fully built and deployed. Admins can upload images, click Process, and watch them turn into 12 optimised variants with AI-generated alt text in 7 languages. The `image_assets` table is the source of truth.

**What's missing:** the public-facing display components (cruise cards on the homepage, search result cards, gallery grids, mobile carousel, extras thumbnails, fleet section, priorities polaroids) still render images via the **legacy** path. They use the original Supabase URLs through Next.js's `<Image>` component, which means:

- They go through Vercel's image optimization (eats free-tier quota)
- They don't serve AVIF — only WebP and JPEG
- They don't render the dominant-color background while loading
- They don't use the AI-generated multilingual alt text
- They don't read SEO filenames

This plan wires the new pipeline into the public-facing components so visitors actually benefit from all the work.

**What this means for the user:** once shipped, every cruise card, hero image, and gallery thumbnail on the live site will be ~70-90% smaller, load with an instant blur-up effect, and have proper SEO alt text in the visitor's language.

---

## What gets built

### 1. Asset-fetching helper
**New file:** `src/lib/images/fetch-assets.ts`

A single function `fetchAssetsForListings(listingIds)` that takes a list of cruise IDs and returns a `Map<string, ImageAsset[]>` so pages can fetch all relevant assets in **one batched Supabase query** instead of one query per listing (avoids the "N+1 query problem" — explained below).

```ts
export async function fetchAssetsForListings(
  listingIds: string[]
): Promise<Map<string, ImageAsset[]>>
```

**Why batched:** if the homepage shows 8 featured cruises, the naive approach makes 8 separate database queries. Batched = 1 query that returns everything, then we group by listing ID in memory. Same data, ~8× faster.

### 2. Cruise admin: link new uploads to assets
**Modify:** `src/components/admin/cruise-editor/CruiseImagesSection.tsx`

After upload returns `{ assetId }`, store it in the `cruise_listings.images` JSONB array:

```json
[
  { "url": "...", "alt_text": "", "image_asset_id": "uuid-here" }
]
```

**Backward compatible:** existing items without `image_asset_id` still work via legacy URL fallback in `<OptimizedImage>`.

### 3. Set `hero_image_asset_id` on hero pick
When the admin clicks "Set as hero", store the picked image's `image_asset_id` in `cruise_listings.hero_image_asset_id` (already a column from migration 037). This lets cruise pages and OG cards pick up the optimised hero automatically.

### 4. Migrate the 7 display components

Each migration follows the same pattern:
- Fetch the `image_asset_id` from the data layer (already available through cruise_listings/extras/hero_carousel_items FKs)
- Look up the asset in the assets map
- Pass to `<OptimizedImage>` with the right `context` prop

| Component | Context | What changes |
|--|--|--|
| `FeaturedCruises.tsx` (homepage cruise cards) | `card` | Cards load AVIF thumbs at 320-800px instead of full-size hero |
| `SearchResultCard.tsx` (search results) | `card` | Same — proper srcset for responsive cards |
| `DesktopGalleryGrid.tsx` (cruise detail) | `hero` for first, `card` for thumbs | Big hero loads 1600px AVIF; thumbs at 800px |
| `MobileCarousel.tsx` (cruise detail mobile) | `carousel` | Each slide picks the right viewport-sized variant |
| `ExtraCard.tsx` (booking flow extras) | `thumb` | Tiny 320px thumb instead of full-size image |
| `FleetSection.tsx` (boat photos) | `card` | Polaroid cards use 800px variant |
| `PrioritiesSection.tsx` (homepage polaroids) | `thumb` | Small polaroids use 320px variant |

Every component keeps its current `fallbackUrl` so anything that hasn't been processed yet still renders (just unoptimised).

### 5. Hero preload for LCP
**Modify:** `src/app/[locale]/cruises/[slug]/page.tsx`

When the cruise page loads, the first image visitors see (the gallery hero) is what Google PageSpeed measures as **LCP** (Largest Contentful Paint). Adding `<link rel="preload">` for it in the page head tells the browser to fetch it before parsing the rest of the HTML — typically saves 200-500ms on LCP.

```tsx
{heroAsset && (
  <link
    rel="preload"
    as="image"
    imageSrcSet={buildSrcSet(heroAsset.variants, 'avif')}
    imageSizes="(max-width: 1024px) 100vw, 50vw"
    type="image/avif"
  />
)}
```

### 6. Replace legacy paths in `getCruisePageData`
**Modify:** `src/lib/cruise/get-cruise-page-data.ts`

Currently returns `images: { url, alt_text }[]`. Extend to return `images: { url, alt_text, asset?: ImageAsset }[]` by joining on `image_assets` for any items with a linked asset_id. Components consuming this can opt into the asset path.

### 7. (Optional polish) Cruise list pages
**Files to check:** any page that lists multiple cruise listings (`/cruises`, `/search`, homepage). These benefit most from the batched `fetchAssetsForListings`.

---

## Files to create / modify

### Create
| File | Purpose |
|--|--|
| `src/lib/images/fetch-assets.ts` | Batched asset query + asset map helper |

### Modify
| File | Change |
|--|--|
| `src/lib/cruise/get-cruise-page-data.ts` | Join image_assets, return assets alongside images |
| `src/components/admin/cruise-editor/CruiseImagesSection.tsx` | Store image_asset_id on upload + on "Set as hero" |
| `src/components/sections/FeaturedCruises.tsx` | Replace `<Image>` with `<OptimizedImage context="card">` |
| `src/components/search/SearchResultCard.tsx` | Same |
| `src/components/cruise/DesktopGalleryGrid.tsx` | Replace `<Image>` with `<OptimizedImage>` (hero + card contexts) |
| `src/components/cruise/MobileCarousel.tsx` | Same with `context="carousel"` |
| `src/components/booking/ExtraCard.tsx` | `<OptimizedImage context="thumb">`, fallback to `extra.image_url` |
| `src/components/sections/FleetSection.tsx` | `<OptimizedImage context="card">` |
| `src/components/sections/PrioritiesSection.tsx` | `<OptimizedImage context="thumb">` |
| `src/app/[locale]/cruises/[slug]/page.tsx` | Add `<link rel="preload">` for LCP hero |

**No new dependencies.** No database changes. No new API routes.

---

## Build order

1. **`fetch-assets.ts` helper** — the foundation everyone uses
2. **`getCruisePageData`** — extend to return assets, type changes ripple from here
3. **Admin: `CruiseImagesSection`** — store `image_asset_id` on new uploads + hero pick
4. **Cruise detail page** — `MobileCarousel` + `DesktopGalleryGrid` + LCP preload (highest visible impact)
5. **Homepage / search** — `FeaturedCruises` + `SearchResultCard`
6. **Booking flow / fleet / homepage** — `ExtraCard`, `FleetSection`, `PrioritiesSection`

Each step is independent and ships as its own commit so we can roll back individual components if anything regresses.

---

## What the user does first (no code change needed)

Before any of this is meaningful, every existing image needs to be processed once:

1. Visit `/admin/image-optimization`
2. Click **"Scan legacy images"** → creates pending asset records for all existing cruise/extras/hero images (idempotent — safe to run multiple times)
3. Click **"Process all pending"** several times until the queue is empty (each call processes 10 to stay within Vercel's 300s limit)
4. Verify a few have ✅ Complete with alt text, dominant color, and 12 variant files in Supabase Storage

After that, this follow-up plan can proceed and the components will start serving optimised variants immediately.

---

## Verification per component

For each migrated component:

1. **Network tab** — confirms AVIF being downloaded (look for `.avif` URLs, no `_next/image?url=` for that image)
2. **DOM inspection** — `<picture>` with AVIF + WebP `<source>` and fallback `<img>`; populated multilingual `alt`
3. **Slow 3G throttle** — dominant color background visible briefly before image loads, then blur-up
4. **PageSpeed Insights** before/after — image payload reduction in the "Reduce unused image bytes" / "Use modern image formats" sections
5. **No regressions** — visual comparison at all 4 breakpoints (375 / 390 / 768 / 1280)

---

## Estimated impact

Based on the file size data Sharp produces:

| Image | Original (JPEG) | After (AVIF 1080px) | Reduction |
|--|--|--|--|
| Cruise hero | ~3-5 MB | ~150-250 KB | ~93% |
| Card thumbnail | ~3-5 MB → resized 800 by Vercel: ~120 KB | ~80-150 KB AVIF | ~30% on top of Vercel optimisation |
| Mobile carousel | served at full size today | 320-800 KB AVIF | ~80% |

**Lighthouse Performance score** typically jumps 20-40 points on image-heavy pages once AVIF is served + LCP preload is in place.

---

## Why this is worth doing now (vs later)

1. **The pipeline is built and tested** — extending it to consumers is mostly mechanical, no new infrastructure
2. **Each component is independent** — partial migration is fine; the legacy fallback path means no regressions
3. **Compounds with SEO work** — the JSON-LD + Open Graph already pick up optimised variants. Migrating display components is the last piece of the chain so visitors see the same content Google Images sees
4. **No new costs** — uses the existing pipeline that's already running for free
