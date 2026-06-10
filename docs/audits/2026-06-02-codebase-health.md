# Codebase Health Audit — Off Course Amsterdam

**Read-only.** No code/config/UI changed. No build/install/dev-server run. CRITICAL findings were verified first-hand (file:line quoted); investigator-only claims are labelled. I did **not** run `npm audit`, `tsc`, `depcheck`, or a production build — those are listed as asks in §7.

---

## 1. Verdict

Structurally this is an **unusually healthy** codebase — `strict: true`, **zero `any`/`@ts-ignore`** in source, machine-generated Supabase types, clean sequential migrations `001→050` with no gaps, CI running tsc + tests, and genuinely good test coverage of the money *math*. But it sits on top of a small cluster of **severe, exploitable security holes**: several `/api/admin/**` endpoints perform privileged/financial actions (cancel any booking + issue Stripe refunds, mint promo codes) with **no authentication**, an `/api/admin/migrate` route runs **arbitrary SQL unauthenticated**, and Google OAuth **refresh tokens are readable with the public anon key**. **Verdict: NOT safe to build new features until the 3 CRITICALs are closed** — every planned surface (Twilio/WhatsApp/Slack webhooks, live chat, captain scheduling) would inherit and multiply this unauthenticated-endpoint pattern. Once those ~4 fixes land, the foundation is solid; the dominant forward-readiness gap is the **complete absence of a durable background-job/queue layer**, which gates almost every planned feature.

## 2. Counts by severity

| Severity | Count |
|---|---|
| 🔴 CRITICAL | 3 |
| 🟠 HIGH | 8 |
| 🟡 MEDIUM | 12 |
| ⚪ LOW | 4 |

## 3. Route & rendering map

| Segment | Rendering | Notes |
|---|---|---|
| `src/app/layout.tsx` | Server (minimal) | root `<html>` |
| `[locale]/` (home), `/cruises`, `/cruises/[slug]`, `/merch`, `/crew` | **Server, ISR 60s** | server components; cruise availability fetched client-side |
| `[locale]/search` | **Server, dynamic** (`revalidate=0`) | per-listing FareHarbor fan-out on SSR (see PERF_AUDIT) |
| `[locale]/book/[slug]/checkout` | Server shell + heavy client island | Stripe `CheckoutFlow` |
| `[locale]/admin/**` (~22 pages) | **Client-rendered SPA** | behind server-side `ProtectedLayout`; SWR data |
| `[locale]/partner/**`, `/login`, `/account` | Client | |
| `partners/[token]` | `force-dynamic` | token-gated |
| `api/**` (94 routes) | Route handlers | **NOT covered by `proxy.ts`** (it skips `/api/`) |
| Middleware | `src/proxy.ts` (Next 16 middleware) | runs on every non-`/api/`, non-static request; `getUser()` each time |
| Background | Vercel Cron (6) + synchronous fire-and-forget | **no queue/worker** |

`'use client'`: **145 files** — concentrated in `admin/**` (legitimately interactive). Not clearly over-used.

---

## 4. Findings by area

### Area 4 — SECURITY

