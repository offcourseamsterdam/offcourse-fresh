import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { hasFood } from '@/lib/catering/filter'
import { isWithinCateringAutoSendWindow } from '@/lib/catering/auto-send-cutoff'
import { sendCateringOrderEmailForBooking } from '@/lib/catering/send-catering-email'
import { notifyCateringOrder } from '@/lib/catering/notify'
import { buildFHBookingNote } from '@/lib/catering/build-fh-note'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const body = await request.json()
    const { customer_name, customer_email, customer_phone, guest_note, deposit_amount_cents, extras_selected, extras_amount_cents, extras_vat_amount_cents } = body

    const supabase = createAdminClient()

    const { data: booking } = await supabase
      .from('bookings')
      .select('id, booking_uuid, guest_note, booking_date, start_time, guest_count, listing_id, listing_title, tour_item_name, extras_selected, catering_email_sent_at')
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

    // Handle catering & FareHarbor note syncing
    if (Array.isArray(extras_selected)) {
      const hasFoodItems = hasFood(extras_selected as never)
      const withinWindow = isWithinCateringAutoSendWindow(booking.booking_date)

      if (hasFoodItems && withinWindow) {
        // Within 7-day auto-send window: immediately send (or update) order to supplier
        await sendCateringOrderEmailForBooking(id)
      } else {
        // Cruise is > 7 days away or no food:
        // 1. Sync note to FareHarbor if FH booking exists
        if (booking.booking_uuid) {
          try {
            const effectiveNote = typeof updates.guest_note === 'string' ? (updates.guest_note as string) : booking.guest_note
            const note = buildFHBookingNote(effectiveNote, extras_selected as never)
            if (note) {
              const fh = getFareHarborClient()
              await fh.updateBookingNote(booking.booking_uuid, note)
            }
          } catch {
            // Best-effort
          }
        }
        // 2. If new food was added > 7 days out, post a Slack review notification
        if (hasFoodItems && !hasFood(booking.extras_selected as never)) {
          notifyCateringOrder({
            dateStr: booking.booking_date,
            cruiseName: booking.listing_title ?? booking.tour_item_name ?? 'Cruise',
            startTimeStr: booking.start_time,
            guestCount: booking.guest_count,
            extrasSelected: extras_selected as never,
            listingId: booking.listing_id,
          }).catch(err => console.error('[admin/bookings] Catering notify failed:', err))
        }
      }
    } else if (typeof guest_note === 'string' && guest_note.trim() !== (booking.guest_note ?? '')) {
      // If note changed and extras were not updated in this request
      if (booking.booking_uuid) {
        try {
          const note = buildFHBookingNote(guest_note.trim(), (booking.extras_selected ?? []) as never)
          if (note) {
            const fh = getFareHarborClient()
            await fh.updateBookingNote(booking.booking_uuid, note)
          }
        } catch {
          // FH note update is best-effort — don't fail the whole request
        }
      }
    }

    return apiOk({ updated: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
