/**
 * Recognizes OTA (Online Travel Agent) notification emails — Withlocals,
 * GetMyBoat, and (later) others — and pulls out what matters: which real-world
 * booking this is about, and what stage it's at.
 *
 * Why this exists: an OTA's notification email comes FROM the platform's own
 * relay address (e.g. info@withlocals.com), never from the actual guest. Left
 * alone, the inbox's normal contact-matching treats "Withlocals" as if it
 * were a recurring customer, which is wrong — see docs/features/ota-notifications.md.
 *
 * Deliberately grown one real email at a time (per Beer: "I will slowly teach
 * you how I should reference them"). Each platform's patterns below are
 * grounded in an actual email already seen in the inbox — nothing here is
 * guessed from OTA documentation. Where a pattern genuinely can't be grounded
 * yet, mark it UNVERIFIED and correct it against the first real example —
 * exactly what happened with Withlocals' "confirmed" email (2026-08-04): the
 * guessed /booking confirmed/i pattern never matched the real subject
 * ("Booking confirmation from {name}"), so it silently fell through to the
 * normal customer-reply pipeline instead of the OTA one, for as long as no
 * real example had arrived to correct it against.
 */

export type OtaKind = 'new_request' | 'confirmed' | 'other' | 'needs_import' | 'own_channel'
export type OtaPlatform = 'withlocals' | 'getmyboat' | 'getyourguide' | 'boatlocal'

/** Single source of truth for a platform's display name — used anywhere an OtaDetection/proposal needs to show it (inbox list, co-pilot cards). */
export const OTA_PLATFORM_NAME: Record<OtaPlatform, string> = {
  withlocals: 'Withlocals',
  getmyboat: 'GetMyBoat',
  getyourguide: 'GetYourGuide',
  boatlocal: 'Boat Local',
}

export interface OtaDetection {
  platform: OtaPlatform
  kind: OtaKind
  /** Groups separate Gmail threads about the SAME booking into one conversation. Null when the platform doesn't expose one (falls back to normal thread-based grouping). */
  bookingRef: string | null
  /** The actual guest's name, when the OTA's email happens to expose it (Withlocals' request notification does not; GetMyBoat's does). */
  guestName: string | null
  /** The guest's real contact details — only FareHarbor's own notification exposes these cleanly (needed to build a `bookings` row directly from the email, see fareharbor/import-booking.ts). Null for Withlocals/GetMyBoat. */
  guestEmail: string | null
  guestPhone: string | null
  /** The booking's end time, same raw HH:MM shape as parsed.time — only needed (and only ever populated) for kind='needs_import', to build a real `bookings.end_time` without guessing a duration. */
  endTime: string | null
  /** Only populated for kind='own_channel' (Boat Local) — that affiliate's "Voucher" field is literally our own Stripe PaymentIntent id, not a platform-specific code (see detectFareharborNotification). Lets handleOtaMessage look up an exact match in our own `bookings` table. Null for every other kind/platform. */
  stripePaymentIntentId: string | null
  parsed: {
    /** Exactly as written by the OTA — formats vary per platform, kept for display. */
    date: string | null
    time: string | null
    /** Normalized to YYYY-MM-DD for calling FareHarbor availability — null if the date couldn't be parsed. */
    dateISO: string | null
    guests: number | null
    experienceName: string | null
  }
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

function monthIndexFrom(name: string): number {
  const lower = name.toLowerCase()
  // Match on the 3-letter abbreviation so both "Sep" and "September" work.
  return MONTHS.findIndex(m => m.startsWith(lower.slice(0, 3)))
}

/**
 * Withlocals uses two different date layouts across its own email types —
 * "Thursday, September 24, 2026 at 10:30" (request) and, grounded in a real
 * confirmation email (2026-08-04), "24 September 2026" (confirmation, no
 * comma, day first). Both → "2026-09-24".
 */
function isoDateFromWithlocals(raw: string | null): string | null {
  if (!raw) return null
  const monthDayYear = raw.match(/(\w+)\s+(\d{1,2}),\s*(\d{4})/)
  if (monthDayYear) {
    const monthIndex = monthIndexFrom(monthDayYear[1])
    if (monthIndex === -1) return null
    return `${monthDayYear[3]}-${String(monthIndex + 1).padStart(2, '0')}-${monthDayYear[2].padStart(2, '0')}`
  }
  const dayMonthYear = raw.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/)
  if (dayMonthYear) {
    const monthIndex = monthIndexFrom(dayMonthYear[2])
    if (monthIndex === -1) return null
    return `${dayMonthYear[3]}-${String(monthIndex + 1).padStart(2, '0')}-${dayMonthYear[1].padStart(2, '0')}`
  }
  return null
}

