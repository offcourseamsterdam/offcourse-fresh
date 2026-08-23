import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasFood } from '@/lib/catering/filter'
import { deriveBookingTimeline } from '@/lib/ops/booking-timeline'

/**
 * GET /api/admin/bookings/[id]/timeline — one booking's ops journey
 * (confirmed → catering ordered → supplier confirmed → captain assigned) for
 * the BookingTimeline component in the admin booking detail row. Phase 1 of
 * docs/plans/2026-08-07-booking-ops-timeline-plan.md: visibility only,
 * derived from real booking/shift columns — see deriveBookingTimeline's own
 * doc comment for why ops_events is only ever used for a timestamp, never
 * for the done/not-done state itself.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  const supabase = createAdminClient()

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, status, created_at, extras_selected, catering_email_sent_at, catering_confirmed_at, fareharbor_availability_pk')
    .eq('id', id)
    .single()

  if (error || !booking) return apiError('Booking not found', 404)

  const { data: ownShift } = await supabase
    .from('shifts')
    .select('id, staff_id')
    .eq('booking_id', id)
    .maybeSingle()

  let shift = ownShift

  // Shared-cruise bookings link to their captain via the FareHarbor
  // availability slot, not booking_id — same fallback the Planning page
  // uses (captainByBookingId in admin/planning/page.tsx).
  if (!shift?.staff_id && booking.fareharbor_availability_pk) {
    const { data: sharedShift } = await supabase
      .from('shifts')
      .select('id, staff_id')
      .eq('fareharbor_availability_pk', booking.fareharbor_availability_pk)
      .not('staff_id', 'is', null)
      .limit(1)
      .maybeSingle()
    if (sharedShift) shift = sharedShift
  }

  let captainAssignedAt: string | null = null
  if (shift?.staff_id) {
    const { data: event } = await supabase
      .from('ops_events')
      .select('occurred_at')
      .eq('event_type', 'shift_assigned')
      .eq('shift_id', shift.id)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    captainAssignedAt = event?.occurred_at ?? null
  }

  const timeline = deriveBookingTimeline({
    status: booking.status,
    createdAt: booking.created_at,
    hasCatering: hasFood(booking.extras_selected as never),
    cateringEmailSentAt: booking.catering_email_sent_at,
    cateringConfirmedAt: booking.catering_confirmed_at,
    captainAssigned: !!shift?.staff_id,
    captainAssignedAt,
  })

  return apiOk(timeline)
}
