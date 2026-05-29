# Google Ads Conversion Tracking (server-side)

## What was built

Server-to-server Google Ads conversion tracking. When a Stripe payment succeeds, the booking is reported **directly to the Google Ads API** (Offline Conversion Import) using the Google Click ID (`gclid`, or the iOS equivalents `gbraid`/`wbraid`) captured when the visitor clicked the ad. No client-side "thank you page" pixel — so the conversion can't be lost to ad blockers, a closed tab, or the iDEAL bank-redirect path.

When the visitor consented, the upload also carries **enhanced conversions** — the customer's email/phone, SHA-256 **hashed** on our server (Google never sees the raw value) — so Google can still credit the sale when the gclid is missing (cross-device, expired cookie, iOS/Safari).

It plugs **into** the existing native campaign system rather than around it: a Google ad's destination is one of our own `/t/<slug>` campaign links, so a single click is recorded in **our** database (campaign attribution, clicks, revenue) *and* forwarded to Google for optimisation. Our data stays the source of truth; Google only gets the conversion copy it needs.

On a refund, the conversion is automatically **retracted** (full refund) or **restated** to a lower value (partial refund), so Google's revenue figure never overstates what we actually kept.

## Key files

**New**
- `src/lib/google-ads/conversion-value.ts` — pure helpers: net-revenue calc (ex-VAT, ex city tax), cents→major, Google datetime format, and the `decideUpload` consent/gclid gate. Fully unit-tested.
- `src/lib/google-ads/conversion-value.test.ts` — unit tests for the above.
- `src/lib/google-ads/auth.ts` — OAuth2 refresh-token → access-token (cached in-module).
- `src/lib/google-ads/client.ts` — shared REST transport: config, auth headers, env-pinned API version, 10s timeout, error handling. Never throws.
- `src/lib/google-ads/upload-conversion.ts` — builds the `uploadClickConversions` call.
- `src/lib/google-ads/upload-adjustment.ts` — builds the `uploadConversionAdjustments` call (RETRACTION / RESTATEMENT on refunds).
- `src/lib/google-ads/report-conversion.ts` — sale orchestrator: dedupe → consent gate → upload → record status.
- `src/lib/google-ads/report-refund.ts` — refund orchestrator: retract (full) / restate (partial) → record status.
- `src/lib/google-ads/user-identifiers.ts` — enhanced-conversions helpers: email/phone normalization + SHA-256 hashing.
- `supabase/migrations/049_google_ads_conversions.sql` — `google_ads_conversions` audit/dedupe table + `bookings.gclid` column.
- `supabase/migrations/050_google_ads_conversion_adjustments.sql` — adjustment columns (`adjustment_status`, `adjusted_at`, `adjustment_response`).

**Changed**
- `src/lib/tracking/click-ids.ts` (new) — detects which click id is present (`gclid`/`wbraid`/`gbraid`) and tags its type.
- `src/lib/tracking/constants.ts` — `COOKIE_GCLID`, `COOKIE_CLICK_TYPE`, `GCLID_COOKIE_DAYS`.
- `src/lib/tracking/attribution.ts` — `captureClickIdsFromURL()` (gclid/wbraid/gbraid), `getGclid()` (client fallback capture).
- `src/lib/tracking/server.ts` — `buildGclidCookie()`, `buildClickTypeCookie()`, `appendClickId()`.
- `src/app/api/t/[slug]/route.ts` — primary capture: sets `oc_gclid` on the redirect + forwards gclid to the destination.
- `src/components/tracking/TrackingScript.tsx` — fallback capture on direct ad landings.
- `src/app/api/booking-flow/create-intent/route.ts` + `src/lib/booking/create-intent.ts` — write `gclid` + `consent_marketing` into PaymentIntent metadata.
- `src/app/api/webhooks/stripe/route.ts` — on `payment_intent.succeeded`, fire `reportBookingConversion` (before the idempotency early-return) + store `gclid`; on `charge.refunded`, fire `reportRefundAdjustment`.
- `src/app/api/admin/booking-flow/book/route.ts` — store `gclid` on card-payment bookings.

## Architecture decisions

- **Fire in the webhook, before the idempotency check.** The webhook's `payment_intent.succeeded` handler early-returns for card payments already booked by the browser `/book` call. Reporting the conversion *before* that return makes the webhook the single once-per-payment chokepoint that catches **both** card and iDEAL payments. Missing this would lose most conversions (card is the majority).
- **Dedupe via a dedicated table, not the booking row.** `google_ads_conversions` (PK = PaymentIntent id) is claimed with `ON CONFLICT DO NOTHING`. This is independent of which path created the booking and survives Stripe re-deliveries. It doubles as an audit log + retry surface. We also pass `orderId = pi.id` so Google dedupes on its side too.
- **REST, not the gRPC SDK.** A single `fetch` keeps cold starts light on Vercel serverless and is trivial to debug. The orchestrators never throw — a Google outage can never break a booking.
- **One shared transport, version-pinned by env.** Every Google call goes through `client.ts`; the API version is `GOOGLE_ADS_API_VERSION` (Google sunsets versions ~yearly, so it must not be hard-coded) and each request has a 10s timeout so the payment webhook can never hang.
- **Net revenue as the value.** We report cruise + extras **excluding** 9%/21% VAT and the €2.60/guest city tax (a municipal pass-through). That's what the business actually keeps, so Google optimises toward real ROAS.
- **Capture always, send with consent.** The gclid is our first-party data — captured on every ad click (server-side in `/t/`, client-side fallback in `TrackingScript`) and stored on the booking regardless of consent. Only the **transfer to Google** is gated, by `GOOGLE_ADS_REQUIRE_CONSENT` (default `true`). A skipped send still logs a row (`skipped_no_consent`) for a full audit trail.
- **Hashed PII only with explicit consent.** Enhanced-conversion identifiers (hashed email/phone) are attached only when `consent === 'yes'`, *independent of* `GOOGLE_ADS_REQUIRE_CONSENT` — so customer PII never reaches Google without consent, even if that flag is later turned off. Values are SHA-256 hashed on our server; Google never receives the raw email/phone.

