import { createAdminClient } from '@/lib/supabase/admin'
import { getListingBySlug } from '@/lib/cruise/get-cruise-page-data'
import { getLocalizedField } from '@/lib/i18n/get-localized-field'
import { selectAllowedCustomerTypes, type CustomerTypeRate } from '@/lib/fareharbor/customer-types'
import type { Locale } from '@/lib/i18n/config'

export interface Faq {
  question: string
  answer: string
}

export interface PublicCruiseDetail {
  slug: string
  title: string
  tagline: string | null
  /** Rich-text HTML from the admin listing editor — caller decides how to render it. */
  descriptionHtml: string | null
  priceDisplay: string | null
  startingPrice: number | null
  durationDisplay: string | null
  maxGuests: number | null
  category: string | null
  departureLocation: string | null
  heroImageUrl: string | null
  highlights: string[]
  faqs: Faq[]
  customerTypes: CustomerTypeRate[]
}

/**
 * Loads and shapes a single published cruise listing for public consumption —
 * the same underlying data whether it's rendered as Markdown (agent content
 * negotiation) or returned as JSON (the /api/v1/cruises API). One query, one
 * locale-resolution + Layer 2 customer-type filter, reused by both surfaces.
 */
export async function getPublicCruiseDetail(slug: string, locale: Locale): Promise<PublicCruiseDetail | null> {
  const listing = await getListingBySlug(slug)
  if (!listing) return null

  const supabase = createAdminClient()
  const { data: fhItem } = listing.fareharbor_item_pk
    ? await supabase
        .from('fareharbor_items')
        .select('customer_types')
        .eq('fareharbor_pk', listing.fareharbor_item_pk)
        .maybeSingle()
    : { data: null }

  const rawTypes = (fhItem?.customer_types as CustomerTypeRate[] | null) ?? []
  const customerTypes = selectAllowedCustomerTypes(rawTypes, listing.allowed_customer_type_pks as number[] | null)

  // FAQs are a jsonb array, not a plain text column, so they don't fit
  // getLocalizedField (mirrors the same fallback getCruisePageData uses).
  const localizedFaqs = locale === 'en' ? null : (listing as Record<string, unknown>)[`faqs_${locale}`]
  const faqs = (localizedFaqs as Faq[] | null) ?? (listing.faqs as Faq[] | null) ?? []

  const highlights = (listing.highlights as Array<{ text: string }> | null) ?? []

  return {
    slug: listing.slug,
    title: getLocalizedField(listing, 'title', locale),
    tagline: getLocalizedField(listing, 'tagline', locale) || null,
    descriptionHtml: getLocalizedField(listing, 'description', locale) || null,
    priceDisplay: listing.price_display,
    startingPrice: listing.starting_price,
    durationDisplay: listing.duration_display,
    maxGuests: listing.max_guests,
    category: listing.category,
    departureLocation: listing.departure_location,
    heroImageUrl: listing.hero_image_url,
    highlights: highlights.map((h) => h.text),
    faqs,
    customerTypes,
  }
}
