import { createAdminClient } from '@/lib/supabase/admin'
import { fetchSearchResults } from '@/lib/search/fetch-search-results'
import { amsterdamToday } from '@/lib/utils'
import { checkBookingViability } from './dry-run'
import type { AgentTool } from './agent-runtime'

/**
 * The Ghost's toolbox — read-only views of the truth, shaped for agents.
 *
 * Tool design follows Anthropic's guidance: few consolidated tools,
 * descriptions that say WHEN to call them, compact human-readable results
 * (an agent reading 40 raw DB rows burns context for nothing).
 * Every tool reads; NONE writes. The only write an agent can make is its
 * final proposal, and that happens in the caller after the loop ends.
 */

const DATE_SCHEMA = {
  type: 'string',
  description: 'Date in YYYY-MM-DD format (Amsterdam time)',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
} as const

/** Compact a search result for the agent: listings with real slots only. */
export function compactAvailability(
  results: {
    listing: { slug: string; title: string; category: string | null; price_display?: string | null }
    availableSlots: {
      startTime: string
      customerTypes?: { name: string; priceCents: number; durationMinutes: number }[]
    }[]
  }[],
): unknown {
  const withSlots = results.filter(r => r.availableSlots.length > 0)
  if (!withSlots.length) return { available: false, note: 'Nothing available that day for that group size.' }
  return {
    available: true,
    listings: withSlots.map(r => ({
      listing: r.listing.title,
      slug: r.listing.slug,
      category: r.listing.category,
      price: r.listing.price_display ?? undefined,
      times: r.availableSlots.slice(0, 8).map(s => s.startTime),
      options: r.availableSlots[0]?.customerTypes?.slice(0, 4).map(ct => ({
        name: ct.name,
        price_eur: Math.round(ct.priceCents / 100),
        duration_min: ct.durationMinutes,
      })),
    })),
  }
}

export function buildGhostTools(): AgentTool[] {
  return [
    {
      name: 'search_availability',
      description:
        'Check REAL FareHarbor availability for a date and group size — every published cruise with its open departure times and prices. Call this whenever a customer mentions a date, wants to book, rebook or asks "is X free". Do not guess availability; this is the only source of truth.',
      input_schema: {
        type: 'object',
        properties: {
          date: DATE_SCHEMA,
          guests: { type: 'number', description: 'Party size, 1-12' },
        },
        required: ['date', 'guests'],
      },
      run: async input => {
        const date = String(input.date ?? '')
        const guests = Math.min(12, Math.max(1, Number(input.guests ?? 2)))
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Date must be YYYY-MM-DD; you sent '${date}'`)
        const results = await fetchSearchResults(date, guests)
        return compactAvailability(results)
      },
    },
    {
      name: 'get_customer_bookings',
      description:
        "Look up a customer's booking history by email — dates, cruises, party sizes, status, catering extras. Call when you need to know if/what they booked (rescheduling, 'my booking', repeat guests).",
      input_schema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: "The customer's email address" },
        },
        required: ['email'],
      },
      run: async input => {
        const email = String(input.email ?? '').trim()
        if (!email) throw new Error('email is required')
        const supabase = createAdminClient()
        const { data } = await supabase
          .from('bookings')
          .select('booking_date, start_time, status, guest_count, listing_title, category, extras_selected')
          .eq('customer_email', email)
          .order('booking_date', { ascending: false })
          .limit(5)
        if (!data?.length) return { bookings: [], note: 'No bookings found for this email.' }
        return {
          bookings: data.map(b => ({
            date: b.booking_date,
            time: b.start_time,
            cruise: b.listing_title,
            guests: b.guest_count,
            status: b.status,
            extras: Array.isArray(b.extras_selected)
              ? (b.extras_selected as { name?: string }[]).map(e => e.name).filter(Boolean)
              : [],
          })),
        }
      },
    },
    {
      name: 'get_schedule',
      description:
        'See the shift schedule for a date range: every shift (boat, time, status, assigned captain) plus each captain\'s stated availability. Call when reasoning about who works when, open shifts, or whether a captain is free.',
      input_schema: {
        type: 'object',
        properties: {
          from: DATE_SCHEMA,
          to: DATE_SCHEMA,
        },
        required: ['from', 'to'],
      },
      run: async input => {
        const from = String(input.from ?? amsterdamToday())
        const to = String(input.to ?? from)
        const supabase = createAdminClient()
        const [shifts, staff, availability] = await Promise.all([
          supabase
            .from('shifts')
            .select('id, date, start_at, end_at, status, staff(name), boats(name), bookings(listing_title, guest_count)')
            .gte('date', from)
            .lte('date', to)
            .order('start_at'),
          supabase.from('staff').select('id, name, role, max_shifts_per_week').eq('is_active', true),
          supabase.from('staff_availability').select('staff_id, date, status, note').gte('date', from).lte('date', to),
        ])
        return {
          shifts: (shifts.data ?? []).map(s => ({
            id: s.id,
            date: s.date,
            boat: (s.boats as { name?: string } | null)?.name,
            status: s.status,
            captain: (s.staff as { name?: string } | null)?.name ?? null,
            cruise: (s.bookings as { listing_title?: string | null } | null)?.listing_title ?? null,
          })),
          staff: staff.data ?? [],
          availability: availability.data ?? [],
        }
      },
    },
    {
      name: 'check_booking',
      description:
        'Before you PROPOSE or PROMISE a specific booking, call this to confirm FareHarbor would actually accept it. Pass the exact slug, date, time, guests, and boat+duration option (from search_availability). Returns { bookable: true, price_eur } or { bookable: false, reason } (sold out, party too small/large, slot gone, ambiguous option). Never promise a booking you have not checked here — if it comes back not bookable, explain why and offer an alternative instead.',
      input_schema: {
        type: 'object',
        properties: {
          listing_slug: { type: 'string' },
          date: DATE_SCHEMA,
          time: { type: 'string', description: 'Departure time exactly as shown by search_availability, e.g. 5pm' },
          guests: { type: 'number', description: 'Party size' },
          option: { type: 'string', description: 'Boat + duration, e.g. "Diana - 2 Hours"' },
        },
        required: ['listing_slug', 'date', 'time', 'guests'],
      },
      run: async input => {
        const verdict = await checkBookingViability({
          listing_slug: String(input.listing_slug ?? ''),
          date: String(input.date ?? ''),
          time: String(input.time ?? ''),
          guests: Number(input.guests ?? 2),
          option: input.option ? String(input.option) : undefined,
        })
        return verdict.is_bookable
          ? { bookable: true, price_eur: verdict.receipt_total_eur }
          : { bookable: false, reason: verdict.error ?? verdict.code ?? 'not bookable' }
      },
    },
  ]
}
