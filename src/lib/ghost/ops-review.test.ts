import { describe, it, expect } from 'vitest'
import {
  computeDayFacts,
  renderFacts,
  validateRecommendations,
  type OpsReviewShift,
} from './ops-review'

/**
 * The ops-review agent's contract: TypeScript computes the facts, Claude only
 * judges them. These tests pin the fact math — gaps, idle cost, merge
 * candidacy, the private-cruise protection — so a refactor can never silently
 * hand the LLM wrong numbers.
 */

const DATE = '2026-07-05'

function shift(overrides: Partial<OpsReviewShift> & { id: string }): OpsReviewShift {
  return {
    boat: 'Diana',
    boatCapacity: 8,
    startAt: '2026-07-05T10:00:00Z',
    endAt: '2026-07-05T12:00:00Z',
    status: 'assigned',
    staffId: 'staff-1',
    staffName: 'Jip',
    hourlyRateCents: 3000, // €30/h
    category: 'shared',
    guestCount: 4,
    listingTitle: 'Canal Cruise',
    ...overrides,
  }
}

describe('computeDayFacts — gaps & idle cost', () => {
  it('computes the gap between consecutive sailings on one boat, costed at the captain rate', () => {
    const facts = computeDayFacts(
      DATE,
      [
        shift({ id: 'a', startAt: '2026-07-05T10:00:00Z', endAt: '2026-07-05T12:00:00Z' }),
        shift({ id: 'b', startAt: '2026-07-05T13:30:00Z', endAt: '2026-07-05T15:00:00Z' }),
      ],
      [],
      [],
    )

    expect(facts.gaps).toHaveLength(1)
    const gap = facts.gaps[0]
    expect(gap.minutes).toBe(90)
    expect(gap.afterShiftId).toBe('a')
    expect(gap.beforeShiftId).toBe('b')
    // 90 min at €30/h = €45.00
    expect(gap.estIdleCostCents).toBe(4500)
    expect(facts.totalIdleMinutes).toBe(90)
    expect(facts.totalEstIdleCostCents).toBe(4500)
  })

  it('gap cost is null (not zero, not invented) when the earlier shift has no captain', () => {
    const facts = computeDayFacts(
      DATE,
      [
        shift({ id: 'a', staffId: null, staffName: null, hourlyRateCents: null, status: 'open' }),
        shift({ id: 'b', startAt: '2026-07-05T14:00:00Z', endAt: '2026-07-05T16:00:00Z' }),
      ],
      [],
      [],
    )
    expect(facts.gaps[0].estIdleCostCents).toBeNull()
    expect(facts.totalEstIdleCostCents).toBe(0)
  })

  it('back-to-back sailings produce no gap', () => {
    const facts = computeDayFacts(
      DATE,
      [
        shift({ id: 'a', endAt: '2026-07-05T12:00:00Z' }),
        shift({ id: 'b', startAt: '2026-07-05T12:00:00Z', endAt: '2026-07-05T14:00:00Z' }),
      ],
      [],
      [],
    )
    expect(facts.gaps).toHaveLength(0)
  })

  it('gaps are per boat — sailings on different boats never form a gap', () => {
    const facts = computeDayFacts(
      DATE,
      [
        shift({ id: 'a', boat: 'Diana' }),
        shift({ id: 'b', boat: 'Curaçao', boatCapacity: 12, startAt: '2026-07-05T14:00:00Z', endAt: '2026-07-05T16:00:00Z' }),
      ],
      [],
      [],
    )
    expect(facts.gaps).toHaveLength(0)
    expect(facts.boatsInUse.sort()).toEqual(['Curaçao', 'Diana'])
  })
})