## How it works (data flow)

```
Google ad → /t/<slug>?gclid=xxx ──┬─→ oc_attr  → booking.campaign_id   (our ledger)
 (Final URL = our campaign link)  └─→ oc_gclid → PI metadata → webhook → Google OCI (Google's copy)
```

1. **Capture** — `/t/<slug>` sets `oc_attr` + `oc_gclid` and forwards the gclid to the cruise page. (Direct landings without a `/t/` link are caught by `TrackingScript`.)
2. **Thread** — at PaymentIntent creation, `create-intent` reads the `oc_gclid` + `oc_consent` cookies and writes `gclid` + `consent_marketing` into PI metadata.
3. **Report** — on `payment_intent.succeeded`, `reportBookingConversion` dedupes, checks consent, computes net value, POSTs to Google, and records the result in `google_ads_conversions`.

**Reconciliation note:** our native dashboard is the source of truth. Google's reported numbers are shaped by Google's attribution window, de-duplication, and (for decliners) modelling — same ballpark, never the exact euro. That's expected.

## How to extend

- **Admin visibility:** surface `bookings.gclid` / `google_ads_conversions.status` in the admin booking detail or a small uploads view.

## Dependencies

- **Depends on:** the Stripe webhook + PaymentIntent metadata flow; the existing campaign/`/t/` tracking system; Supabase admin client. Env: `GOOGLE_ADS_*` (see `.env.example`).
- **Depended on by:** nothing yet (additive). The `google_ads_conversions` table is the integration point for future retry/adjustment tooling.

---

## Launch guide (Google Ads side — account exists, no campaigns yet)

1. **Apply for an API developer token** — Google Ads → Tools → **API Center** → request **Basic access**. *(The one external dependency; approval can take hours to a couple of days. Code is already built + tested meanwhile.)*
2. **Create the conversion action** — Goals → Conversions → **New** → **Import** → "Manual import using API/uploads" → category **Purchase**, value **Use different values**, count **One**. Copy its numeric ID → `GOOGLE_ADS_CONVERSION_ACTION_ID`. Then turn on **Enhanced conversions** for this action (accept the terms; method: API) — the code already sends hashed email/phone whenever the visitor consented.
3. **Enable auto-tagging** — Account Settings → Auto-tagging **ON** (appends `gclid` to ad-click landing URLs).
4. **OAuth refresh token** — enable the Google Ads API in the Cloud project (the existing Reviews OAuth client can be reused), then generate a refresh token with the `https://www.googleapis.com/auth/adwords` scope → `GOOGLE_ADS_REFRESH_TOKEN`.
5. **Customer ID** — the 10-digit account number, no dashes → `GOOGLE_ADS_CUSTOMER_ID` (set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` only if the account is under a manager/MCC).
6. **Consent Mode** (recommended) — install Google's `gtag` with consent defaults wired to the existing cookie banner, so visitors who decline still produce **modelled** conversions (recovers most of the "lost" signal, compliantly).
7. **Create the campaign link in our app first** — admin → create a campaign under the **Google Ads** channel → copy its `/t/<slug>` URL (the copy button). Native-first: the link lives in our system before it goes to Google.
8. **Launch the campaign** — set each ad's **Final URL** to the `/t/<slug>` link. *If Google flags a Final-URL/landing-page mismatch, set the cruise page as the Final URL and use `https://offcourseamsterdam.com/t/<slug>?dest={lpurl}` as the **Tracking template** (needs the optional `?dest=` passthrough).* Start on Manual/Max-clicks, switch to conversion bidding after ~15–30 conversions, and set the conversion action as the **primary** goal.

## Verifying it works

- `npm test` — `conversion-value` tests green.
- Visit `/t/<slug>?gclid=TEST123` → redirects, sets `oc_attr` + `oc_gclid`, destination carries the gclid.
- Stripe **test** booking with `?gclid=TEST123` → a `google_ads_conversions` row appears with the net `value_cents` and a `status`; server logs show the upload attempt. (Google rejects a fake gclid, which still proves auth + connectivity via the rejection reason.)
- Live: after the conversion action exists + auto-tagging is on, complete one real ad-click booking, then check Google Ads → Goals → Conversions → **Diagnostics / Uploads** within ~3–6 h.
