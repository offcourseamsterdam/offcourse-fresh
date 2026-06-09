# Admin Performance — How the Admin Got Fast

A plain-English record of the speed work done on the admin environment (`/admin/*`),
ranked from **biggest perceived improvement to smallest**. Written for Beer — every
optimisation is explained with the *why* and a real-world metaphor before the code.

## A note on the numbers (read this first)

There are two kinds of numbers in this doc, and I've kept them strictly separate so
nothing here is made up:

- **Counted facts** — things I can prove by reading the code: how many network
  requests happen, how many database queries run, how many image variants exist,
  how many pages use a cache. These are stated plainly.
- **Estimates** — wall-clock "this is ~X% faster" figures. We have **not** run a
  formal before/after benchmark (no Lighthouse trace, no logged response-time
  comparison). So every time/percentage of *wall-clock* speed is clearly labelled
  **(estimated)** with the assumption it rests on, plus a "How to measure for real"
  section at the bottom so you can replace estimates with measured truth whenever
  you want.

The mechanics are real. The "feels instant" is real. The exact millisecond
percentages are honest estimates until we benchmark.

---

## The ranking at a glance

| # | Optimisation | Principle | Counted outcome | Est. wall-clock win |
|---|--------------|-----------|-----------------|---------------------|
| 1 | Stale-while-revalidate cache (`useAdminFetch`) | Don't ask twice for what you already have | Re-opening a tab within 30s = **0** network requests (down from 1 every time). Live on **18** admin pages. | Repeat navigation drops from "spinner + wait" to **instant** |
| 2 | Pre-warming the top pages on login | Fetch before the click, during dead time | 3 hottest endpoints start loading the **instant** the admin shell mounts | First click on Bookings/Cruises/Extras feels **instant** instead of cold |
| 3 | Parallel + N+1-free server queries | Ask for everything at once; never loop the database | Bookings route: **2 sequential round-trips → 1 parallel batch**; enrichment is **2 queries total, not 1+N**. Pattern used in **10** admin API routes | Removes the slower-query's wait from the critical path (~halves DB time on 2-query routes) |
| 4 | Image pipeline (AVIF + responsive variants + instant placeholders) | Do the heavy work once, serve the perfect size forever | Every upload → **12** pre-built variants (6 widths × AVIF+WebP); AVIF ≈ **30% smaller** than WebP; admin previews use `next/image` | Image-heavy admin views download a fraction of the bytes; layout never jumps |
| 5 | The quiet anti-thrash settings | Stop doing pointless work | No refetch on window-focus; duplicate calls deduped; retries capped at 2 | Kills the "refetch storm" every time you alt-tab back to the admin |

---

## 1. Stale-while-revalidate caching — the biggest everyday win

**File:** `src/hooks/useAdminFetch.ts` · adopted by **18** admin pages/components.

### The principle, in plain English
Imagine a librarian (you've met this metaphor before — it's the same idea as dev-server
caching). The old admin was a librarian who, every single time you asked for "today's
bookings," walked all the way to the archive, fetched the folder, walked back, and handed
it to you — *even if you'd asked thirty seconds ago.*

The new librarian keeps the folder you just looked at **on the desk**. Ask again and it's
handed to you instantly. Meanwhile, quietly, the librarian double-checks the archive in the
background in case something changed — and if it did, swaps in the fresh copy without you
noticing. That pattern has a name: **stale-while-revalidate** (the "SWR" library).

### What was changed
A single shared hook wraps every admin data fetch with four deliberate settings:

```ts
useSWR<T>(url, adminFetcher, {
  keepPreviousData: true,    // show the old data while refreshing — no blank spinner flash
  dedupingInterval: 30_000,  // identical requests within 30s collapse into ONE network call
  revalidateOnFocus: false,  // don't refetch just because you clicked back into the tab
  errorRetryCount: 2,        // fail fast instead of hammering a broken endpoint
})
```

### Counted outcome (fact)
- Re-opening any admin tab **within 30 seconds** of the last visit makes **0** network
  requests — the data is served from memory. Before, every navigation was a fresh fetch.
