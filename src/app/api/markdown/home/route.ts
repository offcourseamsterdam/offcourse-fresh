import { NextRequest, NextResponse } from 'next/server'
import { locales, defaultLocale, type Locale } from '@/lib/i18n/config'
import { buildHomeMarkdown } from '@/lib/markdown/build-home-markdown'

export const revalidate = 3600

export async function GET(request: NextRequest) {
  const localeParam = request.nextUrl.searchParams.get('locale')
  const locale: Locale = (locales as readonly string[]).includes(localeParam ?? '')
    ? (localeParam as Locale)
    : defaultLocale

  return new NextResponse(buildHomeMarkdown(locale), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      Vary: 'Accept',
    },
  })
}
