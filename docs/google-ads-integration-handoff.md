# Google Ads API — Conversion Tracking: Engineering Handoff

**Audience:** the developer setting up Google Ads conversion tracking for the **Boat Local** environment.
**Source of truth:** the Off Course Amsterdam codebase (Next.js 16 / TypeScript / Stripe / Supabase / FareHarbor), where this is already built, deployed, and verified live against the real Google Ads API.
**Purpose:** explain exactly how our system works, how the Google Ads API plugs into it, how the tracking + value calculation work (VAT is the critical part), the bugs we hit and how we fixed them, and a step-by-step setup runbook you can replicate for Boat Local.

---

## 0. Executive summary (read this first)

**What we built:** server-side **Offline Conversion Import**. We do *not* use the Google `gtag`/pixel in the browser. When a customer pays, our **Stripe webhook** (server) reports the sale directly to Google Ads via the REST API, tagged with the click that drove it (`gclid`) and the **net, ex-VAT value of the booking**.

**Why server-side, not a pixel:**
1. **The true value is only known server-side.** The amount we report to Google must be the **net commission we actually keep** — i.e. the booking value **minus VAT minus the municipal city tax minus any discount**. The browser doesn't reliably know that breakdown; our server does (it's in the Stripe PaymentIntent metadata).
2. **It survives ad-blockers, iOS/Safari ITP, and "browser closed after iDEAL redirect."** The conversion fires from the webhook, which runs regardless of what the browser does.
3. **Refunds stay honest.** A refund automatically retracts (full) or restates (partial) the conversion, so reported revenue matches reality.

