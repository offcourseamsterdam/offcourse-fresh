import { createAdminClient } from '@/lib/supabase/admin'
import { fetchSearchResults } from '@/lib/search/fetch-search-results'
import { amsterdamToday, fmtEuros } from '@/lib/utils'
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

/** Human-readable price for an extra, from its price_type + cents value. */
export function extraPriceLabel(priceType: string, priceValue: number): string {
  switch (priceType) {
    case 'fixed_cents':
      return fmtEuros(priceValue)
    case 'per_person_cents':
      return `${fmtEuros(priceValue)} per person`
    case 'per_person_per_hour_cents':
      return `${fmtEuros(priceValue)} per person per hour`
    case 'percentage':
      return `${priceValue}%`
    default:
      return '' // informational — no fixed price
  }
}

/** Compact the food/drinks menu for the agent: name, price, short description. */
export function compactExtras(
  extras: {
    name: string
    description?: string | null
    category: string
    price_type: string
    price_value: number
    min_people?: number | null
  }[],
): unknown {
  if (!extras.length) return { menu: [], note: 'No food or drinks extras available for this cruise.' }
  return {
    menu: extras.map(e => ({
      name: e.name,
      category: e.category,
      ...(extraPriceLabel(e.price_type, e.price_value) ? { price: extraPriceLabel(e.price_type, e.price_value) } : {}),
      ...(e.description ? { about: e.description.slice(0, 120) } : {}),
      ...(e.min_people ? { for_at_least: e.min_people } : {}),
    })),
    note: 'Customers choose these at checkout on the booking page (or pre-order from their confirmation). No payment is taken until the day.',
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
        'Before you PROPOSE or PROMISE a specific booking, call this to confirm FareHarbor would actually accept it. Pass the exact slug, date, time, guests, and boat+duration option (from search_availability). Returns { bookable: true, price_eur }, or when NOT bookable { bookable: false, reason } PLUS up to 3 already-validated `alternatives` (each { date, time, option, price_eur, kind }, kind = same_day_earlier | same_day_later | other_boat | other_day), nearest-and-best first. Never promise a slot you have not checked here. If it comes back not bookable, do NOT invent options: offer these alternatives in your reply, or re-propose onto alternatives[0] when the customer clearly wants the nearest fit.',
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
        const verdict = await checkBookingViability(
          {
            listing_slug: String(input.listing_slug ?? ''),
            date: String(input.date ?? ''),
            time: String(input.time ?? ''),
            guests: Number(input.guests ?? 2),
            option: input.option ? String(input.option) : undefined,
          },
          { withAlternatives: true },
        )
        if (verdict.is_bookable) return { bookable: true, price_eur: verdict.receipt_total_eur }
        return {
          bookable: false,
          reason: verdict.error ?? verdict.code ?? 'not bookable',
          // Already validated + ranked; the agent offers these instead of guessing.
          ...(verdict.alternatives?.length
            ? {
                alternatives: verdict.alternatives.map(a => ({
                  date: a.date,
                  time: a.time,
                  option: a.option,
                  price_eur: a.price_eur,
                  kind: a.kind,
                })),
              }
            : {}),
        }
      },
    },
    {
      name: 'list_extras',
      description:
        "List the food & drinks a cruise offers — bites boxes, drinks packages, platters — with real prices. Call when a customer asks what snacks/food/drinks/catering are available or what they can add. Returns a menu. Tell them these are chosen at checkout on the booking page (no payment until the day); never invent items or prices.",
      input_schema: {
        type: 'object',
        properties: {
          listing_slug: { type: 'string', description: 'The cruise slug from search_availability' },
        },
        required: ['listing_slug'],
      },
      run: async input => {
        const slug = String(input.listing_slug ?? '').trim()
        if (!slug) throw new Error('listing_slug is required')
        const supabase = createAdminClient()

        const { data: listing } = await supabase
          .from('cruise_listings')
          .select('id, category')
          .eq('slug', slug)
          .maybeSingle()
        if (!listing) return { menu: [], note: `No cruise found for '${slug}'.` }

        // Food + drinks only ("the menu"), mirroring the public extras upsell filter.
        const { data: extras } = await supabase
          .from('extras')
          .select('id, name, description, category, price_type, price_value, min_people, applicable_categories, scope')
          .eq('is_active', true)
          .in('category', ['food', 'drinks'])
          .order('sort_order', { ascending: true })

        const { data: listingExtraIds } = await supabase
          .from('listing_extras')
          .select('extra_id')
          .eq('listing_id', listing.id)
          .eq('is_enabled', true)
        const perListing = new Set((listingExtraIds ?? []).map(r => r.extra_id))

        const available = (extras ?? []).filter(e => {
          if (e.scope === 'per_listing') return perListing.has(e.id)
          // global: no applicable_categories = all; otherwise must match this listing.
          const cats = e.applicable_categories as string[] | null
          return !cats || cats.includes(listing.category ?? '') || cats.includes('private')
        })
        return compactExtras(available)
      },
    },
  ]
}
