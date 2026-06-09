import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { WhatsAppButton } from '@/components/layout/WhatsAppButton'
import { CookieBanner } from '@/components/tracking/CookieBanner'
import { GoogleTag } from '@/components/tracking/GoogleTag'
import { createAdminClient } from '@/lib/supabase/admin'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

async function getNavListings() {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('cruise_listings')
    .select('id, title, slug, category')
    .eq('is_published', true)
    .order('display_order', { ascending: true })
  return (data ?? []) as { id: string; title: string; slug: string; category: string }[]
}

const orgJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'Off Course Amsterdam',
  description: "Electric canal cruises through Amsterdam's hidden gems. Your friend with a boat.",
  url: BASE_URL,
  telephone: '+31645351618',
  address: {
    '@type': 'PostalAddress',
    streetAddress: 'Keizersgracht 62',
    addressLocality: 'Amsterdam',
    addressCountry: 'NL',
  },
  sameAs: [
    'https://instagram.com/offcourseamsterdam',
  ],
}

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const navListings = await getNavListings()

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
    </>
  )
}
