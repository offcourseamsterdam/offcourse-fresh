# Google Ads Conversion Tracking — Architecture Overview

**Reference implementation: offcourseamsterdam.com. Shared as a blueprint — adapt specifics to your stack.**

This describes how server-side Google Ads conversion tracking is built for Off Course Amsterdam. The pattern is provider-agnostic; our reference stack is **Next.js (App Router) + Stripe (Payment Intents) + Supabase + FareHarbor**, on Vercel. Swap in your equivalents (payment provider, DB, server runtime) — the *structure and decisions* are what matter.

---

## Goal

Report each paid booking to Google Ads **server-to-server, the moment payment is confirmed** — not via a client-side "thank-you page" pixel. This is Google's **Offline Conversion Import (OCI)** keyed on the click id. It's resilient to ad blockers, closed tabs, Safari/iOS, and redirect-based payment methods (iDEAL), and it reports the real transaction value.

---

## Big picture — one click, two ledgers

```
Google ad → /t/<slug>?gclid=…  ──┬─→ our DB (campaign attribution, native)
 (Final URL = our tracking link) └─→ payment metadata → payment webhook → Google Ads API (OCI)
                                                                   ↑ fires once, server-side, on confirmed payment
```

Pipeline:
1. **Capture** the click id when the visitor lands from an ad.
2. **Thread** it through the booking flow and attach it to the payment.
3. **Report** the conversion from the payment-confirmed webhook.
4. **Adjust** on refund (retraction / restatement).

---

## Components

