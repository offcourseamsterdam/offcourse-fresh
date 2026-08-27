import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError } from '@/lib/api/response'
import { getCaptainFirstNames } from '@/lib/scheduling/assigned-captain'

// How far back to look for finished-but-unsent cruises. Long enough to catch up
// after a few days away from the admin, short enough that a review SMS still
// feels timely rather than a random text out of nowhere.
const READY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

/**
 * GET /api/admin/reviews/sms-ready
 * Bookings whose cruise has ended, within the last 14 days, that haven't had
 * a review SMS sent yet. Powers the "Ready to send" list on the admin Reviews
 * page — the same eligibility the post-cruise-sms cron uses, just admin-auth'd
 * and without the cron's 48h operational window.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()
  const windowStartIso = new Date(Date.now() - READY_WINDOW_MS).toISOString()

  const { data, error } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_phone, listing_title, end_time, booking_date, fareharbor_availability_pk')
    .in('status', ['confirmed', 'booked'])
    .is('review_sms_sent_at', null)
    .not('end_time', 'is', null)
    .lte('end_time', nowIso)
    .gte('end_time', windowStartIso)
    .order('end_time', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[sms-ready] query failed:', error)
    return apiError('Failed to load ready-to-send bookings', 500)
  }

  const bookings = data ?? []
  const captainNames = await getCaptainFirstNames(supabase, bookings)

  return apiOk({
    bookings: bookings.map(b => ({ ...b, captain_name: captainNames.get(b.id) ?? null })),
  })
}
