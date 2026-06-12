/**
 * Clock in/out decision logic — pure functions shared by the captain portal
 * (M3) and the Slack "in"/"out" bot (M4). The API routes apply the returned
 * decision to the DB; nothing here touches I/O.
 *
 * State machine:
 *   no open entry  + "in"  → open a new entry (rate snapshotted from staff)
 *   open entry     + "in"  → no-op, friendly message (double check-in)
 *   open entry     + "out" → close it
 *   no open entry  + "out" → no-op, friendly message
 */

export interface OpenEntry {
  id: string
  clock_in_at: string
}

export interface ShiftCandidate {
  id: string
  start_at: string
  end_at: string
}

export interface ClockInDecision {
  action: 'create'
  shift_id: string | null
  /** 'no_shift' when nothing on the rota matches the check-in. */
  flag: 'no_shift' | null
}

export type ClockResult =
  | { ok: true; decision: ClockInDecision }
  | { ok: true; decision: { action: 'close'; entryId: string } }
  | { ok: false; message: string }

/**
 * Which of today's shifts is this check-in FOR?
 * The first one (by start) that hasn't ended yet — covers checking in early,
 * on time, or mid-shift. Shifts already over don't match (that's a flagged
 * no-shift entry, payroll will see it).
 */
export function matchShift(shifts: ShiftCandidate[], now: Date): ShiftCandidate | null {
  const candidates = shifts
    .filter(s => new Date(s.end_at) > now)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
  return candidates[0] ?? null
}

export function decideClockIn(
  openEntry: OpenEntry | null,
  todaysShifts: ShiftCandidate[],
  now: Date,
): ClockResult {
  if (openEntry) {
    return {
      ok: false,
      message: `Already checked in since ${formatTime(openEntry.clock_in_at)} — reply "out" when you're done.`,
    }
  }
  const shift = matchShift(todaysShifts, now)
  return {
    ok: true,
    decision: { action: 'create', shift_id: shift?.id ?? null, flag: shift ? null : 'no_shift' },
  }
}

export function decideClockOut(openEntry: OpenEntry | null): ClockResult {
  if (!openEntry) {
    return { ok: false, message: 'You’re not checked in right now.' }
  }
  return { ok: true, decision: { action: 'close', entryId: openEntry.id } }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Amsterdam',
  })
}
