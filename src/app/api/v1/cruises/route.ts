import { NextRequest } from 'next/server'
import { apiOk } from '@/lib/api/response'
import { enforceRateLimit } from '@/lib/rate-limit'
import { locales, defaultLocale, type Locale } from '@/lib/i18n/config'
import { getPublicCruiseList } from '@/lib/cruise/get-public-cruise-list'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')

// GET /api/v1/cruises?locale=en
// Public, read-only, unauthenticated — same catalogue data already shown on
// /{locale}/cruises and /llms-full.txt, just as structured JSON. Documented
// in /openapi.yaml and cataloged at /.well-known/api-catalog per RFC 9727.
export async function GET(request: NextRequest) {
  const limited = enforceRateLimit(request, 'v1-cruises-list', 60, 60_000)
  if (limited) return limited

  const localeParam = request.nextUrl.searchParams.get('locale')
  const locale: Locale = (locales as readonly string[]).includes(localeParam ?? '')
    ? (localeParam as Locale)
    : defaultLocale

  const cruises = await getPublicCruiseList(locale)

  return apiOk({
    cruises: cruises.map((c) => ({
      slug: c.slug,
      title: c.title,
      tagline: c.tagline,
      category: c.category,
      price_display: c.priceDisplay,
      starting_price: c.startingPrice,
      duration_display: c.durationDisplay,
      max_guests: c.maxGuests,
      url: `${SITE_URL}/${locale}/cruises/${c.slug}`,
    })),
  })
}