**The one rule that matters most for Boat Local (VAT / net value):**
> We send Google the **net ex-VAT revenue**, *never* the gross booking total.
> `value = (base − base_VAT) + (extras − extras_VAT) − discount`
> City tax (a municipal pass-through we never keep) and all VAT are **excluded**.
> See [§4](#4-the-value-rule-vat-net-revenue--critical-for-boat-local). **If Boat Local earns a *commission* rather than the full booking, this formula must be replaced with your commission calculation.** This is the single most important adaptation.

**The flow in one line:**
`Ad click (gclid) → first-party cookie → Stripe PaymentIntent metadata → payment_intent.succeeded webhook → compute net value → upload to Google Ads → store audit row.`

**Bugs we hit (so you can skip them):** Web-app OAuth client → `redirect_uri_mismatch` (use a **Desktop** client instead); the code defaulted to a **sunset API version (v18 → 404)** which silently failed as "unknown error"; **enhanced conversions rejected** until you accept the account's *customer data terms*. Details in [§7](#7-bugs-we-encountered-and-how-we-fixed-them).

---

## 1. How our system works (the booking architecture)

Off Course is a search-first booking site. The booking money-path is:

1. **Browse / search** → the visitor picks a cruise, date, time, guests, extras.
2. **Quote** (`/api/booking-flow/quote`) → the server computes an authoritative price and stores it in the `pricing_quotes` table. **The client never supplies prices** — the quote is the source of truth.
3. **Create PaymentIntent** (`/api/booking-flow/create-intent`) → the server re-verifies the quote, creates a **Stripe PaymentIntent**, and writes a full breakdown into the PaymentIntent **metadata** (this metadata is what conversion tracking later reads).
4. **Pay** → Stripe (card confirms synchronously; iDEAL/Bancontact/SEPA redirect to the bank and back).
5. **Book** → two paths converge:
   - **Browser path** (`/api/admin/booking-flow/book`): for card payments, the browser calls this right after `confirmPayment` returns. Creates the FareHarbor booking + saves to Supabase.
   - **Webhook safety net** (`/api/webhooks/stripe`, event `payment_intent.succeeded`): the last line of defence for redirect methods or a failed browser flow. Recreates the booking from PaymentIntent metadata.
6. **Confirm** → FareHarbor booking, confirmation email (Resend), Slack notification.

**Key architectural point for tracking:** because card payments are booked by the *browser* path and async payments by the *webhook* path, the **only place that runs exactly once for every successful payment** is `payment_intent.succeeded`. That is therefore where the Google Ads conversion is fired — see [§3](#3-how-the-tracking-works-step-by-step).

Stack: Next.js 16 (App Router) · TypeScript · Stripe (Payment Intents, **not** Checkout Sessions) · Supabase (Postgres) · FareHarbor External API · Vercel.

---

## 2. How the Google Ads API integrates

### 2.1 Mechanism: Offline Conversion Import (server-to-server)

We call the **Google Ads REST API** directly (no SDK, to keep the dependency surface and serverless cold-start small). Two methods are used:

| Method | When | File |
|---|---|---|
| `uploadClickConversions` | on a successful payment | `src/lib/google-ads/upload-conversion.ts` |
| `uploadConversionAdjustments` | on a refund (retract/restate) | `src/lib/google-ads/upload-adjustment.ts` |

Endpoint shape (built in `src/lib/google-ads/client.ts`):
```
POST https://googleads.googleapis.com/{API_VERSION}/customers/{customerId}:{method}
Headers:
  Authorization: Bearer {access_token}      # short-lived, from the refresh token
  developer-token: {GOOGLE_ADS_DEVELOPER_TOKEN}
  login-customer-id: {GOOGLE_ADS_LOGIN_CUSTOMER_ID}   # the manager/MCC account
```

### 2.2 Account structure (MCC → sub-account)

We use a **Manager (MCC) account** that contains the per-brand advertiser accounts:

```
Manager (MCC)  ── login-customer-id
  └── Advertiser account (the one that runs ads + owns the conversion action) ── customer-id
```

- `login-customer-id` = the **manager** account number (10 digits, no dashes).
- `customer-id` = the **advertiser** account that runs the ads and owns the conversion action.
- The advertiser account must be **linked to the manager** (manager sends a link request → advertiser accepts) before the API can reach it through the manager login.

> ⚠️ **Gotcha:** the `ocid=` value in Google Ads dashboard URLs is a *display* id, **not** the real customer id. Get the real ids from the API method `customers:listAccessibleCustomers`, or from the top-right account switcher in the UI.

### 2.3 Auth (OAuth2 refresh-token flow)

`src/lib/google-ads/auth.ts`:
- A long-lived **refresh token** (generated once, with the `https://www.googleapis.com/auth/adwords` scope) is exchanged for a **short-lived access token** at `https://oauth2.googleapis.com/token`.
- The access token is **cached in-module** with a 60-second safety margin, so repeated webhook calls in the same warm serverless instance don't re-fetch.
- The OAuth **client id/secret** can be Ads-specific (`GOOGLE_ADS_CLIENT_ID/SECRET`) or fall back to the shared Google OAuth client (`GOOGLE_OAUTH_CLIENT_ID/SECRET`).

### 2.4 The 7 credentials (+ 2 settings)

| Env var | What it is | Where to get it |
|---|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | API access token, **manager-level** | Google Ads (manager) → Admin → **API Center** |
| `GOOGLE_ADS_CLIENT_ID` | OAuth client id | Google Cloud Console → Credentials (**Desktop app** — see §7.1) |
| `GOOGLE_ADS_CLIENT_SECRET` | OAuth client secret | same credential |
| `GOOGLE_ADS_REFRESH_TOKEN` | long-lived consent token | generated once via the OAuth consent flow (scope `adwords`) |
| `GOOGLE_ADS_CUSTOMER_ID` | advertiser account id (10 digits, no dashes) | top-right account switcher / `listAccessibleCustomers` |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | manager (MCC) id | the manager account number |
| `GOOGLE_ADS_CONVERSION_ACTION_ID` | numeric id of the "Booking" conversion action | created via API or Goals → Conversions → New → Import |
| `GOOGLE_ADS_API_VERSION` | e.g. `v20` (see §7.2) | current version in API Center |
| `GOOGLE_ADS_REQUIRE_CONSENT` | `true`/`false`, default `true` | your call (gates send-to-Google on consent) |

All are declared `optional()` in `src/env.ts`, so a missing key never blocks boot — the conversion code degrades gracefully (logs a clear "not configured" and skips) instead of throwing.

---

## 3. How the tracking works (step by step)

This is the full path from ad click to a conversion landing in Google Ads.

### Step 1 — Click capture (the `gclid`)
Google auto-tagging appends a click id to the ad's Final URL. There are **three kinds**, and each must be uploaded to its **own API field** — sending one as another won't match:
- `gclid` — standard (desktop / Android / most web)
- `wbraid` — iOS web-to-web in privacy-restricted state
- `gbraid` — iOS app-to-web (ad tapped inside an app → Safari)

Selection logic lives in `src/lib/tracking/click-ids.ts` (`pickClickId`, priority `gclid → wbraid → gbraid`; `toClickType` validates).

We capture the click id in **two redundant ways**:

- **Server-side (primary)** — `src/app/api/t/[slug]/route.ts`. Our campaign links are `/t/<slug>`; when used as a Google ad's Final URL, auto-tagging appends `?gclid=…`. This route logs the click, sets our attribution cookie, **sets the `oc_gclid` + `oc_click_type` cookies**, and forwards the click id onto the destination.
- **Client-side (fallback)** — `captureClickIdsFromURL()` in `src/lib/tracking/attribution.ts`, invoked from `src/components/tracking/TrackingScript.tsx`. For ads whose Final URL points **directly** at a cruise page (not via `/t`), this reads `?gclid` from the URL and sets the same cookies.

Cookies (`src/lib/tracking/constants.ts`):
- `oc_gclid` — the click id value
- `oc_click_type` — which kind (`gclid`/`wbraid`/`gbraid`)
- both last **90 days** (`GCLID_COOKIE_DAYS`) — matches Google's default click-conversion window
- `oc_consent` — `'yes'` when the visitor accepted the marketing/tracking banner

> Capturing the click id is **our own first-party data** and is **not** consent-gated. Only the eventual *send to Google* is consent-gated (see §6).

### Step 2 — Carry it through the booking → PaymentIntent metadata
At create-intent time (`src/app/api/booking-flow/create-intent/route.ts`):
```ts
const gclid           = request.cookies.get('oc_gclid')?.value ?? null
const clickType       = request.cookies.get('oc_click_type')?.value ?? null
const marketingConsent = request.cookies.get('oc_consent')?.value === 'yes'
```
These are passed to `createPaymentIntent()` (`src/lib/booking/create-intent.ts`), which writes them — **plus the full price/VAT breakdown** — into the **Stripe PaymentIntent metadata**:

```ts
metadata: {
  // … booking fields …
  server_base_amount_cents:  String(recomputed.serverBaseAmount),
  extras_amount_cents:       String(recomputed.extrasCalculation.extras_amount_cents),
  base_vat_amount_cents:     String(recomputed.extrasCalculation.base_vat_amount_cents),
  extras_vat_amount_cents:   String(recomputed.extrasCalculation.extras_vat_amount_cents),
  total_vat_amount_cents:    String(recomputed.extrasCalculation.total_vat_amount_cents),
  city_tax_cents:            String(recomputed.cityTaxCents),
  consent_marketing:         marketingConsent ? 'yes' : 'no',
  ...(gclid ? { gclid: String(gclid), click_type: toClickType(clickType) } : {}),
  ...(promo ? { discount_amount_cents: String(recomputed.discountAmountCents) } : {}),
  guest_email: …, guest_phone: …,   // for enhanced conversions (hashed later)
}
```
**The PaymentIntent metadata is the hand-off between the booking flow and the conversion tracking.** Everything the conversion needs is now attached to the payment itself.

### Step 3 — Fire the conversion (Stripe webhook)
`src/app/api/webhooks/stripe/route.ts`, on `payment_intent.succeeded`:
```ts
// Runs BEFORE the booking-idempotency check, so card payments already booked by
// the browser /book path still get their conversion. Has its own dedupe; never throws.
await reportBookingConversion({ supabase, pi })
```

`reportBookingConversion` (`src/lib/google-ads/report-conversion.ts`) does, in order:
1. **Compute value** — `computeNetRevenueCents(meta)` → the net ex-VAT figure (see §4).
2. **Decide** — `decideUpload({ gclid, consent, requireConsent })`:
   - no `gclid` → skip (`skipped_no_gclid`)
   - `requireConsent` on and consent ≠ `'yes'` → skip the *send* (`skipped_no_consent`) but still record the row.
3. **Dedupe + claim** — `upsert` into `google_ads_conversions` keyed on `payment_intent_id` with `onConflict: ignoreDuplicates`. An empty result means a prior delivery already handled it → return. **This is the at-most-once guarantee.**
4. **Upload** — `uploadClickConversion(...)` → `googleAdsPost('uploadClickConversions', …)`:
   - puts the click id in the correct field (`gclid`/`wbraid`/`gbraid`),
   - sets `conversionAction`, `conversionValue` (major units, e.g. `165.00`), `currencyCode: 'EUR'`, `conversionDateTime` (Google's `yyyy-mm-dd hh:mm:ss+hh:mm`, Amsterdam tz), and `orderId = PaymentIntent id` (Google-side dedupe + the key refunds match on),
   - attaches **enhanced-conversions** hashed email/phone **only when consent = yes** (§6).
5. **Record outcome** — update the row to `uploaded` or `failed`, storing the raw Google response + any error.

### Step 4 — Store the click id on the booking too
`src/app/api/admin/booking-flow/book/route.ts` writes `gclid` onto the `bookings` row (admin visibility: which bookings came from a Google ad). Nullable; most bookings have none.

---

## 4. The value rule (VAT / net revenue) — CRITICAL for Boat Local

### 4.1 What we send Google
The conversion value is computed by **`computeNetRevenueCents`** in `src/lib/google-ads/conversion-value.ts`:

```ts
net = (base − base_vat) + (extras − extras_vat) − discount     // in cents, floored at 0
```
Then converted to major units (`centsToMajor`, e.g. `16500 → 165.00`) and sent as `conversionValue`.

**Excluded from the value, deliberately:**
- **All VAT** (9% on the cruise, 21%/9% on extras) — it's not ours, we remit it.
- **City tax** (€2.60/guest, a municipal pass-through) — never in `base_amount`, never reported.
- **Discounts** — subtracted, because we only "make" the post-discount amount.

> The business rule, in plain terms: **report what we actually keep, not what the customer paid.** Reporting the gross total would inflate ROAS and mislead Smart Bidding.

### 4.2 How the VAT numbers are produced (so you can replicate the math)
All displayed prices are **VAT-inclusive (gross)**. VAT is **back-calculated**, not added on top. See `src/lib/extras/calculate.ts`:

```ts
// vat = price × rate / (100 + rate)
export function extractVat(amountInclVat: number, rate: number): number {
  if (rate === 0) return 0
  return Math.round(amountInclVat * rate / (100 + rate))
}
```
- **Base cruise VAT rate = 9%** (hard-coded `BASE_VAT_RATE = 9`).
- **Extras** each carry their own `vat_rate` (e.g. 21% alcohol, 9% food), back-calculated per line item.
- `base_vat_amount_cents`, `extras_vat_amount_cents`, `total_vat_amount_cents` are computed here and stored in the PaymentIntent metadata at create-intent time.
- City tax is computed separately in `src/lib/booking/calculate-quote.ts` (`cityTaxCents = guestCount × CITY_TAX_PER_GUEST_CENTS`) and is **kept out of `base_amount`** on purpose.

**Worked example — €165 private cruise, no extras, no discount:**
- Gross charged to customer (excl. city tax): €165.00
- Base VAT (9% back-calc): `16500 × 9 / 109 ≈ 1362` cents (€13.62)
- **Net reported to Google:** `16500 − 1362 = 15138` cents → **€151.38**
- (If there were €40 of drinks at 21%: extras_vat ≈ `4000 × 21/121 ≈ 694`; add `4000 − 694 = 3306` to the net.)

### 4.3 ⚠️ The Boat Local adaptation you must decide
Off Course **operates** its own cruises, so "net revenue" = ex-VAT booking value. Your message used the phrase *"net commission of what we actually make."* If **Boat Local's model is a commission/agency model** (you resell partner inventory and keep only a % or a fixed fee), then:

> **`computeNetRevenueCents` must be replaced** so the reported `conversionValue` is **your commission**, not the ex-VAT booking total.

Concretely, the developer should change exactly one pure function (`computeNetRevenueCents`) to, e.g.:
- `commission = (ex_VAT_booking_value) × commission_rate`, or
- a fixed margin per booking, or
- whatever Boat Local's true take is.

Everything downstream (upload, refund restatement, audit row) already works in terms of `value_cents`, so **this is the only place the money rule lives.** Its unit tests are in `conversion-value.test.ts` — update them to lock in the Boat Local rule. Refund **restatements** automatically scale this value proportionally, so they stay correct once the base value is right.

---

## 5. Refunds (keeping reported revenue honest)

`charge.refunded` webhook → `reportRefundAdjustment` (`src/lib/google-ads/report-refund.ts`) → `uploadConversionAdjustments`:
- **Full refund** → `RETRACTION` (cancels the conversion).
- **Partial refund** → `RESTATEMENT` to `value_cents × (remaining / charged)` — i.e. the value drops proportionally to the amount kept.
- Matched to the original conversion by **`orderId` = PaymentIntent id** (no `gclid` needed for adjustments).
- Guards: only adjusts rows that actually reached Google (`status === 'uploaded'`); a fully-retracted row is never adjusted twice.
- Adjustment outcome is stored on the same `google_ads_conversions` row (`adjustment_status`, `adjusted_at`, `adjustment_response`).

---

## 6. Consent & enhanced conversions

- **Send gating** — `GOOGLE_ADS_REQUIRE_CONSENT` (default `true`). With it on, a conversion is only *sent* to Google when `consent_marketing === 'yes'`. Without consent we still **record an audit row** (status `skipped_no_consent`) and keep the `gclid` on the booking for our own analytics.
- **Enhanced conversions** — when (and only when) consent = `'yes'`, we attach **SHA-256-hashed** email + phone (`src/lib/google-ads/user-identifiers.ts`). The raw PII **never leaves our server** — it's normalized (Google's email/phone rules) and hashed first. This independent gate means customer PII is never transmitted without explicit consent, regardless of the `REQUIRE_CONSENT` flag.
- **Account prerequisite:** enhanced conversions require accepting the account's **customer data terms** in Google Ads (one-time). Until accepted, any *consented* upload is rejected (§7.3).

---

## 7. Bugs we encountered and how we fixed them

### 7.1 `redirect_uri_mismatch` when generating the refresh token
**Symptom:** "Access blocked: This app's request is invalid — Error 400: redirect_uri_mismatch" during the OAuth consent step.
**Cause:** we used a **Web application** OAuth client. Web clients require **every** redirect URI to be pre-registered, and Google's save can take minutes-to-hours to propagate; the OAuth Playground / `localhost` weren't reliably allowlisted.
**Fix:** create a **Desktop app** OAuth client instead. Desktop clients **auto-allow `http://localhost` on any port** — no redirect URI registration, no waiting. We generated the refresh token with a tiny local loopback script (`http://localhost:8080` redirect, scope `adwords`, `access_type=offline`, `prompt=consent`).
**Takeaway for Boat Local:** use a **Desktop** OAuth client for the token-generation step.

### 7.2 Sunset API version → silent "unknown error" (the dangerous one)
**Symptom:** the end-to-end test stored a conversion row with `status: failed`, `error: "unknown error"` — no useful detail.
**Cause:** `src/lib/google-ads/client.ts` defaulted to `API_VERSION = 'v18'`. **Google has sunset v18 and v19 — they return HTTP 404.** A 404 body has no `partialFailureError.message`, and `fetch` doesn't throw on a 404, so neither the `error` nor the `partialFailure` field was populated → the code fell back to the literal string `'unknown error'`. In production this would have **silently dropped every conversion** with no obvious cause.
**Fix:** set `GOOGLE_ADS_API_VERSION=v20` (env) **and** bumped the code default `v18 → v20`. We verified live: `v18/v19 → 404`, `v20/v21 → alive`.
**Takeaways for Boat Local:**
- Always set `GOOGLE_ADS_API_VERSION` explicitly to a currently-supported version (check API Center).
- Consider improving `googleAdsPost` to surface `res.status` into the `error` string when a response is non-OK but has no `partialFailureError` — so a future sunset shows up as `"HTTP 404"` instead of `"unknown error"`. (Minor observability hardening; not yet applied.)
- Google sunsets ~3 versions/year — treat the version as a thing you bump on a schedule.

### 7.3 Enhanced conversions rejected — "customer data terms" not accepted
**Symptom (only after the v20 fix surfaced real errors):**
> "Make sure you agree to the customer data processing terms in conversion settings… at `conversions[0].user_identifiers`"
**Cause:** sending hashed `user_identifiers` (enhanced conversions) requires the account to have **accepted the customer-data-processing terms**. We confirmed `conversion_tracking_setting.accepted_customer_data_terms = false`.
**Fix:** accept the terms once in the UI — **Goals → Conversions → Settings → Enhanced conversions → turn on, method = Google Ads API, agree to the customer data terms.** (This is a legal acceptance; it must be done by an account admin, not via API.) Until accepted, *consented* bookings (which include `user_identifiers`) fail entirely; non-consented base conversions are unaffected.
**Takeaway for Boat Local:** accept the customer data terms **before** launch if you want enhanced conversions.

### 7.4 Account-id confusion (`ocid` ≠ customer id)
The `ocid=` parameter in Google Ads dashboard URLs is a display id, not the real account number. We initially set the wrong `login-customer-id` from a URL. **Fix:** read the real ids from `customers:listAccessibleCustomers` (and query `customer_client` on the manager to enumerate sub-accounts with names). Verify, don't guess.

### 7.5 (Testing only) `server-only` import guard
Running the real conversion code from a standalone `tsx` script failed because `src/lib/supabase/admin.ts` imports `server-only` (a Next build-time guard). We dropped a temporary no-op `node_modules/server-only` stub for the test run, then removed it. Not a production bug — just note it if you write a similar standalone test harness.

---

## 8. How to test it (3 levels, cheapest first)

A conversion only **counts** in Google Ads if it's tied to a **real ad click** — you cannot fabricate a valid `gclid`. So full proof needs one real click. But everything else is testable without spending:

- **Level 1 — validate-only upload (no campaign, free).** Call `uploadClickConversions` with `validateOnly: true`, a sample value, EUR, and a dummy gclid. Google validates auth + conversion action + payload **without recording**. A "gclid could not be decoded" message = everything but the fake click id is correct. *(This is also how you confirm the developer token has production access — a test-only token can't touch a real account.)*
- **Level 2 — exercise the real code path (no charge).** Call `reportBookingConversion` with a synthetic `PaymentIntent` (fake gclid, realistic VAT metadata, `consent_marketing: 'yes'`). This runs the actual value calc → DB row → Google upload → status update. **This is the test that caught bug §7.2.** Use a unique `pi_TEST_…` id and delete the row afterward.
- **Level 3 — one real click (the only true end-to-end proof).** Launch a tiny brand campaign (e.g. €5–10/day on your own brand name), click your own ad, complete a booking. The conversion appears in Google Ads → Goals → Conversions → **Diagnostics/Uploads** within ~3–6h. If you book with real money, the refund path retracts both the booking and the conversion.

Existing automated tests: `conversion-value.test.ts`, `user-identifiers.test.ts`, `click-ids.test.ts`, `attribution.test.ts`, and the Stripe webhook test under `src/app/api/webhooks/stripe/route.test.ts`.

---

## 9. Setup runbook for Boat Local (minute-by-minute)

> Assumes Boat Local has (or will create) its own advertiser account under the same Manager (MCC), and its own code environment with the same library structure.

**A. Google Ads / Cloud side**
1. **Developer token** — in the **manager** account → Admin → **API Center** → fill the form (Advertiser, your URL, intended use = "upload offline conversion data from our booking system"). Copy the token. *(New tokens may be "test accounts only" until Google approves Basic access — but if API calls against a real account succeed, you already have production access.)*
2. **Enable the Google Ads API** in your Google Cloud project (APIs & Services → Library → Google Ads API → Enable).
3. **OAuth client** — Cloud Console → Credentials → Create credentials → OAuth client → **Desktop app** (see §7.1). Copy the **client id + secret immediately** (the secret is shown once).
4. **Refresh token** — run a loopback script (redirect `http://localhost:8080`, scope `https://www.googleapis.com/auth/adwords`, `access_type=offline`, `prompt=consent`), sign in as the **manager** owner, click through the "unverified app" warning (it's your own app), Allow → exchange the code → copy the `refresh_token` (`1//…`).
5. **Link the Boat Local advertiser account to the manager** — manager → Accounts → "+" → Link existing account → enter the advertiser's 10-digit id → send. Then, signed into the advertiser account, **Accept** (notifications bell, or Admin → Access and security → Managers).
6. **Create the conversion action** — in the advertiser account, via API (`ConversionActionService` `type: UPLOAD_CLICKS`, `category: PURCHASE`, `countingType: ONE_PER_CLICK`, `primaryForGoal: true`, default currency EUR) **or** UI: Goals → Conversions → New → **Import → "Manual import using API/uploads"**. Copy its numeric id.
7. **Auto-tagging ON** — advertiser account → Admin → Account settings → Auto-tagging (or `customer.auto_tagging_enabled = true` via the API). This is what appends `gclid` to ad clicks.
8. **(For enhanced conversions) accept the customer data terms** — Goals → Conversions → Settings → Enhanced conversions → turn on → method = Google Ads API → agree (§7.3).

**B. Code / env side**
9. Set the 7 credentials + `GOOGLE_ADS_API_VERSION` + `GOOGLE_ADS_REQUIRE_CONSENT` in `.env.local` **and** in the host (Vercel) for **production** (env changes load on the next deploy).
10. **Decide the value rule** (§4.3) and adapt `computeNetRevenueCents` (commission vs ex-VAT revenue). Update `conversion-value.test.ts`.
11. **Redeploy** so production loads the env vars.
12. Run **Level 1 → Level 2** tests; then a **Level 3** brand campaign for the real proof.

---

## 10. Complete file map (what the feature touches)

**Google Ads library** — `src/lib/google-ads/`
| File | Responsibility |
|---|---|
| `client.ts` | REST transport: config, auth header, API version, 10s timeout, never-throws error handling |
| `auth.ts` | OAuth2 refresh-token → cached access token |
| `conversion-value.ts` | **the money rule** (net ex-VAT value), date formatting, `decideUpload` |
| `upload-conversion.ts` | builds + posts `uploadClickConversions` |
| `report-conversion.ts` | orchestrator: dedupe/claim → decide → upload → record (called by webhook) |
| `upload-adjustment.ts` | builds + posts `uploadConversionAdjustments` |
| `report-refund.ts` | refund → retraction/restatement orchestrator |
| `user-identifiers.ts` | enhanced conversions: normalize + SHA-256 hash email/phone |
| `*.test.ts` | unit tests for value, identifiers |

**Tracking library** — `src/lib/tracking/`
| File | Responsibility |
|---|---|
| `click-ids.ts` | gclid/wbraid/gbraid selection + validation |
| `constants.ts` | cookie names (`oc_gclid`, `oc_click_type`, `oc_consent`), windows (90d) |
| `attribution.ts` | client-side capture fallback (`captureClickIdsFromURL`, `getGclid`) |
| `server.ts` | server-side cookie builders + click logging (used by `/t`) |
| `client.ts` | visit recording / consent plumbing |

**Wiring / routes / data**
| File | Responsibility |
|---|---|
| `src/components/tracking/TrackingScript.tsx` | invokes the client-side click capture on every page |
| `src/app/api/t/[slug]/route.ts` | primary server-side click capture + redirect |
| `src/app/api/booking-flow/create-intent/route.ts` | reads `oc_gclid`/`oc_click_type`/`oc_consent` cookies |
| `src/lib/booking/create-intent.ts` | writes gclid + consent + **VAT breakdown** into PaymentIntent metadata |
| `src/lib/booking/calculate-quote.ts` | base price + city tax |
| `src/lib/extras/calculate.ts` | VAT back-calc (`extractVat`), extras, totals |
| `src/app/api/webhooks/stripe/route.ts` | fires `reportBookingConversion` (on pay) + `reportRefundAdjustment` (on refund) |
| `src/app/api/admin/booking-flow/book/route.ts` | stores `gclid` on the booking row |
| `src/env.ts` | env validation (all Google Ads vars `optional()`) |
| `supabase/migrations/049_google_ads_conversions.sql` | `google_ads_conversions` table + `bookings.gclid` |
| `supabase/migrations/050_google_ads_conversion_adjustments.sql` | adjustment columns |
| `src/lib/supabase/types.ts` | generated DB types |

---

## 11. Database schema (audit + dedupe)

`google_ads_conversions` (one row per PaymentIntent; service-role only, RLS-denied to anon):
```
payment_intent_id   text primary key   -- dedupe key (also Google-side orderId)
gclid               text
value_cents         integer            -- the NET value we computed
currency            text   default 'eur'
status              text               -- pending | uploaded | failed | skipped_no_gclid | skipped_no_consent
consent_marketing   boolean
google_response     jsonb              -- raw Google response (audit)
error               text
uploaded_at         timestamptz
created_at          timestamptz
-- from migration 050 (refunds):
adjustment_status   text               -- retracted | restated | adjustment_failed
adjusted_at         timestamptz
adjustment_response jsonb
```
Plus `bookings.gclid text` for admin visibility.

This table is the **single source of truth** for "did we report this sale, what value, and did Google accept it" — and the dedupe key that makes the whole thing safe against Stripe's at-least-once webhook delivery.

---

## 12. TL;DR for the Boat Local developer

1. **Replicate the library structure** in `src/lib/google-ads/` + the tracking capture (`/t` route + `TrackingScript`).
2. **Wire the gclid → PaymentIntent metadata → webhook** path (steps in §3).
3. **Rewrite `computeNetRevenueCents`** to report **Boat Local's actual take** (commission, if that's the model) — never the gross total, never VAT, never city tax (§4.3). This is the one business-critical change.
4. **Set all env vars** incl. an explicit, current `GOOGLE_ADS_API_VERSION` (don't let it default — §7.2).
5. **Use a Desktop OAuth client** for the refresh token (§7.1); **accept the customer data terms** for enhanced conversions (§7.3); **turn on auto-tagging**.
6. **Test Level 1 → 2 → 3** before trusting it.

Questions on the Off Course implementation: everything above maps to real files in this repo — read `report-conversion.ts` and `conversion-value.ts` first; they're the heart of it.
