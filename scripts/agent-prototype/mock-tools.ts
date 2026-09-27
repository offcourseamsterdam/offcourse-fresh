/**
 * Fake tool runners that answer from a synthetic World, plus the PROPOSED
 * additions this prototype is testing. The tool names, descriptions and
 * schemas the model sees come from the real Ghost toolbox (see run.prototype.test.ts);
 * only `run` is replaced here, and it never touches a network or database.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { hhmm, type Booking, type World } from './scenarios'

type Runner = (input: Record<string, unknown>) => unknown

const digits = (p: unknown) => String(p ?? '').replace(/\D/g, '')

/** "14:00" → "2pm", "18:30" → "6:30pm": the display format the real search returns. */
function display(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${suffix}`
}

/** PROPOSED: lookups return the weekday too. Haiku misread 2026-10-03 as a Friday in round 1. */
export function weekday(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })
}

function bookingRow(b: Booking) {
  // PROPOSED: name_on_booking. Without it the agent can't use a name to break a tie (round 2, case 2).
  return { booking_id: b.id, name_on_booking: b.name, date: b.date, weekday: weekday(b.date), time: b.time, cruise: b.cruise, option: b.option, guests: b.guests, status: b.status, extras: [] }
}

export function mockRunners(world: World): Record<string, Runner> {
  const fits = (guests: number) => (o: { max_guests: number }) => o.max_guests >= guests
  const strip = ({ name, price_eur, duration_min }: { name: string; price_eur: number; duration_min: number }) => ({ name, price_eur, duration_min })

  return {
    search_availability: ({ date, guests }) => {
      const g = Number(guests ?? 2)
      const day = world.slots[String(date)] ?? {}
      const times = Object.keys(day).sort().filter(t => day[t].some(fits(g)))
      if (!times.length) return { available: false, note: 'Nothing available that day for that group size.' }
      return {
        available: true,
        listings: [
          {
            listing: 'Private Canal Cruise',
            slug: 'private-canal-cruise',
            category: 'private',
            times: times.map(display),
            options: day[times[0]].filter(fits(g)).map(strip),
          },
        ],
      }
    },

    check_booking: ({ date, time, guests, option }) => {
      const g = Number(guests ?? 2)
      const t = hhmm(time)
      const day = world.slots[String(date)] ?? {}
      const opts = (t && day[t]?.filter(fits(g))) || []
      const wanted = option ? opts.find(o => o.name.toLowerCase() === String(option).toLowerCase()) : opts[0]
      if (wanted) return { bookable: true, price_eur: wanted.price_eur }
      const alternatives = Object.entries(day)
        .flatMap(([tt, os]) => os.filter(fits(g)).map(o => ({ date, time: display(tt), option: o.name, price_eur: o.price_eur, kind: tt === t ? 'other_boat' : 'same_day_later' })))
        .slice(0, 3)
      return { bookable: false, reason: opts.length ? 'That boat/duration is taken at this time' : 'No departure free at this time', ...(alternatives.length ? { alternatives } : {}) }
    },

    get_customer_bookings: ({ email, phone }) => {
      const found = world.bookings.filter(
        b => (email && b.email?.toLowerCase() === String(email).toLowerCase()) || (phone && b.phone && digits(b.phone) === digits(phone)),
      )
      if (!found.length) return { bookings: [], note: `No bookings found for this ${phone ? 'phone' : 'email'}.` }
      return { bookings: found.map(bookingRow) }
    },

    search_bookings_by_details: ({ customer_name, date, boat }) => {
      const name = String(customer_name ?? '').toLowerCase().trim()
      const found = world.bookings
        .filter(b => b.name.toLowerCase().includes(name))
        .filter(b => !date || b.date === date)
        .filter(b => !boat || b.option.toLowerCase().includes(String(boat).toLowerCase()))
      if (!found.length) return { bookings: [], note: 'No bookings found matching those details.' }
      return {
        bookings: found.map(b => ({ booking_id: b.id, name_on_booking: b.name, email_on_booking: b.email, date: b.date, weekday: weekday(b.date), time: b.time, cruise: b.cruise, guests: b.guests, status: b.status })),
      }
    },

    check_cancellation_terms: ({ booking_id }) => {
      const b = world.bookings.find(x => x.id === booking_id)
      if (!b) return { found: false, note: 'No booking found with that id.' }
      const hours = Math.round((Date.parse(`${b.date}T${b.time}:00+02:00`) - Date.parse(`${world.today}T12:00:00+02:00`)) / 3_600_000)
      const pct = hours >= 48 ? 100 : 0
      return {
        found: true, guest_name: b.name, cruise: b.cruise, departure_at: `${b.date}T${b.time}:00+02:00`, hours_until_departure: hours,
        refund_percent: pct, amount_paid_eur: b.paid_eur, refund_eur: (b.paid_eur * pct) / 100,
        policy_summary: hours < 0 ? 'This cruise has already taken place — the cancellation policy does not apply.' : pct ? 'More than 48h before departure: full refund.' : 'Less than 48h before departure: no refund.',
        is_ota_booking: false, booking_source: 'website', can_cancel_here: hours > 0, already_cancelled: false,
      }
    },

    check_shared_cruise_to_join: () => ({ joinable: false, alternatives: [], note: 'No shared cruise with other guests in that window.' }),
    list_extras: () => ({ menu: [], note: 'No extras in this prototype.' }),

    // PROPOSED shape: the real get_schedule reads start_at/end_at and booking_id
    // but does not return them, so an agent can't tell which shift belongs to a
    // booking or whether a captain is busy at a given hour.
    get_schedule: ({ from, to }) => {
      const inRange = (d: string) => d >= String(from) && d <= String(to ?? from)
      return {
        shifts: world.shifts.filter(s => inRange(s.date)).map(s => ({
          id: s.id, booking_id: s.booking_id, date: s.date, start: s.start, end: s.end, boat: s.boat, status: s.captain_id ? 'assigned' : 'open',
          captain: world.staff.find(x => x.id === s.captain_id)?.name ?? null,
        })),
        staff: world.staff.map(s => ({ ...s, role: 'captain' })),
        availability: world.availability.filter(a => inRange(a.date)).map(a => ({ note: null, start_time: null, end_time: null, ...a })),
      }
    },
  }
}

/** PROPOSED: get_customer_bookings also takes a phone (WhatsApp has no email). */
export const GET_CUSTOMER_BOOKINGS_WITH_PHONE: Anthropic.Tool = {
  name: 'get_customer_bookings',
  description:
    "Look up a customer's booking history by email OR phone — dates, cruises, party sizes, status, catering extras. Call when you need to know if/what they booked (rescheduling, 'my booking', repeat guests). On WhatsApp, the chat's phone number is the best first lookup.",
  input_schema: {
    type: 'object',
    properties: {
      email: { type: 'string', description: "The customer's email address" },
      phone: { type: 'string', description: 'Phone number in international format, e.g. +31612345678' },
    },
  },
}

/** PROPOSED: the reschedule action the inbox agent does not have yet. */
export const SUBMIT_RESCHEDULE: Anthropic.Tool = {
  name: 'submit_reschedule_request',
  description:
    "Finish with a reschedule when the customer wants to move an EXISTING booking to another date/time — use ONLY after you found the exact booking, confirmed the new slot with check_booking, and checked the captain with get_schedule. Includes the reply you would send plus the move for the team to approve; their one click rebooks it in FareHarbor, moves the shift, tells the captain(s) and emails the customer. Never use this if more than one booking could be the one they mean, or the new slot isn't bookable.",
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: "The reply you would send once the team approves, in the customer's language." },
      language: { type: 'string', description: 'Language of the reply, in English' },
      reasoning: { type: 'string', description: '1-3 sentences in English: how you identified the booking, and the captain decision.' },
      reschedule: {
        type: 'object',
        properties: {
          booking_id: { type: 'string', description: 'Exact booking_id from a lookup tool, never invented' },
          match_basis: { type: 'string', enum: ['phone', 'email', 'booking_reference', 'phone+name', 'name_only'] },
          from: { type: 'object', properties: { date: { type: 'string' }, time: { type: 'string' } }, required: ['date', 'time'] },
          to: {
            type: 'object',
            properties: { date: { type: 'string' }, time: { type: 'string' }, option: { type: 'string' }, price_eur: { type: 'number' } },
            required: ['date', 'time', 'option'],
          },
          captain: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['keep', 'swap', 'none_available'] },
              current: { type: ['string', 'null'] },
              proposed: { type: ['string', 'null'] },
              why: { type: 'string' },
            },
            required: ['action'],
          },
        },
        required: ['booking_id', 'match_basis', 'from', 'to', 'captain'],
      },
      open_question: { type: ['string', 'null'], description: 'ONE question for the team if something needs a human decision. null otherwise.' },
    },
    required: ['reply', 'language', 'reasoning', 'reschedule'],
  },
}

/** PROPOSED prompt additions, appended after the real inbox-agent prompt. */
export function proposedAdditions(world: World): string {
  return `

PROPOSED ADDITIONS (reschedule pilot — these override the rules above where they conflict)
CUSTOMER (continued)
- Today is ${weekday(world.today)} ${world.today}.
- Phone (this WhatsApp chat): ${world.contact.phone}
- Channel: WhatsApp. The name above is their WhatsApp profile name, not a verified name.

MORE RULES
- Finding the customer's booking: get_customer_bookings takes an email OR a phone. On WhatsApp start with this chat's phone; also try any email or booking reference the customer mentions.
- Identity strength: phone, email and booking reference are strong. A name is weak, and only counts when it's a real first or last name — never an initial or a nickname. When the phone (or email) finds several bookings and exactly one is under the first or last name the customer uses (in their message or WhatsApp profile), that one is theirs: go ahead with match_basis phone+name. Only ask when the name fits none of them or more than one. If nothing strong matched, act on a name only when search_bookings_by_details returns exactly ONE live booking and the name is a full name that clearly matches; then set match_basis to name_only and start your reasoning with "Matched by name only". If more than one booking could be the one they mean, or none matched, do not guess: submit_reply_draft asking ONLY for their booking reference or the email they booked with (or which of their bookings they mean, by date). Never reveal another booking's details (names, dates, times, boats) to someone who hasn't shown it's theirs.
- Reschedule (customer wants another date/time for an existing booking): once you have the exact booking, check the new slot with check_booking (same guests and the option they already have). Then call get_schedule covering the booking's current date and the new date: find the captain on the booking's shift (shift.booking_id), and whether they're free at the new time (available that day, their hours cover it, not on another shift then). Finish with submit_reschedule_request: keep the captain if free; else swap to another captain who is free; else none_available (the move can still be approved, the shift gets assigned by hand). If the new slot isn't bookable, don't submit a reschedule — reply offering check_booking's alternatives.
- Requests you have no action for (a partial refund, a complaint): never promise money, percentages or outcomes. submit_reply_draft with a warm holding reply, and use open_question to give the team a concrete recommendation (what you'd do and why; amounts only if a tool gave them).`
}
