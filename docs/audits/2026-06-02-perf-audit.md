# Performance Audit — Off Course Amsterdam (read-only)

**Scope:** static analysis only. No code/UI/config changed. No build/dev-server/install run. Every finding cites a real `file:line`. "Measured" = observed directly in source/asset listing. "Inferred" = mechanism is real but latency/size not profiled (see *Needs measurement*).

Stack: Next.js 16 (App Router), React 19, next-intl, Supabase, Stripe, TypeScript. Middleware = `src/proxy.ts`. i18n removal is a known pending task.

---

## 1. Route & rendering map

**Root:** `src/app/layout.tsx` (server, minimal — just `<html><body>`). `src/app/page.tsx` (locale-less root; proxy redirects non-locale paths to `/en`).

**Locale layer:** `src/app/[locale]/layout.tsx` — server component, `generateStaticParams` for 7 locales ([:33](src/app/[locale]/layout.tsx)). Wraps **every** page in 3 client providers: `AuthProvider`, `SearchProvider`, `NextIntlClientProvider` ([:88-90](src/app/[locale]/layout.tsx)) → client JS + context on all pages. Fetches nav listings + messages on the render path ([:64,67](src/app/[locale]/layout.tsx)).

| Route | Rendering | Evidence |
|---|---|---|
| `/[locale]` (home) | Server, **ISR 60s** | `page.tsx:21` revalidate=60; `Promise.all` of 6 queries `:42-75`; below-fold sections `next/dynamic` `:11-19` |
| `/cruises` | Server, ISR 60s | `cruises/page.tsx:12` |
| `/cruises/[slug]` | Server, ISR 60s | `cruises/[slug]/page.tsx:14`; availability fetched **client-side** (BookingPanel) |
| `/merch`, `/crew` | Server, ISR 60s | `:11`, `:8` |
| `/search` | **Server, dynamic (revalidate=0)** | `search/page.tsx:6` |
| `/privacy`, `/terms`, `/support`, `/betaald`, `/captain` | Server, static (no revalidate / data) | inventory |
| `/book/[slug]/checkout` | Server shell + heavy client island | `CheckoutFlow.tsx` `'use client'` (845 lines) |
| `/book/[slug]/confirmation` | Server | inventory |
| `/partners/[token]` | **force-dynamic** | `partners/[token]/page.tsx:9` (token-gated, OK) |
| `/admin/*` (22 pages) | **Client-rendered** (SPA behind auth) | every `admin/**/page.tsx` is `'use client'` |
| `/partner/*` (5 pages), `/login`, `/account` | Client-rendered | inventory |
| `/api/**` (94 routes) | Route handlers | n/a |

**`'use client'` footprint:** ~135 client modules. Concentrated in (a) `/admin` + `/partner` (acceptable — behind auth, not public LCP) and (b) the public booking/cruise interactive islands (mostly justified). Public **pages** are correctly server components; the home page even lazy-loads below-fold sections.

---

## 2. Findings (ranked by impact ÷ effort)

