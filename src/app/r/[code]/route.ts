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
    .select('recommendations_map_url, tripadvisor_review_url, tripadvisor_url')
    .single()

  let destinationUrl: string | null = null

  if (normalizedCode === 'map' || normalizedCode === 'm') {
    destinationUrl = config?.recommendations_map_url || DEFAULT_MAP_URL
  } else if (normalizedCode === 'review' || normalizedCode === 't') {
    destinationUrl = config?.tripadvisor_review_url || config?.tripadvisor_url || DEFAULT_TRIPADVISOR_URL
  } else {
    // Unknown code - redirect home
    const homeUrl = new URL('/', request.url).toString()
    return NextResponse.redirect(homeUrl, 302)
  }

  // Log click event (swallow error so redirect is never blocked)
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip')
  const userAgent = request.headers.get('user-agent')

  await supabase
    .from('short_url_clicks')
    .insert({
      slug: normalizedCode,
      booking_id: bookingId,
      destination_url: destinationUrl,
      user_agent: userAgent,
      ip_hash: hashIp(clientIp),
    } as any)
    .catch(() => {})

  return NextResponse.redirect(destinationUrl, 302)
}
