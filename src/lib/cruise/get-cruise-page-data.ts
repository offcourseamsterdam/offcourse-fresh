import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
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

// Deduplicate the listing fetch between generateMetadata and the page component
export const getListingBySlug = cache(async (slug: string) => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('cruise_listings')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .single()
  return data as CruiseListing | null
})

export async function getCruisePageData(listing: CruiseListing, locale: Locale) {
  const loc = locale
  const supabase = await createClient()
  // google_reviews_config holds OAuth tokens — we can't grant anon SELECT on the table.
  // Use the service-role client server-side for the aggregate-stats query only.
  const adminSupabase = createAdminClient()

  // Parallel queries.
  //
  // `extras` and `listing_extras` MUST use the admin client. Their RLS policies
  // only grant SELECT to the `anon` role — when a logged-in user (admin/partner
  // with a Supabase session cookie) hits this server-rendered page, the cookie-
  // aware client picks up the `authenticated` role and the queries silently
  // return 0 rows. Result: snacks/drinks invisible to logged-in users only.
  // Same family as commit e752a9f for pricing_quotes.
  // Image-asset ids come straight off `listing` (no dependency on the queries
  // below), so the asset fetch joins this same parallel batch instead of running
  // as a serial second round-trip.
  const rawImages = (listing.images as CruiseImage[] | null) ?? []
  const assetIdsToFetch = [
    listing.hero_image_asset_id,
    ...rawImages.map(i => i.image_asset_id ?? null),
  ].filter((id): id is string => Boolean(id))

  const [reviewsResult, reviewCountResult, allExtrasResult, listingExtrasResult, allBoatsResult, googleConfigResult, fhItemResult, assetsResult] = await Promise.all([
    supabase.from('social_proof_reviews').select('*').eq('is_active', true).order('rating', { ascending: false }).limit(6),
    supabase.from('social_proof_reviews').select('*', { count: 'exact', head: true }).eq('is_active', true),
    adminSupabase.from('extras').select('*').eq('is_active', true).in('category', ['food', 'drinks']).order('sort_order', { ascending: true }),
    adminSupabase.from('listing_extras').select('extra_id, is_enabled').eq('listing_id', listing.id),
    supabase.from('boats').select('*').eq('is_active', true).order('display_order', { ascending: true }),
    adminSupabase.from('google_reviews_config').select('total_reviews, overall_rating').limit(1).maybeSingle(),
    adminSupabase.from('fareharbor_items').select('cancellation_tiers').eq('fareharbor_pk', listing.fareharbor_item_pk).maybeSingle(),
    assetIdsToFetch.length > 0
      ? supabase.from('image_assets').select('*').in('id', assetIdsToFetch)
      : Promise.resolve({ data: [] as ImageAsset[] }),
  ])

  const reviews = reviewsResult.data
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
  const faqs = (listing.faqs as Faq[] | null) ?? []
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
  })

  const serializedFood = foodAndDrinkExtras.filter((e) => e.category === 'food').map(serializeExtra)
  const serializedDrinks = foodAndDrinkExtras.filter((e) => e.category === 'drinks').map(serializeExtra)

  const avgRating = googleConfig?.overall_rating != null
    ? Number(googleConfig.overall_rating).toFixed(1)
    : reviews && reviews.length > 0
      ? (reviews.reduce((sum, r) => sum + (r.rating ?? 0), 0) / reviews.length).toFixed(1)
      : null
  const totalReviews = googleConfig?.total_reviews ?? reviewCount ?? reviews?.length ?? 0

  return {
    listing, title, tagline, description, heroUrl, heroAsset, images, highlights, faqs,
    cancellationPolicy, cancellationTiers, serializedReviews, serializedFood, serializedDrinks,
    listingBoats, reviewCount, totalReviews, avgRating, videoUrl, loc,
  }
}
