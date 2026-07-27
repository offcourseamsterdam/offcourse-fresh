# Security & Cleanup Plan — 2026-07-25

Output of a sitewide review (9 parallel review agents + hand-verification). Ordered so an
implementer can work top-to-bottom. Each item lists: **problem → files → fix → tests →
model → effort**.

**Model guidance:** use **Opus** for anything that moves money, changes auth/RLS, or must
preserve exact behaviour while unifying divergent code paths. Use **Sonnet** for mechanical,
well-scoped, test-guarded work. Where it says "Opus", don't downgrade without asking Beer.

Status legend: ✅ = verified first-hand during review · ⚠️ = agent-reported, verify while fixing.

---

## PHASE 0 — EMERGENCY: live production vulnerabilities

> These are exploitable **right now in production** with the public anon key that ships in the
> browser bundle. Do this phase before any feature or cleanup work. All of Phase 0 is **Opus**.
>
> **Rollout caution:** several affected tables (`boats`, `cruises`, `merch_products`,
> `social_proof_reviews`, `campaigns`) are read by public pages via the anon key. Enabling RLS
> **without** adding correct anon `SELECT` policies in the same migration will break the live
> site's public content. Write each fix as a reviewed migration, confirm the public read paths
> still work (preview/staging if possible), and get Beer's explicit go-ahead before applying to
> prod. Do NOT improvise catalog edits.

### 0.1 — Privilege escalation: any signed-up user can make themselves admin ✅ CRITICAL — ✅ FIXED (migration 105, applied to prod 2026-07-25)
- **Problem:** `user_profiles` policy `"Users: update own display_name"` is `UPDATE / roles=public
  / USING (auth.uid()=id) / WITH CHECK = null`. A null `WITH CHECK` reuses `USING`, so the new row
  only needs to still be the user's own. And `authenticated` holds column-level `UPDATE` on `role`,
  `partner_id`, `is_active` (verified via `information_schema.role_column_grants`). So any
  confirmed signup can `PATCH /rest/v1/user_profiles?id=eq.<own uid> {"role":"admin"}` and every
  `/api/admin/**` route opens (bookings + PII, finance, FareHarbor writes, Stripe payment links).
  Setting `partner_id` + `role='partner'` instead gives IDOR into any partner's data.
- **Files / state:** DB policy on `user_profiles`; column grants for `anon`/`authenticated`;
  `src/lib/auth/require-admin.ts:31` and `src/lib/partner/get-partner-id.ts:35-37` trust `role`/`partner_id`.
- **Fix:** new migration that (a) `REVOKE UPDATE (role, partner_id, is_active) ON user_profiles FROM
  anon, authenticated;` and (b) replaces the update policy with an explicit `WITH CHECK` that pins
  the mutable columns (only `display_name` self-editable). Keep the separate admin/service-role
  update policy. Re-verify a normal user can still edit their display name and nothing else.
- **Tests:** add an integration/SQL check (can live in a migration-guard test) asserting a
  non-admin JWT cannot escalate `role`. At minimum, manual re-verify with a throwaway user.
- **Model:** Opus. **Effort:** MED.

### 0.2 — RLS disabled on public tables + full anon DML grants ✅ CRITICAL — ✅ FIXED (migration 105, applied to prod 2026-07-25)
- **Problem:** `relrowsecurity=false` on `partners`, `campaigns`, `campaign_clicks`,
  `analytics_sessions`, `boats`, `cruises`, `social_proof_reviews`, `merch_products` (agent lists
  ~21 total — enumerate the full set before fixing). anon has `SELECT/INSERT/UPDATE/DELETE`. Impact:
  `partners.report_token` is readable → every `/partners/<token>` portal (revenue + commission) is
  open; `campaigns` is writable → rewrite `destination_url` for an open redirect through the
  trusted `/t/<slug>` link (`src/app/api/t/[slug]/route.ts:63`), inflate commission %, insert fake
  `social_proof_reviews`, deface homepage/boats content, or `DELETE` rows. ⚠️ agent reported a live
  zero-row `PATCH /rest/v1/campaigns` returning 204.
- **Fix:** for each table, `ENABLE ROW LEVEL SECURITY` **and in the same migration** add the correct
  policies: anon `SELECT` only where the table genuinely feeds public pages (`boats`, `cruises`,
  `merch_products`, `social_proof_reviews`, published `campaigns` fields), and no anon write
  anywhere. Revoke anon `INSERT/UPDATE/DELETE`. For `partners`, anon should get **nothing** — the
  report portal should fetch server-side by token via the service-role client, not anon SELECT.
  Verify every public page that reads these tables still renders (homepage, cruises, merch, crew).
- **Model:** Opus. **Effort:** MED-HIGH (per-table policy design + public-read regression check).

### 0.3 — `cruise_listings` `admin_all` policy grants everything to anon ✅ CRITICAL — ✅ FIXED (migration 105, applied to prod 2026-07-25)
- **Problem:** alongside the intended `public_read (is_published=true)`, `cruise_listings` has
  `admin_all / cmd=ALL / roles=public / qual=true`. Policies OR together, so `true` wins: anon can
  read unpublished listings and `UPDATE`/`DELETE` any listing (⚠️ agent saw `PATCH ... {"is_published":false}`
  return 204).
- **Fix:** drop the `admin_all` public policy; replace with an admin/service-role-scoped policy
  (JWT `role`-based, mirroring the corrected `user_profiles` admin policy). Keep `public_read`.
  Revoke anon write grants on the table.
- **Model:** Opus. **Effort:** LOW-MED.

### 0.4 — Client discount never validated against a promo code (pay €0.50 for any cruise) ✅ CRITICAL — ✅ FIXED
- Confirmed fixed in code: `calculate-quote.ts` computes `discountAmountCents` entirely server-side
  via `validatePromoCodeById` + `applyPromoCode`, keyed on `promoCodeId` — no client-supplied
  discount value is trusted or read anywhere in the quote path.
- **Problem:** `calculate-quote.ts:43` reads `discountAmountCents` from the request; line 193 only
  clamps it to `[0, total]`; line 196 floors at 50 cents. `promoCodeId` is stored but never used to
  re-derive the discount. `/api/booking-flow/quote/route.ts:59` passes the raw value through; the
  `create-intent.ts:112-135` "drift check" recomputes from the **stored** discount so it always
  matches. Net: `POST /quote {…, discountAmountCents: 99999999}` → total 50 → `create-intent` →
  Stripe charges €0.50 → webhook books the real FareHarbor slot. No promo code, no auth needed.
