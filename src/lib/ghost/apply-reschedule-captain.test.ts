import { describe, it, expect } from 'vitest'
import { planCaptain } from './apply-reschedule-captain'

const STAFF = [
  { id: 'st-jasper', name: 'Jasper' },
  { id: 'st-anna', name: 'Anna' },
]
const OPEN = { id: 'sh-new', staff_id: null, status: 'open' }

describe('planCaptain', () => {
  it('keeps the captain who was on the booking before the move, trusting the database over the model', () => {
    expect(planCaptain({ action: 'keep', proposed_staff_id: 'st-anna' }, 'st-jasper', STAFF, OPEN)).toEqual({ kind: 'assign', staffId: 'st-jasper' })
  })

  it('swaps to the proposed captain id', () => {
    expect(planCaptain({ action: 'swap', proposed_staff_id: 'st-anna' }, 'st-jasper', STAFF, OPEN)).toEqual({ kind: 'assign', staffId: 'st-anna' })
  })

  it('falls back to a unique name match when the model gave no id', () => {
    expect(planCaptain({ action: 'swap', proposed: 'anna' }, 'st-jasper', STAFF, OPEN)).toEqual({ kind: 'assign', staffId: 'st-anna' })
  })

  it('leaves the shift open when nobody is free', () => {
    expect(planCaptain({ action: 'none_available' }, 'st-jasper', STAFF, OPEN).kind).toBe('skip')
  })

  it('never overwrites a captain already on the new shift', () => {
    const taken = { id: 'sh-new', staff_id: 'st-jasper', status: 'assigned' }
    const plan = planCaptain({ action: 'swap', proposed_staff_id: 'st-anna' }, 'st-jasper', STAFF, taken)
    expect(plan.kind).toBe('skip')
  })

  it('reports "already on it" when the kept captain already has the shift (same-day time change)', () => {
    const same = { id: 'sh-old', staff_id: 'st-jasper', status: 'assigned' }
    expect(planCaptain({ action: 'keep' }, 'st-jasper', STAFF, same)).toEqual({ kind: 'skip', note: 'Jasper is already on the new shift.' })
  })

  it('refuses a captain who is not active', () => {
    expect(planCaptain({ action: 'swap', proposed_staff_id: 'st-gone' }, null, STAFF, OPEN).kind).toBe('skip')
  })

  it('skips when the new shift does not exist yet', () => {
    expect(planCaptain({ action: 'keep' }, 'st-jasper', STAFF, null).kind).toBe('skip')
  })
})
