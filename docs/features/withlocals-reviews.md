# Withlocals Reviews Sync

## What was built

Automatic weekly import of Off Course's Withlocals reviews into the `social_proof_reviews` table. Reviews are imported as inactive (Beer approves them before they go live), cross-checked against existing Google/TripAdvisor reviews to flag likely duplicates, and displayed in the admin reviews panel behind a dedicated Withlocals tab. The frontend review components (homepage slider, modal, cruise-detail slider) show Withlocals reviews alongside the others, with the source tab appearing automatically once the platform has reviews.

## Key files

| File | What it does |
|------|-------------|
| `src/lib/withlocals/client.ts` | Fetches all review pages from the Withlocals internal API; resolves experience short ID → full UUID |
| `src/lib/withlocals/parse.ts` | Converts raw Withlocals review objects to `ReviewRow`; strips TripAdvisor prefix injections and internal boat-rating prefixes; handles two rating scales (5 and 10) |
| `src/lib/withlocals/sync.ts` | Orchestrates the sync: dedup within batch, cross-platform similarity check (Jaccard ≥ 0.7), safe insert/update logic that never overwrites `is_active` on existing rows |
| `src/app/api/cron/withlocals-reviews/route.ts` | Weekly cron (`0 8 * * 1`); reads `withlocals_experience_short_id` from config table; calls `syncWithlocalsReviews` |
| `src/app/api/admin/reviews/route.ts` | Extended GET (adds `withlocals_experience_short_id` to config select) and PUT (saves it on upsert) |
| `src/app/[locale]/admin/reviews/page.tsx` | Admin UI: dynamic source tabs derived from which platforms have reviews; Withlocals count in stats bar |
| `src/app/[locale]/admin/reviews/useReviews.ts` | Hook: adds `withlocalsReviews` computed; updated `saveConfig` signature for the new field |
| `src/app/[locale]/admin/reviews/types.ts` | `ReviewsConfig` type now includes `withlocals_experience_short_id` |
| `src/components/admin/GoogleConfigBar.tsx` | Config editor: new Withlocals short ID input field |
| `src/components/sections/ReviewsSlider.tsx` | Frontend: dynamic source tabs; supports `withlocals` + `getyourguide` |
| `src/components/sections/ReviewsModal.tsx` | Frontend: same dynamic source tab expansion |
| `src/components/cruise/ReviewSlider.tsx` | Frontend: per-source tab counts + source badge labels |
| `next.config.ts` | Added `withlocals-com-res.cloudinary.com` to `images.remotePatterns` so reviewer photos render |
| `supabase/migrations/082_withlocals_reviews.sql` | Adds `withlocals_experience_short_id TEXT` to `google_reviews_config`; adds `possible_duplicate_of UUID` to `social_proof_reviews` |
| `vercel.json` | Weekly cron schedule for `/api/cron/withlocals-reviews` |

## Architecture decisions

### Why the Withlocals API (not scraping)?
Withlocals exposes an internal REST API at `https://api.withlocals.com/api/v1/review/experience/{uuid}` with pagination. It returns structured JSON with rating scale info, guest name/photo, and language detection. No Cloudflare blocking (unlike GetYourGuide), no scraping costs.

### Two rating scales
Withlocals aggregates both native reviews (scale=10) and TripAdvisor imports (scale=5). The parser normalises both: `Math.round((rating / scale) * 5)` always yields 1–5.

### Re-sync safety — never overwrite `is_active`
Early versions of the cron used a blind `upsert` which reset `is_active = false` on every sync, undoing Beer's manual approvals. The fix: fetch existing external IDs → split into new vs. existing → only `INSERT` new rows (always inactive) → for existing rows, only `UPDATE possible_duplicate_of` if a cross-platform match is found. `is_active` is never touched after first insert.

### Cross-platform duplicate detection
Withlocals often imports the same review that a customer also posted on TripAdvisor. A Jaccard similarity check (word overlap ≥ 70%, only words ≥ 4 chars) flags likely duplicates by setting `possible_duplicate_of → the matching review's id`. The admin can compare and decide whether to activate the Withlocals copy.

### Within-batch deduplication
Withlocals sometimes stores the same physical review three times with different IDs and slightly different timestamps (likely import artifacts). The `dedupBatch` function keys on `(reviewer_name, first-50-chars-of-text)` and keeps only the most recent occurrence.

### Dynamic source tabs (frontend + admin)
Rather than hardcoding `['google', 'tripadvisor']`, all review components now derive available tabs from `KNOWN_SOURCES.filter(s => reviews.some(r => r.source === s))`. GetYourGuide will appear in tabs automatically if its reviews are ever imported — no code change needed.

## How it works — data flow

```
vercel.json cron (Mon 08:00 UTC)
  → GET /api/cron/withlocals-reviews
    → reads withlocals_experience_short_id from google_reviews_config
    → resolveExperienceUuid(shortId)   (short ID → UUID via /by-experience-short-ids)
    → fetchAllWithlocalsReviews(uuid)  (paginated, all pages)
    → parseWithlocalsReview()          (normalise scale, strip prefixes)
    → dedupBatch()                     (drop within-batch duplicates)
    → load existing non-WL reviews for Jaccard check
    → load existing WL external IDs
    → INSERT new rows (is_active=false)
    → UPDATE possible_duplicate_of on existing rows that matched
    → UPDATE last_synced_at on config
```

## How to extend

**Add GetYourGuide:** Create `src/lib/getyourguide/client.ts` + `parse.ts` + `sync.ts` following the same pattern. Add a cron route and a `vercel.json` entry. The admin tabs and frontend tabs will appear automatically once reviews with `source='getyourguide'` exist.

**Raise the duplicate threshold:** Change `DUPLICATE_THRESHOLD` in `sync.ts` (currently `0.7`). Lower = more flags, higher = fewer.

**Auto-approve certain reviews:** Add a post-insert step in `sync.ts` that sets `is_active=true` for reviews above a rating threshold and no `possible_duplicate_of`. Currently intentionally disabled — Beer wants manual control.

**Sync on demand:** Hit `POST /api/cron/withlocals-reviews` with `Authorization: Bearer $CRON_SECRET`. The "Sync" button in the admin currently only triggers Google/TripAdvisor; a separate "Sync Withlocals" button could be added to `GoogleConfigBar`.

## Ghost / autonomy

Not ghostable. Review approval is a curatorial human decision — activating a review is a public-facing action with reputational impact. The Ghost never touches `is_active`.

## Dependencies

- `google_reviews_config` table (for `withlocals_experience_short_id` + `last_synced_at`)
- `social_proof_reviews` table (for storage; `possible_duplicate_of` FK added in migration 082)
- `CRON_SECRET` env var (shared with other crons, already in `.env.local`)
- `next.config.ts` `images.remotePatterns` for `withlocals-com-res.cloudinary.com`
