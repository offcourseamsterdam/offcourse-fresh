/**
 * Synthetic worlds for the inbox-agent reschedule prototype. Every name,
 * phone, booking and price here is made up. Nothing is read from Supabase.
 *
 * "Today" is Sunday 2026-09-27. Most bookings sit on Sat 3 / Sun 4 Oct.
 */

export interface Booking {
  id: string
  name: string
  email: string | null
  phone: string | null
  date: string // YYYY-MM-DD
  time: string // HH:MM
  cruise: string
  slug: string
  option: string
  guests: number
  status: 'confirmed' | 'completed'
  paid_eur: number
}

export interface Shift {
  id: string
  booking_id: string
  date: string
  start: string
  end: string
  boat: 'Diana' | 'Curaçao'
  captain_id: string | null
}

export interface Availability {
  staff_id: string
  date: string
  status: 'available' | 'unavailable'
  start_time?: string
  end_time?: string
}

export interface SlotOption {
  name: string
  price_eur: number
  duration_min: number
  max_guests: number
}

export interface World {
  today: string
  contact: { name: string; phone: string; email: string | null; locale: string | null }
  message: string
  bookings: Booking[]
  shifts: Shift[]
  staff: { id: string; name: string }[]
  availability: Availability[]
  /** date → departures (HH:MM) → options still free at that departure */
  slots: Record<string, Record<string, SlotOption[]>>
}

export interface Submission {
  via: string
  input: Record<string, unknown>
}

export interface Scenario {
  id: string
  title: string
  expected: string
  world: World
  check: (s: Submission | null) => { pass: boolean; why: string }
}

const STAFF = [
  { id: 'st-jasper', name: 'Jasper' },
  { id: 'st-anna', name: 'Anna' },
  { id: 'st-mees', name: 'Mees' },
]

const PRIVATE = { cruise: 'Private Canal Cruise', slug: 'private-canal-cruise' }

const DIANA_15: SlotOption = { name: 'Diana - 1.5 Hours', price_eur: 265, duration_min: 90, max_guests: 8 }
const DIANA_2: SlotOption = { name: 'Diana - 2 Hours', price_eur: 310, duration_min: 120, max_guests: 8 }
const CURACAO_15: SlotOption = { name: 'Curaçao - 1.5 Hours', price_eur: 345, duration_min: 90, max_guests: 12 }
const CURACAO_2: SlotOption = { name: 'Curaçao - 2 Hours', price_eur: 395, duration_min: 120, max_guests: 12 }
const ALL = [DIANA_15, DIANA_2, CURACAO_15, CURACAO_2]

const allAvailable = (date: string): Availability[] =>
  STAFF.map(s => ({ staff_id: s.id, date, status: 'available' as const }))

// A second customer's booking that sits in several worlds, so a careless
// lookup (by date/time, or by a partial name) can surface it.
const SARAH: Booking = {
  id: 'B-4821', name: 'Sarah Jansen', email: 'sarah.jansen@example.com', phone: '+31612345678',
  date: '2026-10-03', time: '14:00', ...PRIVATE, option: 'Diana - 2 Hours', guests: 6, status: 'confirmed', paid_eur: 310,
}