- `keepPreviousData` means when a refresh *does* happen, the page keeps showing the last
  good data instead of flashing an empty loading state. The spinner-flicker on every click
  is gone.

### Estimated wall-clock win
Repeat navigation goes from "round-trip to the server (typically a few hundred ms) +
spinner" to **rendered instantly from cache**. *(Estimated; the "instant" is real — it's a
memory read — but the exact ms you're saving depends on your connection and the endpoint.)*

### Why this is the #1 win
It's not the flashiest change, but it touches **every page, every click, all day**. Admin
work is repetitive — you bounce between Bookings, Catering, and Cruises constantly. Making
*every repeat visit free* compounds into the single biggest "the admin feels fast now"
effect.

---

## 2. Pre-warming the top pages the moment you log in

**Files:** `src/components/admin/AdminDataPreloader.tsx` · mounted in
`src/app/[locale]/admin/layout.tsx`.

### The principle, in plain English
The best way to make something feel instant is to have already done it before you're asked.
When you land in the admin, there's a short stretch of "dead time" — a second or two while
your eyes find the sidebar and decide where to click. That time is normally wasted. We use
it to **secretly start fetching the pages you're most likely to open**, so the data is
already sitting in the cache (see #1) by the time you click.

This is called **speculative prefetching**: we bet on what you'll do next and pay the cost
in advance, hidden behind your own reaction time.

### What was changed
```ts
const PRELOAD_URLS = [
  '/api/admin/bookings/local',
  '/api/admin/cruise-listings',
  '/api/admin/extras',
]
// fires once, the instant the admin shell renders:
PRELOAD_URLS.forEach(url => preload(url, adminFetcher))
```

### Counted outcome (fact)
- The **3 most-used** admin datasets begin downloading in parallel the instant the layout
  mounts — before you click anything.
- Because SWR caches by URL, the preload warms the **exact** cache entry each page reads.
  The Bookings page calls `useAdminFetch('/api/admin/bookings/local')` — the same URL the
  preloader already fetched — so it gets a cache hit, not a cold fetch.

### Estimated wall-clock win
Your first click on Bookings/Cruises/Extras renders from a warm cache instead of waiting
on a cold server round-trip. The network latency is **overlapped with the time you spend
reading the screen** rather than added on top of it. *(Estimated; the saving equals roughly
one server round-trip on first click.)*

### Why it's #2
#1 makes *repeat* visits free; this makes the *first* visit to your hot pages feel free
too. Together they cover the whole journey.

---

## 3. Parallel, N+1-free server queries

**Example file:** `src/app/api/admin/bookings/local/route.ts` · the `Promise.all` pattern is
used in **10** admin API routes.

### Two principles, in plain English

**(a) Parallelism — ask for everything at once.** The slow way to make two phone calls is
to finish the first before dialling the second. The fast way is to put one on each ear. If
a route needs the bookings table *and* the FareHarbor items table, asking sequentially means
you wait `A + B`. Asking with `Promise.all` means you wait only `max(A, B)` — the slower of
the two — because they run at the same time.

**(b) The N+1 trap — never loop the database.** A classic performance killer: you fetch a
list of 50 bookings (1 query), then for *each* booking you run another query to look up its
"customer type" name (50 more queries). That's "1 + N" = 51 round-trips. The fix: fetch the
lookup table **once**, build an in-memory `Map`, and resolve all 50 names locally with
instant `Map` lookups. 51 queries collapse to 2.

### What was changed
```ts
// (a) both tables fetched concurrently, not one-after-the-other:
const [bookingsResult, itemsResult] = await Promise.all([
  supabase.from('bookings').select(/* … + campaign/promo/partner joins */),
  supabase.from('fareharbor_items').select('customer_types'),
])

// (b) one Map built once, then O(1) lookups per booking — no per-row queries:
const ctMap = new Map<number, CtInfo>()
// … fill once …
const customer_type_name = b.customer_type_name ?? ctMap.get(b.…rate_pk)?.name ?? null
```

It also folds the campaign / promo-code / partner names into the **same** bookings query via
Supabase foreign-key joins, instead of three more separate queries.

### Counted outcome (fact)
- Bookings route: **2 sequential round-trips → 1 parallel batch.**
- Customer-type enrichment: **exactly 2 queries total, regardless of how many bookings
  exist** — instead of growing with the list (the N+1 pattern).
- The same `Promise.all` batching is applied across **10** admin API routes (finance
  partners-summary, catering, tracking overview, google-ads, booking-flow, reviews, …).

### Estimated wall-clock win
On a two-query route, the second query's latency is removed from the critical path —
roughly **halving the database wait** when the two queries take similar time. On routes that
previously had an N+1 loop, the win scales with list size. *(Estimated; measure per route —
see the appendix. Supabase round-trips are typically tens-to-low-hundreds of ms each.)*

### Why it's #3
This shrinks the *server* half of every page load. It's below the cache wins because the
cache often means you don't hit the server at all — but when you *do* (first load, manual
refresh), this is what makes that hit quick.

