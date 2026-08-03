# Attribution & Source Tracking

> The end-to-end map of **how a booking learns where the customer came from** —
> cookies, analytics sessions, traffic-source derivation, campaigns/partners/
> promo codes, the attribution precedence, and the Google Ads conversion that
> rides the same data. Ties together the per-channel docs
> ([google-ads-conversion-tracking](google-ads-conversion-tracking.md),
> [ai-referrals-tracking](ai-referrals-tracking.md),
> [whatsapp-click-tracking](whatsapp-click-tracking.md),
> [partner-invoiced-listings](partner-invoiced-listings.md)).

## What was built

A first-party attribution system that captures origin signals at the edge (a
single tracking-link redirect + a client tracking script), carries them through
the Stripe PaymentIntent, and lands them on the `bookings` row so the admin can
answer "which channel / campaign / partner produced this revenue?" — and so paid
Google-Ads clicks get an offline conversion reported back.

The design principle: **capture is first-party and unconditional; only *sending
to Google* is consent-gated.** Origin cookies are the company's own records and
are set server-side regardless of the cookie banner; the conversion upload to
Google requires `consent_marketing = 'yes'`.

## The cookies

All names live in `src/lib/tracking/constants.ts`.

| Cookie | Purpose | Set by | Window |
|--------|---------|--------|--------|
| `oc_vid` | Stable visitor id (cross-session) | client tracking script | long-lived |
| `oc_sid` | Analytics session id (sliding window) | client tracking script | ~30 min |
| `oc_attr` | Campaign attribution JSON `{campaign_slug, campaign_id, partner_id}` | `GET /api/t/[slug]` | 30 days |
| `oc_gclid` | Google Ads click id value | `/api/t/[slug]` (or client fallback) | 90 days |
| `oc_click_type` | Which click id: `gclid` \| `wbraid` \| `gbraid` | with `oc_gclid` | 90 days |
| `oc_src` | First-touch source JSON `{ref, src, med, cmp, lp, ts}` | client, **first touch only** | 90 days |

First-touch (`oc_src`) and campaign (`oc_attr`) are **write-once** — they answer
"where did this visitor *first* come from", not "where today".

## Entry points

| Route | Method | Role |
|-------|--------|------|
| `src/app/api/t/[slug]/route.ts` | GET | The single capture point for campaign links + ad clicks. Looks up the campaign by slug, logs the click, sets `oc_attr`, extracts `?gclid/?wbraid/?gbraid` → sets `oc_gclid` + `oc_click_type`, then 302-redirects to the campaign destination (forwarding the click id). |
| `src/app/api/tracking/session/route.ts` | POST | Upserts an `analytics_sessions` row on page-load (init) and on page-hide (close → duration/bounce). Resolves `campaign_slug` → `campaign_id`/`channel_id`. Bot-filtered, rate-limited, always returns `{ ok: true }`. |
| `src/app/api/tracking/event/route.ts` | POST | Logs funnel + engagement events (`view_cruise_detail`, `select_date`, …, `booking_completed`, `whatsapp_click`). Funnel events fire once per session; WhatsApp clicks from a Google-Ads visitor trigger a Slack ping. |

## Traffic-source derivation

`src/lib/tracking/traffic-source.ts → deriveTrafficSource()` resolves a single
`{ source, detail }` at PaymentIntent-creation time, first match wins:

1. **`gclid` present** → `google-ads` (detail: campaign slug or first-touch campaign)
2. **`campaignSlug` present** (from `oc_attr`) → `campaign`
3. **first-touch UTM/referrer** (from `oc_src`) → resolved channel (`organic`,
   `social`, `email`, `partners`, `referral`)
4. **otherwise** → `direct`

The result is stamped onto PI metadata as `traffic_source` / `traffic_detail`,
then copied to the booking row by the finalize paths.

## Campaigns, partners, promo codes

| Table | Holds | Key columns |
|-------|-------|-------------|
| `campaigns` | A tracking-link slug → partner + listing + commission | `slug`, `partner_id`, `listing_id`, `is_active`, `investment_type` (`percentage`/`fixed_amount`), `percentage_value`, `settlement_model` |
| `partners` | The commission counterparty | `name`, `commission_rate`, `is_active` |
| `partner_codes` | Rotating physical codes for partner-invoice bookings | `code`, `partner_id`, `expires_at`, `is_active`, `revoked_at` |
| `promo_codes` | Customer discounts, optionally campaign-scoped | `code`, `discount_type` (`percentage`/`fixed_amount`/`full`), `discount_value`, `campaign_id`, `max_uses`, `uses_count` |

A `promo_codes.campaign_id` link means redeeming the code **also attributes the
booking to that campaign's partner** (commission + discount are independent).

## Attribution precedence (resolution)

`resolveAttribution()` in `src/app/api/admin/booking-flow/book/route.ts` resolves
`{ campaignId, partnerId, commissionAmountCents }`, **last-wins**:

1. **Cookie** — parse `oc_attr`, look up `campaigns` by `campaign_id`, compute commission.
2. **Promo code** — if the promo has a `campaign_id`, that campaign overrides the cookie.
3. **Partner-invoice context** — always wins when present (validated earlier in `resolvePartnerInvoiceContext`).

`commissionForCampaign()` computes `base × percentage / 100` (or a fixed cents
amount when `investment_type = 'fixed_amount'`).

**Gotcha — non-website bookings pass `attrCookie: null`** (WithLocals,
GetYourGuide, stripe_recovery, partner_invoice). An admin entering a booking may
carry their own campaign cookie unrelated to the real channel, so cookie
attribution is suppressed; platform auto-attribution still runs via
`resolveCampaignId()` in `saveToSupabase`.

## Where it lands on the booking

Columns on `bookings` written by the finalize paths (`/book`, webhook,
`recover-from-pi`):

| Column | Source |
|--------|--------|
| `gclid` | `oc_gclid` cookie → PI metadata |
| `session_id` | **PI metadata `session_id`** (captured at intent-creation), *not* the post-payment browser session — see below |
| `traffic_source` / `traffic_detail` | `deriveTrafficSource` → PI metadata |
| `campaign_id` | resolved campaign (cookie / promo / partner-invoice), or platform auto-attribution |
| `partner_id` | resolved partner |
| `commission_amount_cents` | `commissionForCampaign` |
| `promo_code_id` / `discount_amount_cents` | applied promo |

**Why session id comes from PI metadata, not the browser:** the browsing session
is captured onto the PaymentIntent at intent-creation. After payment (especially
an iDEAL bank redirect) the browser lands on `/confirmation` in a *fresh*
session; trusting that would detach the booking from the funnel that produced it.
`pickBookingSessionId(piMetadataSessionId, bodySessionId)` prefers the PI value.

## Google Ads conversion (rides the same data)

The `payment_intent.succeeded` webhook calls `reportBookingConversion`
(`src/lib/google-ads/`) for **every** successful PI, before the booking
idempotency check (so card bookings finalized by `/book` still report):

1. **Dedupe** — upsert `google_ads_conversions` keyed on `payment_intent_id`; a
   pre-existing row is a no-op.
2. **Decide** — skip if no `gclid` (`skipped_no_gclid`) or no consent
   (`skipped_no_consent`, when `GOOGLE_ADS_REQUIRE_CONSENT` ≠ `false`).
3. **Upload** — net revenue (base − VAT + extras − VAT − discount; city tax and
   VAT excluded) via offline click-conversion import. Hashed email/phone
   (enhanced conversions) are included **only** with explicit consent.
4. **Record** — write `uploaded`/`failed` + the API response back to the row.

A later `charge.refunded` retracts/restates the conversion so reported revenue
stays honest. Full detail:
[google-ads-conversion-tracking.md](google-ads-conversion-tracking.md).

## End-to-end flow

```
ad/QR/bio click ─► GET /api/t/[slug]
                     • log campaign_clicks
                     • set oc_attr (campaign_id, partner_id)
                     • set oc_gclid + oc_click_type
                     302 ─► listing page (?gclid forwarded)
        │
client tracking script
   • oc_vid / oc_sid, oc_src (first touch)
   • POST /api/tracking/session  → analytics_sessions
   • POST /api/tracking/event    → funnel events
        │
checkout ─► POST /api/booking-flow/create-intent
   • read oc_gclid, oc_attr, oc_src
   • deriveTrafficSource()
   • PI.metadata += { gclid, click_type, session_id, traffic_source, traffic_detail }
        │
payment ─► finalize (/book | webhook | recover)
   • resolveAttribution: cookie ▸ promo ▸ partner-invoice
   • bookings += { gclid, session_id, traffic_source/detail, campaign_id, partner_id,
                   commission_amount_cents, promo_code_id, discount_amount_cents }
        │
webhook ─► reportBookingConversion → google_ads_conversions → Google Ads API
```

## How to extend

- **New campaign / partner:** create the `campaigns` row (slug + partner_id +
  listing_id + commission) — the `/t/[slug]` link and attribution resolution pick
  it up with no code change.
- **New channel classification:** extend `resolveChannelSlug` / the social/email
  source lists in `src/lib/tracking/attribution.ts`.
- **New booking-finalize path:** copy the PI-metadata attribution fields onto the
  booking insert (`gclid`, `session_id`, `traffic_source`, `traffic_detail`,
  `campaign_id`, `partner_id`, `commission_amount_cents`) and prefer the PI
  `session_id` over any browser-sent one.

## Dependencies

`src/lib/tracking/*` (cookies, derivation, client script), `src/lib/google-ads/*`
(conversion upload), Stripe PaymentIntent metadata as the carry-through layer, and
the `campaigns` / `partners` / `partner_codes` / `promo_codes` / `analytics_sessions`
/ `google_ads_conversions` tables. The booking-finalize paths in
`src/app/api/admin/booking-flow/book/route.ts`, `src/app/api/webhooks/stripe/route.ts`,
and `src/lib/booking/recover-from-pi.ts` are the consumers.