- **Fix:** compute the discount **entirely server-side** inside `calculateQuote` (or the quote
  route) by re-running `validatePromoCode` + `applyPromoCode` (`src/lib/promo-codes/validate.ts`,
  `apply.ts`) keyed on `promoCodeId`. Ignore any client-supplied `discountAmountCents` (drop it from
  the input type). No code → discount 0.
- **Tests:** unit-test `calculateQuote` — (a) no promo → discount 0 even if a discount field is
  injected; (b) valid % / fixed / full promo → correct server-derived discount; (c) expired/invalid
  code → 0. These are pure-function tests, cheap and high-value.
- **Model:** Opus. **Effort:** MED.

### 0.5 — `/api/booking-flow/book` creates FareHarbor bookings without verifying payment ✅ HIGH — ✅ FIXED
- Confirmed fixed in code: `book/route.ts` now gates every non-internal (`website`) booking behind
  `pi.status === 'succeeded'` **and** a `paymentMatchesBooking` check (avail_pk/customer_type_rate_pk/
  guest_count must match the PI's server-set metadata) — returns 402/409 otherwise. The full-discount
  path re-validates the promo code server-side (`isAuthorizedByFullPromo`, discount_type==='full')
  rather than trusting the client's `bookingSource`.
- **Problem:** `src/app/api/booking-flow/book/route.ts` re-exports the admin handler. `bookingSource`
  defaults to `'website'` (`admin/booking-flow/book/route.ts:91`); the admin auth gate only fires for
  non-website sources (`:129`). The PI is retrieved at `:325` only to read invoice metadata — its
  `status` is never checked, inside a `try/catch` that ignores failure — then `fh.createBooking` runs
  at `:290`. A request that omits `bookingSource` books a real cruise with no payment and no auth,
  consuming boat capacity.
- **Secondary bug ✅:** the legit 100%-promo public path (`CheckoutFlow.tsx:525`) sends
  `bookingSource: 'partner'`, which is treated as internal → requires admin → an anonymous customer
  redeeming a 100% code would get 401. Confirm whether 100% non-partner promos work in prod today.
- **Design decision (ask Beer):** the code comment at `:195` says the public site no longer reaches
  `/book` — the webhook is the sole finalizer — **except** the full-discount path. Cleanest fix:
    1. For `website` + a `stripePaymentIntentId`: require `pi.status === 'succeeded'` **and** assert
       the booking params (`avail_pk`, `customer_type_rate_pk`, `guest_count`) match the PI metadata,
       so a cheap paid slot can't be swapped for an expensive booking. Reject otherwise.
    2. For `website` with **no** PI (full-discount): require a server-revalidated 100% promo (ties to
       0.4). Fix the `'partner'` source mismatch so anonymous full-discount actually authorises via
       the promo code, not an admin session.
- **Tests:** route tests — unpaid PI rejected; wrong-amount/mismatched-metadata PI rejected; valid
  succeeded PI books; full-discount with valid 100% code books; without code rejected.
- **Model:** Opus. **Effort:** MED. **Confirm the design with Beer before implementing (money path).**

---

## PHASE 1 — Money-path safety net & config bugs

### 1.1 — `pending-fh-sweep` cron scheduled daily but coded for every 15 min ✅ DONE (2026-07-25)
- **Problem:** `vercel.json` schedules `/api/cron/pending-fh-sweep` at `"0 4 * * *"` (daily 04:00),
  but the escalation alert assumed a 15-min cadence (`ESCALATE_MIN_MS=30min`/`ESCALATE_MAX_MS=45min`
  window) — on a daily Hobby-plan schedule the row's age is always hours past that window, so the
  "🔴 PAID BUT UNBOOKED" re-alert was effectively dead code.
- **Confirmed:** Beer is on Vercel **Hobby** (daily cron is a plan limit, not a config choice) — the
  schedule stays daily; only the alert logic needed fixing.
- **Fix applied:** migration `106_bookings_fh_escalated_at.sql` adds a nullable `fh_escalated_at`
  timestamp to `bookings` (same pattern as `catering_email_sent_at`/`extras_upsell_sent_at`). The
  escalation check is now "age ≥30min AND not yet escalated" instead of a time window — fires
  exactly once per stuck booking regardless of cron cadence. Applied to prod + types.ts regenerated.
  Full test coverage added (`route.test.ts`, previously zero) including the exact regression this
  targets: escalate once, then confirm a second run with `fh_escalated_at` already set does NOT
  re-alert. 1091 tests pass, tsc clean.

### 1.2 — Most-critical Slack alert goes to the channel, not Beer's DM ✅ DONE (2026-07-25)
- **Problem:** `alertBookingSaveFailure` (`book/route.ts:1057`) — "customer paid, FareHarbor booked,
  only our DB row failed" — calls `postSlackText` (channel only); if `SLACK_WEBHOOK_URL` is unset it
  just `console.error`s and the alert is lost. The webhook's equivalent path uses
  `postSlackCritical` (DM + channel fallback). The book route also redundantly re-reads
  `SLACK_WEBHOOK_URL` before three `postSlackText` calls (which already no-op internally).
- **Fix:** switch `alertBookingSaveFailure` to `postSlackCritical`; drop the three redundant guards.
- **Model:** Sonnet. **Effort:** LOW.

### 1.3 — Two cron routes fail OPEN when `CRON_SECRET` unset ✅ DONE (2026-07-25)
- **Problem:** `cron/getyourguide-reviews/route.ts:14` and `cron/withlocals-reviews/route.ts:16` use
  `if (process.env.CRON_SECRET && authHeader !== …)` — no secret set → no check. The 10 other crons
  use the fail-closed `requireCronSecret` (`src/lib/auth/require-cron-secret.ts`).
- **Fix:** replace both with `requireCronSecret(request)`.
- **Model:** Sonnet. **Effort:** LOW.

### 1.4 — Config hygiene bundle ✅ DONE (2026-07-25)
- Add to `.env.example`: `SLACK_BOT_TOKEN`, `SLACK_ALERT_DM_CHANNEL`, `SUPPRESS_CONFIRMATION_EMAILS`
  (referenced in code, missing from the source-of-truth list). Missing `SLACK_BOT_TOKEN` silently
  routes critical DMs to the channel fallback.
- Record somewhere (README/migrations note) that migrations **088–104 are already applied to prod**
  out-of-band and must not be replayed (they use bare `CREATE TABLE/POLICY/INDEX` — a replay errors
  on the first duplicate). types.ts is in sync; the risk is provenance only.
- Add `alertCronFailure` to `getyourguide-reviews` and `withlocals-reviews` (only crons with none).
- Remove unused devDependency `ttf2woff2`.
- **Model:** Sonnet. **Effort:** LOW.

---

## PHASE 2 — Baseline hygiene (get to a clean bill of health)

### 2.1 — 6 TypeScript errors, all in one test file ✅
- `src/lib/fareharbor/validate-rebooking.test.ts` — fixtures missing the now-required `phone` on
  `FHContact` (lines 32, 47) and indexing `mock.calls[N][1].body` where the tuple is typed `[]`
  (34, 51). Production code is type-clean. Fix the fixtures + mock typing. **Sonnet. LOW.**

### 2.2 — 35 lint problems (mostly two repeated patterns) ✅
- 9× `react-hooks/set-state-in-effect`, 6× `react-hooks/refs`, 4× `no-unescaped-entities`, 2×
  `static-components`, 1 auto-fixable `prefer-const`, plus 13 warnings (unused vars, exhaustive-deps).
  The two hook clusters are mechanical batch refactors. See the lint agent's file:line list.
  **Sonnet. LOW-MED.**

---

## PHASE 3 — Money-path hardening (the real long-term fragility)

### 3.1 — No single `bookings` row writer ✅ RESCOPED + DONE (2026-07-26)
- **Problem (as originally written):** assumed 3 near-identical inserts with accidental drift,
  citable as `webhooks/stripe/route.ts:280`, `admin/booking-flow/book/route.ts` (`saveToSupabase`),
  and `admin/bookings/local/route.ts`.
- **Correction after re-reading all 3 sites in full:** `admin/bookings/local/route.ts` has no
  insert at all (read-only) — the real third site is `admin/booking-flow/create-payment-link/route.ts`.
  More importantly, the 3 real sites are NOT near-identical — they're 3 genuinely different booking
  flows (webhook-paid, admin-created, payment-link) with legitimately different column subsets
  (only payment-link has `stripe_session_id`/`payment_link_expires_at`; only the webhook has
  `traffic_source`/`traffic_detail`). Forcing them into one `buildBookingRow()` kitchen-sink function
  would risk a real money-path regression for marginal benefit — rejected as the wrong abstraction.
- **What was actually fixed:** the one CONCRETE drift already found — `base_vat_rate: 9` hardcoded
  literal (webhook, create-payment-link) vs a locally-redeclared `BASE_VAT_RATE_PERCENT` constant
  (book route) — none of the three referenced the shared `CRUISE_VAT_RATE`/`EXTRAS_VAT_RATE`
  constants in `src/lib/booking/constants.ts` that the invoice PDF generator already uses. All
  three now source their VAT rates from that single shared file. Low-risk, mechanical, fully tested
  (1096 tests pass, zero tsc errors). The status-value drift (the more important of the two original
  concerns) is handled properly and more precisely by 3.2 below.

### 3.2 — `BOOKING_STATUSES` constant + contract test ✅ DONE (2026-07-26)
- **Fix applied:** `BOOKING_STATUSES` + `BookingStatus` type added to `src/lib/booking/constants.ts`
  (6 values: `pending_payment`, `paid_pending_fh`, `fh_in_progress`, `confirmed`, `cancelled`, and
  the legacy/external `booked` — confirmed via `src/lib/tracking/queries.ts`'s own comment that
  FH-webhook-imported platform bookings are written directly at that status by a process outside
  this app). Added `src/lib/booking/booking-status-contract.test.ts`, modelled on
  `admin-route-contract.test.ts`'s explicit-file-list pattern (a full codebase regex scan would
  false-positive on unrelated `status` columns, e.g. `image_assets`).