| # | Finding | File:line | Mechanism (why slow) | Web Vital | M/I | Suggested fix (described, not done) | Effort |
|---|---|---|---|---|---|---|---|
| F1 | **2.6–2.9 MB texture PNGs as CSS backgrounds** (homepage hero) | `public/textures/bg-sand.png` 2.86 MB, `bg-purple` 2.78 MB, `bg-lavender` 2.59 MB; used `globals.css:206,212,218`; hero bg `HeroSection.tsx:87` | CSS `background-image` bypasses `next/image` optimization → the homepage hero paints a ~2.9 MB PNG; ~8 MB of textures total on first paint. Brutal on mobile/4G. | **LCP**, bandwidth | M | Re-export as compressed WebP/AVIF (typically 50–150 KB, 20×+ smaller) or replace with a CSS gradient/small tiled pattern; same visual. | S |
| F2 | **Layout: serial `getMessages`→`getNavListings`, and nav query uncached on every page** | `[locale]/layout.tsx:64,67`; `getNavListings` `:18-26` (no cache wrapper despite "cached 5 min" comment `:66`) | Two independent awaits run in series; `getNavListings` hits Supabase **every render**, even on `/admin`/`/partner` where the Navbar isn't rendered (`:98` gate) but the fetch (`:67`) is unconditional. Runs on every page. | **TTFB** | M | `Promise.all` the two; wrap `getNavListings` in `react cache()`/`unstable_cache`; skip the fetch when `isAdminRoute`. | S |
| F3 | **`select('*')` over-fetch on hot server pages** | `cruises/page.tsx:34` (68 cols, also no `.limit()`); `search/page.tsx:25`; `get-cruise-page-data.ts:28,51,53,55,109`; `page.tsx:52` (home reviews) | Pulls columns never rendered — e.g. `social_proof_reviews` has 28 cols incl. 6 translation blobs but `getLocalizedField` reads **one** locale per request; `image_assets:109` pulls the heavy `variants` JSONB for every gallery image. Bloats DB read **and** the serialized RSC payload. | **TTFB** (payload) | M | Narrow each `.select()` to rendered columns (model: `layout.tsx:20`). | S each |
| F4 | **/search fans out a live FareHarbor call per listing on the SSR path** | `search/page.tsx:23-34`; `availability.ts:29-44` (2 serial Supabase reads) → FareHarbor `client.ts:247`; `revalidate=0` | Per listing: Supabase RTT → Supabase RTT → FareHarbor RTT, all on render. `Promise.all` parallelizes across listings but TTFB = the **slowest** FareHarbor response; FH is an uncontrolled external API with no Next-layer cache (only a per-instance in-memory Map, `client.ts:67`). | **TTFB** | M(path)/I(latency) | Cache FH per item+date with `next:{revalidate:60}`; and/or move availability to a client fetch (as `/cruises/[slug]` already does); and/or `Promise.all` the 2 Supabase reads in `availability.ts`. | M |
| F5 | **Middleware runs Supabase `getUser()` on every non-API request** | `proxy.ts:57-76`; matcher `:83` | Proxy is in the critical path of every matched route incl. ISR-cached pages; builds a Supabase client + calls `getUser()` per request. Authenticated sessions = an Auth round-trip per navigation; anonymous short-circuits (no token) so lighter, but cached public pages still pay the per-request middleware. | **TTFB** | M(code)/I(latency) | Scope matcher to routes needing session refresh (`/admin`,`/partner`,`/account`,`/captain`); let public pages skip it. Keep locale-redirect path lightweight. | S–M |
| F6 | **Cruise detail re-fetches the same hero `image_assets` row up to 3×** | `cruises/[slug]/page.tsx:31` (`getCruiseOgImage` `:55-59`), `:78` (`getCruiseHeroImageObject`); `get-cruise-page-data.ts:107-110` returns `heroAsset` `:114` | `getListingBySlug` is `cache()`'d (dedup'd) but the `image_assets` lookups are not: queried once in `generateMetadata` and twice in page render — the `:78` call is **redundant** with `data.heroAsset` already fetched at `:114`. | **TTFB** | M | Reuse `data.heroAsset` at `:78`; optionally `cache()` the asset fetch to dedup metadata vs page. | S |
| F7 | **`getCruisePageData` `image_assets` query is a serial 2nd stage** | `get-cruise-page-data.ts:107` (awaited after the `Promise.all` at `:50-58`) | The `image_assets` fetch depends only on `listing` fields (known before the batch), so it adds an avoidable extra RTT instead of joining the parallel batch. | **TTFB** | M | Fold the `image_assets` query into the `Promise.all`. | S |
| F8 | **Fonts: raw `.ttf` via `@font-face`, no `next/font`, no preload** | `globals.css:4-34` (4 faces, all `.ttf`) | `.ttf` is larger than `woff2`; URLs aren't discoverable until CSS parses and there's no `<link rel=preload>`, so font fetch starts late → late text swap (FOUT). `font-display:swap` is set (good — no invisible text). | **LCP** (text), minor CLS | M | Migrate to `next/font/local` (auto-preload + subset) and/or convert to `woff2` + add preload links. | M |
| F9 | **framer-motion in the public booking/checkout funnel** | `CheckoutFlow.tsx:7`; `booking/BookingPanelSlider.tsx`, `PriceSummary.tsx`, `StepAccordion.tsx` | Bundles framer-motion (~tens of KB gz) into the booking/checkout client chunks. `FleetSection.tsx:96-124` gets equivalent transitions with pure CSS → it's avoidable. | **INP**/bundle | I | Replace the simple enter/expand animations with CSS transitions; drop framer-motion from these files. | M |
| F10 | **Full next-intl catalog shipped to client on every page** | `[locale]/layout.tsx:64,88`; only `Navbar.tsx` + `SearchResults.tsx` use `useTranslations` | `getMessages()` (whole catalog) is serialized into the RSC/HTML payload on every page; no `pick()`/namespace scoping. The client provider is app-wide because `Navbar` (in the layout) needs it. **Small today** (en.json ≈ 5 KB; other locales are `{}` stubs) but grows linearly with translations. | TTFB/bundle | M | Scope client messages via `pick()` to the namespaces those 2 components need, or make them server-translated. *(Pending i18n removal may moot this.)* | M |
| F11 | **`FeaturedCruises` is a client component only for `useSearch()`** | `components/sections/FeaturedCruises.tsx` (`useSearch`) | Ships card-rendering JS to the browser when only a search-context dependency forces `'use client'`. | bundle/INP (minor) | I | Lift the search dependency (tiny child island / server-rendered link) so the grid renders server-side. | S–M |
| F12 | **`loadStripe` at module top-level** | `CheckoutFlow.tsx:19`; `admin/fareharbor/PaymentStep.tsx:13` | `js.stripe.com/v3` fetches as soon as the checkout chunk evaluates (checkout mount) rather than at payment-step reveal. Route-scoped, so home/cruise pages are unaffected. | INP/bundle on checkout (minor) | M | Defer `loadStripe` to when the payment step mounts. | S |
| F13 | **Oversized boat image `diana.webp` (563 KB)** | `public/images/boats/diana.webp` | Large for a WebP; rendered in `FleetSection` (below fold) so limited LCP impact. | LCP (if above fold) | M | Recompress/resize. | S |

