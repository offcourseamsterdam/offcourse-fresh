# Search Results Page — Dagdeel-tabs met Immersive Sfeer

## Why

After searching on the homepage, users currently see results inline below the hero. This works but doesn't scale well with many virtual listings, and doesn't help users discover the right cruise for their vibe. The search results need their own page with atmospheric time-of-day theming that makes browsing feel like an experience, not a booking tool.

Two user flows to serve:
- **Organic visitors** (homepage) — browse, discover, get inspired by the mood
- **Google Ads visitors** — land directly on `/cruises/{slug}` with booking accordion (unchanged)

## Design

### New page: `/[locale]/search`

Full-page immersive layout where the entire background changes based on the active dagdeel tab.

**URL:** `/search?date=YYYY-MM-DD&guests=N`

### Full-page atmosphere

The gradient + semi-transparent canal photo covers the entire page background. When switching tabs, the whole page transitions smoothly — like sunlight shifting across the canals.

| Tab | Time range | Gradient | Photo overlay |
|-----|-----------|----------|--------------|
| All | — | Neutral (white/sand) | None |
| Morning | 06:00–12:00 | Warm beige → soft gold | Morning mist on canal |
| Afternoon | 12:00–17:00 | Light blue → white | Bright sunlight, sparkling water |
| Evening | 17:00–22:00 | Dark blue → warm orange | Golden hour, lanterns lit |

Background transitions: CSS `transition` on gradient colors (300ms ease) + opacity crossfade on photos.

### Layout (top to bottom)

1. **Navbar** — standard, persistent
2. **Search bar** — centered, floating over the gradient. Pre-filled with current date/guests. Glassmorphism style (`backdrop-blur`, `bg-white/80`). Users can re-search without going back to homepage.
3. **Dagdeel tabs** — `[All] [Morning] [Afternoon] [Evening]` — pill-shaped buttons. Active tab is filled, others outlined. Switching tabs transitions the full-page background.
4. **Type chips** — `[All] [Private] [Shared]` — smaller toggle pills below the tabs.
5. **Result count** — "5 cruises available on Friday, April 11"
6. **Listing cards grid** — 1 col (mobile) → 2 cols (tablet) → 3 cols (desktop). Cards have `bg-white/90 backdrop-blur` for readability on any background.
7. **Empty state** — "No cruises available in the [morning]. Try another time of day."

### Filtering logic (all client-side)

The API call (`/api/search?date=...&guests=...`) happens once on page load. All filtering is client-side on the returned data:

1. **Tab filter:** a listing is shown if it has at least 1 available slot within the tab's time range. The card only displays slots within that range.
2. **Type filter:** filters by `listing.category` (`private` / `shared` / all).
3. **Default:** "All" tab + "All" type selected.

### Time ranges for slot filtering

```
Morning:   slot.startTime >= "06:00" && slot.startTime < "12:00"
Afternoon: slot.startTime >= "12:00" && slot.startTime < "17:00"
Evening:   slot.startTime >= "17:00" && slot.startTime < "23:00"
```

A listing can appear in multiple tabs if it has slots across dagdelen.

### Homepage change

The HeroSection currently handles search + inline results. After this change:
- Search submit → `router.push(/search?date=${date}&guests=${guests})`
- Remove inline `SearchResults` rendering from HeroSection
- SearchResults component moves to the new `/search` page

### Listing cards

Same `SearchResultCard` component with minor adjustments:
- Time pills: only show slots within the active dagdeel (unless "All")
- Card background: semi-transparent (`bg-white/90`) for readability over gradient
- Existing clickable time pills + "+N more" logic unchanged

### Mobile

- Tabs: horizontally scrollable pills (overflow-x-auto)
- Type chips: single row
- Cards: 1-column stack
- Background: gradient works same, photo may be more subtle (lower opacity)

### Photos needed

Three canal photos for the dagdeel overlays:
- Morning: soft light, mist, quiet canal
- Afternoon: bright, blue sky, active
- Evening: golden hour, warm tones, lanterns

These go in `/public/images/search/` — can be optimized WebP, ~1200px wide.

## What stays the same

- Search API endpoint (no changes needed)
- SearchResultCard component (minor adjustments)
- Google Ads flow (direct to `/cruises/{slug}`)
- Booking accordion on cruise detail pages
- Virtual listing architecture (3-layer filters)

## Key files

| File | Change |
|------|--------|
| `src/app/[locale]/search/page.tsx` | NEW — server component, reads searchParams, fetches results |
| `src/components/search/SearchResultsPage.tsx` | NEW — client component with tabs, filters, immersive layout |
| `src/components/search/DagdeelTabs.tsx` | NEW — tab component with active state |
| `src/components/sections/HeroSection.tsx` | MODIFY — search redirects to /search instead of inline results |
| `src/components/search/SearchResults.tsx` | MODIFY or REMOVE — logic moves to SearchResultsPage |
| `public/images/search/*.webp` | NEW — 3 dagdeel background photos |
