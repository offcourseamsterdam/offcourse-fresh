import { fetchSearchResults } from '@/lib/search/fetch-search-results'
import { compactAvailability } from '@/lib/ghost/tools'
import type { OtaDetection } from './detect'

export interface OtaAvailabilityResult {
  checked: boolean
  reason?: string
  dateISO?: string
  guests?: number
  /** HH:MM (24h, Amsterdam) the guest asked for, when the email named one. Availability is narrowed to it. */
  time?: string
  /** Same shape Ghost's own search_availability tool returns — real FareHarbor data, not a guess. */
  availability?: unknown
}

/**
 * The requested departure as "HH:MM" (24h), or null when the email doesn't
 * name one. GetMyBoat puts it in its own `time` field; Withlocals only embeds
 * it in the date line ("Tuesday, September 29, 2026 at 18:30"), so parsed.time
 * stays null for them and the time is read from parsed.date here instead of
 * changing the parser (which would print "at 18:30" twice in the summaries).
 */
export function requestedTime(parsed: OtaDetection['parsed']): string | null {
  const raw = parsed.time ?? parsed.date?.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i)?.[1] ?? null
  if (!raw) return null
  const m = raw.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!m) return null
  let hour = parseInt(m[1], 10)
  const minute = m[2] ?? '00'
  if (m[3] === 'pm' && hour < 12) hour += 12
  if (m[3] === 'am' && hour === 12) hour = 0
  if (hour > 23 || parseInt(minute, 10) > 59) return null
  return `${String(hour).padStart(2, '0')}:${minute}`
}

/** A slot's departure as "HH:MM" (24h) in Amsterdam time — the same clock the OTA emails use. */
export function amsterdamHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Amsterdam',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * Runs the SAME real-availability lookup Ghost's chat tool uses
 * (search_availability), for a "new booking request" OTA notification — so
 * the admin can see at a glance whether the requested date/group size is
 * actually bookable before going to confirm it on the OTA's own platform.
 * Read-only: never proposes or creates anything, just surfaces the facts.
 *
 * When the request names a time, only departures at exactly that time count.
 * Without this, an 18:30 request read "Bookable" whenever ANY departure that
 * day was free, with prices taken from the first slot of the day.
 */
export async function checkOtaAvailability(ota: OtaDetection): Promise<OtaAvailabilityResult> {
  const { dateISO, guests } = ota.parsed
  if (!dateISO || !guests) {
    return { checked: false, reason: "Could not read a clear date and guest count from the email — check it manually." }
  }
  const time = requestedTime(ota.parsed)
  const results = await fetchSearchResults(dateISO, guests)
  const atRequestedTime = time
    ? results.map(r => ({ ...r, availableSlots: r.availableSlots.filter(s => amsterdamHHMM(s.startAt) === time) }))
    : results
  return {
    checked: true,
    dateISO,
    guests,
    ...(time ? { time } : {}),
    availability: compactAvailability(atRequestedTime, guests),
  }
}
