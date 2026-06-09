/**
 * Test script: sends an extras upsell email to a specified address.
 * Usage: npx tsx scripts/test-extras-email.ts [email] [bookingId]
 *
 * Defaults: beerzoomers@hotmail.com + the June 11 test booking
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
      if (!(key in process.env)) process.env[key] = val
    }
  } catch { /* rely on existing env */ }
}
loadEnv()

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { createHmac } from 'crypto'
import { extrasUpsellEmailHtml } from '../src/emails/ExtrasUpsellEmail'

const TO_EMAIL = process.argv[2] ?? 'beerzoomers@hotmail.com'
const BOOKING_ID = process.argv[3] ?? 'e8b449c7-16ba-4comp7-82ea-6267a5c48d99'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

function generateToken(bookingId: string): string {
  const secret =
    process.env.EXTRAS_TOKEN_SECRET ??
    process.env.REVALIDATION_SECRET ??
    'dev-fallback'
  return createHmac('sha256', secret).update(bookingId).digest('hex').slice(0, 32)
}

function formatPriceDisplay(priceType: string, priceValue: number): string {
  const euros = `€${(priceValue / 100).toFixed(0)}`
  switch (priceType) {
    case 'per_person_cents': return `${euros} p.p.`
    case 'per_person_per_hour_cents': return `${euros} p.p./hr`
    default: return euros
  }
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const BOOKING_ID_REAL = 'e8b449c7-16ba-4cc7-82ea-6267a5c48d99'

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, customer_name, listing_title, booking_date, start_time, guest_count')
    .eq('id', BOOKING_ID_REAL)
    .maybeSingle()

  if (error || !booking) {
    console.error('Booking not found:', error)
    process.exit(1)
  }

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
    price_display: formatPriceDisplay(e.price_type ?? '', e.price_value ?? 0),
  }))

  const token = generateToken(BOOKING_ID_REAL)
  const extrasPageUrl = `${SITE_URL}/en/extras/${BOOKING_ID_REAL}/${token}`

  const bookingDate = new Date((booking.booking_date ?? '') + 'T12:00:00')
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Amsterdam' })

  let startTimeStr = ''
  if (booking.start_time) {
    const t = new Date(booking.start_time)
    startTimeStr = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
  }

  const html = extrasUpsellEmailHtml({
    customerName: booking.customer_name ?? 'there',
    listingTitle: booking.listing_title ?? 'your canal cruise',
    bookingDate,
    startTime: startTimeStr,
    guestCount: booking.guest_count ?? 2,
    extrasPageUrl,
    featuredExtras: emailExtras,
    totalExtras: totalExtras ?? undefined,
    siteUrl: SITE_URL,
  })

  const resend = new Resend(process.env.RESEND_API_KEY!)
  const result = await resend.emails.send({
    from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
    to: TO_EMAIL,
    subject: `your cruise is in 2 days 🛥️ — want to add food or drinks?`,
    html,
  })

  if (result.error) {
    console.error('Resend error:', result.error)
    process.exit(1)
  }

  console.log(`✅ Email sent to ${TO_EMAIL}`)
  console.log(`   Booking: ${booking.listing_title} — ${bookingDate}`)
  console.log(`   Extras page: ${extrasPageUrl}`)
  console.log(`   Resend ID: ${result.data?.id}`)
}

main().catch(err => { console.error(err); process.exit(1) })
