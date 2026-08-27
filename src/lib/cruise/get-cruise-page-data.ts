import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import { formatExtraPrice } from '@/lib/constants'
import { normalizeTiers } from '@/lib/cancellation/policy'
import type { Locale } from '@/lib/i18n/config'
import type { Database } from '@/lib/supabase/types'
import type { ImageAsset } from '@/lib/images/types'

type CruiseListing = Database['public']['Tables']['cruise_listings']['Row']
/** Item shape inside cruise_listings.images JSONB. image_asset_id is optional — */
/** items uploaded before the optimization pipeline don't have it. */
type CruiseImage = { url: string; alt_text?: string | null; image_asset_id?: string | null }
type Benefit = { text: string }
type Faq = { question: string; answer: string }

/** Image item enriched with its optimized asset (if available). */
export interface CruiseImageItem extends CruiseImage {
  asset: ImageAsset | null
}

// Columns actually read anywhere downstream of this query (traced exhaustively
// 2026-07 through getCruisePageData, [slug]/page.tsx incl. generateMetadata, and
// CruiseContentSections). Excludes admin-editor-only fields (benefits,
// inclusions, boat_id, allowed_resource_pks,
// booking_cutoff_hours, cancellation_policy, required_partner_id, is_archived,
// is_featured, created_at, updated_at) and is_published/display_order (used only
// as query predicates, never projected). All 7 variants of each locale-suffixed
// field group stay — which one is needed depends on the request's locale.
// availability_filters is included despite being admin-editor data — [slug]/page.tsx
// reads its min_guests_override to drive the solo-booking floor override.
const LISTING_DETAIL_COLUMNS = `
  id, slug, category, images, hero_image_asset_id, hero_image_url, video_url,
  fareharbor_item_pk, allowed_customer_type_pks, availability_filters, highlights, price_display,
  price_label, payment_mode, starting_price, max_guests, duration_display,
  departure_location, google_maps_url, chef_name, chef_bio, chef_photo_url,
  theme_primary_color, theme_accent_color,
  title, title_de, title_es, title_fr, title_nl, title_pt, title_zh,
  tagline, tagline_de, tagline_es, tagline_fr, tagline_nl, tagline_pt, tagline_zh,
  description, description_de, description_es, description_fr, description_nl, description_pt, description_zh,
  seo_title, seo_title_de, seo_title_es, seo_title_fr, seo_title_nl, seo_title_pt, seo_title_zh,
  seo_meta_description, seo_meta_description_de, seo_meta_description_es, seo_meta_description_fr, seo_meta_description_nl, seo_meta_description_pt, seo_meta_description_zh,
  faqs, faqs_de, faqs_es, faqs_fr, faqs_nl, faqs_pt, faqs_zh
` as const

// Deduplicate the listing fetch between generateMetadata and the page component
export const getListingBySlug = cache(async (slug: string) => {
  // Cookie-less client — reading cookies() here would force this page dynamic
  // and silently defeat the `revalidate = 60` ISR cache in [slug]/page.tsx.
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('cruise_listings')
    .select(LISTING_DETAIL_COLUMNS)
    .eq('slug', slug)
    .eq('is_published', true)
    .single()
  return data as CruiseListing | null
})

