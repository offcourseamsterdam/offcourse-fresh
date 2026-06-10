# Codebase Deep-Dive Audit — June 10, 2026

**Scope:** Full health check before the next expansion phase (customer chat, abandoned-cart
recovery, SEO tooling, capacity planning). Five parallel investigations: API surface (all 107
routes), money path, frontend maintainability, data-layer scalability, structure & forward-
readiness. Plus: `npx tsc --noEmit` (clean), `npm test` (578/578 passing, 52 files),
`npm audit` (9 transitive vulns).

**Supersedes** the June 2 audits (`CODEBASE_HEALTH.md`, `PERF_AUDIT.md`) — most of their
critical findings have since been fixed and are re-verified below.

---

## 1. Verdict

**The codebase is fundamentally healthy.** The three critical security holes from June 2 are
closed, the money path is verified robust, all 578 tests pass, TypeScript strict mode is clean,
and the module structure has no circular dependencies or god modules in `src/lib`.

What remains is a different class of problem: **growth debt**. Three things will hurt as the
app becomes a full back-office system:

1. **No observability** — failures in webhooks and crons are invisible unless a Slack message
   happens to fire. (#1 risk for every new async feature.)
2. **No background-job queue** — all async work is fire-and-forget inside requests or
   fixed-time crons. Chat and abandoned-cart recovery cannot be built reliably on this.
3. **Frontend duplication** — the admin/checkout component layer hand-rolls the same
   fetch/form/modal boilerplate across ~20 files (~500+ duplicated lines), which multiplies
   the cost of every new admin feature.

Plus one trivial-but-real data bug: **two migrations share the number `062`**.

---

## 2. Re-verification of the June 2 criticals — ALL FIXED ✅

| June 2 finding | Status today | Evidence |
|---|---|---|
| Unauthenticated `/api/admin/**` (cancel/refund/promo mint) | **FIXED** | All 75 admin routes call `requireAdmin()`; enforced by `src/lib/auth/admin-route-contract.test.ts` |
| `/api/admin/migrate` arbitrary SQL | **FIXED** | Route deleted |
| Google OAuth tokens readable by anon | **FIXED** | `051_secure_google_reviews_config.sql` |
| No `server-only` on admin Supabase client | **FIXED** | `src/lib/supabase/admin.ts:5` |
| No error boundaries | **FIXED** | `src/app/global-error.tsx`, `src/app/[locale]/error.tsx` |
| FareHarbor fetch no timeout | **FIXED** | 8s `AbortSignal.timeout` at `src/lib/fareharbor/client.ts:258` |
| Double-booking race (no unique PI constraint) | **FIXED** | `052_bookings_security.sql` unique constraint + pre-insert dedup check |
| No boot-time env validation | **FIXED** | `src/env.ts` |
| Stripe webhook untested | **FIXED** | `route.test.ts` added in 0bf638a (idempotency covered) |
| proxy `getUser()` on every anonymous request | **FIXED** | 389ec83 skips auth for anonymous visitors |
| Texture PNGs / TTF fonts (perf F1/F8) | **MOSTLY FIXED** | AVIF/WebP variants shipped; `next/font/local` + woff2. Legacy multi-MB PNGs still sit in `public/textures/` — delete if unreferenced. |

**The money path was re-audited end-to-end and is solid:** webhook idempotency airtight
(status check + unique constraint), prices server-recomputed (browser never trusted), VAT
back-extraction correct (9% base / 21% extras / 0% city tax), payment-link lifecycle handles
expiry + FH slot release, extras upsell links die when a booking is cancelled (410), Google
Ads conversions report net ex-VAT correctly. Known benign limitation: promo-code max-uses
rotation has a non-transactional SELECT→UPDATE race (acknowledged in code, affects rotation
timing only, not payments).

---

## 3. Open findings (new + still-open), by severity

### 🔴 Fix this week (small effort, real risk)

| # | Finding | Evidence | Impact | Fix |
|---|---|---|---|---|
| C1 | **Duplicate migration number 062** (`062_booking_extras_upsell.sql` + `062_whatsapp_click_event.sql`) | `supabase/migrations/` | Fresh deploys / new environments can apply schema in inconsistent order | Rename one to `063_…`; verify with `ls \| grep -oE '^[0-9]+' \| sort \| uniq -d` |
| C2 | **No rate limiting on public money-adjacent endpoints**: `/api/promo/validate` (8-char codes brute-forceable; response distinguishes `not_found` vs `inactive` = existence oracle), `/api/search`, `/api/fareharbor/availability` (each request fans out to FareHarbor), `/api/booking-flow/quote` (writes `pricing_quotes` rows) | Verified per-route | Promo-code brute force; FH quota exhaustion (30 req/s, 3000/5min) = availability outages for real customers; DB spam | Reuse the existing tracking rate-limit helper (`src/lib/tracking/rate-limit.ts`) as a first pass; move to Upstash/Vercel KV for cluster-wide limits |
| C3 | **`npm audit`: 9 vulns (1 high, 7 moderate)** — transitive: `resend→svix→uuid`, `ws` | `npm audit --omit=dev` | Known CVEs in prod deps | `npm audit fix` (no breaking changes required for most) |
| C4 | **Two routes bypass the FareHarbor singleton** — `new FareHarborClient()` instead of `getFareHarborClient()` | `api/admin/bookings/[id]/catering-email/route.ts`, `api/booking/extras/[id]/route.ts` | Skips shared rate limiter + cache | Two-line change |

### 🟠 Fix before building any new feature (the architectural gates)

| # | Finding | Evidence | Impact | Fix |
|---|---|---|---|---|
| H1 | **No error tracking / silent failure of crons & webhooks.** 8 cron jobs have zero failure alerting (`console.error` + 500 only); Slack-alert-on-failure degrades to an unread console line if the webhook env is unset | `api/cron/*/route.ts` | A failed payment-reminder, FH-sync, or upsell cron is invisible until a customer complains. Every new feature (chat, cart recovery) inherits this blindness | Add Sentry (free tier fine) + a tiny `reportCronResult()` helper that Slack-alerts on cron failure |
| H2 | **No background-job queue.** All async work = fire-and-forget in requests (`.catch(() => {})` in `api/t/[slug]`, outscraper webhook, extras route) or fixed-time crons. No retries, no dead-letter, no event-driven scheduling | Verified: zero queue deps | **Blocks chat and abandoned carts.** "Send recovery email 1h after abandonment" or "retry WhatsApp send" cannot be expressed | Adopt Inngest or Upstash QStash (both Vercel-serverless-native), ~1 week incl. migrating the worst fire-and-forget spots |
| H3 | **Tracking dashboard aggregates unbounded rows in JavaScript.** Every KPI function fetches ALL `analytics_sessions`/`tracking_events` rows in range, then reduces in JS. The file's own comment acknowledges it | `src/lib/tracking/queries.ts:119-399` | Works now (~3K sessions/mo); at ~30–50K sessions/mo the admin dashboard times out (Vercel 60s limit). More marketing = more traffic = this breaks exactly when business is best | Move aggregations into Postgres RPC functions (indexes already exist; SQL `count`/`group by` does this natively) |
| H4 | **FareHarbor rate limiter & cache are per-serverless-instance.** Token bucket (30/s) and 60s availability cache live in module memory; N concurrent Vercel instances = N×30 tokens and near-zero cache hits under load | `src/lib/fareharbor/client.ts:59,67` | Traffic spike (ad campaign, sunny Saturday) → FH 429s → customers see "no availability" on bookable slots | Shared cache/limit via Upstash Redis or KV (pairs naturally with C2/H2 infra) |
| H5 | **`ProtectedLayout` bypasses ALL admin auth when `NODE_ENV === 'development'`** — still present, comment says "remove before going to production" | `src/components/auth/ProtectedLayout.tsx:24` | Any non-prod deployment running dev mode exposes the full admin | Gate on an explicit env var (e.g. `ADMIN_DEV_BYPASS=true`) instead of NODE_ENV |

### 🟡 The "clean, less code" agenda (maintainability)

| # | Finding | Evidence | Fix |
|---|---|---|---|
| M1 | **Admin fetch/form boilerplate duplicated ~500+ lines.** Only 11 of 22 admin pages use `useAdminFetch`; 7 hand-roll `useState`/`useEffect`/`try-finally`; ~8 CRUD modals repeat an identical ~40-line submit/reset/error pattern; ~12 `alert()` calls instead of a toast | e.g. `admin/partners/page.tsx:73-93` vs `admin/cruises/page.tsx:73-82` vs `admin/boats/page.tsx:157-167`; `ExtrasFormModal` (467 lines, 9 props/5 callbacks) | Extract `useAdminForm()` + `useAdminList()` + `useImageUpload()` hooks and a `BaseFormModal`; migrate pages incrementally. Eliminates ~1,200 lines and standardizes every future admin page |
| M2 | **God components**: `CheckoutFlow.tsx` 876 lines (7 responsibilities), `admin/fareharbor/page.tsx` 662 lines (28 `useState` + 9 `useEffect`), `admin/homepage/page.tsx` 625, `partner/page.tsx` 565, `admin/partners/page.tsx` 523 | Verified | Split per the pattern that already works: `useBookingPanel.ts` (reducer hook + thin UI shells) is the in-repo gold standard — copy it |
| M3 | **Duplicated VAT function in UI** — `extractVat()` re-implemented in `AddCateringModal.tsx:58-62`, identical to `src/lib/extras/calculate.ts:53-56` | Verified exact duplicate | Import from lib. Money math must have exactly one home |
| M4 | **i18n is a façade**: 6 of 7 locale files are empty `{}` stubs; hardcoded English strings in checkout/admin | `src/lib/i18n/messages/*.json` | **Decision needed**: either AI-populate translations (the pipeline exists) or cut to fewer locales and delete the dead weight. Carrying 7 locales × empty files is pure overhead |
| M5 | **~36 mutation routes parse `request.json()` without zod** (only a handful validate); several admin routes return raw `err.message` to the client | API audit | Zod-parse bodies on money/admin mutations first; add an `errorToResponse()` that never leaks internals |
| M6 | **Cron hygiene**: email-then-flag-update ordering can double-send on partial failure; no runtime guard near Vercel's 60s limit; `fareharbor/sync` uses `REVALIDATION_SECRET` while others use `CRON_SECRET` | `api/cron/payment-reminders/route.ts`; `api/fareharbor/sync/route.ts:13` | Standardize on `requireCronSecret()`; flag-before-send or idempotency keys; add elapsed-time guard |
| M7 | **`pricing_quotes` RLS still disabled** (041); **`webhook_logs`** exists in generated types but no table/writes (orphaned scaffolding — ideal shape for future webhook idempotency) | migrations 040/041; `types.ts` | Re-enable RLS with service-only policy; either build `webhook_logs` when adding new webhooks or regenerate types |
| M8 | **`/api/revalidate` accepts any path** with the shared secret | `api/revalidate/route.ts:10` | Whitelist paths or require admin |
| M9 | **Docs drift**: CLAUDE.md says "484 tests / 44 files" (actual: 578 / 52); ~5 shipped features lack docs (extras upsell, payment links, reviews modal, boats admin, homepage section styles); June 2 audit files live in repo root | Verified | Update CLAUDE.md counts; write the missing feature docs; move audits to `docs/audits/` |
| M10 | **Test gaps on the "delivery" layer**: `send-confirmation-email.ts` (483 lines), `recover-from-pi.ts`, `get-cruise-page-data.ts`, `fetch-search-results.ts`, `cron-queries.ts`, partner settlement math — all untested. The *math* is well-tested; the *plumbing* isn't | Coverage map | Prioritize tests for confirmation email + recovery (the two money-adjacent ones) |
| M11 | Minor: `image_assets` list endpoint selects `*` incl. heavy `variants` JSONB; legacy texture PNGs (2.6MB+) still in `public/`; per-pageview row inserts in `tracking_events` will reach ~3M rows/yr at 10× traffic (batch or archive later) | Verified | Narrow select; delete unused PNGs; revisit event batching when traffic grows |

---

## 4. Forward-readiness for the four planned features

**a) Abandoned-cart recovery — closest to buildable (1–2 weeks after the queue).**
`pricing_quotes` already snapshots every quote. Missing: customer email captured *before*
payment (today it's only collected at the Stripe step), `recovery_sent_at`-style idempotency
columns, and a delayed-send mechanism (→ H2 queue). Email infra (Resend) is proven.

**b) Customer chat — greenfield and gated (3–4 weeks, after H1+H2).**
Zero message/conversation tables, zero Supabase Realtime usage. Serverless route handlers
can't hold connections — use Supabase Realtime (already on the stack) or Pusher/Ably. Inbound
WhatsApp/Twilio webhooks need a `src/lib/webhooks/` verifier abstraction (Stripe's HMAC
pattern doesn't generalize) + the `webhook_logs` idempotency table. Build only after Sentry
and the queue exist, or failures will be silent.

**c) SEO tooling — essentially unblocked (days, not weeks).**
Sitemap, robots, JSON-LD, canonical/alternates, Gemini SEO filenames all exist. The WordPress
blog integration is live but minimal (one `[slug]` page, no blog index). Gaps: complete
hreflang coverage, a blog index page, and — bigger — the i18n decision (M4), since SEO across
7 locales with empty translations is self-defeating.

