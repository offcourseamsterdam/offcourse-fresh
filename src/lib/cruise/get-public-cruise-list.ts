import { createAdminClient } from '@/lib/supabase/admin'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import type { Locale } from '@/lib/i18n/config'

export interface PublicCruiseSummary {
  slug: string
  title: string
  tagline: string | null
  category: string | null
  priceDisplay: string | null
  startingPrice: number | null
  durationDisplay: string | null
  maxGuests: number | null
}

const COLUMNS = `
  slug, category, price_display, starting_price, max_guests, duration_display, display_order,
  title, title_de, title_es, title_fr, title_nl, title_pt, title_zh,
  tagline, tagline_de, tagline_es, tagline_fr, tagline_nl, tagline_pt, tagline_zh
` as const

/**
 * Loads every publicly browsable cruise listing — same is_published +
 * is_listed gate as /llms-full.txt's catalogue, so partner-invoice/QR-only
 * listings (published but deliberately unlisted) don't leak into the public
 * API's index, even though their detail page/endpoint stays reachable by slug.
 */
export async function getPublicCruiseList(locale: Locale): Promise<PublicCruiseSummary[]> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('cruise_listings')
    .select(COLUMNS)
    .eq('is_published', true)
    .eq('is_listed', true)
    .order('display_order', { ascending: true })

  return (data ?? []).map((listing) => ({
    slug: listing.slug,
    title: getLocalizedField(listing, 'title', locale),
    tagline: getLocalizedField(listing, 'tagline', locale) || null,
    category: listing.category,
    priceDisplay: listing.price_display,
    startingPrice: listing.starting_price,
    durationDisplay: listing.duration_display,
    maxGuests: listing.max_guests,
  }))
}
