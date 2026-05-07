import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasCatering } from '@/lib/catering/filter'

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Fetch confirmed bookings where catering email hasn't been sent yet.
    // The partial index on `catering_email_sent_at IS NULL` makes this fast.
    const { data, error } = await supabase
      .from('bookings')
      .select('id, extras_selected')
      .in('status', ['confirmed', 'booked'])
      .is('catering_email_sent_at', null)

    if (error) return apiError(error.message)

    // Filter JS-side to those that actually have food/drinks extras
    const count = (data ?? []).filter(b => hasCatering(b.extras_selected as never)).length

    return apiOk({ count })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