describe('computeDayFacts — boat-swap candidates (never combines two parties onto one departure)', () => {
  it('a shared cruise that fits the other boat with no overlap is a boat-swap candidate, priced at the full shift cost', () => {
    const facts = computeDayFacts(
      DATE,
      [
        shift({ id: 'a', boat: 'Diana', category: 'shared', guestCount: 4, hourlyRateCents: 3500 }),
        shift({
          id: 'b',
          boat: 'Curaçao',
          boatCapacity: 12,
          startAt: '2026-07-05T14:00:00Z',
          endAt: '2026-07-05T16:00:00Z',
        }),
      ],
      [],
      [],
    )
    const candidate = facts.mergeCandidates.find(m => m.shiftId === 'a')
    expect(candidate).toBeTruthy()
    expect(candidate!.fromBoat).toBe('Diana')
    expect(candidate!.toBoat).toBe('Curaçao')
    // 2h at €35/h = €70.00 — "one boat, one day, one shift" means moving a's
    // only departure onto Curaçao frees Diana's captain for the whole day.
    expect(candidate!.estSavingCents).toBe(7000)
  })

  it('a PRIVATE cruise IS a boat-swap candidate when it fits (Beer, 2026-08-23: "private cruises can definitely swap Diana for Curaçao" — allowBoatSwap, not allowMerge, gates this pool)', () => {
    const facts = computeDayFacts(
      DATE,
      [
        shift({ id: 'a', boat: 'Diana', category: 'private', guestCount: 4 }),
        shift({
          id: 'b',
          boat: 'Curaçao',
          boatCapacity: 12,
          startAt: '2026-07-05T14:00:00Z',
          endAt: '2026-07-05T16:00:00Z',
        }),
      ],
      [],
      [],
    )
    const candidate = facts.mergeCandidates.find(m => m.shiftId === 'a')
    expect(candidate).toBeTruthy()
    expect(candidate!.fromBoat).toBe('Diana')
    expect(candidate!.toBoat).toBe('Curaçao')
  })

  it('estSavingCents is null (not 0, not invented) when the moving shift has no captain assigned', () => {
    const facts = computeDayFacts(
      DATE,
      [
        shift({ id: 'a', boat: 'Diana', staffId: null, staffName: null, hourlyRateCents: null }),
        shift({
          id: 'b',
          boat: 'Curaçao',
          boatCapacity: 12,
          startAt: '2026-07-05T14:00:00Z',
          endAt: '2026-07-05T16:00:00Z',
        }),
      ],
      [],
      [],
    )
    expect(facts.mergeCandidates.find(m => m.shiftId === 'a')?.estSavingCents).toBeNull()
  })

  it('no candidate when the target boat overlaps in time or lacks capacity', () => {
    const overlap = computeDayFacts(
      DATE,
      [
        shift({ id: 'a', boat: 'Diana' }),
        shift({ id: 'b', boat: 'Curaçao', boatCapacity: 12, startAt: '2026-07-05T11:00:00Z', endAt: '2026-07-05T13:00:00Z' }),
      ],
      [],
      [],
    )
    expect(overlap.mergeCandidates.filter(m => m.shiftId === 'a')).toHaveLength(0)

    const tooBig = computeDayFacts(
      DATE,
      [
        shift({ id: 'a', boat: 'Curaçao', boatCapacity: 12, guestCount: 10 }),
        shift({ id: 'b', boat: 'Diana', boatCapacity: 8, startAt: '2026-07-05T14:00:00Z', endAt: '2026-07-05T16:00:00Z' }),
      ],
      [],
      [],
    )
    expect(tooBig.mergeCandidates.filter(m => m.shiftId === 'a')).toHaveLength(0)
  })
})

describe('computeDayFacts — staffing & maintenance', () => {
  it('counts open shifts, distinct captains, and spare available captains', () => {
    const facts = computeDayFacts(
      DATE,
      [
        shift({ id: 'a', staffId: 's1', staffName: 'Jip' }),
        shift({ id: 'b', boat: 'Curaçao', boatCapacity: 12, startAt: '2026-07-05T14:00:00Z', endAt: '2026-07-05T16:00:00Z', staffId: null, staffName: null, status: 'open' }),
      ],
      [
        { id: 's1', name: 'Jip' },
        { id: 's2', name: 'Janneke' },
      ],
      [],
    )
    expect(facts.openShifts).toBe(1)
    expect(facts.distinctCaptains).toBe(1)
    expect(facts.spareCaptains).toEqual(['Janneke'])
  })

  it('flags a blocking maintenance task only for boats actually sailing', () => {
    const facts = computeDayFacts(
      DATE,
      [shift({ id: 'a', boat: 'Diana' })],
      [],
      [
        { boat: 'Diana', title: 'Bilge pump broken' },
        { boat: 'Curaçao', title: 'Scratch in hull' }, // not sailing → no conflict
      ],
    )
    expect(facts.maintenanceConflicts).toEqual([{ boat: 'Diana', task: 'Bilge pump broken' }])
  })
})

describe('renderFacts', () => {
  it('renders the numbers the agent must cite — idle minutes, €, capacity note', () => {
    const shifts = [
      shift({ id: 'a', startAt: '2026-07-05T10:00:00Z', endAt: '2026-07-05T12:00:00Z' }),
      shift({ id: 'b', startAt: '2026-07-05T13:30:00Z', endAt: '2026-07-05T15:00:00Z' }),
    ]
    const facts = computeDayFacts(DATE, shifts, [], [])
    const block = renderFacts(facts, shifts)

    expect(block).toContain('90 min idle')
    expect(block).toContain('€45.00')
    expect(block).toContain('shared (flexible)')
    expect(block).toContain('captains on the water: 1')
  })
})

describe('validateRecommendations', () => {
  const valid = {
    type: 'consolidate_gap',
    summary: 'Shift the 15:00 shared cruise to 13:30',
    why: '90 min idle on Diana ≈ €45',
    est_saving_cents: 4500,
    guest_impact: 'low',
    requires_guest_contact: true,
    confidence: 0.7,
  }

  it('accepts a well-formed recommendation and drops malformed ones', () => {
    const result = validateRecommendations([
      valid,
      { ...valid, type: 'invented_type' }, // unknown type
      { ...valid, est_saving_cents: 'lots' }, // wrong type
      'not even an object',
    ])
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('consolidate_gap')
  })

  it('returns [] for non-array input', () => {
    expect(validateRecommendations(undefined)).toEqual([])
    expect(validateRecommendations({})).toEqual([])
  })
})
