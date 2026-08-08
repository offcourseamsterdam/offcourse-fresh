import { formatAmsterdamTime, amsterdamToday, amsterdamTimeToUtcIso } from '@/lib/utils'
import { SCHEDULE_DIGEST_HOUR_AMSTERDAM } from '@/lib/ghost/rulebook'

/**
 * True during the first 15 minutes of the digest hour, Amsterdam-local —
 * checked against the real clock (Intl, DST-aware) rather than a fixed UTC
 * cron time, so this never drifts by an hour across the CET/CEST switch the
 * way several of this project's older crons do (see docs/features note).
 * Pair with a cron that runs every 15 minutes so this window is never missed.
 */
export function isScheduleDigestTime(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Amsterdam',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(parts.find(p => p.type === 'hour')?.value)
  const minute = Number(parts.find(p => p.type === 'minute')?.value)
  return hour === SCHEDULE_DIGEST_HOUR_AMSTERDAM && minute < 15
}

/**
 * When the next digest will actually go out (UTC ISO), for a forward-looking
 * "what's coming" view — today at the digest hour if that hasn't passed yet,
 * otherwise tomorrow.
 */
export function getNextScheduleDigestAt(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Amsterdam',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(parts.find(p => p.type === 'hour')?.value)
  const minute = Number(parts.find(p => p.type === 'minute')?.value)
  const alreadyPassedToday = hour > SCHEDULE_DIGEST_HOUR_AMSTERDAM || (hour === SCHEDULE_DIGEST_HOUR_AMSTERDAM && minute >= 15)
  const targetDate = amsterdamToday(alreadyPassedToday ? 1 : 0, now)
  return amsterdamTimeToUtcIso(targetDate, `${String(SCHEDULE_DIGEST_HOUR_AMSTERDAM).padStart(2, '0')}:00`)
}

export interface DigestShift {
  startAt: string
  endAt: string
  boatName: string
}

export interface CaptainDigest {
  staffId: string
  staffName: string
  slackMemberId: string | null
  shifts: DigestShift[]
}

interface RawShift {
  staff_id: string | null
  start_at: string
  end_at: string
  staff: { name: string; slack_member_id: string | null } | null
  boats: { name: string } | null
}

/** Groups tomorrow's assigned shifts by captain, sorted by start time within each. */
export function buildCaptainDigests(shifts: RawShift[]): CaptainDigest[] {
  const map = new Map<string, CaptainDigest>()
  for (const s of shifts) {
    if (!s.staff_id || !s.staff) continue
    const entry = map.get(s.staff_id) ?? {
      staffId: s.staff_id,
      staffName: s.staff.name,
      slackMemberId: s.staff.slack_member_id,
      shifts: [],
    }
    entry.shifts.push({ startAt: s.start_at, endAt: s.end_at, boatName: s.boats?.name ?? 'boat TBD' })
    map.set(s.staff_id, entry)
  }
  for (const entry of map.values()) entry.shifts.sort((a, b) => a.startAt.localeCompare(b.startAt))
  return [...map.values()]
}

export function formatDigestMessage(dayLabel: string, shifts: DigestShift[]): string {
  const lines = shifts.map(s => `• ${formatAmsterdamTime(s.startAt)}–${formatAmsterdamTime(s.endAt)} · ${s.boatName}`)
  return `📋 Tomorrow (${dayLabel}): ${shifts.length} tour${shifts.length === 1 ? '' : 's'}\n${lines.join('\n')}`
}
