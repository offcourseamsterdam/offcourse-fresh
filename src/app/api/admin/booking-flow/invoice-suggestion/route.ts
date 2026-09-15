import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeInvoiceSuggestion } from '@/lib/booking/invoice-suggestion'

/**
 * GET /api/admin/booking-flow/invoice-suggestion?partnerId=&listingId=&baseAmountCents=
 *
 * Suggests how much to invoice a partner for an "Invoice later" admin booking.
 * If an active percentage campaign links this partner + listing (the same
 * campaigns used by the Webikeamsterdam partner-invoice flow), the suggestion
 * is base minus that commission %. Otherwise it defaults to the full base
 * amount — there's no established revenue-share for this pair, so nothing to
 * subtract. Either way the admin can edit the suggested amount before booking.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const partnerId = searchParams.get('partnerId')
  const listingId = searchParams.get('listingId')
  const baseAmountCents = Number(searchParams.get('baseAmountCents') ?? 0)
  const extrasAmountCents = Number(searchParams.get('extrasAmountCents') ?? 0)
  const guestCount = Number(searchParams.get('guestCount') ?? 0)
  const cityTaxCents = guestCount > 0 ? guestCount * 260 : Number(searchParams.get('cityTaxCents') ?? 0)

  if (!partnerId || !listingId) {
    return apiError('partnerId and listingId are required', 400)
  }

  const supabase = createAdminClient()
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('percentage_value, investment_type')
    .eq('listing_id', listingId)
    .eq('partner_id', partnerId)
    .eq('is_active', true)
    .maybeSingle()

  let partnerCommissionRate: number | null = null
  if (!campaign?.percentage_value) {
    const { data: partner } = await supabase
      .from('partners')
      .select('commission_rate, name')
      .eq('id', partnerId)
      .maybeSingle()
    if (partner?.commission_rate != null && Number(partner.commission_rate) > 0) {
      partnerCommissionRate = Number(partner.commission_rate)
    }
  }

  const commissionOnNetBaseOnly = searchParams.get('netBase') === 'true' || (!campaign?.percentage_value && Boolean(partnerCommissionRate))

  const suggestion = computeInvoiceSuggestion(baseAmountCents, campaign, {
    partnerCommissionRate,
    extrasAmountCents,
    cityTaxCents,
    commissionOnNetBaseOnly,
  })

  return apiOk(suggestion)
}