---

## 4. The image pipeline — heavy lifting once, perfect bytes forever

**Files:** `src/lib/images/process.ts`, `srcset.ts`, `src/components/ui/OptimizedImage.tsx`,
the `/api/admin/images/*` routes · full detail in
[`image-optimization.md`](image-optimization.md).

### The principle, in plain English
A photo straight off a phone is enormous — often 4000+ pixels wide and several megabytes.
Showing that in a 300-pixel-wide admin thumbnail is like mailing someone a wall-sized poster
so they can read a postcard. Wasteful, and slow.

The fix is to do the expensive work **once**, at upload, and never again: shrink the photo
into a ladder of sensible sizes, in the most efficient modern formats, and then serve each
browser **exactly the size and format it needs**. The cost is paid a single time; the
saving is collected on every page view forever after.

### What was changed
At upload, Sharp generates, **in parallel**:

```ts
export const VARIANT_WIDTHS = [320, 480, 640, 800, 1080, 1600]  // 6 widths
const AVIF_QUALITY = 70   // visually ≈ WebP 82, ~30% smaller
const WEBP_QUALITY = 80   // fallback for the ~5% of browsers without AVIF
const BLUR_WIDTH   = 20   // tiny blurred preview, ~250 bytes
```

- **6 widths × (AVIF + WebP) = 12 variants** per image, never upscaled past the original.
- A **~250-byte blurred placeholder** + the image's **dominant colour** so something
  appears instantly and the layout doesn't jump while the real image streams in.
- **EXIF/GPS metadata stripped** from every variant (smaller + privacy).
- Admin image **previews were converted to `next/image`** (commit `2994607`) so the admin
  itself stops downloading full-resolution originals just to show a thumbnail.

### Counted outcome (fact)
- AVIF variants are **≈30% smaller** than the WebP equivalent at matched quality (encoder
  setting + documented).
- A small admin thumbnail downloads a **320–640px** variant instead of a multi-thousand-pixel
  original — a large byte reduction (exact ratio depends on each source image).
- The work happens **once at upload**, not on every view.

### Estimated wall-clock win
Image-heavy admin screens (the Image Optimization page, the cruise editor's image section,
the homepage editor) download a small fraction of their former byte weight, and the blur +
dominant-colour placeholders make them *feel* loaded before the full image arrives.
*(Estimated; the precise % depends entirely on the source images — measure with the Network
panel.)*

### Why it's #4
Massive on the image-heavy pages, irrelevant on the text-heavy ones. High impact but
narrower reach than the cache/query wins, which touch every page.

---

## 5. The quiet anti-thrash settings

Small, cheap settings that stop the admin from doing pointless work — bundled because each
is minor alone but together they remove a real source of jank.

- **`revalidateOnFocus: false`** — by default SWR refetches every time a tab regains focus.
  For an admin you alt-tab into constantly, that's a refetch storm. Turned off: **0**
  refetches on focus.
- **`dedupingInterval: 30_000`** — if three components on a page ask for the same URL within
  30s, they share **one** network call instead of three.
- **`errorRetryCount: 2`** — a broken endpoint fails fast (2 tries) instead of retrying
  forever and spamming the server.
- **In-memory enrichment** — end-time correction and label resolution happen in a single
  `.map()` over already-fetched data, not via more queries.

