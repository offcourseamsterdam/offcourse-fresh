import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const DEFAULT_MAP_URL = 'https://maps.app.goo.gl/3QW2o9k9v4t5M6jCA'
const DEFAULT_TRIPADVISOR_URL = 'https://www.tripadvisor.com'

function hashIp(ip: string | null): string | null {
  if (!ip) return null
  return createHash('sha256').update(ip).digest('hex')
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const normalizedCode = code.toLowerCase().trim()
  const searchParams = request.nextUrl.searchParams
  const bookingId = searchParams.get('b') || searchParams.get('booking_id') || null

  const supabase = createAdminClient()

  // Fetch reviews config for URLs
  const { data: config } = await supabase
    .from('google_reviews_config')
    .select('recommendations_map_url, tripadvisor_review_url_shared, tripadvisor_review_url_private, tripadvisor_url')
    .single()

  let destinationUrl: string

  if (normalizedCode === 'map' || normalizedCode === 'm') {
    destinationUrl = config?.recommendations_map_url || DEFAULT_MAP_URL
  } else if (normalizedCode === 'review' || normalizedCode === 't') {
    // Shared and private cruises are different TripAdvisor listings — resolve
    // by the clicking booking's category, looked up from the ?b= booking id.
    let category: string | null = null
    if (bookingId) {
      const { data: booking } = await supabase
        .from('bookings')
        .select('category')
        .eq('id', bookingId)
        .maybeSingle()
      category = booking?.category ?? null
    }

    destinationUrl =
      (category === 'shared' ? config?.tripadvisor_review_url_shared : config?.tripadvisor_review_url_private) ||
      config?.tripadvisor_url ||
      DEFAULT_TRIPADVISOR_URL
  } else {
    // Unknown code - redirect home
    const homeUrl = new URL('/', request.url).toString()
    return NextResponse.redirect(homeUrl, 302)
  }

  // Log click event (swallow error so redirect is never blocked)
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip')
  const userAgent = request.headers.get('user-agent')

  try {
    await supabase.from('short_url_clicks').insert({
      slug: normalizedCode,
      booking_id: bookingId,
      destination_url: destinationUrl,
      user_agent: userAgent,
      ip_hash: hashIp(clientIp),
    })
  } catch {
    // Silent
  }

  return NextResponse.redirect(destinationUrl, 302)
}
