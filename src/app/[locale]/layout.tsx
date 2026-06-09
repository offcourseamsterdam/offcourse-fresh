import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import AuthProvider from '@/components/auth/AuthProvider'
import { SearchProvider } from '@/lib/search/SearchContext'
import { TrackingScript } from '@/components/tracking/TrackingScript'
import type { Locale } from '@/lib/i18n/config'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

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

  const messages = await getMessages()

  return (
    <NextIntlClientProvider messages={messages}>
      <AuthProvider>
        <SearchProvider>
          {/* Resource hints for the Supabase Storage CDN — saves ~100ms on first image load. */}
          <link rel="preconnect" href="https://fkylzllxvepmrtqxisrn.supabase.co" />
          <link rel="dns-prefetch" href="https://fkylzllxvepmrtqxisrn.supabase.co" />
          <TrackingScript />
          {children}
        </SearchProvider>
      </AuthProvider>
    </NextIntlClientProvider>
  )
}
