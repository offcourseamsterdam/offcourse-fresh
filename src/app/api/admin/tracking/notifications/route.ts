import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/tracking/notifications?channel_id=...&partner_id=...
 * Returns notification settings for a channel or partner.
 *
 * PUT /api/admin/tracking/notifications
 * Creates or updates notification settings.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const channel_id = searchParams.get('channel_id')
    const partner_id = searchParams.get('partner_id')

    const supabase = createAdminClient()
    let query = supabase.from('notification_settings').select('*')

    if (channel_id) query = query.eq('channel_id', channel_id)
    if (partner_id) query = query.eq('partner_id', partner_id)

    const { data, error } = await query.maybeSingle()
    if (error) return apiError(error.message)
    return apiOk(data)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { channel_id, partner_id, notify_per_booking, notify_weekly, notify_monthly, notify_quarterly, email_recipients } = body

    if (!channel_id && !partner_id) {
      return apiError('Either channel_id or partner_id is required', 400)
    }

    const supabase = createAdminClient()

    // Check if settings exist
    let query = supabase.from('notification_settings').select('id')
    if (channel_id) query = query.eq('channel_id', channel_id)
    if (partner_id) query = query.eq('partner_id', partner_id)
    const { data: existing } = await query.maybeSingle()

    const settings = {
      channel_id: channel_id ?? null,
      partner_id: partner_id ?? null,
      notify_per_booking: notify_per_booking ?? false,
      notify_weekly: notify_weekly ?? false,
      notify_monthly: notify_monthly ?? false,
      notify_quarterly: notify_quarterly ?? false,
      email_recipients: email_recipients ?? [],
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { data, error } = await supabase
        .from('notification_settings')
        .update(settings)
        .eq('id', existing.id)
        .select()
        .single()
      if (error) return apiError(error.message)
      return apiOk(data)
    } else {
      const { data, error } = await supabase
        .from('notification_settings')
        .insert(settings)
        .select()
        .single()
      if (error) return apiError(error.message)
      return apiOk(data, 201)
    }
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
