import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPartnerIdFromRequest } from '@/lib/partner/get-partner-id'

/**
 * GET /api/partner/bookings?from=2024-01-01&to=2024-12-31
 *
 * Returns confirmed bookings for the authenticated partner.
 * No customer personal info (name/email/phone) is exposed.
 * Catches bookings via partner_id OR campaign_id ownership.
 */
export async function GET(request: NextRequest) {
  try {
    const partnerId = await getPartnerIdFromRequest(request)
    if (!partnerId) return apiError('Unauthorized', 401)

    const { searchParams } = request.nextUrl
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    const admin = createAdminClient()

    const { data: campaigns } = await admin
      .from('campaigns')
      .select('id')
      .eq('partner_id', partnerId)

    const campaignIds = (campaigns ?? []).map(c => c.id)

    let query = admin
      .from('bookings')
      .select('booking_date, listing_title, start_time, guest_count, base_amount_cents, commission_amount_cents, status, created_at')
      .eq('status', 'confirmed')
      .or(
        campaignIds.length > 0
          ? `partner_id.eq.${partnerId},campaign_id.in.(${campaignIds.join(',')})`
          : `partner_id.eq.${partnerId}`
      )
      .order('booking_date', { ascending: false })

    if (from) query = query.gte('booking_date', from)
    if (to) query = query.lte('booking_date', to)

    const { data, error } = await query
    if (error) return apiError(error.message)

    // Deduplicate by booking identity
    const seen = new Set<string>()
    const bookings = []
    for (const b of data ?? []) {
      const key = `${b.booking_date}-${b.listing_title}-${b.base_amount_cents}`
      if (seen.has(key)) continue
      seen.add(key)
      bookings.push({
        date: b.booking_date ?? '',
        cruise: b.listing_title ?? '',
        time: b.start_time ? b.start_time.slice(0, 5) : '',
        guests: b.guest_count ?? 0,
        base_price_cents: b.base_amount_cents ?? 0,
        commission_cents: b.commission_amount_cents ?? 0,
      })
    }

    return apiOk(bookings)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
