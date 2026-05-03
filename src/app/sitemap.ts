import type { MetadataRoute } from 'next'
import { createClient } from '@/lib/supabase/server'
import { locales } from '@/lib/i18n/config'
import type { Database } from '@/lib/supabase/types'

type ListingSlug = Pick<
  Database['public']['Tables']['cruise_listings']['Row'],
  'slug' | 'updated_at' | 'hero_image_url' | 'hero_image_asset_id'
>

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient()

  const { data: listingsData } = await supabase
    .from('cruise_listings')
    .select('slug, updated_at, hero_image_url, hero_image_asset_id')
    .eq('is_published', true)
  const listings = listingsData as ListingSlug[] | null

  // Fetch hero image variants for all linked assets in one query
  const assetIds = (listings ?? []).map(l => l.hero_image_asset_id).filter(Boolean) as string[]
  const assetMap = new Map<string, { variants: Array<{ width: number; webp_url: string }> }>()
  if (assetIds.length > 0) {
    const { data: assets } = await supabase
      .from('image_assets')
      .select('id, variants, status')
      .in('id', assetIds)
      .eq('status', 'complete')
    for (const a of assets ?? []) {
      if (a.variants) assetMap.set(a.id as string, { variants: a.variants as Array<{ width: number; webp_url: string }> })
    }
  }

  const staticPages = ['', '/merch', '/crew', '/privacy', '/terms']

  const entries: MetadataRoute.Sitemap = []

  // Static pages × all locales
  for (const page of staticPages) {
    entries.push({
      url: `${BASE_URL}/en${page}`,
      lastModified: new Date(),
      alternates: {
        languages: Object.fromEntries(
          locales.map(locale => [locale, `${BASE_URL}/${locale}${page}`])
        ),
      },
      changeFrequency: page === '' ? 'daily' : 'monthly',
      priority: page === '' ? 1 : 0.5,
    })
  }

  // Cruise listing pages × all locales
  for (const listing of listings ?? []) {
    // Pick the largest WebP variant for sitemap image extension (Google indexes these)
    let imageUrl: string | null = listing.hero_image_url
    if (listing.hero_image_asset_id) {
      const asset = assetMap.get(listing.hero_image_asset_id)
      if (asset?.variants?.length) {
        imageUrl = asset.variants[asset.variants.length - 1].webp_url
      }
    }

    entries.push({
      url: `${BASE_URL}/en/cruises/${listing.slug}`,
      lastModified: new Date(listing.updated_at ?? new Date().toISOString()),
      alternates: {
        languages: Object.fromEntries(
          locales.map(locale => [locale, `${BASE_URL}/${locale}/cruises/${listing.slug}`])
        ),
      },
      changeFrequency: 'weekly',
      priority: 0.9,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    })
  }

  return entries
}
