import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPartnerIdFromRequest } from '@/lib/partner/get-partner-id'

/**
 * GET /api/partner/bookings?from=2024-01-01&to=2024-12-31
 *
 * Returns paginated bookings for the authenticated partner.
 * No customer personal info (name/email/phone) is exposed.
 */
export async function GET(request: NextRequest) {
  try {
    const partnerId = await getPartnerIdFromRequest(request)
    if (!partnerId) return apiError('Unauthorized', 401)

    const { searchParams } = request.nextUrl
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    const admin = createAdminClient()

    let query = admin
      .from('bookings')
      .select('booking_date, listing_title, start_time, end_time, guest_count, category, base_amount_cents, commission_amount_cents, status')
      .eq('partner_id', partnerId)
      .order('booking_date', { ascending: false })

    if (from) {
      query = query.gte('booking_date', from)
    }
    if (to) {
      query = query.lte('booking_date', to)
    }

    const { data, error } = await query

    if (error) return apiError(error.message)
    return apiOk({ bookings: data ?? [] })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