### No significant issue found (explicitly checked)
- **AI SDKs are server-only** — every `@anthropic-ai/sdk` / `@google/generative-ai` import is in `src/lib/ai/*` or API routes; none reach a `'use client'` module. No browser leak.
- **FareHarbor embed is not loaded** — `fareharbor_embed_script` exists only as a DB column type; no widget/script rendered (checkout was replaced by native Stripe).
- **No third-party analytics/GTM/gtag.js** loaded; tracking is first-party server-side. `next/script` not used; only inline JSON-LD (`layout.tsx:94`, `cruises/[slug]/page.tsx:81`).
- **lucide-react** imported per-icon everywhere (tree-shakes correctly). **recharts / @tiptap / @dnd-kit** confined to `/admin`.
- **Home page** data path is well-built (`Promise.all`, narrowed selects, `.limit(6)`, `next/dynamic` for below-fold).
- **`/cruises/[slug]` does not block on FareHarbor** — availability is fetched client-side via `/api/fareharbor/availability`; TTFB is Supabase-only.
- **CLS** largely controlled — LCP images use `next/image` with `priority` and aspect-ratio wrappers; cruise hero is `<link rel=preload>`'d (`page.tsx:157-165`).
- Dead asset: `public/fonts/avenir_next_bold.ttf` is 0 bytes but unreferenced (cleanup only, not perf).

---

## 3. Top 3 — do these first

1. **F1 — Compress the texture PNGs.** Single biggest LCP + bandwidth win; the homepage hero currently paints a ~2.9 MB background image. Asset-only change, no code/UI logic.
2. **F2 — Parallelize + cache the locale-layout nav query.** Tiny change that removes an uncached Supabase round-trip (and a serial await) from **every** page's TTFB.
3. **F3 — Narrow the `select('*')` queries.** Mechanical, low-risk; shrinks DB reads and the RSC payload on the most-visited server pages (cruises list, cruise detail, home, search).

> Highest *absolute* single-page win (medium effort): **F4** — cache/relocate the `/search` FareHarbor fan-out. It's the one page whose TTFB is gated by an uncontrolled external API.

---

## 4. Needs measurement (I did NOT run these — they need your yes per the rules)

1. **First Load JS per route + static/dynamic confirmation** — `npm run build` and read the route table. Confirms which pages are truly static vs dynamic and the per-route JS budget. *(Build only; no deploy.)*
2. **Bundle composition** (confirm framer-motion/recharts weight, catch any unexpected client dep) — `@next/bundle-analyzer` + `ANALYZE=true npm run build`. Requires installing the analyzer (out of scope) — alternative without install: inspect `.next/static/chunks/*` sizes after a build.
3. **Real Core Web Vitals (LCP/INP/CLS/TTFB)** — `npx lighthouse https://offcourseamsterdam.com/ --only-categories=performance --form-factor=mobile` (or PageSpeed Insights / Vercel Speed Insights). Needs network/install. This is what turns the Inferred items (F4, F9) into measured ones.
4. **/search TTFB under real FareHarbor latency** — `curl -w "time_starttransfer: %{time_starttransfer}s\n" -o /dev/null -s "https://offcourseamsterdam.com/en/search?date=<future-date>&guests=2"`, or read Vercel function traces.

---

## 5. Open questions for you

1. **i18n removal** is pending — is `next-intl` being removed entirely? If yes, F10 (and parts of the layout) change shape; don't invest in message scoping first.
2. **Textures** — are they meant to be photographic/full-bleed, or could they be CSS gradients / small tiled patterns? Determines whether F1 is a pure asset swap or a CSS change.
3. **/search traffic** — how much real traffic hits `/search` vs. landing directly on `/cruises/[slug]`? Justifies the F4 effort.
4. **Deploy platform** — Vercel? Multi-instance/serverless? The in-memory FareHarbor + sunset `Map` caches give a low cross-request hit rate there, strengthening the case for Next-layer `fetch` caching (F4).
5. **CDN/edge** in front of `/public` and ISR HTML? Affects how much the texture sizes hurt repeat visits.
6. **Traffic split** logged-in vs anonymous — sizes the real impact of the proxy `getUser()` call (F5).
