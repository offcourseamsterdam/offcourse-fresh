import { createAdminClient } from '@/lib/supabase/admin'
import { escapeLikePattern } from '@/lib/supabase/escape-like'
import { fetchSearchResults } from '@/lib/search/fetch-search-results'
import { amsterdamToday, fmtEuros } from '@/lib/utils'
import { checkBookingViability } from './dry-run'
import { computeCancellationTerms } from './cancellation-terms'
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

/**
 * The ALTERNATIVE dates check_shared_cruise_to_join offers: the 3 days
 * AFTER centerDate — never centerDate itself (that's what search_availability
 * already checked) and never a day before it (Beer, 2026-08-21: "check for
 * hte 3 days that come after the requested date"). Never a day that's
 * already passed, though with a forward-only window that only matters if
 * centerDate itself is in the past.
 */
export function nearbyDates(centerDate: string, today: string): string[] {
  // Date.UTC (not `new Date(centerDate + 'T00:00:00')`, which parses as LOCAL
  // midnight) — on a machine east of UTC, local midnight is the previous UTC
  // day, so toISOString() would silently shift every date back by one.
  const [y, m, d] = centerDate.split('-').map(Number)
  const centerUtcMs = Date.UTC(y, m - 1, d)
  return [1, 2, 3]
    .map(offset => new Date(centerUtcMs + offset * 86_400_000).toISOString().slice(0, 10))
    .filter(date => date >= today)
}

/**
 * Shared-category listings/slots with room for `guests` more people AND at
 * least one existing confirmed booking on that exact departure — a guest
 * joins a trip that's already happening, not an empty slot with no
 * guarantee it'll actually run (Beer, 2026-08-21: "look for a cruise that
 * he/she can join, which means an existing shared cruise should already
 * exist"). Matched by listing id + departure time as real timestamps (not
 * string equality) since search results carry FareHarbor's own ISO string
 * while `bookings.start_time` is stamped by our own conversion — same
 * instant, not necessarily the same literal string.
 */
