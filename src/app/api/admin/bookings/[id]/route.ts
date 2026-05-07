import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { customer_name, customer_email, customer_phone, guest_note, deposit_amount_cents, extras_selected, extras_amount_cents, extras_vat_amount_cents } = body

    const supabase = createAdminClient()

    const { data: booking } = await supabase
      .from('bookings')
      .select('id, booking_uuid, guest_note')
      .eq('id', id)
      .single()

    if (!booking) return apiError('Booking not found', 404)

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof customer_name === 'string' && customer_name.trim()) {
      updates.customer_name = customer_name.trim()
    }
    if (typeof customer_email === 'string' && customer_email.trim()) {
      updates.customer_email = customer_email.trim()
    }
    if (typeof customer_phone === 'string') {
      updates.customer_phone = customer_phone.trim() || null
    }
    if (typeof guest_note === 'string') {
      updates.guest_note = guest_note.trim() || null
    }
    if (typeof deposit_amount_cents === 'number') {
      updates.deposit_amount_cents = deposit_amount_cents
    }
    if (Array.isArray(extras_selected)) {
      updates.extras_selected = extras_selected
    }
    if (typeof extras_amount_cents === 'number') {
      updates.extras_amount_cents = extras_amount_cents
    }
    if (typeof extras_vat_amount_cents === 'number') {
      updates.extras_vat_amount_cents = extras_vat_amount_cents
    }

    if (Object.keys(updates).length === 1) {
      return apiError('No valid fields provided', 400)
    }

    const { error } = await supabase.from('bookings').update(updates).eq('id', id)
    if (error) return apiError(error.message)

    // If note changed and booking is in FareHarbor, sync the note there too
    const noteChanged =
      typeof guest_note === 'string' &&
      guest_note.trim() !== (booking.guest_note ?? '')
    if (noteChanged && booking.booking_uuid) {
      try {
        const fh = getFareHarborClient()
        await fh.updateBookingNote(booking.booking_uuid, guest_note.trim())
      } catch {
        // FH note update is best-effort — don't fail the whole request
      }
    }

    return apiOk({ updated: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
