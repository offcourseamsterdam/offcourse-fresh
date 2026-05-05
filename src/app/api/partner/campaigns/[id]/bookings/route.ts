import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPartnerIdFromRequest } from '@/lib/partner/get-partner-id'

/**
 * GET /api/partner/campaigns/[id]/bookings
 * Returns confirmed bookings for a specific campaign owned by the authenticated partner.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const partnerId = await getPartnerIdFromRequest(request)
    if (!partnerId) return apiError('Unauthorized', 401)

    const { id: campaignId } = await params
    const admin = createAdminClient()

    // Verify campaign belongs to this partner
    const { data: campaign } = await admin
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('partner_id', partnerId)
      .maybeSingle()

    if (!campaign) return apiError('Campaign not found', 404)

    const { data, error } = await admin
      .from('bookings')
      .select('booking_date, listing_title, start_time, guest_count, base_amount_cents, commission_amount_cents, created_at')
      .eq('campaign_id', campaignId)
      .eq('status', 'confirmed')
      .order('booking_date', { ascending: false })

    if (error) return apiError(error.message)

    const bookings = (data ?? []).map(b => ({
      date: b.booking_date ?? '',
      cruise: b.listing_title ?? '',
      time: b.start_time ? b.start_time.slice(0, 5) : '',
      guests: b.guest_count ?? 0,
      base_price_cents: b.base_amount_cents ?? 0,
      commission_cents: b.commission_amount_cents ?? 0,
      booked_on: b.created_at ?? '',
    }))

    return apiOk(bookings)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
