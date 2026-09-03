import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { createAdminClient } from '@/lib/supabase/admin'
import { postDm, postToChannel } from '@/lib/slack/bot'
import { postSlackDM } from '@/lib/slack/send-notification'
import { formatAmsterdamTime, amsterdamToday } from '@/lib/utils'
import { alertCronFailure } from '@/lib/cron/alert'

/**
 * Shift reminder & Pre-tour briefing cron — called every 5 minutes by Vercel.
 *
 * 1. 2 Hours in Advance Reminder:
 *    Finds shifts starting in ~2 hours (110–130 min) and sends a heads-up DM to the captain.
 * 2. 5 Minutes in Advance Pre-Tour Briefing:
 *    Finds shifts starting in ~5 minutes (3–11 min), looks up the tour's snacks & drinks (catering),
 *    and sends a high-hospitality pre-tour briefing directly to the captain.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = requireCronSecret(req)
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const now = new Date()
    const opsChannel = process.env.SLACK_OPS_CHANNEL ?? '#bookings'

    // ── 1. 2 HOURS IN ADVANCE SHIFT REMINDER ────────────────────────────────
    const twoHoursStart = new Date(now.getTime() + 110 * 60 * 1000).toISOString()
    const twoHoursEnd   = new Date(now.getTime() + 130 * 60 * 1000).toISOString()

    const { data: upcoming2hShifts } = await supabase
      .from('shifts')
      .select('id, start_at, end_at, boat_id, notes, staff_id, staff(name, slack_member_id), boats(name)')
      .in('status', ['assigned', 'confirmed'])
      .gte('start_at', twoHoursStart)
      .lte('start_at', twoHoursEnd)

    let reminded2hCount = 0
    for (const shift of (upcoming2hShifts ?? [])) {
      if (!shift.staff_id) continue
      const notes = shift.notes || ''
      if (notes.includes('[reminder_2h_sent]')) continue

      const staffName = shift.staff?.name ?? 'Captain'
      const boatName  = shift.boats?.name ?? 'de boot'
      const msg = `⏰ *Dienst Reminder (over 2 uur)*:\n${staffName} staat ingepland op de *${boatName}* (${formatAmsterdamTime(shift.start_at)}–${formatAmsterdamTime(shift.end_at)}).`

      // Per instruction: all shift updates go to Beer
      await postSlackDM(msg)

      await supabase
        .from('shifts')
        .update({ notes: `${notes} [reminder_2h_sent]`.trim() })
        .eq('id', shift.id)
      reminded2hCount++
    }

    // ── 2. 5 MINUTES PRE-TOUR BRIEFING (SNACKS & DRINKS) ────────────────────
    const windowStart = new Date(now.getTime() + 3 * 60 * 1000).toISOString()
    const windowEnd   = new Date(now.getTime() + 11 * 60 * 1000).toISOString()

    const { data: shifts, error } = await supabase
      .from('shifts')
      .select('id, start_at, end_at, boat_id, staff_id, staff(name, slack_member_id), boats(name)')
      .in('status', ['assigned', 'confirmed'])
      .is('reminder_sent_at', null)
      .gte('start_at', windowStart)
      .lte('start_at', windowEnd)

    if (error) throw new Error(`query shifts: ${error.message}`)

    let briefed5mCount = 0
    for (const shift of (shifts ?? [])) {
      if (!shift.staff_id) continue
      const staffName = shift.staff?.name ?? 'Captain'
      const boatName  = shift.boats?.name ?? 'de boot'

      // Look up matching booking for this boat and shift time to retrieve snacks & drinks
      const shiftDate = amsterdamToday(0, new Date(shift.start_at))
      const { data: bookings } = await supabase
        .from('bookings')
        .select('tour_item_name, guest_count, customer_name, extras_selected')
        .eq('booking_date', shiftDate)
        .neq('status', 'cancelled')
        .order('start_time', { ascending: true })
        .limit(3)

      const booking = bookings?.[0]
      const tourName = booking?.tour_item_name || 'Vaart'
      const guestCount = booking?.guest_count ? `${booking.guest_count} gasten` : 'je gasten'

      const snacksAndDrinks: string[] = []
      if (Array.isArray(booking?.extras_selected)) {
        for (const item of (booking.extras_selected as any[])) {
          const name = item.name || item.title || item.label
          const qty = item.quantity ? `${item.quantity}x ` : ''
          if (name) snacksAndDrinks.push(`${qty}${name}`)
        }
      }

      let msg = `👋 Hey ${staffName}! Over 5 minuten vertrekt de *${tourName}* op *${boatName}* (${guestCount}).\n\n`
      if (snacksAndDrinks.length > 0) {
        msg += `🍿 *Let op:* deze tour heeft catering/drankjes aan boord:\n${snacksAndDrinks.map(s => `• ${s}`).join('\n')}\n\n`
      } else {
        msg += `🍿 *Catering:* Geen vooraf bestelde catering. Standaard bar aan boord (Zettle betalingen).\n\n`
      }
      msg += `✨ Veel plezier en succes op het water! ⛵️`

      const memberId = shift.staff?.slack_member_id
      if (memberId) {
        await postDm(memberId, msg, { type: 'pre-tour-briefing-dm', triggeredBy: 'schedule' })
      } else {
        await postToChannel(opsChannel, msg)
      }

      await supabase.from('shifts').update({ reminder_sent_at: now.toISOString() }).eq('id', shift.id)
      briefed5mCount++
    }

    return NextResponse.json({ ok: true, reminded2h: reminded2hCount, briefed5m: briefed5mCount })
  } catch (err) {
    await alertCronFailure('shift-reminder', err)
    return NextResponse.json({ error: 'Shift reminder failed' }, { status: 500 })
  }
}