| Finding | File:line | Sev | Mechanism | V/I | Smallest fix |
|---|---|---|---|---|---|
| **Unauthenticated `/api/admin/**` privileged + financial mutations** | `api/admin/bookings/[id]/cancel/route.ts:20`; `api/admin/promo-codes/route.ts:13,65`; pattern across `api/admin/**` | 🔴CRIT | Handlers call `createAdminClient()` (service-role, bypasses RLS) with **no `getUser()`/role check**; `proxy.ts:11` skips `/api/`, so nothing gates them. Anon `POST /api/admin/bookings/<id>/cancel?refundOption=full` cancels any booking **and issues a Stripe refund** (`cancel:66`); `POST /api/admin/promo-codes` mints discounts; `GET` leaks all codes. | **V** | Add a shared `requireAdmin(request)` (cookie→`getUser()`→role check) at the top of every `/api/admin/**` handler; deny by default. |
| **`/api/admin/migrate` runs arbitrary SQL, unauthenticated** | `api/admin/migrate/route.ts:17-45` | 🔴CRIT | Only gate is "is `SUPABASE_MANAGEMENT_TOKEN` set". Body `{sql}` is forwarded verbatim to the Management API `database/query` (`:29-36`). If that token is in the prod env, any anon POST = full DB read/write/DROP/exfiltration. | **V** (code) / **I** (whether token is in prod env) | Delete the route (migrations run via the documented CLI/curl); or hard-gate behind a server secret AND remove the management token from the deployed env. |
| **Google OAuth refresh/access tokens readable by `anon`** | `016_google_reviews.sql:33-35` (anon SELECT `USING(true)`) + `017_google_oauth_and_replies.sql:8-9` (adds `oauth_refresh_token`/`oauth_access_token` to same table) | 🔴CRIT | The "anon can read public rating" policy predates the OAuth columns bolted onto the same table. The anon key ships in the browser bundle, so anyone can `select oauth_refresh_token from google_reviews_config` → steal the long-lived Google Business Profile token. (Home page reads this table via the **admin** client `[locale]/page.tsx:70`, so the app likely doesn't need anon SELECT at all.) | **V** (migration) | Move OAuth columns to a separate `google_oauth_tokens` table with **no** anon access; or drop the anon SELECT policy after confirming no client-side reader. |
| **Service-role admin client imported into a `'use client'` component** | `components/admin/cruise-editor/CruiseCancellationTab.tsx:1,7,25` → `lib/supabase/admin.ts:18` | 🟠HIGH | A client component imports `createAdminClient` and calls it in `useEffect`. **The key does NOT leak** — `SUPABASE_SERVICE_ROLE_KEY` is non-`NEXT_PUBLIC_`, so it's `undefined` in the browser bundle (Next doesn't inline it). Result: the tab's query runs with no key → **silently broken in prod**, and `admin.ts` has **no `import 'server-only'` guard** so the mistake compiles. | **V** | Add `import 'server-only'` to `admin.ts` (turns any client import into a build error); refetch via an API route or the anon client. |
| **`bookings` RLS status unestablished in this repo** | (no migration; table inherited from prior Lovable app) | 🟠HIGH | Grep of all migrations for `bookings` + RLS/policy returns nothing — its RLS state lives only in the live DB. `bookings` holds `customer_name/email/phone` + `stripe_payment_intent_id`. If RLS is off/anon-readable, the anon key reads all customer PII. App reads via admin client, so enabling RLS won't break it. | **I** | Verify in the live DB (see §7); add explicit RLS + a service-only policy. |
| **No security headers** | `next.config.ts:1-33` | 🟡MED | No `headers()` → no CSP, HSTS, X-Frame-Options, X-Content-Type-Options. For a payment app: clickjacking / MIME-sniff / no transport pinning. | **V** | Add a `headers()` block with the standard set. |
| **`pricing_quotes` RLS disabled** | `041_pricing_quotes_disable_rls.sql:12` | 🟡MED | RLS off; only control is unguessable UUID. Server routes use the admin client, so RLS-on wouldn't break them. | **V** | Re-enable RLS with a service-only policy instead of off. |
| **`ProtectedLayout` bypasses ALL auth in development** | `components/auth/ProtectedLayout.tsx:22-24` | 🟡MED | Returns admin `DEV_PROFILE` when `NODE_ENV==='development'`. Safe only if every non-prod deploy (preview/staging) is NOT in dev mode; otherwise admin is wide open. Comment: "remove before going to production." | **V** | Gate on an explicit allowlist env, not `NODE_ENV`; remove before scaling access. |
| **No hardcoded secrets; `NEXT_PUBLIC_` clean; Stripe verified** | — | ✅ | No `sk_`/`whsec_`/`eyJ` literals in `src`; `NEXT_PUBLIC_` = only URL/anon/publishable. Stripe webhook `constructEvent` + 400-on-fail (`webhooks/stripe/route.ts:18-22`); cron routes gate on `CRON_SECRET`; partner routes use a token check. | **V** | — |