- **Caught two real bugs immediately:**
  1. `admin/cruise-listings/[id]/route.ts`'s listing-deletion safety check filtered on `'pending'`
     (nothing ever writes that — the real value is `'pending_payment'`) and omitted
     `paid_pending_fh`/`fh_in_progress` entirely — a listing with money already in flight could be
     deleted. Fixed + added `route.test.ts` asserting the exact filter contents.
  2. `admin/tracking/affiliates/route.ts` filtered on `.in('status', ['confirmed', 'completed'])` —
     `'completed'` is dead (nothing ever writes it); removed.
- 1116 tests pass (was 1096), zero tsc errors, lint clean.
- **Model:** Sonnet. **Effort:** LOW-MED.

### 3.3 — Money-path tests (highest-ROI coverage gaps) ✅ DONE (2026-07-26)
- `createBookingIdempotent`/`findExistingBooking` — added
  `src/lib/fareharbor/client.ts`'s companion `create-booking-idempotent.test.ts` (12 tests): the
  checkExisting-first lookup, deterministic (400/403/404) vs transient (5xx) error handling,
  voucher-exact-match priority over email+party-size fallback, cancelled-booking exclusion, and the
  most-recent tie-break.
- `buildFhBookingPlan` — added `src/lib/booking/finalize-booking.test.ts` (11 tests, pure function,
  zero mocks needed): private vs shared-single-rate vs shared-multi-rate (adult+child) expansion,
  voucher_number = pi.id, contact fallbacks, note inclusion/omission.
- `pending-fh-sweep` — done in Phase 1.1.
- `charge.refunded` handler — added 5 tests to `webhooks/stripe/route.test.ts`: full vs partial
  refund boundary, expanded-object vs bare-id payment_intent resolution, missing-PI no-op, and that
  a Google Ads reporting failure doesn't block the Slack alert. Also tightened the happy-path
  assertion from `toHaveBeenCalled()` to the actual confirmed-flip payload.
- 1144 tests pass (was 1096 before 3.1-3.3 combined), zero tsc errors, lint clean.
- Deferred: the shared `mockSupabaseAdmin()` helper extraction (nice-to-have, not money-path risk
  reduction — skipped to keep moving through the phases; each new test file's mock is self-contained
  and passing).

