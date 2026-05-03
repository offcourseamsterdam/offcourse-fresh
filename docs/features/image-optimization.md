# Image Optimization Pipeline

## What was built

A self-hosted image optimization pipeline that replaces what paid services like Vercel Image Optimization, Supabase Pro Image Transforms, or Cloudflare Images would provide.

Every uploaded image is processed once at admin-trigger time:

- Resized into 6 width variants (320, 480, 640, 800, 1080, 1600 px) — never upscaled
- Encoded in **AVIF** (primary, ~30% smaller than WebP) **and WebP** (fallback for older browsers)
- EXIF / GPS metadata stripped
- Tiny base64 blur placeholder generated (~250 bytes, instant render)
- Dominant color extracted (CSS background-color while loading)
- SHA-256 hash stored for deduplication (same image uploaded twice = single asset record)
- AI-generated alt text + caption + SEO keywords in **all 7 site locales** (en, nl, de, fr, es, pt, zh) via Gemini Vision + Claude
- Quality issues flagged (blurry / too_dark / etc.) so admins can spot bad photos before they go live
- SEO-friendly filename derived from primary keywords (e.g. `amsterdam-canal-cruise-diana-sunset_1080.avif`)

All variant files are stored in Supabase Storage and served via Supabase's included global CDN — **no per-request optimization fees, no plan upgrades required, ever**.

## Key files

### Core pipeline (`src/lib/images/`)
| File | Purpose |
|--|--|
| `process.ts` | Sharp pipeline: variants × formats, blur, dominant color, SHA-256 |
| `seo-filename.ts` | Build deduped, hyphen-separated, ≤60 char SEO slug from AI keywords |
| `processor.ts` | Orchestrates the whole pipeline: download → Sharp → Gemini → Claude → upload variants → update DB |
| `upload-helper.ts` | Validate uploads + create / link `image_assets` rows with SHA-256 dedup |
| `types.ts` | `ImageAsset`, `ImageAssetVariant`, `IMAGE_CONTEXT_SIZES` presets |
| `srcset.ts` | Build `srcset` strings for AVIF / WebP from variants |

### AI integration
- `src/lib/ai/generate-image-metadata.ts` — extends existing Gemini + Claude integration with `seo_filename` (from keywords) and `quality_issues` (whitelist-filtered)

### Display layer
- `src/components/ui/OptimizedImage.tsx` — `<picture>`-based component with AVIF + WebP sources, srcset, dominant-color background, blur placeholder, and graceful legacy fallback

### Admin
- `src/app/[locale]/admin/image-optimization/page.tsx` — queue dashboard with status counts, filter tabs, "Process all pending" + "Scan legacy images" buttons
- `src/components/admin/image-optimization/AssetRow.tsx` — per-image row with status badge, dominant color preview, quality flags, process / re-process actions
- `src/components/admin/image-optimization/StatusBadge.tsx` — coloured pill for each lifecycle state

### API routes
- `POST /api/admin/cruise-listings/images` — upload original, create pending asset
- `POST /api/admin/extras/[id]/image` — same, links extras row to asset
- `POST /api/admin/hero/upload` — same for homepage hero (videos still upload-as-is)
- `POST /api/admin/images/[assetId]/process` — run pipeline on one asset
- `POST /api/admin/images/[assetId]/reprocess` — re-run pipeline on a complete asset
- `POST /api/admin/images/process-batch` — batch process by IDs or by status (`pending` / `failed`)
- `POST /api/admin/images/migrate-legacy` — scan all existing image URLs across cruise_listings, extras, hero_carousel_items and create `pending` asset records (deduped by SHA-256). Idempotent.
- `GET /api/admin/images/list` — list assets with status filters + counts

### SEO + performance
- `src/app/[locale]/cruises/[slug]/page.tsx` — Open Graph + Twitter Card images use the optimised 1080px WebP; JSON-LD `Product` embeds `ImageObject` with width/height for Google Images / Discover ranking
- `src/app/sitemap.ts` — emits sitemap image extensions per cruise, batches asset queries to avoid N+1
- `src/app/[locale]/layout.tsx` — `<link rel="preconnect">` + `dns-prefetch` for the Supabase Storage CDN (~100ms saved on first image load)

### Database
- `supabase/migrations/037_image_optimization.sql` — adds `image_assets` table + nullable FK columns on `cruise_listings.hero_image_asset_id`, `extras.image_asset_id`, `hero_carousel_items.image_asset_id`. Backward compatible: legacy rows continue to render via fallback URL paths.

## Architecture decisions

### Why AVIF primary + WebP fallback?
AVIF is ~30% smaller than WebP at equivalent visual quality, with ~95% browser support as of 2026. WebP fallback (via `<picture><source>`) catches the remaining ~5% (mostly older Safari versions). Generating both at upload costs once; serving the right one to each visitor saves bandwidth forever.

### Why manual processing (admin-triggered) instead of auto?
Sharp is fast (1-2 s) but Gemini + Claude take 5-10 s combined per image. Auto-processing on every upload would tie up the request and risk visible failures from API rate limits. Admin-triggered batching gives explicit control, surfaces failures immediately, and lets admins review AI metadata before it goes live. Uploads still work — pending images render via their `original_url`, just unoptimised, until processed.