> ⚠️ Investigator claim **rejected**: "proxy.ts never runs / no middleware." **False for Next 16** — `proxy.ts` *is* the renamed middleware; verified running this session (the `/t/<slug>`→`/api/t/` rewrite it defines worked in-browser, and no `next.config` rewrite exists). It does, however, deliberately skip `/api/` (`proxy.ts:11`), which is why §C3 holds.

### Area 3 — ERROR HANDLING & RESILIENCE

| Finding | File:line | Sev | Mechanism | V/I | Smallest fix |
|---|---|---|---|---|---|
| **No error boundaries anywhere** | (no `error.tsx`/`global-error.tsx` in `src/app`) | 🟠HIGH | Any uncaught render error → default Next error screen, no recovery/branding; a root-layout throw has nothing to catch it. | **V** | Add `app/global-error.tsx` + a segment `error.tsx`. |
| **FareHarbor fetch has no timeout** | `lib/fareharbor/client.ts:247` | 🟠HIGH | `fetch()` with no `AbortSignal.timeout`. A hung FH connection blocks the booking request indefinitely; inside the Stripe webhook (`webhooks/stripe/route.ts:122-128`) a hang risks webhook timeout → Stripe retry → duplicate booking attempt. (Has 429 retry + token-bucket, just no timeout.) | **V** | Add `signal: AbortSignal.timeout(8000)` to `request()`. |
| **FareHarbor double-booking race (no FH-side idempotency)** | `webhooks/stripe/route.ts:44-54,122-128` vs `admin/booking-flow/book` | 🟠HIGH | Both the webhook and browser `/book` check "booking exists for this PI?" then create the FH booking. The DB index on `stripe_payment_intent_id` is **not unique**, so if both pass the check before either inserts, **two FH bookings** for one payment. Narrow window (card path usually staggers), real consequence (boat double-booked). | **V** (code) / **I** (race likelihood) | Unique constraint on `bookings.stripe_payment_intent_id`; insert a claim row *before* calling FH so the loser fails fast. |
| External-call try/catch + fire-and-forget hygiene | `webhooks/stripe/route.ts:216,231` etc. | ✅ | Slack/email use `.catch()`/`Promise.allSettled` (correctly non-fatal); FH/Stripe wrapped in try/catch with Slack alerts on the money path. | **V** | — |

### Area 2 — TYPE SAFETY

| Finding | File:line | Sev | Mechanism | V/I | Smallest fix |
|---|---|---|---|---|---|
| **No boot-time env validation; 21 `process.env.X!` assertions** | `proxy.ts:58-59`; `lib/supabase/admin.ts:17-18`; 4 cron routes `new Resend(process.env.RESEND_API_KEY!)`; etc. | 🟠HIGH | A missing `RESEND_API_KEY`/`SERVICE_ROLE_KEY` doesn't fail at boot — it throws **deep in a request/cron at runtime**, the most expensive moment. The `!` silences the type system on untrusted external config. | **V** | One `src/env.ts` zod schema validated at import; replace `!` with the typed export. |
| `noUncheckedIndexedAccess` not enabled | `tsconfig.json` (`strict:true`, but flag absent) | 🟡MED | Array/record access typed as always-defined despite heavy `meta.x ?? default` patterns → latent `undefined` bugs the compiler won't catch. | **V** | Add `"noUncheckedIndexedAccess": true` (will surface real spots to fix). |
| ~36 `req.json()` bodies unvalidated | most `api/**` handlers; only ~4 use zod | 🟡MED | Request bodies cast untyped (`const body = await request.json()`) or `as T`; external `res.json() as Promise<T>` (`fareharbor/client.ts:262`, google-reviews) trusts the wire. Bad input → runtime errors / bad writes. | **V** | zod-parse bodies on mutation routes (money + admin first). |
| Generated types, `strict:true`, zero `any`/`ts-ignore` | `types.ts:9` (CLI signature) | ✅ | Excellent baseline. | **V** | — |

