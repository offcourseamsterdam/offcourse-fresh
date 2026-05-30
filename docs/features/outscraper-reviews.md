# Outscraper Reviews (Google + TripAdvisor)

Replaces the old Google OAuth / Places reviews system with the **Outscraper API** — an
API-key-based scraping service that pulls reviews from both **Google Maps** and **TripAdvisor**.

## What was built

- Deleted the entire Google OAuth subsystem (consent flow, callback routes, refresh tokens
  in the DB, Business Profile client, Places client) and the review-reply feature.
- Added an Outscraper client + a single webhook that ingests scraped reviews.
- Reviews from both sources are stored in `social_proof_reviews` (tagged by `source`),
  mixed on the public site with per-source filter tabs + "via Google/TripAdvisor" badges.
- Review photos (attached by reviewers) are imported and displayed.

## How it works

```
Day 1 — admin clicks "Sync":
  POST /api/admin/reviews/sync
    → Outscraper Scraper API (Google + TripAdvisor, async)
    → Outscraper scrapes in background
    → POST /api/webhooks/outscraper  (HMAC-verified)
    → parse + upsert into social_proof_reviews

Ongoing — Outscraper Scheduler ("Monitoring"):
  Outscraper runs the same scrape daily on a schedule YOU configure in its dashboard
    → POST /api/webhooks/outscraper  (same endpoint, same handler)
    → upsert (dedup keeps it idempotent)
```

The webhook payload contains the full results inline (`{ id, status, data: [...] }`) — no
second fetch needed. It's deduplicated on the Outscraper request `id` (stored in
`google_reviews_config.outscraper_processed_ids`), so duplicate deliveries are no-ops.

## Key files

| File | Purpose |
|------|---------|
| `src/lib/outscraper/client.ts` | Thin fetch client — `scrapeGoogleReviews` / `scrapeTripadvisorReviews` (async, X-API-Key) |
| `src/lib/outscraper/parse.ts` | Pure mappers: Outscraper payload → `social_proof_reviews` rows (both sources) |
| `src/app/api/admin/reviews/sync/route.ts` | POST — kicks off both scrape jobs (admin-only) |
| `src/app/api/webhooks/outscraper/route.ts` | POST — HMAC-verified webhook; parses + upserts |
| `src/app/api/admin/reviews/route.ts` | GET reviews+config; PUT to save place_id + tripadvisor_url |
| `supabase/migrations/053_outscraper_reviews.sql` | Schema changes (see below) |
| `src/components/ui/ReviewPhoto.tsx` | Plain `<img>` for review photos (expirable external URLs) |
| `src/components/sections/ReviewsSlider.tsx` | Public slider + source filter tabs + photos |
| `src/app/[locale]/admin/reviews/*` | Admin list + source filter + config editor |

## Schema (migration 053)

- `google_reviews_config`: dropped OAuth token columns; added `tripadvisor_url`,
  `tripadvisor_rating`, `tripadvisor_total_reviews`, `outscraper_processed_ids[]`.
- `social_proof_reviews`: added `review_image_url`; dropped the 6 reply columns; renamed
  `google_review_id` → `external_review_id`; unique key is now `(source, external_review_id)`;
  **clean re-import** deleted old `source='google'` rows (kept `source='manual'`).

## Architecture decisions

- **No new dependency** — hand-rolled fetch client matching `lib/fareharbor/client.ts`.
- **Single webhook for Scraper + Monitoring** — both deliver the same payload shape.
- **`ReviewPhoto` uses a plain `<img>`** — review image URLs come from unpredictable CDN hosts
  and can expire; `next/image` errors on unknown hosts. Plain `<img onError>` hides gracefully.
- **SEO: no `Review`/`AggregateRating` JSON-LD.** Google bans self-serving review markup for
  `LocalBusiness`/`Organization` (no star snippets, risk of manual action). Reviews are
  conversion/engagement content; star snippets come from the GBP + TripAdvisor profiles, not us.
  We cite the source ("via Google/TripAdvisor") + link to the real profiles instead.

## Setup (one-time, in the Outscraper dashboard)

**1. Register the webhook** — `app.outscraper.com/integrations` → add
`https://offcourseamsterdam.com/api/webhooks/outscraper`.

**2. Configure sources in our admin** — `/admin/reviews` → Edit config → paste the Google
place ID and the TripAdvisor listing URL → Save → click **Sync** for the first full import.

**3. Set up daily monitoring (the "Monitoring" service = Scheduler):**
- Google Maps Reviews Scraper → enter place ID → `sort=newest`, `reviewsLimit=10` → enable
  **Scheduler → daily**.
- TripAdvisor Reviews Scraper → enter listing URL → `limit=10` → **Scheduler → daily**.
- Both automatically POST new reviews to the same webhook. No cron in our codebase.

## Environment

- `OUTSCRAPER_API_KEY` — used for both API requests and webhook HMAC verification (optional in
  `env.ts`; the sync route errors clearly if absent). Set in Vercel (all environments).
- Removed `GOOGLE_PLACES_API_KEY` (now unused). `GOOGLE_OAUTH_CLIENT_ID/SECRET` kept (Google Ads).

## Tests

- `src/lib/outscraper/parse.test.ts` — Google + TripAdvisor payload → row mapping, edge cases.
- `src/lib/outscraper/client.test.ts` — header/params/timeout assertions.
- `src/app/api/webhooks/outscraper/route.test.ts` — HMAC valid/invalid, unknown source, dedup.

## Dependencies

- Depends on: `OUTSCRAPER_API_KEY`, `social_proof_reviews` + `google_reviews_config` tables,
  `postSlackText` (failure alerts), `requireAdmin`.
- Depended on by: homepage + cruise-page review sections.