### Why a separate `image_assets` table instead of extending existing tables?
Three reasons:
1. **Deduplication** — SHA-256 unique index means the same image uploaded across multiple cruises results in one record + one set of variant files. Storage cost saved.
2. **Single source of truth for AI metadata** — alt text in 7 locales lives in one place; no duplication across cruise_listings.images, extras.alt_text, hero_carousel_items.alt_text.
3. **Status lifecycle** — `pending → processing → complete / failed` is a property of the asset itself, not of any consumer. The admin dashboard can show the full pipeline state regardless of where the image is referenced.

### Why no Vercel Image Optimization?
Vercel's free plan caps optimization at 1,000 images/month. With 20 cruise listings × 10 images × 6 viewport sizes = ~1,200 unique combinations, a high-traffic month would burn through the cap easily. Processing once at upload + serving from Supabase CDN sidesteps the cap entirely. The `<picture>` element + native srcset gives the browser everything it needs to pick the right variant.

### Why React's `<link rel="preconnect">` instead of Next.js Metadata API?
Next.js's metadata API doesn't support arbitrary `<link>` tags. React 19 (under Next 16) auto-hoists `<link>` and `<meta>` tags rendered anywhere in the tree to `<head>` — so we render them inside the locale layout where they belong semantically.

## How it works (data flow)

### Fresh upload
1. Admin drops a file in cruise / extras / homepage admin
2. POST → upload route → `validateUpload(file)` checks type + size
3. `createPendingAsset()` computes SHA-256 → checks `image_assets` for dedup → uploads original to `bucket/_originals/{uuid}.ext` → inserts row with `status='pending'`
4. Returns `{ assetId, status: 'pending', url, deduplicated }`
5. Admin sees it appear in `/admin/image-optimization` as ⏳ Pending

### Processing (admin-triggered)
1. Admin clicks "Process" (or "Process all pending")
2. POST → `/api/admin/images/[assetId]/process`
3. `processAsset(assetId)` flips status to 🔄 Processing
4. Downloads original from Supabase Storage
5. Sharp → 12 variants (6 widths × AVIF + WebP) + blur + dominant color
6. Gemini → analyses image, returns en alt text, caption, keywords, confidence, quality_issues
7. `buildSeoFilename(keywords)` → e.g. `amsterdam-canal-cruise-diana-sunset`
8. Claude → translates en alt text + caption to nl/de/fr/es/pt/zh
9. Uploads all 12 variant files to `bucket/{contextId}/{baseFilename}_{width}.{avif|webp}` with immutable cache headers
10. Updates `image_assets` row with variants[], blur, dominant color, alt_text JSON, etc.
11. Status flips to ✅ Complete

If anything fails, status becomes ⚠️ Failed with `failure_reason` set; admin can retry.

### Display
1. Server fetches cruise listing + linked `image_assets` row
2. Passes asset to `<OptimizedImage asset={...} context="hero" alt={...} priority />`
3. Component renders `<picture><source type="image/avif" srcSet={...}><source type="image/webp" srcSet={...}><img></picture>`
4. Browser picks AVIF if supported, WebP if not, downloads the variant matching its viewport
5. While loading: dominant color background fills the space (no layout shift)

## How to extend

### Adding a new image context (e.g. blog posts)
1. Add `'blog'` to the `ImageAssetContext` union in `src/lib/images/types.ts`
2. Add `'blog'` to `IMAGE_CONTEXT_SIZES` if a new responsive sizes preset is needed
3. Create the upload route (copy `src/app/api/admin/extras/[id]/image/route.ts`)
4. Add a nullable `image_asset_id UUID REFERENCES image_assets(id)` column to your new table
5. The admin page automatically picks up the new context via the `context` filter

### Adding a new variant width
1. Add the width to `VARIANT_WIDTHS` in `src/lib/images/process.ts`
2. Update the test to expect the new variant
3. Re-process all images via admin page → "Re-process all complete"

### Replacing Gemini / Claude
Swap the implementation in `src/lib/ai/generate-image-metadata.ts`. The `processor.ts` only depends on the public `generateImageMetadata()` signature.

## Dependencies

- **Sharp** (`^0.34.5`) — already installed, used by Next.js internally
- **Gemini Vision** + **Claude** — keys in `GOOGLE_AI_API_KEY` + `ANTHROPIC_API_KEY`
- **Supabase Storage** — standard buckets `cruise-images`, `extras-images`, `hero-images`
- **Database** — migration `037_image_optimization.sql` adds `image_assets` table + 3 FK columns

## Cost comparison

| Service | Cost | Why we don't need it |
|--|--|--|
| Vercel Image Optimization | Free 1k/mo, paid after | We serve pre-optimised files from Supabase CDN |
| Supabase Pro Image Transforms | $25/mo | We resize at upload, not request time |
| Cloudflare Images | $5/mo per 100k | Same — Supabase CDN is included |
| Cloudinary auto-tagging | $89/mo for AI features | We use Gemini Vision (~$0.001/image) |

**Net new monthly cost: ~$0.** Gemini calls only happen when an admin clicks "Process" — in the order of pennies per month for typical content workflows.

## Test coverage

| Module | Tests | File |
|--|--|--|
| Sharp pipeline | 12 | `src/lib/images/process.test.ts` |
| SEO filename builder | 8 | `src/lib/images/seo-filename.test.ts` |
| Srcset / variant picker | 7 | `src/lib/images/srcset.test.ts` |
| AI metadata (extended) | 10 (was 7) | `src/lib/ai/generate-image-metadata.test.ts` |

321 / 321 tests passing.
