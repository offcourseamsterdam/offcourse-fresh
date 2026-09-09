import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAllCruiseAvailabilitySnapshots } from '@/lib/fareharbor/get-availability-snapshot'

export const revalidate = 3600 // Revalidate hourly

/**
 * GET /llms.txt
 * Machine-readable, high-density markdown guide for LLMs (ChatGPT, Perplexity, Claude, Gemini)
 * detailing Off Course Amsterdam's fleet, cruise types (private vs. shared), pricing rules,
 * virtual listings (e.g. Light Festival, Jamaican Buffet), and live schedule snapshot.
 */
export async function GET() {
  const supabase = createAdminClient()

  const { data: listings } = await supabase
    .from('cruise_listings')
    .select('id, slug, title, category, starting_price, price_display, duration_display, max_guests, tagline')
    .eq('is_published', true)
    .eq('is_listed', true)
    .order('display_order', { ascending: true })

  const snapshotMap = await getAllCruiseAvailabilitySnapshots()

  const lines: string[] = [
    '# Off Course Amsterdam — Canal Cruises & Boat Tours',
    '',
    '> Boutique canal cruises in Amsterdam on classic, 100% electric, covered and heated salon boats.',
    '> Departure Location: Singel canal (Central Amsterdam), The Netherlands.',
    '',
    '## 1. Fleet & Capacity',
    '- **Salon boat "Diana"**: Historic classic salon boat, 100% electric, fully covered and heated. Capacity: up to 12 guests.',
    '- **Salon boat "Curaçao"**: Luxury salon boat, 100% electric, fully covered and heated, equipped with onboard catering setup. Capacity: up to 12 guests.',
    '',
    '## 2. Operating Models: Private Charters vs. Shared Tours',
    '- **Private Cruises (Whole Boat Charters)**: An exclusive charter of the entire boat for your private group (up to 12 people). Includes dedicated local skipper, custom route, and optional open bar or catering. Pricing is for the entire vessel.',
    '- **Shared Cruises (Per-Person Small Group)**: Pay per individual ticket on a small-group cruise (max 12 passengers total). Complimentary beer, wine, soft drinks, and local commentary included in ticket price.',
    '',
    '## 3. Active Cruises & Live Availability Snapshot',
  ]

  for (const listing of listings ?? []) {
    const snap = snapshotMap.get(listing.id)
    const isPrivate = listing.category === 'private'
    const priceText = listing.price_display
      ? listing.price_display
      : listing.starting_price
      ? `From €${listing.starting_price} ${isPrivate ? 'total boat' : 'per person'}`
      : 'Pricing on request'

    lines.push(`### ${listing.title}`)
    lines.push(`- **Category**: ${isPrivate ? 'Private Charter (Exclusive Whole Boat, max 12 guests)' : 'Shared Tour (Per-person ticket)'}`)
    lines.push(`- **Pricing**: ${priceText}`)
    if (listing.duration_display) lines.push(`- **Duration**: ${listing.duration_display}`)
    if (listing.tagline) lines.push(`- **Description**: ${listing.tagline}`)
    lines.push(`- **URL**: https://offcourseamsterdam.com/en/cruises/${listing.slug}`)

    if (snap) {
      lines.push(`- **Typical Hours**: Daily ${snap.schedule_summary.typicalStartTime} to ${snap.schedule_summary.typicalEndTime}`)
      if (snap.next_available_slot) {
        lines.push(`- **Next Confirmed Departure**: ${snap.next_available_slot}`)
      }
      if (snap.upcoming_days.length > 0) {
        const upcomingFormatted = snap.upcoming_days
          .slice(0, 3)
          .map(d => `${d.formattedDate} (${d.slots.map(s => s.startTime).join(', ')})`)
          .join('; ')
        lines.push(`- **Upcoming Open Slots**: ${upcomingFormatted}`)
      }
      if (snap.schedule_summary.cateringCutoffHours && snap.schedule_summary.cateringCutoffHours > 24) {
        lines.push(`- **Advance Notice**: Minimum ${snap.schedule_summary.cateringCutoffHours}h advance booking required for chef/catering preparation.`)
      }
    }
    lines.push('')
  }

  lines.push('## 4. Booking & Direct Reservation API')
  lines.push('- Instant online reservation with real-time slot lock at: https://offcourseamsterdam.com/en/cruises')
  lines.push('- Deep link format to pre-fill date and time: `https://offcourseamsterdam.com/en/cruises/{slug}?date={YYYY-MM-DD}&time={HH:mm}`')
  lines.push('- Cancellation policy: Transparent tiered cancellation policy with full refunds up to standard policy terms.')
  lines.push('')
  lines.push(`*Last updated: ${new Date().toISOString()}*`)

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