**1. Click-id capture** *(framework-agnostic)*
- **Primary:** route ads through your own campaign redirect links (we use `/t/<slug>` as the ad's **Final URL**). The redirect handler captures campaign attribution **and** the click id server-side, then forwards to the landing page. Native-first: your own DB gets the data too, not just Google.
- **Fallback:** a tiny client script reads the click id from the URL on any page (covers direct landings).
- Store the click id **and its type** in first-party cookies. Google sends one of `gclid` (standard), `wbraid` (iOS web→web), or `gbraid` (iOS app→web) — **each must later go in its own API field**, so track which one you got.

**2. Thread onto the payment**
- At payment-intent creation, read the cookies server-side and write into the **payment metadata**: the click id, the click type, and a **marketing-consent flag**.
- Metadata travels with the payment, so it's all available at webhook time with no extra DB lookup.

**3. The conversion chokepoint** *(the critical design point)*
- Fire the conversion from the **payment-confirmed webhook** (`payment_intent.succeeded`) — the one event guaranteed to fire for **every** successful payment.
- ⚠️ Fire it **before** any order-creation idempotency early-return. We have two order-creation paths (browser calls our `/book` after card payment; webhook is the safety net for async/iDEAL). The webhook early-returns if the order already exists — so if you put the conversion *after* that check, you miss every card payment (the majority). Put it first.

**4. The upload**
- A thin **REST** client to the Google Ads API (`customers/{id}:uploadClickConversions`). REST over the gRPC SDK → lighter cold starts on serverless, trivial to debug.
- Put the click id in the field matching its type (`gclid`/`wbraid`/`gbraid`).
- The function **never throws** — returns a result object. A Google outage must never break checkout.

**5. Dedupe + audit**
- A dedicated table keyed on the payment id, claimed with `INSERT … ON CONFLICT DO NOTHING`. Guarantees **once-only** even with webhook re-delivery or a browser/webhook race. Doubles as an **audit log + retry surface** (every attempt + status + Google's response).
- Also send `orderId = payment id` so Google dedupes on its side too (belt and suspenders).

**6. Conversion value**
- We report **net revenue** (ex-VAT, ex pass-through city tax) — what the business actually keeps — so Google optimises toward real ROAS. (Business choice; gross is also valid. Pick one and be consistent.)

**7. Enhanced conversions**
- When the visitor consented, attach **SHA-256 hashed** email/phone as `userIdentifiers` on the upload. Recovers conversions the click id alone misses (cross-device, expired cookie, iOS/Safari). Hashing happens server-side — raw PII never leaves your server.

**8. Refund handling**
- On the refund webhook: **full refund → RETRACTION** (cancel the conversion), **partial → RESTATEMENT** (lower the value proportionally). Matched to the original by `orderId`. Keeps reported revenue honest.

---

## Consent / GDPR (EU)

This is the part most people get wrong — keep two things separate:
- **Capturing** the click id into first-party storage = your own data; we do it always.
- **Sending** it to Google = a third-party transfer for advertising → **consent-gated** (a config flag, default on).
- **Hashed PII** (enhanced conversions) is attached **only with explicit consent**, *independent* of that flag — so customer PII never reaches Google without consent even if you loosen the click-id flag.
- Recommended: add **Google Consent Mode v2** client-side so visitors who decline still yield *modelled* conversions — recovers most of the lost signal, compliantly.

---

## Key design decisions (the "why")

| Decision | Why |
|---|---|
| Fire at the payment webhook, before idempotency return | The one event that fires for every payment; don't miss card sales |
| Dedicated dedupe/audit table (PK = payment id) | Once-only regardless of which path created the order; audit + retry |
| REST + never-throw | Serverless-friendly; tracking can never break selling |
| API version in an env var | Google sunsets API versions ~yearly — never hardcode it |
| Net revenue as the value | Optimise bidding toward real margin |
| Capture-always / send-with-consent / PII-only-with-consent | Max data, legally |
| Track the click *type* | iOS `gbraid`/`wbraid` must go in their own fields, not `gclid` |

Suggested module layout (mirror in any language): `capture` (click id → cookie), `client` (auth + one POST helper, version + timeout in one place), `upload-conversion`, `upload-adjustment`, `report-conversion` (orchestrator: dedupe → consent → upload → record), `report-refund`, plus pure, unit-tested helpers for value math, hashing/normalisation, and click-type detection.

---

## Google-side setup (account prerequisites)

1. **Manager (MCC) account** → source of the **developer token** (Tools → API Center; apply for *Basic access*). **Use a separate manager account per business** so each developer's token is isolated to its own accounts.
2. **OAuth2 client** in a Google Cloud project with the Google Ads API enabled → client id + secret → generate a **refresh token** with the `https://www.googleapis.com/auth/adwords` scope.
3. **Advertiser account Customer ID** — where ads run and conversions land.
4. **Import conversion action** (category *Purchase*, value *Use different values*, count *One*) → copy its numeric ID. **Enable Enhanced Conversions** on it (method: API).
5. **Auto-tagging ON** (so the click id is appended to landing URLs).

## Environment variables (names only — values are secrets)

```
GOOGLE_ADS_DEVELOPER_TOKEN     # from the manager account's API Center
GOOGLE_ADS_CLIENT_ID           # OAuth client
GOOGLE_ADS_CLIENT_SECRET
GOOGLE_ADS_REFRESH_TOKEN       # generated once, adwords scope
GOOGLE_ADS_CUSTOMER_ID         # advertiser account, digits only
GOOGLE_ADS_LOGIN_CUSTOMER_ID   # the manager account id (if accessed via MCC)
GOOGLE_ADS_CONVERSION_ACTION_ID
GOOGLE_ADS_API_VERSION         # current version (sunsets ~yearly)
GOOGLE_ADS_REQUIRE_CONSENT     # gate the send-to-Google on cookie consent
```

---

## Adapting to a different stack

- **Payment metadata** → whatever your provider offers (Stripe metadata, or your own order record keyed by payment id).
- **The webhook** → your "payment confirmed" server event. Keep the chokepoint principle: fire **once, server-side, on confirmed payment, idempotently**.
- **The DB table** → any store with a unique constraint on the payment id (that's your dedupe key).
- The **capture layer** and the **Google REST calls** are pure HTTP/cookies — fully portable.

## Gotchas we hit (so you don't)

- Two order-creation paths → fire the conversion where **both** are covered (the webhook, before its idempotency return).
- iOS `gbraid`/`wbraid` need their **own** upload fields — sending them as `gclid` silently fails to match.
- Google **API versions sunset** ~yearly — make it configurable.
- The **developer token requires a manager account**, and manager-account creation is rate-limited per Google login (you may need to ask support to lift it).
- Hashed PII to Google is still **personal data** → consent-gate it.