// Wrap with React cache() so both generateMetadata and the page body can call
// this function without triggering duplicate Supabase queries. Next.js 16 runs
// generateMetadata in a separate RSC request from the page — cache() deduplicates
// within the same request, so we also ensure the OG image URL is derived here
// (removing the old serial getCruiseOgImage query from generateMetadata).
export const getCruisePageData = cache(async function getCruisePageData(listing: CruiseListing, locale: Locale) {
  const loc = locale
  // Cookie-less client for everything — reading cookies() would force this page
  // dynamic and silently defeat the `revalidate = 60` ISR cache in [slug]/page.tsx.
  // This also fixes the bug the old split used to work around: extras/listing_extras'
  // RLS policies only grant SELECT to the `anon` role, so a logged-in admin/partner
  // hitting this server-rendered page via the cookie-aware client (picking up the
  // `authenticated` role) got 0 rows back — snacks/drinks silently invisible to
  // logged-in users only. A single service-role client has no such gap.
  const supabase = createAdminClient()
  const adminSupabase = supabase

  // Parallel queries. Image-asset ids come straight off `listing` (no dependency
  // on the queries below), so the asset fetch joins this same parallel batch
  // instead of running as a serial second round-trip.
  const rawImages = (listing.images as CruiseImage[] | null) ?? []
  const assetIdsToFetch = [
    listing.hero_image_asset_id,
    ...rawImages.map(i => i.image_asset_id ?? null),
  ].filter((id): id is string => Boolean(id))

  // Columns needed by the ReviewSlider — 7 locale text columns + display metadata.
  const REVIEW_COLS = 'id, reviewer_name, rating, source, author_photo_url, review_image_url, publish_time, review_text, review_text_nl, review_text_de, review_text_fr, review_text_es, review_text_pt, review_text_zh' as const

  const [googleRvResult, taRvResult, wlRvResult, gygRvResult, reviewCountResult, allExtrasResult, listingExtrasResult, allBoatsResult, googleConfigResult, fhItemResult, assetsResult] = await Promise.all([
    // Fetch 5 most recent per source so every platform appears in the slider tabs.
    // A single date-sorted LIMIT 20 would exclude TripAdvisor entirely when newer
    // platforms (Withlocals, GYG) have more recent reviews.
    // The GalleryModal fetches the full list on open via /api/reviews.
    supabase.from('social_proof_reviews').select(REVIEW_COLS).eq('is_active', true).eq('source', 'google').order('publish_time', { ascending: false, nullsFirst: false }).limit(5),
    supabase.from('social_proof_reviews').select(REVIEW_COLS).eq('is_active', true).eq('source', 'tripadvisor').order('publish_time', { ascending: false, nullsFirst: false }).limit(5),
    supabase.from('social_proof_reviews').select(REVIEW_COLS).eq('is_active', true).eq('source', 'withlocals').order('publish_time', { ascending: false, nullsFirst: false }).limit(5),
    supabase.from('social_proof_reviews').select(REVIEW_COLS).eq('is_active', true).eq('source', 'getyourguide').order('publish_time', { ascending: false, nullsFirst: false }).limit(5),
    supabase.from('social_proof_reviews').select('*', { count: 'exact', head: true }).eq('is_active', true),
    adminSupabase.from('extras').select('*').eq('is_active', true).in('category', ['food', 'drinks']).order('sort_order', { ascending: true }),
    adminSupabase.from('listing_extras').select('extra_id, is_enabled').eq('listing_id', listing.id),
    supabase.from('boats').select('*').eq('is_active', true).order('display_order', { ascending: true }),
    adminSupabase.from('google_reviews_config').select('total_reviews, overall_rating, tripadvisor_total_reviews, tripadvisor_rating').limit(1).maybeSingle(),
    adminSupabase.from('fareharbor_items').select('cancellation_tiers').eq('fareharbor_pk', listing.fareharbor_item_pk).maybeSingle(),
    assetIdsToFetch.length > 0
      ? supabase.from('image_assets').select('*').in('id', assetIdsToFetch)
      : Promise.resolve({ data: [] as ImageAsset[] }),
  ])

  // Merge per-source results and re-sort by date so the slider stays chronological.
  const reviews = [
    ...(googleRvResult.data ?? []),
    ...(taRvResult.data ?? []),
    ...(wlRvResult.data ?? []),
    ...(gygRvResult.data ?? []),
  ].sort((a, b) => {
    if (!a.publish_time && !b.publish_time) return 0
    if (!a.publish_time) return 1
    if (!b.publish_time) return -1
    return new Date(b.publish_time).getTime() - new Date(a.publish_time).getTime()
  })
  const reviewCount = reviewCountResult.count
  const googleConfig = googleConfigResult.data
  // Cancellation policy is owned by the parent FH item; falls back to DEFAULT_TIERS when null/invalid.
  const cancellationTiers = normalizeTiers(fhItemResult.data?.cancellation_tiers)

  // Filter extras by scope + overrides
  const overrideMap = new Map(
    (listingExtrasResult.data ?? []).map((o) => [o.extra_id, o.is_enabled])
  )

  const foodAndDrinkExtras = (allExtrasResult.data ?? []).filter((extra) => {
    if (extra.scope === 'global') {
      if (extra.applicable_categories && !extra.applicable_categories.includes(listing.category ?? '')) return false
      if (overrideMap.get(extra.id) === false) return false
      return true
    }
    return overrideMap.get(extra.id) === true
  })

  // Filter boats by allowed customer types
  const allowedCtPks = listing.allowed_customer_type_pks as number[] | null
  const listingBoats = (allBoatsResult.data ?? []).filter((boat) => {
    if (!allowedCtPks || allowedCtPks.length === 0) return true
    const boatCtPks = (boat.fareharbor_customer_type_pks as number[] | null) ?? []
    return boatCtPks.some((pk) => allowedCtPks.includes(pk))
  })

  // Parse JSONB fields
  const highlights = (listing.highlights as Benefit[] | null) ?? []
  // FAQs are a jsonb array, not a plain string, so they don't fit getLocalizedField
  // (which only handles scalar text columns) — resolve the locale variant by hand,
  // falling back to the English base column exactly like getLocalizedField does.
  const localizedFaqs = loc === 'en' ? null : (listing as Record<string, unknown>)[`faqs_${loc}`] as Faq[] | null
  const faqs = localizedFaqs ?? (listing.faqs as Faq[] | null) ?? []
  // Legacy short label used by the booking-panel "Free cancellation" badge.
  // Derived from the FH item's tiers so the badge hides if there's no full-refund tier.
  const topTier = cancellationTiers[0]
  const cancellationPolicy = topTier && topTier.refund_percent === 100
    ? `Free cancellation up to ${topTier.hours_before} hours before departure`
    : null

  // Build the asset lookup from the batched query above.
  const assetMap = new Map<string, ImageAsset>()
  for (const a of ((assetsResult.data ?? []) as ImageAsset[])) assetMap.set(a.id, a)

  const heroAsset = listing.hero_image_asset_id ? assetMap.get(listing.hero_image_asset_id) ?? null : null
  // Enrich each image item with its optimized asset (or null if not yet processed)
  const images: CruiseImageItem[] = rawImages.map(i => ({
    ...i,
    asset: i.image_asset_id ? assetMap.get(i.image_asset_id) ?? null : null,
  }))

  const heroUrl = listing.hero_image_url ?? images[0]?.url ?? null
  const title = getLocalizedField(listing, 'title', loc)
  const tagline = getLocalizedField(listing, 'tagline', loc)
  const description = getLocalizedField(listing, 'description', loc)
  const videoUrl = listing.video_url

  // Serialize for client components
  const serializedReviews = (reviews ?? []).map((r) => ({
    id: r.id,
    reviewer_name: r.reviewer_name,
    review_text: getLocalizedField(r, 'review_text', loc),
    rating: r.rating,
    source: r.source,
    author_photo_url: r.author_photo_url,
    review_image_url: r.review_image_url,
    publish_time: r.publish_time,
  }))

  const serializeExtra = (e: (typeof foodAndDrinkExtras)[number]) => ({
    id: e.id,
    name: getLocalizedField(e, 'name', loc),
    description: getLocalizedField(e, 'description', loc) || null,
    image_url: e.image_url,
    ingredients: e.ingredients,
    price_display: formatExtraPrice(e),
    min_people: e.min_people ?? null,
    default_to_guest_count: e.default_to_guest_count ?? false,
  })

  const serializedFood = foodAndDrinkExtras.filter((e) => e.category === 'food').map(serializeExtra)
  const serializedDrinks = foodAndDrinkExtras.filter((e) => e.category === 'drinks').map(serializeExtra)

  // ── Combined review stats (all platforms) ─────────────────────────────────
  // Google and TA use admin-configured counts (the real platform totals, even if not
  // every review is imported). Withlocals and GYG are fully imported so reviewCount
  // already includes them. We take whichever is larger so the number always reflects
  // all platforms and grows automatically as new reviews are added.
  const googleTotal = googleConfig?.total_reviews ?? null
  const taTotal = googleConfig?.tripadvisor_total_reviews ?? null
  const configPlatformTotal =
    googleTotal != null || taTotal != null ? (googleTotal ?? 0) + (taTotal ?? 0) : 0
  const totalReviews = Math.max(configPlatformTotal, reviewCount ?? 0) || (reviews?.length ?? 0)

  // Rating: weight each source's average by its review count when both exist;
  // otherwise fall back to whichever single rating we have, then to row average.
  const googleRating = googleConfig?.overall_rating != null ? Number(googleConfig.overall_rating) : null
  const taRating = googleConfig?.tripadvisor_rating != null ? Number(googleConfig.tripadvisor_rating) : null
  let avgRating: string | null = null
  if (
    googleRating != null && taRating != null &&
    googleTotal != null && taTotal != null && googleTotal + taTotal > 0
  ) {
    avgRating = (
      (googleRating * googleTotal + taRating * taTotal) / (googleTotal + taTotal)
    ).toFixed(1)
  } else if (googleRating != null) {
    avgRating = googleRating.toFixed(1)
  } else if (taRating != null) {
    avgRating = taRating.toFixed(1)
  } else if (reviews && reviews.length > 0) {
    avgRating = (reviews.reduce((sum, r) => sum + (r.rating ?? 0), 0) / reviews.length).toFixed(1)
  }

  // Derive the Open Graph image URL from the already-fetched heroAsset — eliminates
  // the separate getCruiseOgImage() Supabase query that used to run serially inside
  // generateMetadata before the page could start rendering.
  let ogImageUrl: string | null = listing.hero_image_url
  if (heroAsset && heroAsset.status === 'complete' && heroAsset.variants?.length) {
    const ogVariants = heroAsset.variants as Array<{ width: number; webp_url: string }>
    const ideal = ogVariants.find(v => v.width === 1080) ?? ogVariants[ogVariants.length - 1]
    ogImageUrl = ideal?.webp_url ?? listing.hero_image_url
  }

  return {
    listing, title, tagline, description, heroUrl, heroAsset, ogImageUrl, images, highlights, faqs,
    cancellationPolicy, cancellationTiers, serializedReviews, serializedFood, serializedDrinks,
    listingBoats, reviewCount, totalReviews, avgRating, videoUrl, loc,
  }
})
