import { NextRequest, NextResponse } from 'next/server'
import { locales, defaultLocale, type Locale } from '@/lib/i18n/config'
import { buildCruiseMarkdown } from '@/lib/markdown/build-cruise-markdown'
import { getPublicCruiseDetail } from '@/lib/cruise/get-public-cruise-detail'

export const revalidate = 60

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const localeParam = request.nextUrl.searchParams.get('locale')
  const locale: Locale = (locales as readonly string[]).includes(localeParam ?? '')
    ? (localeParam as Locale)
    : defaultLocale

  const cruise = await getPublicCruiseDetail(slug, locale)
  if (!cruise) {
    return new NextResponse('Not found', { status: 404 })
  }

  const markdown = buildCruiseMarkdown(
    {
      slug: cruise.slug,
      title: cruise.title,
      tagline: cruise.tagline,
      description: cruise.descriptionHtml,
      price_display: cruise.priceDisplay,
      starting_price: cruise.startingPrice,
      duration_display: cruise.durationDisplay,
      max_guests: cruise.maxGuests,
      category: cruise.category,
      departure_location: cruise.departureLocation,
      hero_image_url: cruise.heroImageUrl,
      highlights: cruise.highlights.map((text) => ({ text })),
      faqs: cruise.faqs,
    },
    locale,
    cruise.customerTypes
  )

  return new NextResponse(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=3600',
      Vary: 'Accept',
    },
  })
}
