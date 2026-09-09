import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { emitOpsEvent } from '@/lib/ops/events'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data: booking, error: fetchErr } = await supabase
      .from('bookings')
      .select('id, customer_name, booking_date, catering_confirmed_at')
      .eq('id', id)
      .single()

    if (fetchErr || !booking) return apiError('Booking not found', 404)

    const now = new Date().toISOString()
    const { error: updateErr } = await supabase
      .from('bookings')
      .update({ catering_confirmed_at: now })
      .eq('id', id)

    if (updateErr) return apiError(updateErr.message, 500)

    await emitOpsEvent({
      eventType: 'catering_confirmed',
      actorType: 'human',
      bookingId: id,
      payload: { manual: true, bookingDate: booking.booking_date },
      source: 'admin/catering-confirm',
    })

    return apiOk({ ok: true, confirmed_at: now })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