/** "8 Aug 2026 - 8 Aug 2026" → "2026-08-08" (GetMyBoat's format — takes the first date in the range). */
function isoDateFromGetMyBoat(raw: string | null): string | null {
  if (!raw) return null
  const first = raw.split('-')[0].trim()
  const m = first.match(/(\d{1,2})\s+(\w{3,})\s+(\d{4})/)
  if (!m) return null
  const monthIndex = monthIndexFrom(m[2])
  if (monthIndex === -1) return null
  return `${m[3]}-${String(monthIndex + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

function detectWithlocals(subject: string, bodyText: string): OtaDetection | null {
  // Grounded in a real "New booking request received from ." email (2026-08-03).
  const isRequest = /New booking request received/i.test(subject)
  // Grounded in a real "Booking confirmation from {name}" email (2026-08-04) —
  // the previous pattern here (/booking confirmed/i) was an explicitly-marked
  // guess made before any real confirmation email had arrived, and it missed
  // this one: Withlocals' actual subject says "confirmation", never
  // "confirmed". This is the guest-paid signal that should prompt creating
  // the real booking (see handleOtaMessage's 'confirmed' branch).
  const isConfirmed = /booking confirmation/i.test(subject)
  // Grounded in a real "New invoice for booking #{ref}." email (2026-08-04),
  // which follows the confirmation above by seconds for the SAME booking.
  // Not a new action on its own (the confirmation email already produced the
  // booking-ready proposal) — recognized only so its bookingRef groups it
  // into that same conversation instead of spawning a third, seemingly
  // unrelated thread with no context.
  const isInvoice = /New invoice for booking/i.test(subject)
  if (!isRequest && !isConfirmed && !isInvoice) return null

  const bookingRef =
    bodyText.match(/Booking reference\r?\n([a-zA-Z0-9]+)/)?.[1] ??
    subject.match(/booking #([a-zA-Z0-9]+)/i)?.[1] ??
    null
  const date = bodyText.match(/Date & time\r?\n([^\r\n]+)/)?.[1]?.trim() ?? null
  const experienceName = bodyText.match(/Experience\r?\n([^\r\n]+)/)?.[1]?.trim() ?? null
  const guestsRaw = bodyText.match(/Number of guests\r?\n(\d+)/)?.[1]
  const guests = guestsRaw ? parseInt(guestsRaw, 10) : null

  return {
    platform: 'withlocals',
    kind: isConfirmed ? 'confirmed' : isRequest ? 'new_request' : 'other',
    bookingRef,
    guestName: null, // Withlocals' request/confirmation notifications never name the guest in a clean, structured field.
    guestEmail: null,
    guestPhone: null,
    endTime: null,
    stripePaymentIntentId: null,
    parsed: { date, time: null, dateISO: isoDateFromWithlocals(date), guests, experienceName },
  }
}

function detectGetMyBoat(fromEmail: string, bodyText: string): OtaDetection | null {
  // Grounded in a real "NEW BOOKING REQUEST" email (2026-08-03). GetMyBoat's
  // notification exposes no clean booking reference — grouping falls back to
  // Gmail's own thread matching (their emails naturally thread via "RE:").
  if (!fromEmail.toLowerCase().includes('@getmyboat.com')) return null
  const isRequest = /NEW BOOKING REQUEST/i.test(bodyText)
  if (!isRequest) return null

  const guestName = bodyText.match(/^([^\r\n]+?) is actively comparing boats/m)?.[1]?.trim() ?? null
  const experienceName = bodyText.match(/Listing:\s*[“"]([^”"]+)[”"]/)?.[1]?.trim() ?? null
  const date = bodyText.match(/^Date:\s*([^\r\n]+)/m)?.[1]?.trim() ?? null
  const time = bodyText.match(/^Time:\s*([^\r\n]+)/m)?.[1]?.trim() ?? null
  const guestsRaw = bodyText.match(/Group Size:\s*(\d+)\s*Guests?/i)?.[1]
  const guests = guestsRaw ? parseInt(guestsRaw, 10) : null

  return {
    platform: 'getmyboat',
    kind: 'new_request',
    bookingRef: null,
    guestName,
    guestEmail: null,
    guestPhone: null,
    endTime: null,
    stripePaymentIntentId: null,
    parsed: { date, time, dateISO: isoDateFromGetMyBoat(date), guests, experienceName },
  }
}

/**
 * FareHarbor's OWN outbound "New Booking" notification — sent to Beer's inbox
 * (he's subscribed in FareHarbor's own settings) whenever a 3rd-party API
 * integration creates a booking directly inside FareHarbor, no human and no
 * website checkout involved. This is a fundamentally different situation from
 * Withlocals/GetMyBoat above: there the guest paid THEM and nothing exists in
 * FareHarbor yet (see detectWithlocals/handleOtaMessage's 'confirmed' branch —
 * action: create it). Here the booking is already fully real in FareHarbor;
 * the gap is one level down — our own sync never picks up a booking a 3rd-party
 * API creates straight into FareHarbor, so it never reaches our own database or
 * Bookings/Scheduling/Planning (action: import it, never re-create it).
 *
 * Grounded in a real "New Booking for Shared Cruise ... Created by: GetYourGuide
 * API (GetYourGuide - EUR - API) ... Booking #369057638" email (2026-08-04).
 *
 * The import action (fareharbor/import-booking.ts) builds its `bookings` row
 * straight from these parsed fields rather than re-fetching the booking live
 * from FareHarbor — the only endpoint that could do that re-fetch,
 * getBookings(), 404s against the real API (a pre-existing bug, silently
 * swallowed by its only other caller). The notification email already has
 * every field the row needs, so there's nothing to gain from that round trip
 * anyway.
 *
 * "Boat Local - API" is a DIFFERENT case, not another 3rd-party platform to
 * import: grounded in 3 real notifications (2026-08-05) whose "Created by"
 * line reads "Zoomers B.V. API (Boat Local - API)" — Zoomers B.V. is Off
 * Course's own legal entity, and all 3 example bookings already existed in
 * our `bookings` table under booking_source='website'. This is FareHarbor
 * echoing back a booking OUR OWN website just created, not a foreign
 * platform — see handleOtaMessage's 'own_channel' branch, which checks our
 * own database instead of offering an import (importing would create a real
 * duplicate of a booking that's usually already there).
 */
function platformFromAffiliate(affiliateRaw: string | null): OtaPlatform | null {
  if (!affiliateRaw) return null
  const lower = affiliateRaw.toLowerCase()
  if (lower.includes('getyourguide')) return 'getyourguide'
  if (lower.includes('boat local')) return 'boatlocal'
  return null
}

function detectFareharborNotification(bodyText: string): OtaDetection | null {
  if (!/New Booking for/i.test(bodyText) || !/Created by:/i.test(bodyText)) return null

  const affiliateRaw = bodyText.match(/Affiliate:\s*([^\r\n]+)/i)?.[1]?.trim() ?? null
  const platform = platformFromAffiliate(affiliateRaw)
  if (!platform) return null

  // The FareHarbor booking pk (e.g. "Booking #369057638") — doubles as
  // bookingRef for conversation grouping AND as the literal number the import
  // action re-fetches live from FareHarbor by. Without it there's nothing
  // reliable to import, so this notification is unrecognized.
  const pk = bodyText.match(/Booking #(\d+)/)?.[1] ?? null
  if (!pk) return null

  const guestName = bodyText.match(/^[ \t]*Name:\s*([^\r\n]+)/m)?.[1]?.trim() ?? null
  const guestEmail = bodyText.match(/^[ \t]*Email:\s*([^\r\n]+)/m)?.[1]?.trim() ?? null
  const guestPhone = bodyText.match(/^[ \t]*Phone:\s*([^\r\n]+)/m)?.[1]?.trim() ?? null
  const experienceName = bodyText.match(/New Booking for\s+([^\r\n]+)/i)?.[1]?.trim() ?? null

  // "Wednesday, 5 August 2026 @ 17:00 - 18:30" — the end time is captured too
  // (unlike Withlocals/GetMyBoat above): with no live FareHarbor re-fetch,
  // this is the only source for bookings.end_time, and guessing a duration
  // instead would be a guess the email doesn't actually require.
  const dateMatch = bodyText.match(/\w+,\s+(\d{1,2})\s+(\w+)\s+(\d{4})\s+@\s+(\d{2}:\d{2})(?:\s*-\s*(\d{2}:\d{2}))?/)
  let date: string | null = null
  let time: string | null = null
  let endTime: string | null = null
  let dateISO: string | null = null
  if (dateMatch) {
    const monthIndex = monthIndexFrom(dateMatch[2])
    date = `${dateMatch[1]} ${dateMatch[2]} ${dateMatch[3]}`
    time = dateMatch[4]
    endTime = dateMatch[5] ?? null
    if (monthIndex !== -1) dateISO = `${dateMatch[3]}-${String(monthIndex + 1).padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`
  }

  // "2 Adults" — FareHarbor separates the count from the label with a
  // non-breaking space, not a regular one; \s in JS regex matches NBSP too.
  const guestsRaw = bodyText.match(/(\d+)\s*Adults?/i)?.[1]
  const guests = guestsRaw ? parseInt(guestsRaw, 10) : null

  // Boat Local's "Voucher" field is our own Stripe PaymentIntent id (grounded
  // in a real example: "Voucher: pi_3U0pbNGh1qCF71Ta0pKRNwmw") — only
  // meaningful as a lookup key for that platform; other platforms' vouchers
  // are their own booking codes, not something our `bookings` table stores.
  const stripePaymentIntentId = platform === 'boatlocal'
    ? bodyText.match(/Voucher:\s*([^\r\n]+)/i)?.[1]?.trim() ?? null
    : null

  return {
    platform,
    kind: platform === 'boatlocal' ? 'own_channel' : 'needs_import',
    bookingRef: pk,
    guestName,
    guestEmail,
    guestPhone,
    endTime,
    stripePaymentIntentId,
    parsed: { date, time, dateISO, guests, experienceName },
  }
}

export function detectOtaEmail(params: { fromEmail: string; subject: string; bodyText: string }): OtaDetection | null {
  const { fromEmail, subject, bodyText } = params
  const from = fromEmail.toLowerCase()
  if (from.includes('@withlocals.com')) {
    return detectWithlocals(subject, bodyText)
  }
  if (from.includes('@fareharbor.com')) {
    return detectFareharborNotification(bodyText)
  }
  return detectGetMyBoat(fromEmail, bodyText)
}
