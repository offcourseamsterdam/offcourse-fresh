import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { routing } from '@/i18n/routing'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { WhatsAppButton } from '@/components/layout/WhatsAppButton'
import AuthProvider from '@/components/auth/AuthProvider'
import { SearchProvider } from '@/lib/search/SearchContext'
import { TrackingScript } from '@/components/tracking/TrackingScript'
import { createClient } from '@/lib/supabase/server'
import type { Locale } from '@/lib/i18n/config'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

async function getNavListings() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('cruise_listings')
    .select('id, title, slug, category')
    .eq('is_published', true)
    .order('display_order', { ascending: true })
  return (data ?? []) as { id: string; title: string; slug: string; category: string }[]
}

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export function generateStaticParams() {
  return routing.locales.map(locale => ({ locale }))
}

export async function generateMetadata({ params }: Omit<Props, 'children'>) {
  const { locale } = await params

  return {
    alternates: {
      languages: Object.fromEntries(
        routing.locales.map(l => [l, `${BASE_URL}/${l}`])
      ),
      canonical: `${BASE_URL}/${locale}`,
    },
  }
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params

  if (!routing.locales.includes(locale as Locale)) {
    notFound()
  }

  const headersList = await headers()
  const pathname = headersList.get('x-pathname') ?? ''
  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/')

  const messages = await getMessages()

  // Fetch cruise listings for Navbar dropdown (cached for 5 min)
  const navListings = await getNavListings()

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

  return (
    <NextIntlClientProvider messages={messages}>
      <AuthProvider>
        <SearchProvider>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
          />
          {!isAdminRoute && <Navbar navListings={navListings} />}
          <main>{children}</main>
          {!isAdminRoute && <Footer />}
          {!isAdminRoute && <WhatsAppButton />}
          <TrackingScript />
        </SearchProvider>
      </AuthProvider>
    </NextIntlClientProvider>
  )
}
