/**
 * Fake tool runners that answer from a synthetic World, shaped like the real
 * tool output. The tool names, descriptions and
 * schemas the model sees come from the real Ghost toolbox (see run.prototype.test.ts);
 * only `run` is replaced here, and it never touches a network or database.
 */
import { hhmm, type Booking, type World } from './scenarios'

const OTA = ['tripadvisor', 'getyourguide', 'withlocals', 'clickandboat', 'boatlocal']

type Runner = (input: Record<string, unknown>) => unknown

const digits = (p: unknown) => String(p ?? '').replace(/\D/g, '')

/** "14:00" → "2pm", "18:30" → "6:30pm": the display format the real search returns. */
function display(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${suffix}`
}

/** Lookups return the weekday too (Haiku misread 2026-10-03 as a Friday without it). Haiku misread 2026-10-03 as a Friday in round 1. */
export function weekday(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })
}

function bookingRow(b: Booking) {
  // name_on_booking: without it the agent can't use a name to break a tie (round 2, case 2).
  return { booking_id: b.id, name_on_booking: b.name, date: b.date, weekday: weekday(b.date), time: b.time, cruise: b.cruise, listing_slug: b.slug, option: b.option, guests: b.guests, status: b.status, booked_via: b.source ?? 'website', is_ota_booking: OTA.includes(b.source ?? ''), extras: [] }
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

    get_schedule: ({ from, to }) => {
      const inRange = (d: string) => d >= String(from) && d <= String(to ?? from)
      return {
        shifts: world.shifts.filter(s => inRange(s.date)).map(s => ({
          id: s.id, date: s.date, weekday: weekday(s.date), start: s.start, end: s.end, booking_ids: [s.booking_id], boat: s.boat,
          status: s.captain_id ? 'assigned' : 'open', captain_id: s.captain_id,
          captain: world.staff.find(x => x.id === s.captain_id)?.name ?? null,
        })),
        staff: world.staff.map(s => ({ ...s, role: 'captain' })),
        availability: world.availability.filter(a => inRange(a.date)).map(a => ({ note: null, start_time: null, end_time: null, ...a })),
      }
    },
  }
}
