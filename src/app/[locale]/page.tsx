import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { HeroSection } from '@/components/sections/HeroSection'
import { FeaturedCruises } from '@/components/sections/FeaturedCruises'
import { PrioritiesSection } from '@/components/sections/PrioritiesSection'
import { FleetSection } from '@/components/sections/FleetSection'
import { LocationSection } from '@/components/sections/LocationSection'
import type { Locale } from '@/lib/i18n/config'

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

  const [listingsResult, reviewsResult, slidesResult, boatsResult] = await Promise.all([
    supabase
      .from('cruise_listings')
      .select('*')
      .eq('is_published', true)
      .eq('is_featured', true)
      .order('display_order', { ascending: true })
      .limit(6),
    supabase
      .from('social_proof_reviews')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase
      .from('hero_carousel_items')
      .select('src, alt, caption')
      .eq('active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('boats')
      .select('id, name, built_year, max_capacity, description, photo_url, photo_covered_url, photo_interior_url')
      .eq('is_active', true)
      .order('display_order', { ascending: true }),
  ])

  const listings = listingsResult.data
  const reviews = reviewsResult.data
  const slides = (slidesResult.data ?? []) as unknown as { src: string; alt: string; caption: string }[]
  const boats = boatsResult.data ?? []

  return (
    <>
      <HeroSection slides={slides.length > 0 ? slides : undefined} />
      <FeaturedCruises listings={listings ?? []} locale={locale as Locale} />
      <PrioritiesSection />
      <FleetSection boats={boats.length > 0 ? boats : undefined} />
      <LocationSection />
    </>
  )
}
