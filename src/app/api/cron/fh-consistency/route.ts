import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { FHNotFoundError } from '@/lib/fareharbor/types'
import { postSlackText } from '@/lib/slack/send-notification'
import { alertCronFailure } from '@/lib/cron/alert'
import { buildFHBookingNote } from '@/lib/catering/build-fh-note'
import type { ExtrasLineItem } from '@/lib/catering/filter'

/**
 * The date to check/display a booking against. Website + webhook rows persist the
 * real departure in start_time and leave booking_date null, so fall back to the
 * date portion of start_time. (This is the same fallback generate-shifts uses.)
 */
export function consistencyDisplayDate(b: { booking_date: string | null; start_time: string | null }): string {
  return b.booking_date ?? b.start_time?.slice(0, 10) ?? '?'
}

/**
 * GET /api/cron/fh-consistency
 * Vercel Cron: daily at 06:00 UTC (08:00 Amsterdam).
 *
 * For every upcoming confirmed/booked booking with a FareHarbor UUID:
 *   1. Verify the FH booking is not cancelled or missing.
 *   2. If the booking has catering or a guest note, verify the FH note matches
 *      what our system would generate — so the skipper sees correct info.
 *
 * Posts a Slack summary either way (green all-clear or red alert list).
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  const supabase = createAdminClient()
  const fh = getFareHarborClient()

  const todayDate = new Date().toISOString().slice(0, 10)
  const todayStartIso = new Date(`${todayDate}T00:00:00Z`).toISOString()

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, booking_uuid, customer_name, booking_date, start_time, customer_type_name, booking_source, guest_note, extras_selected')
    .in('status', ['confirmed', 'booked'])
    .not('booking_uuid', 'is', null)
    // Upcoming = booking_date today-or-later, OR (no booking_date but start_time is
    // today-or-later). The second arm catches website/webhook rows that leave
    // booking_date null and keep the real departure in start_time — previously these
    // were silently skipped, so the orphan/cancelled checks never looked at them.
    .or(`booking_date.gte.${todayDate},and(booking_date.is.null,start_time.gte.${todayStartIso})`)
    .order('start_time', { ascending: true })

  if (error) {
    // The cron meant to catch orphans must not itself fail silently.
    await alertCronFailure('fh-consistency', error, 'could not query upcoming bookings')
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  if (!bookings || bookings.length === 0) {
    await postSlackText('✅ *FH Consistency Check* — no upcoming bookings to check.')
    return NextResponse.json({ ok: true, checked: 0, issues: 0 })
  }

  const issues: string[] = []

  for (const booking of bookings) {
    try {
      const fhBooking = await fh.getBooking(booking.booking_uuid!)

      if (fhBooking.is_cancelled || fhBooking.status === 'cancelled') {
        issues.push(`🔴 *CANCELLED in FH* — ${formatBookingLine(booking)}`)
        continue
      }

      // Check catering/note consistency
      const extras = (Array.isArray(booking.extras_selected) ? booking.extras_selected : []) as unknown as ExtrasLineItem[]
      const expectedNote = buildFHBookingNote(booking.guest_note ?? null, extras)
      const actualNote = fhBooking.note?.trim() || null
      const normalised = expectedNote?.trim() || null

      if (normalised !== null && normalised !== actualNote) {
        issues.push(
          `📋 *NOTE MISMATCH* — ${formatBookingLine(booking)}\n` +
          `   Expected: ${normalised.split('\n')[0]}…\n` +
          `   FH has: ${actualNote ? actualNote.split('\n')[0] + '…' : '(empty)'}`
        )
      }
    } catch (err) {
      if (err instanceof FHNotFoundError) {
        issues.push(`❓ *NOT FOUND in FH* — ${formatBookingLine(booking)}`)
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        issues.push(`⚠️ *FH API error* for ${booking.customer_name ?? '?'} (${booking.booking_uuid?.slice(0, 8)}): ${msg}`)
      }
    }
  }

  if (issues.length === 0) {
    const dates = [...new Set(bookings.map(consistencyDisplayDate))].sort()
    await postSlackText(
      `✅ *FH Consistency Check* — all ${bookings.length} upcoming booking${bookings.length === 1 ? '' : 's'} confirmed in FareHarbor with correct notes. ` +
      `Dates checked: ${dates.join(', ')}.`
    )
  } else {
    const lines = [
      `🚨 *FH Consistency Check — ${issues.length} issue${issues.length === 1 ? '' : 's'} found!*`,
      '',
      ...issues,
      '',
      `_Checked ${bookings.length} upcoming booking${bookings.length === 1 ? '' : 's'} total._`,
    ]
    await postSlackText(lines.join('\n'))
  }

  return NextResponse.json({ ok: true, checked: bookings.length, issues: issues.length })
}

function formatBookingLine(booking: {
  customer_name: string | null
  booking_date: string | null
  start_time: string | null
  customer_type_name: string | null
  booking_source: string | null
  booking_uuid: string | null
}): string {
  const date = consistencyDisplayDate(booking)
  const time = booking.start_time ? booking.start_time.slice(11, 16) + ' UTC' : ''
  const type = booking.customer_type_name ?? booking.booking_source ?? '?'
  const uuid = booking.booking_uuid?.slice(0, 8) ?? '?'
  return `${booking.customer_name ?? '?'} — ${date} ${time} (${type}) [${uuid}]`
}