### 3.4 — `Cents` branded type on the payment boundary ⚠️ MED — DEFERRED, do after 3.5/4.8
- Explicitly depends on the formatter consolidation in 3.5/4.8 ("route display through the one
  consolidated formatter") — attempting it before those exist would mean redoing the work. Moved to
  run immediately after 4.8 in the execution order, not skipped.
- **Problem:** all amounts are bare `number`; the same field is euros in one place, cents in another
  (`google-ads/guardrail.ts` works in euros; everything else cents). A euros/cents mix is a silent
  100× error the type system can't catch today.
- **Fix:** `type Cents = number & { __brand: 'cents' }` (or a small `Money` value object) in
  `src/types/`; adopt on quote/create-intent/webhook/booking boundaries first; route display through
  the one consolidated formatter (3.5 / 4.8).
- **Model:** Sonnet. **Effort:** MED (incremental).

### 3.5 — `src/lib/finance/shared.ts` (parsers) ✅ DONE (2026-07-26)
- **Fix applied:** `src/lib/finance/shared.ts` now holds the one canonical `parseCsvRows` (used by
  `revolut-statement.ts`, `fareharbor-payout-csv.ts`, and — upgraded, not just deduplicated —
  `clickandboat-csv.ts`, which previously split on newlines BEFORE parsing quotes and would have
  corrupted a quoted field containing an embedded newline), one canonical `toCents` (accepts €,
  thousands commas, and whitespace — a strict superset of all 7 prior variants; returns `null` on
  unparseable input instead of a silent 0), and `splitVat` (moved from `withlocals-summary.ts`,
  which now re-exports it so its 12 existing importers needed no changes).
- Each of the 8 per-source `toCents` callers kept its exact prior local signature/behavior via a
  thin wrapper (`sharedToCents(v) ?? 0` for the zero-defaulting sources; a direct swap for the 2
  that already returned `number | null`) — zero call-site changes needed anywhere.
- `shared.test.ts` added: 19 tests covering every currency format in the wild, the embedded-newline
  CSV case, and the ex+VAT-sums-to-gross invariant.
- 1163 tests pass (was 1144), zero tsc errors, lint clean.

---

## PHASE 4 — Structural cleanup for feature velocity

### 4.1 — ISR dead: public pages read `cookies()` via `createClient()` ✅ DONE (2026-07-26)
- Switched `(public)/page.tsx` (homepage), `cruises/page.tsx`, `crew/page.tsx`, `merch/page.tsx`, and
  `get-cruise-page-data.ts` (both `getListingBySlug` and `getCruisePageData`) from the cookie-aware
  `createClient()` to `createAdminClient()`, restoring `revalidate=60` ISR on all of them. Verified
  via the Supabase Management API that every table touched has either an unrestricted anon-read RLS
  policy or its own `is_active`/`is_published` code-level filter, so the client switch changes zero
  visibility.
- **Critical discovery mid-fix:** `Footer.tsx` (rendered on every public page via the shared layout)
  was also calling the cookie-aware client for `homepage_section_styles` — this alone would have
  silently forced every public page dynamic regardless of the page-level fixes above, since a
  Dynamic API call anywhere in the render tree defeats ISR, not just in the page component itself.
  Fixed the same way.
- Verified `checkout/page.tsx` has no `revalidate` export and is intentionally dynamic (correctly
  out of scope).
- Out-of-scope discovery flagged (not fixed, to stay in scope): `people`/`priorities_cards` tables
  have the same `admin_all`-with-`qual=true` anon-write RLS bug pattern as the Phase 0 critical
  fixes — spawned as a separate follow-up task rather than expanding this change.
- Verified: `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 1168 pass (6 skipped). Live
  DOM verification in-browser confirmed homepage hero, Featured Cruises, Reviews, and Footer (nav
  links, mission copy, contact info, admin-configured background texture + text colour) all render
  against real data — the Browser pane's screenshot capture had an unrelated glitch (returned blank
  frames) during this check, so verification was done via `innerText`/`getComputedStyle`/
  `getBoundingClientRect` instead of a visual screenshot; all confirmed correct rendering.

### 4.2 — `select('*')` on 74-column `cruise_listings` in one locale ✅ DONE (2026-07-26)
- Delegated an exhaustive usage trace (Explore agent) across `getCruisePageData`, the `[slug]/page.tsx`
  detail page incl. `generateMetadata`, and `CruiseContentSections` before touching either query —
  the risk of a missed column silently breaking a live page (the type cast to `CruiseListing` gives
  no compile-time safety net) was too high to eyeball. Confirmed all 6 locale-suffixed field groups
  (title/tagline/description/seo_title/seo_meta_description/faqs) are read one-locale-at-a-time via
  `getLocalizedField`/bracket access — never all 7 at once — so all 7 variants of each had to stay
  (can't statically drop any specific locale), but 14 wholly-unrelated columns (admin-editor-only
  fields, plus `is_published`/`display_order` which are query predicates, not projected fields)
  were safe to drop from both `getListingBySlug` (detail page, ~60 columns kept) and the `cruises/page.tsx`
  browse query (~20 columns kept — far less, since card rendering needs much less than the detail page).
  Verified live in the browser (title, description, highlights, extras, cancellation policy, boats,
  FAQs, meeting point, and both `<meta name="description">`/OG tags all confirmed rendering correctly
  against real data) — not just the automated suite, given the risk profile. Tests/tsc/lint clean.

### 4.3 — Extract domain logic out of the book route into `src/lib` ✅ DONE (2026-07-26, rescoped)
- A research pass (before touching money-path code) corrected the plan's framing: none of
  `resolveAttribution`/`resolveCampaignId`/`resolvePartnerInvoiceContext`/`applyPromoCodeUsage` are
  actually pure — every one does its own Supabase I/O. More importantly, **the webhook doesn't read
  the `oc_attr` cookie at all** — it consumes a `campaign_id` already resolved into PI metadata at
  create-intent time, then re-validates it against the campaigns table. So "the webhook re-derives
  attribution itself" isn't quite right either — the webhook has its own single, small campaign
  lookup block, structurally similar to (but not identical to) book route's Layer 1.
- **Found and fixed a real bug in the process:** comparing the two lookups side by side, book
  route's `resolveAttribution` Layer 1 (cookie path) resolved `partnerId` from the **cookie's own
  snapshot** (`attr.partner_id`), while Layer 2 (promo-code path) and the webhook's lookup both
  already read `partner_id` fresh off the campaign row — because that FK is continuously enforced
  by Postgres, so it's guaranteed current, whereas a cookie can outlive a partner reassignment on
  the campaign. Layer 1 alone had drifted from the other two.
- **The fix:** extracted the one operation that actually needed to be shared —
  `resolveCampaignCommission(supabase, campaignId, baseAmountCents)` in
  `src/lib/booking/campaign-commission.ts` — "given a campaign id, look up the campaign and resolve
  `{campaignId, partnerId, commissionAmountCents}`, always reading `partnerId` fresh from the row."
  Book route's Layer 1 *and* Layer 2 now both call it (Layer 1's bug is fixed as a side effect of
  reuse, not a separate manual change), and the Stripe webhook's inline block now calls it too —
  eliminating the actual duplication the plan was about. Also swapped Layer 1's hand-rolled
  `JSON.parse(attrCookie)` for the existing shared `parseAttribution()` helper
  (`src/lib/tracking/attribution.ts`) — a second, smaller pre-existing duplication in the same
  neighborhood.
- Added direct test coverage that didn't exist before: `campaign-commission.test.ts` (5 tests) and
  `route.resolve-attribution.test.ts` (7 tests, exported `resolveAttribution` for direct testing) —
  including a regression test asserting Layer 1 now returns the campaign's fresh `partner_id`, not
  a stale cookie value, which is the exact bug this fixes.
- **Deliberately NOT done, and why:** the plan's other named functions
  (`resolvePartnerInvoiceContext`, `resolveInvoiceLaterContext`, `buildBookingPayload`,
  `resolveCampaignId`, the promo-rotation trio, the Slack builder) have **no webhook reuse case** —
  confirmed by checking every other booking-creation call site
  (`create-payment-link/route.ts` omits attribution entirely — a separate gap, not a 3rd consumer;
  `create-intent.ts` only writes PI metadata, no campaign-table lookup happens there). Moving them
  into `src/lib` files would be pure code reorganization on money-path code with zero functional
  duplication removed — real diff and re-test surface for cosmetic benefit only. Left them in
  `route.ts`, matching the same judgment call made in 3.1 (don't force a unification/move that isn't
  earning its risk).
- **Flagging, not deciding, a real product question surfaced by the research:** the webhook writes
  `promo_code_id`/`discount_amount_cents` to the booking row but **never calls anything equivalent
  to `applyPromoCodeUsage`** — a promo code redeemed through the customer-facing Stripe checkout
  currently never increments `uses_count` or triggers rotation; only admin-created bookings via
  `/book` do. This might be intentional (Layer-2-linked codes are typically partner codes, not the
  discount codes real customers redeem) or might be an actual gap — it's a business-logic call, not
  a refactor detail, so left exactly as-is rather than guessing. Whoever owns promo-code rules
  should confirm before anything changes here.
- Verified: `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 1199 pass (up from 1187 — the
  12 new tests above).

### 4.4 — `withRoute()` wrapper + wrap ~15 unguarded admin mutation routes ✅ DONE (2026-07-26)
- Added `src/lib/api/with-route.ts` — a single-responsibility wrapper that catches a thrown
  exception and returns `apiError(err instanceof Error ? err.message : 'Unknown error')`, matching
  the exact catch-block message already used verbatim in all 63 existing guarded handlers (so
  wrapped and hand-guarded routes now produce identical error output). `requireAdmin()` stays inside
  the wrapped handler, not inside `withRoute` itself — it never throws (returns `NextResponse | null`)
  so there was no correctness reason to fold it in, and keeping it separate matches the existing
  one-job-per-helper style (`apiOk`/`apiError` vs `requireAdmin`).
- Wrapped all 21 unguarded POST/PUT/PATCH/DELETE handlers across 15 files: both `cruise-listings/[id]`
  mutations + its `duplicate` and `extras` routes, `extras` (list + `[id]`), `homepage-styles/[section]`,
  both `partners/[id]/settlements` routes, `priorities-cards/[id]`, `reviews` (list + `[id]`), all three
  `tracking/{affiliates,campaigns,channels}/[id]` files, and `users` + `users/invite` (the latter had a
  *partial* try/catch — only around the `requireRole` check — leaving JSON parsing and 3 Supabase calls
  unguarded; now the whole body is covered). GET handlers were left as-is — the plan scoped this to
  mutation routes, and GETs already fail more gracefully via SWR's own error path.
- **Caught via the test suite, not manually:** `src/lib/auth/admin-route-contract.test.ts`'s
  `findHandlers()` parses route files with a regex looking for `export function METHOD` to find each
  handler's body boundary. Converting a handler to `export const METHOD = withRoute(async (...) => ...)`
  made that regex blind to the new boundary, so the next handler's body (and its `requireAdmin()` call)
  got misattributed to the previous, unrelated handler — surfaced as a false "wrongly guarded" failure
  on `cruise-listings/[id]/extras/route.ts`'s public GET. Fixed by widening the test's boundary regex to
  recognize both the plain-function and `withRoute()`-wrapped const forms — a real gap in the guardrail
  itself now that two handler styles coexist, not an app bug.
- Verified: `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 1173 pass (6 skipped, up from
  1172 — added `src/lib/api/with-route.test.ts`, 5 tests covering pass-through of success/explicit-error
  responses, catching thrown `Error`/non-`Error` values, and argument forwarding).

### 4.5 — Migrate hand-rolled admin pages to `useAdminFetch` ✅ DONE (2026-07-26, rescoped)
- A research pass found 2 of the plan's 4 named "big ones" were already fully migrated on `main`
  (`cruises/page.tsx`'s reads, `finance/page.tsx`'s 22 GET call sites) — the plan's text was stale.
  The real remaining count was 17 files. Migrated 13 of them:
  - **Simple single-GET swaps (10 files):** `homepage/SectionStylesEditor.tsx`,
    `fareharbor-settings/page.tsx`, `cruise-editor/{CruisePaymentTab,CruiseDetailsTab,
    CruiseCancellationTab,CruiseImagesSection,CruiseConfigTab}.tsx`, `fareharbor/DateListingsStep.tsx`,
    `tracking/PartnerModal.tsx`, `booking-actions/AddCateringModal.tsx`.
  - **Multi-fetch / dependent-chain (3 files):** `ExtrasTab.tsx` (2 parallel fetches → 2
    `useAdminFetch` calls, combined loading state preserved), `tracking/CampaignModal.tsx` (3 parallel
    fetches → 3 calls; the modal never actually gated content on a combined loading flag before, so
    rather than inventing one, the combined flag now feeds `AdminFormModal`'s existing
    `submitDisabled` prop — blocks saving before the required channel list loads, without changing
    render behavior), and the 2 GET sites inside the 835-line `admin/fareharbor/page.tsx` booking
    wizard (left its mutation/step-machine logic untouched) — including the trickiest one, the
    invoice-suggestion dependent chain: the original's "never overwrite an amount the admin already
    typed" guard translates directly into a URL-vs-`null` condition (`!invoiceAmountInput`), since a
    non-null URL only ever fires once and a filled input collapses the URL to `null` permanently.
- Used two parallel background agents in isolated git worktrees for the mechanical bulk of this
  (10 simple files in one, the 3 trickier ones in another), then hand-merged both sets of changes
  into the working tree myself, reviewing each diff and reconciling 4 files that had unrelated
  earlier-phase edits (the `toAmsDateStr`/apostrophe-escape fixes in `fareharbor/page.tsx`, the
  `<img>`→`<Image>` swap in `AddCateringModal.tsx`, and 2 `eslint-disable` comments in
  `PartnerModal.tsx`/`CampaignModal.tsx`) so nothing from earlier phases was silently reverted.
- **Explicitly deferred, not silently dropped** — 4 sites that don't fit `useAdminFetch`'s model
  cleanly, each requiring a real design decision rather than a mechanical swap:
  - `homepage/page.tsx` + `boats/page.tsx` — read/write straight to Supabase via a cookie-aware
    client, with **no GET admin API route existing yet** for either table. Migrating these means
    designing and building new backend routes first, not just swapping a frontend hook — a bigger
    lift than the rest of this item, saved for its own pass.
  - `image-optimization/page.tsx` — polls every 2s via `setInterval` while a job is processing;
    `useAdminFetch` has no `refreshInterval` option (unlike raw `useSWR`), so this needs either
    extending the hook or a deliberate exception, not a blind swap.
  - `partners/page.tsx`'s per-row campaigns fetch — lazily populates a `Record<partnerId, ...>` cache
    on accordion-expand; the idiomatic SWR fix is extracting each row into its own child component
    (a real component-boundary refactor), not a like-for-like hook swap.
  - `booking-actions/RescheduleBookingModal.tsx`'s slot fetch — currently fires only on an explicit
    "Load slots" button click, not automatically; wiring it to `useAdminFetch` would change an
    on-demand action into an auto-fetch-on-change, a subtle behavior shift left for a deliberate
    decision rather than a silent swap.
- One accepted, low-risk behavior change worth flagging: `DateListingsStep.tsx`'s date-search now
  fires automatically on mount/date-change (matching the customer-facing search bar's established
  pattern) instead of requiring an explicit "Search" click — the button still works (now calls
  `refresh()`), just isn't strictly required anymore.
- Verified: `npx tsc --noEmit` clean, `npm run lint` clean (fixed 2 warnings the migration
  introduced — an unused `CancellationTier` import in `CruiseCancellationTab.tsx`, and an
  unmemoized `fhItems` array literal that could churn a `useMemo`'s deps every render in
  `CruiseConfigTab.tsx`), `npm test` 1187 pass (unchanged — pure refactor, no new tests needed).

### 4.6 — Finance page split + route factories 🟡 PARTIALLY DONE (2026-07-26, rescoped)
- This is real VAT/accounting reconciliation code used for actual tax filings, so a research pass
  ran first to separate genuinely safe/mechanical work from work that risks silently changing a
  number an accountant relies on. It found the full ask was riskier than this section implies:
  - The "four hand-maintained VAT copies" (Click&Boat, GetMyBoat, Barqo, Withlocals) are **three
    genuinely different formulas** (9%-of-net / 9%-of-net-plus-21%-derived-commission-gap /
    9%-of-gross-plus-separately-stored-commission), confirmed correct per the plan's own "do NOT
    unify the math" warning — but that also means a `deriveXVat` extraction needs one function
    *per source*, each verified against real historical rows to the cent, not just synthetic unit
    tests, before it's safe to trust.
  - The "9 near-identical aggregators" needing `bucketByPeriod` feed `btw-dashboard/summary`, which
    calls all of them **twice each** (quarter grain + month grain) — the single highest-blast-radius
    consumer in the whole finance module, and the one screen actual tax filing is based on. One of
    the 9 (`vat-stripe-summary.ts`) is also structurally different (a plain `Record` + a post-hoc
    `netCents` pass, vs. the other 8's `Map` + inline accumulation) — forcing it into one generic
    without treating that as a deliberate exception is exactly the kind of change that could
    silently shift a quarterly total.
  - Zero HTTP-route tests exist anywhere under `src/app/api/admin/finance/**` today — only the pure
    aggregation functions are tested. Any extraction of route-level logic needs new test coverage,
    not just "the existing tests still pass."
  - The plan's own "~1400–1600 lines collapse to ~350" estimate looks optimistic — a line-by-line
    read of the actually-generic tabs puts the real collapsible surface at ~1,100–1,250 lines if the
    three (four, including Zettle) bespoke tabs' JSX is left untouched, which is the safer reading.
- **Done, verified safe (two agents in isolated worktrees, output reviewed and merged by hand):**
  - `src/hooks/useFinanceUpload.ts` — deduplicates the identical upload-handling block (FormData →
    fetch → `json.ok` check → busy/message/error state → refresh) that 6 tabs (Viator, GetYourGuide,
    BoatLocal, Click&Boat, Withlocals, Revolut) each hand-rolled separately. Pure client-state/UI
    plumbing, zero money-math involved, zero visible behavior change (same button text, same
    success/error wording per tab). GetMyBoat has no upload UI (synced by a background job, not a
    file); FareHarborPayout's own upload block was left untouched (out of this pass's scope, not
    because it doesn't fit — it does).
  - `src/lib/api/create-summary-route.ts` — a `createSummaryRoute({table, columns, map, aggregate})`
    factory replacing 8 confirmed byte-for-byte-identical route handlers (barqo, boatlocal,
    clickandboat, fareharbor, getmyboat, getyourguide, revolut, viator `summary/route.ts`), each now
    ~10-17 lines. Reproduces the exact original request/response contract — same auth guard, same
    try/catch → `apiError` shape, same `apiOk(aggregate(...))` output. `withlocals/summary` and
    `zettle/summary` confirmed structurally different (extra filter / pre-split fields) and correctly
    left alone.
  - **Caught via the guardrail, not manually:** `src/lib/auth/admin-route-contract.test.ts`'s
    `findHandlers()` — already once widened in Phase 4.4 for the `withRoute()`-wrapped
    `export const METHOD = withRoute(...)` shape — was blind to this factory's *destructuring* export
    shape (`export const { GET } = createSummaryRoute(...)`), silently skipping all 8 migrated routes
    rather than failing. Extended `findHandlers()` again to recognize this pattern and treat any
    method destructured from a `createSummaryRoute(...)` call as guarded (the factory calls
    `requireAdmin()` unconditionally, backed by its own auth-denied-passthrough test) — the third
    time this exact class of gap has shown up as new handler-export shapes were introduced this
    session, worth remembering as a recurring pattern when adding future route wrapper factories.
  - Verified: `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 1215 pass (up from 1199 —
    9 new `useFinanceUpload` tests, 7 new `create-summary-route` tests).
- **Deliberately NOT done this pass, each requiring more than this session could safely verify:**
  - **`<PayoutSourceTab>` + `<FinanceTabShell>` full UI consolidation** for the 6 confirmed-generic
    tabs (Viator, GetYourGuide, BoatLocal, Click&Boat, GetMyBoat, Barqo) — classified safe (UI-only,
    no money-math) by the research pass, but still a real per-tab visual-parity verification task
    (each tab's column set/card count genuinely differs) that deserves its own dedicated pass rather
    than being squeezed in at the end of an already-large session.
  - **`deriveXVat` extraction** for the four VAT-formula sources — needs verification against real
    historical rows (does the extracted function reproduce today's stored numbers to the cent for
    every existing booking?), not just synthetic test fixtures, which requires someone with
    production data access to run and sign off.
  - **`bucketByPeriod` generic** for the 9 aggregators — recommended by the research to be its own
    careful phase: re-run `btw-dashboard/summary` old-vs-new (both quarter and month grain, every
    source) before merging, and get an explicit decision on how `vat-stripe-summary.ts`'s structural
    difference is handled (special-cased vs. forced into the generic) rather than papered over.
  - None of these are abandoned — they're the right-sized next slice whenever there's room to verify
    them properly, most likely with real production data on hand rather than in an autonomous pass.

### 4.7 — Split `CheckoutFlow.tsx` (864 lines, 4 concerns) ✅ DONE (2026-07-26)
- Extracted 4 siblings under `src/components/checkout/`: `types.ts` (the shared `BookingData`,
  `ServerQuote`, `PromoResult` interfaces both the orchestrator and the extracted pieces need —
  avoids a circular import between `CheckoutFlow.tsx` and its children), `CheckoutProgress.tsx`,
  `PromoCodeInput.tsx`, and `PaymentStep.tsx` (renamed from the old internal `PaymentForm` name for
  clarity — same component, needs to render inside `<Elements>`). `ContactForm` was already its own
  file (`GuestInfoForm.tsx`) before this phase, so it needed no extraction. `CheckoutFlow.tsx` itself
  shrank from 867 to 570 lines and kept every business-logic function (`refreshQuote`,
  `handleGuestInfoSubmit`, `handleFullDiscountBooking`, `handlePaymentSuccess`, `buildCustomerTypeRates`)
  — it stays the orchestrator per the plan, nothing here touched pricing logic (already
  server-canonical, confirmed healthy).
- Every moved function body is byte-identical to the original — only import paths and the one
  rename changed, so this is a pure structural move with zero logic changes.
- **Caught via the test suite:** `src/lib/auth/admin-route-contract.test.ts` was unaffected (that
  file only scans `src/app/api/admin`), but this is the same class of risk as 4.4's discovery —
  worth checking every time a component/handler is renamed or moved whether a source-scanning test
  elsewhere depends on its old shape. None did here.
- Verified: `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 1173 pass (unchanged — no new
  test file needed since no logic changed, only file organization). Live-verified in the browser:
  injected synthetic booking data into `sessionStorage` (the real key, `offcourse_booking` from
  `src/lib/constants.ts`) and loaded `/book/[slug]/checkout` directly — confirmed `CheckoutProgress`,
  `PromoCodeInput` ("Have a promo code?"), `GuestInfoForm`, `BookingSummary`, and `CancellationCutoff`
  all render correctly with a real server-canonical quote (`€310 + €5 city tax = €315 incl. VAT`)
  fetched live from `/api/booking-flow/quote`. Did not reach the extracted `PaymentStep` this way —
  it only renders after a real FareHarbor availability slot produces a valid Stripe `clientSecret`,
  and the synthetic `availPk` correctly triggered a "FareHarbor resource not found" error rather than
  faking through — `PaymentStep`'s live verification is left to the dedicated Stripe test-card pass
  (task list item 25), which exercises it with a real booking end-to-end instead of injected data.

### 4.8 — Consolidate money & date formatting ✅ DONE (2026-07-26, rescoped)
- A research pass (before touching code) found the real footprint was bigger than this section's
  estimate: 11 named money formatters (not 9) across ~230 call sites (not ~90 — the gap is almost
  entirely `fmtAdminAmount`'s 122 uses inside the single 3137-line `admin/finance/page.tsx`, itself
  slated for a full split in 4.6), 13+ date formatters, 13 confirmed `toISOString().slice(0,10)`/
  `split('T')[0]` UTC-hazard sites (matches the estimate), and 21 `'T12:00:00'`-workaround sites
  across 18 files (not 8) — see the full inventory in the research trace if needed.
- **Rescoped the money side** the same way 3.1 was: migrating all ~230 call sites to one new mega
  `formatMoney()` module would be a large mechanical diff for marginal benefit over what's here now,
  and `fmtEuros`/`formatPrice` (customer-facing, plain-period) vs `fmtAdminAmount`
  (admin-facing, nl-NL comma-decimal) are genuinely different display conventions, not accidental
  duplication — forcing them into one function would just reintroduce the difference as an options
  object. Instead: **(1)** fixed a real bug found along the way — `fmtEuros`, `fmtEurosRounded`,
  `fmtAdminAmount`, `fmtAdminAmountRounded` all built the string as `` €${value} ``, so a negative
  amount (refunds, adjustments) rendered as `€-5.00` instead of `-€5.00` — fixed in all four
  (`src/lib/utils.ts`, `src/lib/admin/format.ts`). **(2)** Deduped the 3 byte-identical true
  duplicates (`fmtAmountEur` in `book/route.ts` + `send-confirmation-email.ts`, `fmtPrice` in
  `fareharbor/helpers.ts`) into thin aliased imports of `fmtEurosRounded` — zero call-site changes,
  one less implementation to keep in sync. Left `formatPrice` (already `Intl`-based, already
  correct), `formatPriceLabel`/`formatExtraPrice`/`formatPriceDisplay` (domain-specific, low
  duplication value), the google-ads module's euro-denominated inline formatters (different unit —
  folding them into a cents-based formatter would be exactly the silent 100× bug 3.4 exists to
  prevent), and the sparse one-off inline `€${...}` literals untouched.
- **Fully fixed the UTC hazard** (the actual bug, not just duplication): added `toAmsDateStr(date?)`
  to `src/lib/utils.ts` — `Intl`-based, `en-CA` locale trick, explicit `Europe/Amsterdam` — and
  replaced all 13 confirmed hazard sites with it, across both server routes/libs (`fh-consistency`
  cron's `booking_date` query predicate, `boats/[id]/sync-capacity`, `fareharbor/sync.ts`,
  `google-ads/reporting.ts`, `partner/clicks/route.ts`) and admin client components
  (`admin/fareharbor/page.tsx`, `partner/bookings/page.tsx`, `RescheduleBookingModal.tsx`) — a
  bare `toISOString().slice(0,10)` on a server (UTC) reads the wrong calendar day for roughly the
  first 1-2 hours after Amsterdam midnight each day. Did **not** touch the existing (different,
  pre-existing) `toDateStr` in the same file — its 11 call sites are client-side date-picker "what
  day is today" UI, intentionally using the browser's own local time, not a server-side business
  predicate; renaming/changing it was out of scope and not the bug in question.
- Also fixed `formatDate` (`src/lib/utils.ts`) to default to `timeZone: 'Europe/Amsterdam'` —
  Amsterdam is always ahead of UTC, so a bare "YYYY-MM-DD" string now always displays on the
  correct calendar day for any viewer's browser timezone, without needing a pre-shift. This let two
  call sites (`BookingSummary.tsx`, `SearchResultsPage.tsx`) drop their `'T12:00:00'` workaround
  entirely. Left the other ~19 raw inline `'T12:00:00'` sites alone — the technique is correct, just
  duplicated, and per-site review of ~19 scattered call sites for a non-bug was judged not worth the
  diff size/risk here; flagging for a future pass if it recurs.
- Deduped 3 more true duplicates found along the way: `amsStartOf` (byte-identical in
  `src/lib/admin/week.ts` and `date-filter.ts`, the latter's own docstring already said "mirrors the
  identical helper") — now lives once in `date-filter.ts`, exported, `week.ts` imports it;
  `week.ts`'s local `amsDateString` — replaced with a re-exported alias of the new `toAmsDateStr`
  (external consumers `planning/page.tsx` + `week.test.ts` needed zero changes); and
  `ReviewsModal.tsx`/`ReviewsSlider.tsx`'s byte-identical local `formatDate(publishTime)` — lifted to
  a new `formatReviewMonthYear` in `utils.ts`, both files now import it aliased as `formatDate`.
  Left the 3 `fmtDate`-named functions in `partners/[id]/page.tsx`, `generate-invoice-pdf.ts`, and
  `catering/email-template.ts` alone — despite sharing a name, they use different locales
  (en-GB/en-NL) and option shapes and are genuinely different display conventions for different
  audiences, not accidental duplication; forcing one shape would be a real customer/admin-facing
  display change for no correctness benefit.
- Verified: `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` 1187 pass (up from 1173 —
  added negative-amount tests for the 4 fixed formatters, `toAmsDateStr` tests including a direct
  regression test reproducing the exact UTC-hazard failure mode, a `formatDate` timezone-safety
  test, and `formatReviewMonthYear` tests).

### 4.9 — Locale list re-hardcoded outside config ✅ DONE (2026-07-26)
- `proxy.ts`'s regex is now built from `locales.join('|')` (also fixed a second hardcoded
  `DEFAULT_LOCALE = 'en'` alongside it → uses `defaultLocale`). `AssetRow.tsx` and
  `src/lib/ai/context.ts` now import/re-export from the canonical `@/lib/i18n/config` instead of
  re-declaring the array. Verified the generated regex is byte-identical to the old hardcoded one.
  Zero external importers of `ai/context.ts`'s `LOCALES`/`Locale` existed, but kept as re-exports
  (same names) for safety. Tests/tsc/lint clean.

### 4.10 — Dead code removal ✅ DONE (2026-07-26)
- Re-verified every candidate with grep immediately before deleting (all confirmed zero real
  importers). Deleted: `fareharbor/index.ts` barrel, `ui/ReviewCard.tsx`, `auth/RoleGate.tsx`,
  `createServiceClient` (+ the stale comment referencing it in `calculate-quote.ts`),
  `getCustomerTypeMap()` + its dead `'customer-types'` caller branch in `fareharbor-test/route.ts`,
  `getRawAvailabilities`, `applyListingFilters`, `utils.ts` `pluralize`, `section-styles.ts`
  `EMPTY_SECTION_STYLE`, and 5 unused `tracking/constants.ts` exports (kept `USER_AGENT_MAX_LENGTH`
  — confirmed genuinely used). Tests/tsc/lint clean throughout.

### 4.11 — `/api/search/slots` redundant listing round-trip ✅ DONE (2026-07-26)
- Added `getFilteredAvailabilityBySlug()` to `availability.ts` (shares a new `computeFilteredAvailability`
  helper with the existing id-based `getFilteredAvailability`, used unchanged by the other caller,
  `/api/fareharbor/availability`). The route now does one query instead of two, and no longer needs
  the cookie-aware client at all.
- **Behavior preserved carefully:** the old route returned 404 for a missing/unpublished listing;
  simply swapping to the new function would have collapsed that into the same `NO_AVAILABILITIES`
  code as "listing exists, no slots today" (200). Added a distinct `LISTING_NOT_FOUND` reason code
  (verified zero client code exhaustively switches over `ReasonCode`, so this was safe to add) so
  the route still 404s correctly. Added `route.test.ts` (5 tests, previously zero) — the
  SECURITY/REGRESSION test specifically guards the 404-vs-200 distinction.
- 1168 tests pass (was 1163), zero tsc errors, lint clean.

---

## Suggested execution order

1. **Phase 0** (Opus, with Beer's approval per item — production security). Group 0.1-0.3 into one
   reviewed RLS migration; 0.4 + 0.5 are the booking-flow code fixes.
2. **Phase 1** (Sonnet) — restore the safety net + config hygiene.
3. **Phase 2** (Sonnet) — clean type/lint baseline.
4. **Phase 3** (Opus for 3.1 + idempotency tests; Sonnet rest) — harden the money path.
5. **Phase 4** (Sonnet) — structural cleanup, in any order; 4.6 is the big bulk win, do it last.

Phases 0-3 make the base *safe*; Phase 4 makes it *fast to build on*. Don't start Phase 4 refactors
until Phase 0 is closed — you don't want to be restructuring code that has a live hole in it.
