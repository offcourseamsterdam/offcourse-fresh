import { getTranslations } from 'next-intl/server'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { HeroSection } from '@/components/sections/HeroSection'
import { ReviewsSection } from '@/components/sections/ReviewsSection'

// FeaturedCruises is a 'use client' component rendered below the hero fold.
// Making it dynamic defers its JS bundle to after the hero paints, reducing
// the initial JS that blocks the LCP. SSR still renders the section HTML.
const FeaturedCruises = dynamic(
  () => import('@/components/sections/FeaturedCruises').then(m => ({ default: m.FeaturedCruises }))
)
import { TrackPageView } from '@/components/tracking/TrackPageView'
import type { Locale } from '@/lib/i18n/config'
import type { SectionStyle } from '@/lib/homepage/section-styles'

const PrioritiesSection = dynamic(
  () => import('@/components/sections/PrioritiesSection').then(m => ({ default: m.PrioritiesSection }))
)
const FleetSection = dynamic(
  () => import('@/components/sections/FleetSection').then(m => ({ default: m.FleetSection }))
)
const LocationSection = dynamic(
  () => import('@/components/sections/LocationSection').then(m => ({ default: m.LocationSection }))
)

export const revalidate = 60

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'home.hero' })
  return {
    title: 'Off Course Amsterdam — Your friend with a boat',
    description: t('subtitle'),
  }
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params
  const supabase = await createClient()
  // google_reviews_config is RLS-protected (service-role only). Bypass for the public stats + source URLs.
  const adminSupabase = createAdminClient()

  const [listingsResult, reviewsResult, slidesResult, boatsResult, prioritiesResult, googleConfigResult, sectionStylesResult] = await Promise.all([
    supabase
      .from('cruise_listings')
      .select('id, slug, category, hero_image_url, title, tagline, price_display, duration_display')
      .eq('is_published', true)
      .eq('is_featured', true)
      .order('display_order', { ascending: true })
      .limit(6),
    // Fetch 20 most recent reviews — enough for the slider (3 shown at a time)
    // and any popups. ReviewsModal fetches more on open via its own query if needed.
    // Selecting only the columns actually rendered avoids passing 90+ rows × 7
    // language columns as serialized JSON in the RSC payload.
    supabase
      .from('social_proof_reviews')
      .select('id, reviewer_name, rating, source, author_photo_url, review_image_url, publish_time, review_text, review_text_nl, review_text_de, review_text_fr, review_text_es, review_text_pt, review_text_zh')
      .eq('is_active', true)
      .order('publish_time', { ascending: false, nullsFirst: false })
      .limit(20),
    supabase
      .from('hero_carousel_items')
      .select('image_url, alt_text, caption')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('boats')
      .select('id, name, built_year, max_capacity, description, photo_url, photo_covered_url, photo_interior_url')
      .eq('is_active', true)
      .order('display_order', { ascending: true }),
    supabase
      .from('priorities_cards')
      .select('image_url, alt_text, title, body, rotate, polaroid_color, title_color')
      .order('sort_order', { ascending: true }),
    adminSupabase
      .from('google_reviews_config')
      .select('total_reviews, tripadvisor_total_reviews')
      .limit(1)
      .maybeSingle(),
    // Per-section custom backgrounds + text colours (admin-managed appearance)
    supabase
      .from('homepage_section_styles')
      .select('section_key, background, text_colors, decoration_image_url, decoration_image_url_2'),
  ])

  const listings = listingsResult.data
  const reviews = reviewsResult.data
  const rawSlides = (slidesResult.data ?? []) as { image_url: string; alt_text: string | null; caption: string | null }[]
  const slides = rawSlides.map(s => ({ src: s.image_url, alt: s.alt_text ?? '', caption: s.caption ?? '' }))
  const boats = boatsResult.data ?? []
  const priorities = prioritiesResult.data ?? []
  // Combined total across both sources (fall back to actual loaded counts per source).
  const allReviews = reviews ?? []
  const googleTotal = googleConfigResult.data?.total_reviews ?? allReviews.filter(r => r.source === 'google').length
  const taTotal = googleConfigResult.data?.tripadvisor_total_reviews ?? allReviews.filter(r => r.source === 'tripadvisor').length
  const totalReviewCount = googleTotal + taTotal

  // Look up an admin-set background/text-colour style for a homepage section.
  const sectionStyle = (key: string): SectionStyle | undefined => {
    const row = sectionStylesResult.data?.find(r => r.section_key === key)
    if (!row) return undefined
    return {
      background: (row.background ?? null) as SectionStyle['background'],
      text_colors: (row.text_colors ?? {}) as SectionStyle['text_colors'],
      decoration_image_url: row.decoration_image_url ?? null,
      decoration_image_url_2: row.decoration_image_url_2 ?? null,
    }
  }

  return (
    <>
      <TrackPageView event="view_homepage" />
      <HeroSection slides={slides.length > 0 ? slides : undefined} reviewCount={totalReviewCount} sectionStyle={sectionStyle('hero')} />
      <FeaturedCruises listings={listings ?? []} sectionStyle={sectionStyle('featured_cruises')} />
      <ReviewsSection reviews={reviews ?? []} totalReviewCount={totalReviewCount} locale={locale as Locale} sectionStyle={sectionStyle('reviews')} />
      <PrioritiesSection cards={priorities} sectionStyle={sectionStyle('priorities')} />
      <FleetSection boats={boats.length > 0 ? boats : undefined} sectionStyle={sectionStyle('fleet')} />
      <LocationSection sectionStyle={sectionStyle('location')} />
    </>
  )
}
