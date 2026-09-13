import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { WhatsAppButton } from '@/components/layout/WhatsAppButton'
import { CookieBanner } from '@/components/tracking/CookieBanner'
import { GoogleTag } from '@/components/tracking/GoogleTag'
import { ClarityTag } from '@/components/tracking/ClarityTag'
import { createAdminClient } from '@/lib/supabase/admin'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

// Nav listings and org schema don't need sub-minute freshness.
// 1-hour ISR window keeps the aggregateRating reviewCount accurate without hammering Supabase.
export const revalidate = 3600

async function getNavListings() {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('cruise_listings')
    .select('id, title, slug, category')
    .eq('is_published', true)
    .eq('is_listed', true)
    .order('display_order', { ascending: true })
  return (data ?? []) as { id: string; title: string; slug: string; category: string }[]
}

async function getReviewCount(): Promise<number> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('google_reviews_config')
      .select('total_reviews, tripadvisor_total_reviews')
      .limit(1)
      .maybeSingle()
    return (data?.total_reviews ?? 0) + (data?.tripadvisor_total_reviews ?? 0)
  } catch {
    return 300 // conservative fallback
  }
}

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [navListings, reviewCount] = await Promise.all([getNavListings(), getReviewCount()])

  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'TravelAgency'],
    '@id': `${BASE_URL}/#organization`,
    name: 'Off Course Amsterdam',
    description:
      'Boutique electric canal boat tours in Amsterdam on historic wooden salon boats (Curaçao max 12 guests, Diana max 8 guests). Offering both shared small-group tours (per-person tickets) and exclusive private boat charters. Safe upfront online booking via Stripe accepting all international payment methods. Drinks upgrade available for €10 per person per hour (good wine, craft beer, sodas). Multiple pee breaks along the way and live local skipper commentary. Founded by Beer & Jannah.',
    url: BASE_URL,
    telephone: '+31645351618',
    email: 'hello@offcourseamsterdam.com',
    priceRange: '€€',
    image: `${BASE_URL}/og-default.jpg`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Brouwersgracht 66',
      addressLocality: 'Amsterdam',
      addressRegion: 'Noord-Holland',
      postalCode: '1015 GH',
      addressCountry: 'NL',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: '52.3782',
      longitude: '4.8840',
    },
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        opens: '10:00',
        closes: '22:00',
      },
    ],
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.9',
      reviewCount: String(reviewCount > 0 ? reviewCount : 300),
      bestRating: '5',
      worstRating: '1',
    },
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Amsterdam Canal Cruises',
      url: `${BASE_URL}/en/cruises`,
    },
    founder: [
      { '@type': 'Person', name: 'Beer' },
      { '@type': 'Person', name: 'Jannah' },
    ],
    sameAs: [
      'https://instagram.com/offcourseamsterdam',
      'https://www.tripadvisor.com/Attraction_Review-g188590-d26987483-Reviews-Off_Course_Amsterdam-Amsterdam_North_Holland_Province.html',
      'https://en.wikipedia.org/wiki/Canals_of_Amsterdam',
      'https://www.wikidata.org/wiki/Q727',
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      <Navbar navListings={navListings} />
      <main>{children}</main>
      <Footer />
      <WhatsAppButton />
      <CookieBanner />
      <GoogleTag />
      <ClarityTag />
    </>
  )
}
