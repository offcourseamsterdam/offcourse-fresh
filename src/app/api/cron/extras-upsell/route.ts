import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { extrasPageUrl } from '@/lib/booking/extras-token'
import { extrasUpsellEmailHtml } from '@/emails/ExtrasUpsellEmail'
import { filterCateringItems } from '@/lib/catering/filter'
import type { ExtrasLineItem } from '@/lib/catering/filter'
import { formatAmsterdamTime } from '@/lib/utils'
import { alertCronFailure } from '@/lib/cron/alert'

/**
 * GET /api/cron/extras-upsell
 * Vercel Cron: runs daily at 10:00 Amsterdam time (08:00 UTC).
 *
 * Finds private bookings whose cruise is exactly 2 days from now and that
 * have no food or drinks extras booked. Sends a visual upsell email with a
 * unique per-booking link where the guest can pre-order catering.
 *
 * Skips bookings where extras_upsell_sent_at is already set (no double-sends).
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  const supabase = createAdminClient()
  const resend = new Resend(process.env.RESEND_API_KEY!)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

  // Target date = 2 days from now in Amsterdam timezone
  const now = new Date()
  const target = new Date(now)
  target.setDate(target.getDate() + 2)
  const targetDate = target.toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' }) // YYYY-MM-DD

  // Fetch eligible private bookings
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_email, listing_title, listing_id, booking_date, start_time, guest_count, extras_selected')
    .eq('booking_date', targetDate)
    .eq('category', 'private')
    .in('status', ['confirmed', 'booked'])
    .is('extras_upsell_sent_at', null)

  if (error) {
    await alertCronFailure('extras-upsell', error, 'DB query for eligible bookings failed')
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  // Filter to only those without food/drinks already booked
  const eligible = (bookings ?? []).filter(b => {
    const extras = (b.extras_selected ?? []) as unknown as ExtrasLineItem[]
    return filterCateringItems(extras).length === 0
  })

  if (eligible.length === 0) {
    return NextResponse.json({ sent: 0, reason: 'No eligible bookings' })
  }

  // Fetch featured extras (first 4 with images) + total count for email copy
  const [{ data: featuredExtras }, { count: totalExtras }] = await Promise.all([
    supabase
      .from('extras')
      .select('name, description, image_url, price_type, price_value')
      .eq('is_active', true)
      .in('category', ['food', 'drinks'])
      .not('image_url', 'is', null)
      .order('sort_order', { ascending: true })
      .limit(4),
    supabase
      .from('extras')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .in('category', ['food', 'drinks']),
  ])

  const emailExtras = (featuredExtras ?? []).map(e => ({
    name: e.name,
    description: e.description,
    image_url: e.image_url,
    price_display: formatPriceDisplay(e.price_type, e.price_value),
  }))

  let sent = 0
  const failed: string[] = []

  for (const booking of eligible) {
    if (!booking.customer_email) continue

    const pageUrl = extrasPageUrl(booking.id, siteUrl)

    const bookingDateStr = new Date(booking.booking_date + 'T12:00:00')
      .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Amsterdam' })

    const startTimeStr = booking.start_time
      ? formatAmsterdamTime(booking.start_time)
      : ''

    const html = extrasUpsellEmailHtml({
      customerName: booking.customer_name ?? 'there',
      listingTitle: booking.listing_title ?? 'your canal cruise',
      bookingDate: bookingDateStr,
      startTime: startTimeStr,
      guestCount: booking.guest_count ?? 2,
      extrasPageUrl: pageUrl,
      featuredExtras: emailExtras,
      totalExtras: totalExtras ?? undefined,
      siteUrl,
    })

    try {
      await resend.emails.send({
        from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
        to: booking.customer_email,
        subject: `Your cruise is in 2 days 🛥️ — want to add food or drinks?`,
        html,
      })

      await supabase
        .from('bookings')
        .update({ extras_upsell_sent_at: new Date().toISOString() })
        .eq('id', booking.id)

      sent++
    } catch (err) {
      await alertCronFailure('extras-upsell', err, `booking ${booking.id}`)
      failed.push(booking.id)
    }
  }

  console.log(`[cron/extras-upsell] Sent ${sent}/${eligible.length} upsell emails`)
  return NextResponse.json({ sent, failed: failed.length > 0 ? failed : undefined })
}

function formatPriceDisplay(priceType: string, priceValue: number): string {
  const euros = `€${(priceValue / 100).toFixed(0)}`
  switch (priceType) {
    case 'per_person_cents': return `${euros} p.p.`
    case 'per_person_per_hour_cents': return `${euros} p.p./hr`
    case 'fixed_cents': return euros
    default: return euros
  }
}
