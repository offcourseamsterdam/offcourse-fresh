import { amsterdamToday } from '@/lib/utils'
import { AVAILABILITY_REQUEST_LEAD_DAYS, AVAILABILITY_REMINDER_LEAD_DAYS } from '@/lib/ghost/rulebook'

export interface AvailabilityRequestCheck {
  /** The month captains are being asked to fill in, as YYYY-MM. */
  targetMonth: string
  /** First day of that month, YYYY-MM-DD — the date the captain portal opens the calendar to. */
  targetMonthStart: string
}

/**
 * True exactly once per month, `leadDays` before that month's 1st — every
 * calendar month has exactly one date that many days before it, so this
 * needs no separate "already sent" tracking the way a booking-triggered
 * auto-send does; the date match itself is the guard.
 */
function checkLeadDays(now: Date, leadDays: number): AvailabilityRequestCheck | null {
  const today = amsterdamToday(0, now)
  const [y, m, d] = today.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1, d + leadDays))
  if (target.getUTCDate() !== 1) return null

  const targetYear = target.getUTCFullYear()
  const targetMonthNum = target.getUTCMonth() + 1
  const targetMonth = `${targetYear}-${String(targetMonthNum).padStart(2, '0')}`
  return { targetMonth, targetMonthStart: `${targetMonth}-01` }
}

/** The FIRST ask — goes to every active captain. */
export function checkAvailabilityRequest(now: Date = new Date()): AvailabilityRequestCheck | null {
  return checkLeadDays(now, AVAILABILITY_REQUEST_LEAD_DAYS)
}

/**
 * The FOLLOW-UP nudge (Beer, 2026-08-23) — same once-per-month date logic,
 * a shorter lead. Unlike the first ask this one is NOT sent to everybody:
 * the caller filters to captains who still have nothing filled in, so a
 * captain who already responded is never chased.
 */
export function checkAvailabilityReminder(now: Date = new Date()): AvailabilityRequestCheck | null {
  return checkLeadDays(now, AVAILABILITY_REMINDER_LEAD_DAYS)
}

export interface NextAvailabilityRequest extends AvailabilityRequestCheck {
  triggerDate: string
  daysUntil: number
}

/**
 * The next upcoming trigger date, whether or not it's today — for a
 * forward-looking "what's coming" view (see /admin/ghost's Upcoming
 * section), as opposed to checkAvailabilityRequest's "is it today" gate
 * the actual cron uses.
 */
export function getNextAvailabilityRequestDate(now: Date = new Date()): NextAvailabilityRequest {
  const todayStr = amsterdamToday(0, now)
  const [ty, tm, td] = todayStr.split('-').map(Number)
  for (let monthOffset = 0; monthOffset <= 4; monthOffset++) {
    const monthStart = new Date(Date.UTC(ty, tm - 1 + monthOffset, 1))
    const trigger = new Date(monthStart.getTime() - AVAILABILITY_REQUEST_LEAD_DAYS * 24 * 60 * 60 * 1000)
    const triggerStr = trigger.toISOString().slice(0, 10)
    if (triggerStr >= todayStr) {
      const targetMonth = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`
      const daysUntil = Math.round((trigger.getTime() - Date.UTC(ty, tm - 1, td)) / (24 * 60 * 60 * 1000))
      return { targetMonth, targetMonthStart: `${targetMonth}-01`, triggerDate: triggerStr, daysUntil }
    }
  }
  throw new Error('No upcoming availability-request date found within the search window')
}