**d) Capacity planning — medium greenfield (3–5 weeks).**
FH read path is solid and tested. No `schedules`/`staff` tables (`people` is a bio CMS table).
**First step is a research task: verify whether the FareHarbor API allows availability
write-back at all** — that determines whether Supabase or FH is the source of truth.

---

## 5. Recommended sequence

1. **Week 1 — quick wins (C1–C4 + H5):** rename migration 062, `npm audit fix`, fix the two
   FH client call sites, rate-limit promo/search/availability/quote, env-gate the dev bypass,
   standardize cron secret. *All small, all real.*
2. **Weeks 2–3 — the two gates (H1, H2):** Sentry + cron failure alerts, then Inngest/QStash
   and migrate the fire-and-forget spots. This is the prerequisite for chat + cart recovery.
3. **Weeks 3–4 — consolidation sprint (M1–M3, H3):** admin hooks + BaseFormModal, split
   CheckoutFlow & the FH wizard, dedupe `extractVat`, move tracking aggregations into
   Postgres RPCs. Net effect: meaningfully **less** code, and every future admin page costs
   a third of what it does today.
4. **Then features, in this order:** SEO polish (days) → abandoned carts (direct revenue,
   1–2 wks) → capacity planning (after FH write-API research) → customer chat (largest, last).

Decisions needed from the owner: (1) keep 7 locales and populate translations, or cut down?
(2) chat channel: WhatsApp Business API vs on-site live chat vs both? (3) abandoned carts:
email-only or email+SMS? (4) capacity source of truth: FareHarbor or Supabase?
