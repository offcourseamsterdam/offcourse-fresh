import { getTranslations } from 'next-intl/server'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { HeroSection } from '@/components/sections/HeroSection'
import { FeaturedCruises } from '@/components/sections/FeaturedCruises'
import { ReviewsSection } from '@/components/sections/ReviewsSection'
import { TrackPageView } from '@/components/tracking/TrackPageView'
import type { Locale } from '@/lib/i18n/config'

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

  const [listingsResult, reviewsResult, slidesResult, boatsResult, prioritiesResult, googleConfigResult] = await Promise.all([
    supabase
      .from('cruise_listings')
      .select('id, slug, category, hero_image_url, title, tagline, price_display, duration_display')
      .eq('is_published', true)
      .eq('is_featured', true)
      .order('display_order', { ascending: true })
      .limit(6),
    supabase
      .from('social_proof_reviews')
      .select('*')
      .eq('is_active', true)
      // Newest reviews first (by the review's own date, not our import time)
      .order('publish_time', { ascending: false, nullsFirst: false }),
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
      .select('image_url, alt_text, title, body, rotate')
      .order('sort_order', { ascending: true }),
    adminSupabase
      .from('google_reviews_config')
      .select('total_reviews, tripadvisor_total_reviews')
      .limit(1)
      .maybeSingle(),
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
  return (
    <>
      <TrackPageView event="view_homepage" />
      <HeroSection slides={slides.length > 0 ? slides : undefined} />
      <FeaturedCruises listings={listings ?? []} />
      <ReviewsSection reviews={reviews ?? []} totalReviewCount={totalReviewCount} locale={locale as Locale} />
      <PrioritiesSection cards={priorities} />
      <FleetSection boats={boats.length > 0 ? boats : undefined} />
      <LocationSection />
    </>
  )
}
