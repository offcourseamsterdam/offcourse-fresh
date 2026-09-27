import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { enforceRateLimit } from '@/lib/rate-limit'
import { locales, defaultLocale, type Locale } from '@/lib/i18n/config'
import { getPublicCruiseDetail } from '@/lib/cruise/get-public-cruise-detail'
import { formatRatePrice } from '@/lib/fareharbor/customer-types'
import { htmlToMarkdown } from '@/lib/markdown/html-to-markdown'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')

// GET /api/v1/cruises/{slug}?locale=en
// Public, read-only, unauthenticated — same detail already shown on the
// cruise page, just as structured JSON. `description` is Markdown-formatted
// (converted from the admin editor's rich-text HTML), not raw HTML.
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const limited = enforceRateLimit(request, 'v1-cruises-detail', 60, 60_000)
  if (limited) return limited

  const { slug } = await params
  const localeParam = request.nextUrl.searchParams.get('locale')
  const locale: Locale = (locales as readonly string[]).includes(localeParam ?? '')
    ? (localeParam as Locale)
    : defaultLocale

  const cruise = await getPublicCruiseDetail(slug, locale)
  if (!cruise) {
    return apiError('Cruise not found', 404)
  }

  return apiOk({
    slug: cruise.slug,
    title: cruise.title,
    tagline: cruise.tagline,
    description: cruise.descriptionHtml ? htmlToMarkdown(cruise.descriptionHtml) : null,
    price_display: cruise.priceDisplay,
    starting_price: cruise.startingPrice,
    duration_display: cruise.durationDisplay,
    max_guests: cruise.maxGuests,
    category: cruise.category,
    departure_location: cruise.departureLocation,
    hero_image_url: cruise.heroImageUrl,
    highlights: cruise.highlights,
    faqs: cruise.faqs,
    rates: cruise.customerTypes.map((ct) => ({
      name: ct.name,
      price_cents: ct.price_cents,
      price_display: formatRatePrice(ct.price_cents),
    })),
    url: `${SITE_URL}/${locale}/cruises/${cruise.slug}`,
  })
}