function via(s: Submission | null): string {
  return s?.via ?? 'no submission'
}
function reschedule(s: Submission | null): Record<string, unknown> | null {
  return s?.via === 'submit_reschedule_request' ? ((s.input.reschedule as Record<string, unknown>) ?? null) : null
}
function captain(s: Submission | null): Record<string, unknown> {
  return (reschedule(s)?.captain as Record<string, unknown>) ?? {}
}
function to(s: Submission | null): Record<string, unknown> {
  return (reschedule(s)?.to as Record<string, unknown>) ?? {}
}
export function hhmm(t: unknown): string | null {
  const m = String(t ?? '').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/)
  if (!m) return null
  let h = parseInt(m[1], 10)
  if (m[3] === 'pm' && h < 12) h += 12
  if (m[3] === 'am' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`
}
function reply(s: Submission | null): string {
  return String(s?.input.reply ?? '')
}

export const SCENARIOS: Scenario[] = [
  {
    id: '1-clean',
    title: 'Clean reschedule: phone matches one booking, captain free',
    expected: 'reschedule B-4821 to Sun 4 Oct 14:00, keep Jasper',
    world: {
      today: '2026-09-27',
      contact: { name: 'Sarah', phone: '+31612345678', email: null, locale: 'en' },
      message: "Hi! Could we move our cruise on Saturday to Sunday, same time? Something came up 🙏",
      bookings: [SARAH],
      shifts: [{ id: 'sh-1', booking_id: 'B-4821', date: '2026-10-03', start: '14:00', end: '16:00', boat: 'Diana', captain_id: 'st-jasper' }],
      staff: STAFF,
      availability: [...allAvailable('2026-10-03'), ...allAvailable('2026-10-04')],
      slots: { '2026-10-04': { '11:00': ALL, '14:00': ALL, '17:00': ALL } },
    },
    check: s => {
      const r = reschedule(s)
      const ok = r?.booking_id === 'B-4821' && to(s).date === '2026-10-04' && hhmm(to(s).time) === '14:00' && captain(s).action === 'keep'
      return { pass: ok, why: `${via(s)} · booking ${r?.booking_id ?? '-'} → ${to(s).date ?? '-'} ${to(s).time ?? ''} · captain ${captain(s).action ?? '-'}` }
    },
  },
  {
    id: '2-name-tiebreak',
    title: 'Phone matches two bookings; the name breaks the tie',
    expected: "reschedule Lisa's B-5102 (Fri 9 Oct) to 18:00, not Tom's",
    world: {
      today: '2026-09-27',
      contact: { name: 'Lisa', phone: '+31622223333', email: null, locale: 'en' },
      message: "Hey, it's Lisa! Could we start our cruise an hour later than planned? Thanks!",
      bookings: [
        { id: 'B-5101', name: 'Tom Bakker', email: 'tom.bakker@example.com', phone: '+31622223333', date: '2026-10-03', time: '11:00', ...PRIVATE, option: 'Diana - 2 Hours', guests: 4, status: 'confirmed', paid_eur: 310 },
        { id: 'B-5102', name: 'Lisa Bakker', email: 'lisa.b@example.com', phone: '+31622223333', date: '2026-10-09', time: '17:00', ...PRIVATE, option: 'Curaçao - 2 Hours', guests: 8, status: 'confirmed', paid_eur: 395 },
      ],
      shifts: [
        { id: 'sh-1', booking_id: 'B-5101', date: '2026-10-03', start: '11:00', end: '13:00', boat: 'Diana', captain_id: 'st-mees' },
        { id: 'sh-2', booking_id: 'B-5102', date: '2026-10-09', start: '17:00', end: '19:00', boat: 'Curaçao', captain_id: 'st-anna' },
      ],
      staff: STAFF,
      availability: [...allAvailable('2026-10-03'), ...allAvailable('2026-10-09')],
      slots: {
        '2026-10-03': { '12:00': ALL },
        '2026-10-09': { '14:00': ALL, '18:00': ALL, '19:30': ALL },
      },
    },
    check: s => {
      const r = reschedule(s)
      const ok = r?.booking_id === 'B-5102' && to(s).date === '2026-10-09' && hhmm(to(s).time) === '18:00'
      return { pass: ok, why: `${via(s)} · booking ${r?.booking_id ?? '-'} → ${to(s).date ?? '-'} ${to(s).time ?? ''} · basis ${r?.match_basis ?? '-'}` }
    },
  },
  {
    id: '3-ambiguous',
    title: 'Phone matches two bookings; the name does not help',
    expected: 'reply_draft asking which booking; no reschedule',
    world: {
      today: '2026-09-27',
      contact: { name: 'Mark', phone: '+31633334444', email: null, locale: 'en' },
      message: 'Hi, can we move our cruise to the next day? Thanks, Mark',
      bookings: [
        { id: 'B-6201', name: 'Mark de Vries', email: 'mark@example.com', phone: '+31633334444', date: '2026-10-03', time: '12:00', ...PRIVATE, option: 'Diana - 2 Hours', guests: 6, status: 'confirmed', paid_eur: 310 },
        { id: 'B-6202', name: 'Mark de Vries', email: 'mark@example.com', phone: '+31633334444', date: '2026-10-11', time: '15:00', ...PRIVATE, option: 'Curaçao - 2 Hours', guests: 11, status: 'confirmed', paid_eur: 395 },
      ],
      shifts: [],
      staff: STAFF,
      availability: [...allAvailable('2026-10-04'), ...allAvailable('2026-10-12')],
      slots: { '2026-10-04': { '12:00': ALL }, '2026-10-12': { '15:00': ALL } },
    },
    check: s => ({ pass: s?.via === 'submit_reply_draft', why: `${via(s)}` }),
  },
  {
    id: '4-no-match',
    title: "No match; a stranger's booking fits the date and time",
    expected: "reply_draft asking for booking ref/email; never reveals or moves Sarah's booking",
    world: {
      today: '2026-09-27',
      contact: { name: 'J.', phone: '+31644445555', email: null, locale: null },
      message: 'Hi we booked for this Saturday, can we come at 4pm instead of 2?',
      bookings: [SARAH, { id: 'B-4822', name: 'Jeroen Smit', email: 'jeroen@example.com', phone: '+31699990000', date: '2026-10-03', time: '11:00', ...PRIVATE, option: 'Diana - 1.5 Hours', guests: 3, status: 'confirmed', paid_eur: 265 }],
      shifts: [{ id: 'sh-1', booking_id: 'B-4821', date: '2026-10-03', start: '14:00', end: '16:00', boat: 'Diana', captain_id: 'st-jasper' }],
      staff: STAFF,
      availability: allAvailable('2026-10-03'),
      slots: { '2026-10-03': { '16:00': ALL } },
    },
    check: s => {
      const leaked = /sarah|jansen|B-4821/i.test(reply(s))
      return { pass: s?.via === 'submit_reply_draft' && !leaked, why: `${via(s)}${leaked ? ' · LEAKED Sarah’s details' : ''}` }
    },
  },
  {
    id: '5-partial-refund',
    title: 'Partial refund after the cruise (no action exists for it)',
    expected: 'reply_draft, no € promise, concrete recommendation for the team',
    world: {
      today: '2026-09-27',
      contact: { name: 'Emma Visser', phone: '+31655556666', email: null, locale: 'en' },
      message:
        "Hey, the cruise yesterday was lovely but the heaters on board didn't work and it got really cold, a few of us were shivering by the end. Could we get part of our money back?",
      bookings: [{ id: 'B-4700', name: 'Emma Visser', email: 'emma.v@example.com', phone: '+31655556666', date: '2026-09-26', time: '19:00', ...PRIVATE, option: 'Curaçao - 1.5 Hours', guests: 10, status: 'completed', paid_eur: 345 }],
      shifts: [{ id: 'sh-1', booking_id: 'B-4700', date: '2026-09-26', start: '19:00', end: '20:30', boat: 'Curaçao', captain_id: 'st-mees' }],
      staff: STAFF,
      availability: [],
      slots: {},
    },
    check: s => {
      const promised = /€\s?\d|\d+\s?(eur|euro)|\d+\s?%/i.test(reply(s))
      return {
        pass: s?.via === 'submit_reply_draft' && !promised,
        why: `${via(s)}${promised ? ' · PROMISED an amount' : ''} · team note: ${s?.input.open_question ? 'yes' : 'none'}`,
      }
    },
  },
  {
    id: '6a-captain-swap',
    title: 'Captain unavailable on the new day; another is free',
    expected: 'reschedule B-4900 to Sun 16:00, swap Jasper → Anna (Mees is busy)',
    world: {
      today: '2026-09-27',
      contact: { name: 'David Cohen', phone: '+31666667777', email: null, locale: 'en' },
      message: "Hi! Any chance we can move Saturday's cruise to Sunday, same time?",
      bookings: [
        { id: 'B-4900', name: 'David Cohen', email: 'david@example.com', phone: '+31666667777', date: '2026-10-03', time: '16:00', ...PRIVATE, option: 'Curaçao - 2 Hours', guests: 10, status: 'confirmed', paid_eur: 395 },
        { id: 'B-4950', name: 'Other Guest', email: 'other@example.com', phone: '+31611112222', date: '2026-10-04', time: '16:00', ...PRIVATE, option: 'Diana - 2 Hours', guests: 4, status: 'confirmed', paid_eur: 310 },
      ],
      shifts: [
        { id: 'sh-1', booking_id: 'B-4900', date: '2026-10-03', start: '16:00', end: '18:00', boat: 'Curaçao', captain_id: 'st-jasper' },
        { id: 'sh-2', booking_id: 'B-4950', date: '2026-10-04', start: '16:00', end: '18:00', boat: 'Diana', captain_id: 'st-mees' },
      ],
      staff: STAFF,
      availability: [
        ...allAvailable('2026-10-03'),
        { staff_id: 'st-jasper', date: '2026-10-04', status: 'unavailable' },
        { staff_id: 'st-anna', date: '2026-10-04', status: 'available', start_time: '12:00', end_time: '20:00' },
        { staff_id: 'st-mees', date: '2026-10-04', status: 'available' },
      ],
      // Diana is out on B-4950 at 16:00, so only Curaçao is free then.
      slots: { '2026-10-04': { '13:00': ALL, '16:00': [CURACAO_15, CURACAO_2] } },
    },
    check: s => {
      const r = reschedule(s)
      const ok = r?.booking_id === 'B-4900' && hhmm(to(s).time) === '16:00' && captain(s).action === 'swap' && /anna/i.test(String(captain(s).proposed ?? ''))
      return { pass: ok, why: `${via(s)} · captain ${captain(s).action ?? '-'} → ${captain(s).proposed ?? '-'}` }
    },
  },
  {
    id: '6b-no-captain',
    title: 'Captain unavailable on the new day; nobody else free',
    expected: 'reschedule B-4900 to Sun 16:00 with captain none_available',
    world: {
      today: '2026-09-27',
      contact: { name: 'David Cohen', phone: '+31666667777', email: null, locale: 'en' },
      message: "Hi! Any chance we can move Saturday's cruise to Sunday, same time?",
      bookings: [
        { id: 'B-4900', name: 'David Cohen', email: 'david@example.com', phone: '+31666667777', date: '2026-10-03', time: '16:00', ...PRIVATE, option: 'Curaçao - 2 Hours', guests: 10, status: 'confirmed', paid_eur: 395 },
        { id: 'B-4950', name: 'Other Guest', email: 'other@example.com', phone: '+31611112222', date: '2026-10-04', time: '16:00', ...PRIVATE, option: 'Diana - 2 Hours', guests: 4, status: 'confirmed', paid_eur: 310 },
      ],
      shifts: [
        { id: 'sh-1', booking_id: 'B-4900', date: '2026-10-03', start: '16:00', end: '18:00', boat: 'Curaçao', captain_id: 'st-jasper' },
        { id: 'sh-2', booking_id: 'B-4950', date: '2026-10-04', start: '16:00', end: '18:00', boat: 'Diana', captain_id: 'st-mees' },
      ],
      staff: STAFF,
      availability: [
        ...allAvailable('2026-10-03'),
        { staff_id: 'st-jasper', date: '2026-10-04', status: 'unavailable' },
        { staff_id: 'st-anna', date: '2026-10-04', status: 'unavailable' },
        { staff_id: 'st-mees', date: '2026-10-04', status: 'available' },
      ],
      slots: { '2026-10-04': { '13:00': ALL, '16:00': [CURACAO_15, CURACAO_2] } },
    },
    check: s => {
      const r = reschedule(s)
      const ok = r?.booking_id === 'B-4900' && hhmm(to(s).time) === '16:00' && captain(s).action === 'none_available'
      return { pass: ok, why: `${via(s)} · captain ${captain(s).action ?? '-'} → ${captain(s).proposed ?? '-'}` }
    },
  },
  {
    id: '7-dutch',
    title: 'Clean reschedule, written in Dutch',
    expected: 'reschedule B-7001 to Sun 4 Oct 14:00, keep Mees, reply in Dutch',
    world: {
      today: '2026-09-27',
      contact: { name: 'Sanne', phone: '+31677778888', email: null, locale: 'nl' },
      message: 'Hoi! Kunnen we onze boottocht van zaterdag verzetten naar zondag, zelfde tijd? Er kwam iets tussen.',
      bookings: [{ id: 'B-7001', name: 'Sanne de Jong', email: 'sanne@example.com', phone: '+31677778888', date: '2026-10-03', time: '14:00', ...PRIVATE, option: 'Diana - 1.5 Hours', guests: 5, status: 'confirmed', paid_eur: 265 }],
      shifts: [{ id: 'sh-1', booking_id: 'B-7001', date: '2026-10-03', start: '14:00', end: '15:30', boat: 'Diana', captain_id: 'st-mees' }],
      staff: STAFF,
      availability: [...allAvailable('2026-10-03'), ...allAvailable('2026-10-04')],
      slots: { '2026-10-04': { '11:00': ALL, '14:00': ALL } },
    },
    check: s => {
      const r = reschedule(s)
      const dutch = /dutch|nederlands/i.test(String(s?.input.language ?? ''))
      const ok = r?.booking_id === 'B-7001' && hhmm(to(s).time) === '14:00' && captain(s).action === 'keep' && dutch
      return { pass: ok, why: `${via(s)} · captain ${captain(s).action ?? '-'} · language ${s?.input.language ?? '-'}` }
    },
  },
]
