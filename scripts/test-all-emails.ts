/**
 * Sends one of every email type to a specified address for visual QA.
 * Usage: npx tsx scripts/test-all-emails.ts [email]
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createHmac } from 'crypto'

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
// Must run before any Next.js module is imported
loadEnv()

const TO = process.argv[2] ?? 'beerzoomers@hotmail.com'
const FROM = 'Off Course Amsterdam <cruise@offcourseamsterdam.com>'
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')
const BOOKING_ID = 'e8b449c7-16ba-4cc7-82ea-6267a5c48d99'

function generateToken(bookingId: string): string {
  const secret = process.env.EXTRAS_TOKEN_SECRET ?? process.env.REVALIDATION_SECRET ?? 'dev-fallback'
  return createHmac('sha256', secret).update(bookingId).digest('hex').slice(0, 32)
}

function formatPrice(priceType: string, priceValue: number): string {
  const euros = `€${(priceValue / 100).toFixed(0)}`
  if (priceType === 'per_person_cents') return `${euros} p.p.`
  if (priceType === 'per_person_per_hour_cents') return `${euros} p.p./hr`
  return euros
}

async function main() {
  // Dynamic imports so env is loaded first
  const { Resend } = await import('resend')
  const { createClient } = await import('@supabase/supabase-js')
  const { sendConfirmationEmail, sendRescheduleEmail } = await import('../src/lib/booking/send-confirmation-email')
  const { paymentLinkEmailHtml } = await import('../src/emails/PaymentLinkEmail')
  const { paymentReminderEmailHtml } = await import('../src/emails/PaymentReminderEmail')
  const { partnerInviteEmailHtml } = await import('../src/emails/PartnerInviteEmail')
  const { periodicSummaryHtml } = await import('../src/emails/PeriodicSummary')
  const { extrasUpsellEmailHtml } = await import('../src/emails/ExtrasUpsellEmail')

  const resend = new Resend(process.env.RESEND_API_KEY!)

  async function send(label: string, subject: string, html: string) {
    const r = await resend.emails.send({ from: FROM, to: TO, subject, html })
    if (r.error) { console.error(`❌ ${label}:`, r.error); return }
    console.log(`✅ ${label}`)
  }

  console.log(`Sending all email types to ${TO}…\n`)

  // ── 1. Booking confirmation ──────────────────────────────────────────────────
  await sendConfirmationEmail({
    contact: { name: 'Beer Zoomer', email: TO },
    listingTitle: 'Private Hidden Gems Cruise',
    departureLocation: 'Brouwersgracht 29, Amsterdam',
    date: 'Wednesday, 11 June 2026',
    startAt: '2026-06-11T13:30:00.000Z',
    endAt: '2026-06-11T15:30:00.000Z',
    guestCount: 6,
    amountCents: 29500,
    extrasSelected: [
      { name: 'Charcuterie Platter', amount_cents: 4400, quantity: 4, is_per_person_pick: true },
    ],
    fhBookingUuid: 'FH-DEMO-12345',
    category: 'private',
    fareharborCustomerTypeRatePk: null,
  })
  console.log('✅ Booking confirmation')

  // ── 2. Reschedule ────────────────────────────────────────────────────────────
  await sendRescheduleEmail({
    contact: { name: 'Beer Zoomer', email: TO },
    listingTitle: 'Private Hidden Gems Cruise',
    newDate: 'Thursday, 18 June 2026',
    newStartAt: '2026-06-18T15:00:00.000Z',
    newEndAt: '2026-06-18T17:00:00.000Z',
    guestCount: 6,
    amountCents: 29500,
    fhBookingUuid: 'FH-DEMO-12345',
    category: 'private',
    fareharborCustomerTypeRatePk: null,
  })
  console.log('✅ Reschedule')

  // ── 3. Payment link ──────────────────────────────────────────────────────────
  await send(
    'Payment link',
    'your spot is waiting — complete your payment',
    paymentLinkEmailHtml({
      customerName: 'Beer Zoomer',
      listingTitle: 'Private Hidden Gems Cruise',
      bookingDate: 'Wednesday, 11 June 2026',
      startTime: '3:30 PM',
      guestCount: 6,
      amountCents: 29500,
      paymentUrl: 'https://offcourseamsterdam.com',
    }),
  )

  // ── 4. Payment reminder ──────────────────────────────────────────────────────
  await send(
    'Payment reminder',
    '⏰ 6 hours left to pay — private hidden gems cruise',
    paymentReminderEmailHtml({
      customerName: 'Beer Zoomer',
      listingTitle: 'Private Hidden Gems Cruise',
      bookingDate: 'Wednesday, 11 June 2026',
      startTime: '3:30 PM',
      guestCount: 6,
      amountCents: 29500,
      paymentUrl: 'https://offcourseamsterdam.com',
    }),
  )

  // ── 5. Partner invite ────────────────────────────────────────────────────────
  await send(
    'Partner invite',
    "you're in — access your Off Course partner portal",
    partnerInviteEmailHtml({
      partnerName: 'Amsterdam City Tours',
      inviteUrl: 'https://offcourseamsterdam.com',
    }),
  )

  // ── 6. Periodic summary (weekly) ─────────────────────────────────────────────
  await send(
    'Periodic summary',
    'your performance summary — week of jun 1–7',
    periodicSummaryHtml({
      recipientName: 'Beer',
      periodLabel: 'Week of Jun 1–7, 2026',
      totalBookings: 12,
      totalRevenueCents: 295000,
      totalCommissionCents: 29500,
      campaigns: [
        { name: 'Amsterdam Influencer Pack', bookings: 7, revenueCents: 172000, commissionCents: 17200, commissionRate: '10%' },
        { name: 'Hotel Droog Partnership', bookings: 5, revenueCents: 123000, commissionCents: 12300, commissionRate: '10%' },
      ],
    }),
  )

  // ── 7. Extras upsell (fetches real extras from Supabase) ─────────────────────
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const [{ data: featuredExtras }, { count: totalExtras }] = await Promise.all([
      supabase.from('extras').select('name, description, image_url, price_type, price_value')
        .eq('is_active', true).in('category', ['food', 'drinks'])
        .not('image_url', 'is', null).order('sort_order', { ascending: true }).limit(4),
      supabase.from('extras').select('*', { count: 'exact', head: true })
        .eq('is_active', true).in('category', ['food', 'drinks']),
    ])

    const token = generateToken(BOOKING_ID)
    const extrasPageUrl = `${SITE}/en/extras/${BOOKING_ID}/${token}`

    await send(
      'Extras upsell',
      'your cruise is in 2 days 🛥️ — want to add food or drinks?',
      extrasUpsellEmailHtml({
        customerName: 'Beer Zoomer',
        listingTitle: 'Private Hidden Gems Cruise',
        bookingDate: 'Wednesday, 11 June 2026',
        startTime: '3:30 PM',
        guestCount: 6,
        extrasPageUrl,
        featuredExtras: (featuredExtras ?? []).map(e => ({
          name: e.name,
          description: e.description,
          image_url: e.image_url,
          price_display: formatPrice(e.price_type ?? '', e.price_value ?? 0),
        })),
        totalExtras: totalExtras ?? undefined,
        siteUrl: SITE,
      }),
    )
  } catch (err) {
    console.error('❌ Extras upsell:', err)
  }

  console.log(`\nAll done — check ${TO} 📬`)
}

main().catch(err => { console.error(err); process.exit(1) })