export function sharedListingsAlreadyBooked(
  results: {
    listing: { id: string; title: string; slug: string; category: string | null; price_display?: string | null }
    availableSlots: { startTime: string; startAt: string }[]
  }[],
  existingBookings: { listing_id: string | null; start_time: string | null }[],
): { listing: string; slug: string; price?: string; times: string[] }[] {
  const bookedKeys = new Set(
    existingBookings
      .filter((b): b is { listing_id: string; start_time: string } => !!b.listing_id && !!b.start_time)
      .map(b => `${b.listing_id}|${new Date(b.start_time).getTime()}`),
  )
  return results
    .filter(r => r.listing.category === 'shared')
    .map(r => ({
      listing: r.listing,
      slots: r.availableSlots.filter(s => bookedKeys.has(`${r.listing.id}|${new Date(s.startAt).getTime()}`)),
    }))
    .filter(r => r.slots.length > 0)
    .map(r => ({
      listing: r.listing.title,
      slug: r.listing.slug,
      price: r.listing.price_display ?? undefined,
      times: r.slots.slice(0, 6).map(s => s.startTime),
    }))
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
      name: 'check_shared_cruise_to_join',
      description:
        "THE tool for a solo traveller or small party who wants a SHARED cruise. Answers the only question that matters for them: is there a shared cruise ALREADY carrying other booked guests that they can join? A shared slot with every seat still free means nobody has booked it — that boat is not actually sailing, so we cannot take a single guest on it, no matter what search_availability says is 'available'. NEVER use search_availability alone to tell a solo guest a shared cruise is running — it only reports bookable seats, not whether the trip exists. This tool checks their requested date AND the 3 days after it, and reports each one as joinable or not. Only offer dates it actually returns as joinable.",
      input_schema: {
        type: 'object',
        properties: {
          date: DATE_SCHEMA,
          guests: { type: 'number', description: 'Party size, 1-12 (usually 1 for this tool)' },
        },
        required: ['date', 'guests'],
      },
      run: async input => {
        const requestedDate = String(input.date ?? '')
        if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) throw new Error(`Date must be YYYY-MM-DD; you sent '${requestedDate}'`)
        const guests = Math.min(12, Math.max(1, Number(input.guests ?? 1)))
        const supabase = createAdminClient()

        // The requested date is evaluated by the SAME already-booked rule as
        // the alternatives — the whole point is that "seats are free" is not
        // the same as "the cruise is running". Without judging the requested
        // date here too, the model falls back on search_availability's
        // bookable-seat count and tells a solo guest a cruise is "going out"
        // when in fact nobody has booked it (real failure, Jacob, 2026-08-21).
        const joinableOn = async (date: string) => {
          const [results, { data: existingBookings }] = await Promise.all([
            fetchSearchResults(date, guests),
            supabase.from('bookings').select('listing_id, start_time').eq('booking_date', date).eq('category', 'shared').eq('status', 'confirmed'),
          ])
          return sharedListingsAlreadyBooked(results, existingBookings ?? [])
        }

        const [requestedListings, alternativeDays] = await Promise.all([
          joinableOn(requestedDate),
          Promise.all(
            nearbyDates(requestedDate, amsterdamToday()).map(async date => ({ date, listings: await joinableOn(date) })),
          ),
        ])
        const alternatives = alternativeDays.filter(d => d.listings.length > 0)

        return {
          requested_date: {
            date: requestedDate,
            joinable: requestedListings.length > 0,
            listings: requestedListings,
            ...(requestedListings.length === 0 && {
              why_not: 'No shared cruise on this date has any other guests booked yet, so there is no trip to join — we cannot sail it for a single booking.',
            }),
          },
          alternatives,
          ...(alternatives.length === 0 && {
            note: `No shared cruise in the 3 days after ${requestedDate} has other guests booked either.`,
          }),
        }
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
          .select('id, booking_date, start_time, status, guest_count, listing_title, category, extras_selected')
          .eq('customer_email', email)
          .order('booking_date', { ascending: false })
          .limit(5)
        if (!data?.length) return { bookings: [], note: 'No bookings found for this email.' }
        return {
          bookings: data.map(b => ({
            // The id a cancellation/correction action would target — carried
            // through so a later tool call never has to re-search for it.
            booking_id: b.id,
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
      name: 'search_bookings_by_details',
      description:
        'Find a booking by name/date/boat when the customer says "I already booked" but get_customer_bookings found nothing — this happens when their contact email does not match what is stored on the actual booking (a typo, a different address). Use whatever details the customer gave: name, approximate date, boat. Returns up to 5 candidates ranked newest-first, each including the email actually on file for that booking — compare it against what the customer told you. If more than one plausible match comes back, or the name match is weak, do NOT assume which one is right — ask the customer to confirm rather than guessing on someone else\'s paid booking.',
      input_schema: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: "The name the customer gave you in the conversation (not necessarily their contact record's name)" },
          date: { ...DATE_SCHEMA, description: 'Date in YYYY-MM-DD format, if the customer gave one' },
          boat: { type: 'string', description: 'Boat name if mentioned, e.g. "Diana" or "Curaçao"' },
        },
        required: ['customer_name'],
      },
      run: async input => {
        const name = String(input.customer_name ?? '').trim()
        if (!name) throw new Error('customer_name is required')
        const supabase = createAdminClient()
        let query = supabase
          .from('bookings')
          .select('id, customer_name, customer_email, booking_date, start_time, listing_title, guest_count, status')
          .ilike('customer_name', `%${escapeLikePattern(name)}%`)
          .order('booking_date', { ascending: false })
          .limit(5)
        if (input.date) query = query.eq('booking_date', String(input.date))
        if (input.boat) query = query.ilike('listing_title', `%${escapeLikePattern(String(input.boat))}%`)
        const { data } = await query
        if (!data?.length) return { bookings: [], note: 'No bookings found matching those details.' }
        return {
          bookings: data.map(b => ({
            booking_id: b.id,
            name_on_booking: b.customer_name,
            email_on_booking: b.customer_email,
            date: b.booking_date,
            time: b.start_time,
            cruise: b.listing_title,
            guests: b.guest_count,
            status: b.status,
          })),
        }
      },
    },
    {
      name: 'get_schedule',
      description:
        'See the shift schedule for a date range: every shift (boat, time, status, assigned captain) plus each captain\'s stated availability. Availability rows may carry start_time/end_time ("partly available") — null on both means all day; if end_time is not after start_time, the window crosses midnight (e.g. 22:00-00:30). Call when reasoning about who works when, open shifts, or whether a captain is free.',
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
          supabase.from('staff_availability').select('staff_id, date, status, note, start_time, end_time').gte('date', from).lte('date', to),
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
          // start_time/end_time (partly available, Beer 2026-08-23/24) trimmed
          // to HH:MM — a captain "available" with no hours is available all day.
          availability: (availability.data ?? []).map(a => ({
            staff_id: a.staff_id,
            date: a.date,
            status: a.status,
            note: a.note,
            start_time: a.start_time?.slice(0, 5) ?? null,
            end_time: a.end_time?.slice(0, 5) ?? null,
          })),
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
      name: 'check_cancellation_terms',
      description:
        'Before you offer a cancellation/refund, call this with the booking_id (from get_customer_bookings or search_bookings_by_details) to get the REAL policy terms — never state a refund % or € from memory. Returns hours_until_departure, refund_percent, refund_eur (computed from what was actually paid), policy_summary (a one-line explanation), is_ota_booking (true means this booking must be cancelled on that platform, not by us), and can_cancel_here (false means we have no FareHarbor reference to act on — tell the customer to check their confirmation email instead).',
      input_schema: {
        type: 'object',
        properties: {
          booking_id: { type: 'string', description: 'The exact booking id from get_customer_bookings/search_bookings_by_details' },
        },
        required: ['booking_id'],
      },
      run: async input => {
        const bookingId = String(input.booking_id ?? '').trim()
        if (!bookingId) throw new Error('booking_id is required')
        const terms = await computeCancellationTerms(bookingId)
        if (!terms.bookingFound) return { found: false, note: 'No booking found with that id.' }
        return {
          found: true,
          guest_name: terms.guestName,
          cruise: terms.listingTitle,
          departure_at: terms.departureAt,
          hours_until_departure: terms.hoursUntilDeparture != null ? Math.round(terms.hoursUntilDeparture) : null,
          refund_percent: terms.refundPercent,
          amount_paid_eur: terms.amountPaidCents / 100,
          refund_eur: terms.refundCents / 100,
          policy_summary: terms.policySummary,
          is_ota_booking: terms.isOtaBooking,
          booking_source: terms.bookingSource,
          can_cancel_here: terms.canCancelInFareharbor && !terms.isOtaBooking,
          already_cancelled: terms.alreadyCancelled,
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
