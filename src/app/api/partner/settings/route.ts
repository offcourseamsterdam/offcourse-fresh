import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPartnerIdFromRequest } from '@/lib/partner/get-partner-id'

/**
 * GET /api/partner/settings
 *
 * Returns notification preferences and partner email for the
 * authenticated partner.
 */
export async function GET(request: NextRequest) {
  try {
    const partnerId = await getPartnerIdFromRequest(request)
    if (!partnerId) return apiError('Unauthorized', 401)

    const admin = createAdminClient()

    // Fetch partner info and notification settings in parallel
    const [partnerRes, settingsRes] = await Promise.all([
      admin
        .from('partners')
        .select('email')
        .eq('id', partnerId)
        .maybeSingle(),
      admin
        .from('notification_settings')
        .select('notify_per_booking, notify_weekly, notify_monthly, notify_quarterly')
        .eq('partner_id', partnerId)
        .maybeSingle(),
    ])

    if (partnerRes.error) return apiError(partnerRes.error.message)

    // Default notification settings if none exist yet
    const settings = settingsRes.data ?? {
      notify_per_booking: true,
      notify_weekly: false,
      notify_monthly: true,
      notify_quarterly: false,
    }

    return apiOk({
      email: partnerRes.data?.email ?? null,
      notify_per_booking: settings.notify_per_booking,
      notify_weekly: settings.notify_weekly,
      notify_monthly: settings.notify_monthly,
      notify_quarterly: settings.notify_quarterly,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

/**
 * PATCH /api/partner/settings
 *
 * Updates notification preferences for the authenticated partner.
 * Accepts: { notify_per_booking?, notify_weekly?, notify_monthly?, notify_quarterly? }
 */
export async function PATCH(request: NextRequest) {
  try {
    const partnerId = await getPartnerIdFromRequest(request)
    if (!partnerId) return apiError('Unauthorized', 401)

    const body = await request.json()

    // Only allow known notification fields
    const allowedFields = ['notify_per_booking', 'notify_weekly', 'notify_monthly', 'notify_quarterly'] as const
    const updates: Record<string, boolean> = {}

    for (const field of allowedFields) {
      if (typeof body[field] === 'boolean') {
        updates[field] = body[field]
      }
    }

    if (Object.keys(updates).length === 0) {
      return apiError('No valid fields to update', 400)
    }

    const admin = createAdminClient()

    // Upsert: update if exists, insert if not
    const { data: existing } = await admin
      .from('notification_settings')
      .select('id')
      .eq('partner_id', partnerId)
      .maybeSingle()

    if (existing) {
      const { error } = await admin
        .from('notification_settings')
        .update(updates)
        .eq('partner_id', partnerId)

      if (error) return apiError(error.message)
    } else {
      const { error } = await admin
        .from('notification_settings')
        .insert({ partner_id: partnerId, ...updates })

      if (error) return apiError(error.message)
    }

    return apiOk({ updated: true })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
