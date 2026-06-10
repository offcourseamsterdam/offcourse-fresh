import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import { FHNotFoundError } from '@/lib/fareharbor/types'
import { postSlackText } from '@/lib/slack/send-notification'
import { buildFHBookingNote } from '@/lib/catering/build-fh-note'
import type { ExtrasLineItem } from '@/lib/catering/filter'

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

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, booking_uuid, customer_name, booking_date, start_time, customer_type_name, booking_source, guest_note, extras_selected')
    .in('status', ['confirmed', 'booked'])
    .not('booking_date', 'is', null)
    .not('booking_uuid', 'is', null)
    .gte('booking_date', new Date().toISOString().slice(0, 10))
    .order('booking_date', { ascending: true })

  if (error) {
    await postSlackText(`🚨 *FH Consistency Check FAILED* — could not query Supabase: ${error.message}`)
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
    const dates = [...new Set(bookings.map(b => b.booking_date))].sort()
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
  const date = booking.booking_date ?? '?'
  const time = booking.start_time ? booking.start_time.slice(11, 16) + ' UTC' : ''
  const type = booking.customer_type_name ?? booking.booking_source ?? '?'
  const uuid = booking.booking_uuid?.slice(0, 8) ?? '?'
  return `${booking.customer_name ?? '?'} — ${date} ${time} (${type}) [${uuid}]`
}