### Counted outcome (fact)
Fewer redundant requests per page, zero focus-triggered refetches, bounded retry behaviour.

### Why it's #5
Pure polish. You won't see it as "fast" so much as the *absence* of stutter — but it's the
difference between an admin that feels calm and one that constantly flickers and reloads.

---

## How it all fits together (the data-flow story)

```
You log in
   │
   ├─►  AdminDataPreloader fires  ──►  bookings + cruises + extras start downloading
   │     (#2 pre-warm)                  in parallel, in the background
   │
   │     …each request hits an API route that fetches its tables with Promise.all
   │     and resolves labels from in-memory Maps  (#3 parallel / no N+1)
   │
   ├─►  You read the sidebar (dead time the prefetch is hiding behind)
   │
   ├─►  You click "Bookings"
   │     └─►  useAdminFetch reads the cache  ──►  data already there  ──►  instant render  (#1)
   │
   ├─►  You pop to Catering and back within 30s
   │     └─►  dedupe window still open  ──►  0 network requests  (#1 + #5)
   │
   └─►  A thumbnail renders
         └─►  <picture> serves a 320–640px AVIF, blur placeholder fills the gap  (#4)
```

The pattern is consistent: **avoid the request when we can (cache), make it before you ask
when we can't (prefetch), and make it quick when we must (parallel queries + small images).**

---

## How to measure this for real (turn estimates into facts)

When you want true before/after percentages instead of the estimates above:

1. **Chrome DevTools → Network tab.** Open an admin page, watch the request count and the
   total transferred size. Click around — notice repeat visits within 30s fire **no**
   requests. Note the size difference between an admin thumbnail (AVIF variant) and the
   original file in storage.
2. **DevTools → Performance, or Lighthouse.** Run a trace on a cold load vs. a warm
   (pre-warmed) load. Compare "Time to Interactive."
3. **Server timing.** Temporarily log `performance.now()` at the start and end of an admin
   API route (e.g. `bookings/local`), then compare against a version that awaits the two
   queries sequentially. That gives you the exact parallelism saving for *your* data volume.
4. **`npm test`** — the cache hook and image pipeline have unit tests
   (`src/hooks/useAdminFetch.test.ts`, `src/lib/images/*.test.ts`) proving the behaviour is
   correct, which is the foundation any speed claim rests on.

Drop the measured numbers back into the "Estimated wall-clock win" lines and this doc
becomes fully benchmarked.

---

## Key files (quick reference)

| File | Role |
|------|------|
| `src/hooks/useAdminFetch.ts` | The stale-while-revalidate cache hook (#1, #5) |
| `src/components/admin/AdminDataPreloader.tsx` | Speculative prefetch of hot pages (#2) |
| `src/app/[locale]/admin/layout.tsx` | Mounts the preloader for the whole admin |
| `src/app/api/admin/bookings/local/route.ts` | Reference example of parallel + N+1-free queries (#3) |
| `src/lib/images/process.ts` | Sharp → 12 variants + blur + dominant colour (#4) |
| `src/lib/images/srcset.ts` | Picks the right variant per viewport (#4) |
| `src/components/ui/OptimizedImage.tsx` | `<picture>` with AVIF/WebP + placeholder (#4) |

## Dependencies

- **`swr` ^2.4.1** — powers #1, #2, #5.
- **`sharp`** — powers the #4 image pipeline.
- **Supabase JS client** (`createAdminClient`) — the parallel queries in #3 run through it.

## How to extend

- **New admin page?** Fetch its data with `useAdminFetch('/api/admin/your-endpoint')` and it
  inherits the cache, dedupe, and no-flicker behaviour for free.
- **New hot page worth pre-warming?** Add its endpoint URL to `PRELOAD_URLS` in
  `AdminDataPreloader.tsx`. Keep the list short — only genuinely high-traffic pages, or
  you'll waste bandwidth prefetching things nobody opens.
- **New API route that reads 2+ independent tables?** Wrap them in `Promise.all`. If you
  catch yourself querying inside a loop, stop — fetch once and resolve with a `Map`.
- **New image surface?** Use `OptimizedImage` and the existing variants; never render a
  raw storage original in the UI.