### Area 5 — DATA LAYER

| Finding | File:line | Sev | Mechanism | V/I | Smallest fix |
|---|---|---|---|---|---|
| No pagination anywhere (`.range()` = 0; `.limit()` = 16) | admin bookings/tracking/users/reviews list routes | 🟡MED | Admin list endpoints fetch unbounded rows — fine now, degrades as data grows. | **V** | Add `.range()` pagination to list endpoints. |
| Search issues 1 FareHarbor call per listing | `api/search/route.ts:34`; `[locale]/search/page.tsx:30` | 🟡MED | O(listings) external calls per search (mitigated by `Promise.all`, but TTFB = slowest FH). Covered in PERF_AUDIT. | **V/I** | Cache FH per item+date; see PERF_AUDIT F4. |
| `.select('*')` over-fetch (~38) | mostly admin routes; `api/search/route.ts:23` | ⚪LOW | Hot public paths already in PERF_AUDIT; remainder is low-traffic admin. | **V** | Narrow columns incrementally. |
| `webhook_logs` table typed but never created/written | `types.ts` (type only) | 🟡MED | A near-ideal generic inbound-webhook audit/idempotency table shape exists in the generated types but **no migration creates it and nothing writes it** — orphaned scaffolding that misleads. | **I** | Either implement it (it's exactly what the future webhooks want — see §5) or remove the stale type. |
| Migrations 001→050, no gaps; FKs + indexes present | `supabase/migrations/` | ✅ | Healthy, ordered, with foreign keys. | **V** | — |

### Area 1 — ARCHITECTURE

| Finding | File:line | Sev | Mechanism | V/I | Smallest fix |
|---|---|---|---|---|---|
| Slack `fetch` re-implemented inline in the webhook | `webhooks/stripe/route.ts` (~5 inline blocks + `alertWebhookFailure`) | 🟡MED | `postSlackText()` helper exists and is used by 6 modules, but the Stripe webhook still hand-rolls the raw `fetch(SLACK_WEBHOOK_URL…)` (a deliberate scope decision this session — the most payment-critical file). Duplicated formatting can drift. | **V** | Route through `postSlackText` when next touching the file. |
| Module structure / dead code | — | ✅ | `src/lib/<domain>/` clean; `BookingPanelInline` fully removed (no orphan); only 2 TODO/FIXME in `src`. | **V** | — |

### Area 9 — OBSERVABILITY (weakest non-security area)

| Finding | File:line | Sev | Mechanism | V/I | Smallest fix |
|---|---|---|---|---|---|
| **No error tracking; monitoring = Slack-alert-on-failure that degrades silently** | `webhooks/stripe/route.ts:338-364` (`alertWebhookFailure`) | 🟠HIGH | No Sentry/structured logger; bare `console.*`. The single "a booking silently failed" signal is a Slack message — and if `SLACK_WEBHOOK_URL` is unset it falls back to `console.error` no human reads (`route.ts:362`). Crons (weekly/quarterly/payment-reminders) have **no** failure alerting. **A failed webhook/cron is invisible.** This is the #1 thing that makes Twilio/WhatsApp/Slack webhooks AND live chat fail silently. | **V** | Add Sentry (or equivalent) at the app + route-handler level before any new async surface. |

### Area 8 — TESTING & CI

| Finding | File:line | Sev | Mechanism | V/I | Smallest fix |
|---|---|---|---|---|---|
| **Stripe webhook + customer money-path routes untested** | `webhooks/stripe/` (no test); `booking-flow/create-intent`, `booking-flow/quote` (no test) | 🟠HIGH | The highest-consequence code (the iDEAL safety-net that creates bookings + inserts payment rows, the conversion-firing, the refund path) has no test. Only the *admin* `book/route.test.ts` exists. | **V** | Add a webhook test (mock Stripe event → assert idempotency + booking insert + no double-fire). |
| 34 test files; money-math well covered; CI present | `.github/workflows/ci.yml` | ✅ | tsc + tests on PR/push, Node 22; good coverage of pricing/VAT/promo/cancellation logic. | **V** | — |

### Area 6 — DEPENDENCIES

| Finding | File:line | Sev | Mechanism | V/I | Smallest fix |
|---|---|---|---|---|---|
| `lucide-react@^1.7.0` — **not** a problem | `package.json:35` | ✅ | Lockfile resolves the genuine package (real icon exports, valid integrity, 84 working imports). The "should be 0.4xx" assumption was outdated. | **V** | — |
| Stack current & React-19-compatible | `package.json` | ✅ | Next 16.2.2 / React 19.2.4 / next-intl 4.9 / stripe 22 / zod 4 — no deprecated/unmaintained deps spotted. | **V** | Run `npm audit` to confirm transitive CVEs (ask in §7). |

### Area 10 — CONFIG & BUILD

| Finding | File:line | Sev | Mechanism | V/I | Smallest fix |
|---|---|---|---|---|---|
| `proxy.ts` runs `getUser()` on every non-API request | `proxy.ts:57-76` | 🟡MED | A Supabase Auth round-trip on every public page load, incl. anonymous visitors browsing cruises (needed for session refresh, but taxes every cold request — incl. ISR pages). | **V** | Scope the matcher / skip the auth refresh on purely public routes. |
| Cron auth secret name inconsistency | `cron/payment-reminders/route.ts:16` (`CRON_SECRET`) vs `fareharbor/sync/route.ts:14` (`REVALIDATION_SECRET`) | 🟡MED | Two env names for the same Vercel-cron bearer → easy misconfig as crons grow. | **V** | Standardize on one cron secret. |
| next-intl removal = multi-day debt (not a quick delete) | `next.config.ts` (`withNextIntl`), `src/i18n/*`, 19 files, 7 message JSONs, entire `[locale]/` segment | 🟡MED | Removal means flattening every `[locale]` route, stripping the proxy locale-redirect (`proxy.ts:34-44`), and de-translating ~18 components. | **V** | Plan as a dedicated refactor; don't do it under another feature. |

---

## 5. Forward-readiness

### a) WEBHOOK / ASYNC (Twilio, WhatsApp, Slack) — **not ready**
- **No reusable signature-verified webhook pattern.** Stripe is the only inbound webhook and uses the Stripe SDK's HMAC (`webhooks/stripe/route.ts:18`). Twilio (HMAC-SHA1 of URL+params), WhatsApp/Meta (`X-Hub-Signature-256`), and Slack (`v0:` signing secret) each differ and **none reuse Stripe's SDK** — today each would be a hand-rolled `route.ts` from scratch. **[HIGH for the plan]** → build `src/lib/webhooks/` with per-provider verifiers + a generic handler shell, and **wire the orphaned `webhook_logs` table** for idempotency/audit (it already has the right shape).
- **🔴 The pattern you'd copy is the *insecure* one.** Every new webhook would be modelled on `/api/admin/**` (no auth) unless §4-C3 is fixed first. Fix auth before adding providers.
- **Secrets**: flat `.env` per provider — fine, extends trivially. **[LOW]**

### b) BACKGROUND JOBS — **the dominant gate. [HIGH]**
There is **no durable job/queue runtime** (verified: no bullmq/inngest/qstash/upstash/trigger.dev; no `new Worker`/`enqueue`). All async work is either Vercel Cron polling Supabase, or **synchronous fire-and-forget inside a request** (the Stripe webhook does FH booking + email + Slack inline; `t/[slug]:56` logs `.catch(()=>{})`). Almost every planned feature needs retries / delayed sends / fan-out / work surviving the request — none of which the current model supports. **Add a queue (Upstash QStash or Inngest fit Vercel serverless) before the notification/messaging features.**

### b2) REAL-TIME MESSAGING (live chat) — **greenfield, and architecture-blocked on serverless. [HIGH for the plan]**
- **Supabase Realtime is unused** (zero `.channel(`/`postgres_changes`/`.subscribe(`). The capability is on the stack but never touched.
- **No `messages`/`conversations`/`thread` tables exist** (zero such `CREATE TABLE` across 50 migrations). Building chat = greenfield schema (sender/recipient/conversation_id/body/read_at/ordering).
- **Vercel route handlers are short-lived serverless invocations — they cannot hold persistent two-way connections.** Live chat MUST run through **Supabase Realtime broadcast/presence** (already available) or an external service (Pusher/Ably). The current stateless request/response architecture *tolerates* this (a client component opens a channel directly), but it is 100% net-new.

### c) EMAIL / NOTIFICATIONS — **exists, but synchronous & lossy. [MEDIUM]**
- Resend is wired (`send-confirmation-email.ts`, `catering/notify.ts`, `payment-reminders`). But sending is **on the request path** — the Stripe webhook `await`s the email before responding — and on failure it only `console.error`s (`send-confirmation-email.ts:242-251`): **no retry, no dead-letter, no alert → the email is silently lost while the booking succeeds.** Templating is inline HTML literals (no shared layout). Only `payment-reminders` has an idempotency flag.
- Outbound Slack (`slack/send-notification.ts`) is a clean never-throws helper; the *pattern* (thin provider fn + per-event message builders) generalizes to SMS/WhatsApp, but the *code* is Slack-specific. No notification dispatcher abstraction.

### d) DATA MODEL — **tour/booking-coupled; both new domains greenfield. [MEDIUM]**
44 tables, all oriented around tours/bookings/FareHarbor/partners. **Captains/shifts**: no `shifts`/`schedules`/`staff` table (`people` is a static bio CMS table, not a scheduling entity). **Messaging**: nothing. **Generic notifications**: `notification_settings` is delivery *preferences* only — no outbox/log. No structural obstacle to adding cleanly-namespaced tables, but both are net-new.

---

## 6. Fix these before anything else (ranked)

1. **🔴 Authenticate every `/api/admin/**` route** (shared `requireAdmin()` guard). Today anyone can cancel bookings, issue Stripe refunds, and mint promo codes. *This also fixes the template every future webhook would copy.*
2. **🔴 Delete or hard-gate `/api/admin/migrate`** and remove `SUPABASE_MANAGEMENT_TOKEN` from the deployed env — it's an unauthenticated arbitrary-SQL endpoint.
3. **🔴 Stop exposing OAuth tokens to `anon`** — move `oauth_*` columns off `google_reviews_config` (or drop its anon SELECT policy).
4. **🟠 Add error tracking (Sentry) + boot-time env validation** — without observability, every new webhook/cron/chat surface fails *silently*; without env validation, a missing key fails deep in production.
5. **🟠 Add `import 'server-only'` to `lib/supabase/admin.ts`** (catches the `CruiseCancellationTab` class of bug at build time) **and a Stripe-webhook test** (the untested money path).

## 7. Open questions / asks for you

- **May I run these read-only commands?** (each would tighten this report): `npm audit --omit=dev` (transitive CVEs), `npx tsc --noEmit` (confirm clean — it passed earlier this session), `ANALYZE=true next build` would need the analyzer dep so likely skip. Say yes/no per command.
- **Live-DB RLS check** (read-only Management API query): may I confirm whether `bookings`, `analytics_sessions`, `campaign_clicks`, and `google_reviews_config` actually have RLS enabled in production? The migrations don't establish `bookings` RLS, so its real state is unknown from the repo — this turns HIGH `bookings`-RLS from inferred to verified.
- **Is `SUPABASE_MANAGEMENT_TOKEN` set in the Vercel production env?** Determines whether `/api/admin/migrate` is CRITICAL-live or only dangerous locally.
- **Which forward feature is first?** Given the above, the **safest to build first is outbound notifications/email hardening** (the plumbing exists; you'd add a queue + retries + Sentry — all things you need anyway). Live chat is the riskiest first move (greenfield schema + Realtime + a connection model the serverless backend can't host directly).
