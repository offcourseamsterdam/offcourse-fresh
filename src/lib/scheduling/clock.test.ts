import { describe, it, expect } from 'vitest'
import { decideClockIn, decideClockOut, matchShift, type ShiftCandidate } from './clock'

const NOW = new Date('2026-06-20T11:50:00.000Z')

const shift = (id: string, start: string, end: string): ShiftCandidate => ({
  id,
  start_at: start,
  end_at: end,
})

describe('matchShift', () => {
  it('picks the upcoming shift', () => {
    const s = shift('s1', '2026-06-20T12:00:00.000Z', '2026-06-20T14:00:00.000Z')
    expect(matchShift([s], NOW)?.id).toBe('s1')
  })

  it('picks a shift already in progress', () => {
    const s = shift('s1', '2026-06-20T11:00:00.000Z', '2026-06-20T13:00:00.000Z')
    expect(matchShift([s], NOW)?.id).toBe('s1')
  })

  it('ignores shifts that already ended', () => {
    const s = shift('s1', '2026-06-20T08:00:00.000Z', '2026-06-20T10:00:00.000Z')
    expect(matchShift([s], NOW)).toBeNull()
  })

  it('picks the EARLIEST not-yet-ended shift when there are several', () => {
    const later = shift('later', '2026-06-20T16:00:00.000Z', '2026-06-20T18:00:00.000Z')
    const sooner = shift('sooner', '2026-06-20T12:00:00.000Z', '2026-06-20T14:00:00.000Z')
    expect(matchShift([later, sooner], NOW)?.id).toBe('sooner')
  })

  it('returns null for an empty rota', () => {
    expect(matchShift([], NOW)).toBeNull()
  })
})

describe('decideClockIn', () => {
  it('creates an entry linked to the matching shift', () => {
    const s = shift('s1', '2026-06-20T12:00:00.000Z', '2026-06-20T14:00:00.000Z')
    const result = decideClockIn(null, [s], NOW)
    expect(result).toEqual({ ok: true, decision: { action: 'create', shift_id: 's1', flag: null } })
  })

  it('creates a flagged no_shift entry when nothing matches', () => {
    const result = decideClockIn(null, [], NOW)
    expect(result).toEqual({
      ok: true,
      decision: { action: 'create', shift_id: null, flag: 'no_shift' },
    })
  })

  it('double check-in is a friendly no-op mentioning the original time', () => {
    const result = decideClockIn({ id: 'e1', clock_in_at: '2026-06-20T09:58:00.000Z' }, [], NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // 09:58 UTC = 11:58 Amsterdam in summer
      expect(result.message).toContain('11:58')
      expect(result.message.toLowerCase()).toContain('already checked in')
    }
  })
})

describe('decideClockOut', () => {
  it('closes the open entry', () => {
    const result = decideClockOut({ id: 'e1', clock_in_at: '2026-06-20T10:00:00.000Z' })
    expect(result).toEqual({ ok: true, decision: { action: 'close', entryId: 'e1' } })
  })

  it('out without in is a friendly no-op', () => {
    const result = decideClockOut(null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('not checked in')
  })
})
