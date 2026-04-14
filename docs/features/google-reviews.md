# Google Reviews Integration

## What was built

Integration with Google Places API (New) to automatically sync customer reviews from Google into the Off Course website. Reviews appear on the homepage and cruise detail pages, and can be managed in a dedicated admin page.

## Key files

| File | Description |
|------|-------------|
| `src/lib/google-reviews/client.ts` | Google Places API client — fetches reviews and searches for places |
| `src/app/api/admin/reviews/route.ts` | Admin API: list all reviews, create manual reviews |
| `src/app/api/admin/reviews/[id]/route.ts` | Admin API: update and delete individual reviews |
| `src/app/api/admin/reviews/sync-google/route.ts` | API: sync reviews from Google Places, search for places |
| `src/app/[locale]/admin/reviews/page.tsx` | Admin page: list reviews, toggle visibility, trigger Google sync |
| `src/components/sections/ReviewsSection.tsx` | Homepage review cards (enhanced with author photos) |
| `src/components/sections/CruiseReviews.tsx` | Compact review display for cruise detail pages |
| `supabase/migrations/015_google_reviews.sql` | DB migration: Google-specific columns + config table |
| `src/lib/supabase/types.ts` | Updated TypeScript types for new columns |
| `next.config.ts` | Added `lh3.googleusercontent.com` for Google profile photos |

## Architecture decisions

**Why sync-to-database instead of fetching live?** Google Places API returns a maximum of 5 reviews per request, billed at $0.04/request. Syncing into our own database means we can show reviews without API calls on every page load, and admins can toggle which reviews are visible.

**Why `social_proof_reviews` instead of a new table?** The table already existed with the right structure (rating, text, i18n columns, is_active, sort_order). Adding Google-specific columns (google_review_id, author_photo_url, etc.) was cleaner than creating a separate table and merging results.

**Why a separate `google_reviews_config` table?** Stores the Place ID, overall rating, total review count, and last sync timestamp. This decouples the Google config from environment variables — admins can search for and select their business from the admin UI.

## How it works

### Sync flow
1. Admin clicks "Sync Google" in `/admin/reviews`
2. Frontend POSTs to `/api/admin/reviews/sync-google`
3. API determines Place ID (from request body → stored config → env var)
4. Calls Google Places API (New) `GET /v1/places/{placeId}` with `reviews,rating,userRatingCount,displayName` fields
5. For each review: checks if `google_review_id` already exists (deduplication), inserts or updates
6. Updates `google_reviews_config` with overall rating and sync timestamp
7. Returns sync summary to frontend

### Display flow
- **Homepage:** Server component fetches `social_proof_reviews` where `is_active = true`, passes to `ReviewsSection`
- **Cruise pages:** Server component fetches top 3 reviews (sorted by rating), passes to `CruiseReviews`
- Both components use `getLocalizedField()` for i18n support

### Admin management
- Toggle reviews on/off with checkboxes (optimistic UI with rollback)
- Delete reviews permanently
- View Google profile links and author photos
- Source badges show "google" vs "manual"

## How to extend

### Add a new review source
1. Create a new sync route at `/api/admin/reviews/sync-{source}/route.ts`
2. Use a unique identifier field (like `google_review_id`) for deduplication
3. Set `source` to the platform name when inserting

### Change which reviews show on cruise pages
Edit the query in `src/app/[locale]/cruises/[slug]/page.tsx` — currently fetches top 3 by rating. You could filter by source, randomize, or show cruise-specific reviews if you add a `cruise_listing_id` column later.

### Add more Google data
The Places API supports `reviewSummary` (AI-powered summaries) — request it in the field mask in `client.ts`. It's available in English and Japanese.

## Dependencies

**Requires:**
- `GOOGLE_PLACES_API_KEY` env variable (from Google Cloud Console, with Places API enabled)
- `GOOGLE_PLACE_ID` env variable OR admin-configured Place ID
- Database migration `015_google_reviews.sql` applied

**Depended on by:**
- Homepage (`[locale]/page.tsx`) — renders ReviewsSection
- Cruise detail pages (`[locale]/cruises/[slug]/page.tsx`) — renders CruiseReviews
- Admin sidebar (`admin/layout.tsx`) — links to reviews page

## Reply to Reviews

### How it works

Replying to Google reviews requires the **Google Business Profile API** which uses OAuth 2.0 (not an API key). This is because Google needs to verify the replier is the actual business owner.

**One-time setup:**
1. In Google Cloud Console → Credentials → Create OAuth 2.0 Client ID (Web application)
2. Set redirect URI to `{NEXT_PUBLIC_SITE_URL}/api/admin/reviews/google-auth/callback`
3. Enable "My Business Account Management API" and "My Business Business Information API"
4. Add `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` to `.env.local`
5. Click "Connect Google Business" in admin → authorize → done

**Reply flow:**
1. Admin clicks "Reply" on a Google review → inline textarea opens
2. Types reply → clicks "Send Reply"
3. Frontend PUTs to `/api/admin/reviews/:id/reply`
4. Route gets valid OAuth token (auto-refreshes if expired)
5. Extracts review ID suffix from `google_review_id`
6. Calls Business Profile API PUT to post the reply
7. Saves reply text locally in `social_proof_reviews`

### Key files (reply feature)

| File | Description |
|------|-------------|
| `src/lib/google-reviews/oauth.ts` | OAuth token management (auth URL, exchange, refresh) |
| `src/lib/google-reviews/business-profile.ts` | Business Profile API client (accounts, locations, reply) |
| `src/app/api/admin/reviews/google-auth/route.ts` | Starts OAuth flow (redirects to Google) |
| `src/app/api/admin/reviews/google-auth/callback/route.ts` | Handles OAuth callback, stores tokens |
| `src/app/api/admin/reviews/[id]/reply/route.ts` | Send/delete review replies |
| `supabase/migrations/016_google_oauth_and_replies.sql` | OAuth tokens + reply columns |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_PLACES_API_KEY` | Yes | Google Cloud API key with Places API (New) enabled |
| `GOOGLE_PLACE_ID` | Optional | Place ID for Off Course Amsterdam. Can also be set via admin UI. |
| `GOOGLE_OAUTH_CLIENT_ID` | For replies | OAuth 2.0 Client ID from Google Cloud Console |
| `GOOGLE_OAUTH_CLIENT_SECRET` | For replies | OAuth 2.0 Client Secret |
