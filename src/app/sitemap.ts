import type { MetadataRoute } from 'next'
import { createClient } from '@/lib/supabase/server'
import { locales } from '@/lib/i18n/config'
import type { Database } from '@/lib/supabase/types'

type ListingSlug = Pick<Database['public']['Tables']['cruise_listings']['Row'], 'slug' | 'updated_at'>

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient()

  const { data: listingsData } = await supabase
    .from('cruise_listings')
    .select('slug, updated_at')
    .eq('is_published', true)
  const listings = listingsData as ListingSlug[] | null

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
    })
  }

  return entries
}
