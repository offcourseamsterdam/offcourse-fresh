import { describe, it, expect } from 'vitest'
import { buildOverlayModel, laneKey, STATE_STYLES } from './optimizer-overlay-model'
import type { OptimizerItem } from '@/app/api/admin/planning/optimizer/route'

function move(overrides: Partial<OptimizerItem> = {}): OptimizerItem {
  return {
    kind: 'cross_day_consolidation',
    date: '2026-08-26',
    boat: 'Diana',
    summary: 'could move',
    estSavingCents: 5000,
    bookingId: 'b1',
    state: 'possible',
    ...overrides,
  }
}

function gap(overrides: Partial<OptimizerItem> = {}): OptimizerItem {
  return {
    kind: 'same_day_gap',
    date: '2026-08-26',
    boat: 'Diana',
    summary: '90 min idle',
    estSavingCents: 3000,
    gapStartAt: '2026-08-26T14:30:00Z',
    gapEndAt: '2026-08-26T16:00:00Z',
    ...overrides,
  }
}

describe('buildOverlayModel', () => {
  it('indexes moves by booking id', () => {
    const model = buildOverlayModel([move({ bookingId: 'b1' }), move({ bookingId: 'b2' })])
    expect(model.movesByBooking.get('b1')?.bookingId).toBe('b1')
    expect(model.movesByBooking.get('b2')?.bookingId).toBe('b2')
  })

  it('indexes gaps by date+boat lane, keeping several per lane', () => {
    const model = buildOverlayModel([
      gap({ gapStartAt: '2026-08-26T12:00:00Z', gapEndAt: '2026-08-26T13:00:00Z' }),
      gap({ gapStartAt: '2026-08-26T18:00:00Z', gapEndAt: '2026-08-26T19:00:00Z' }),
      gap({ boat: 'Curaçao' }),
    ])
    expect(model.gapsByLane.get(laneKey('2026-08-26', 'Diana'))).toHaveLength(2)
    expect(model.gapsByLane.get(laneKey('2026-08-26', 'Curaçao'))).toHaveLength(1)
  })

  it('drops a gap with no span to draw rather than rendering a zero-width ghost', () => {
    const model = buildOverlayModel([gap({ gapStartAt: undefined, gapEndAt: undefined })])
    expect(model.gapsByLane.size).toBe(0)
  })

  it('ignores a move with no booking to anchor to', () => {
    const model = buildOverlayModel([move({ bookingId: undefined })])
    expect(model.movesByBooking.size).toBe(0)
  })

  it('defaults a proposal-less move to possible', () => {
    const model = buildOverlayModel([move({ state: undefined })])
    expect(model.movesByBooking.get('b1')?.state).toBe('possible')
  })

  it('counts each move into exactly one phase bucket', () => {
    const model = buildOverlayModel([
      move({ bookingId: 'b1', state: 'possible' }),
      move({ bookingId: 'b2', state: 'awaiting' }),
      move({ bookingId: 'b3', state: 'accepted' }),
      move({ bookingId: 'b4', state: 'finalized' }),
      move({ bookingId: 'b5', state: 'declined' }),
    ])
    expect(model.counts).toEqual({ possible: 1, in_progress: 2, finalized: 2 })
  })

  it('sums savings across every finding, gaps included', () => {
    const model = buildOverlayModel([move({ estSavingCents: 5000 }), gap({ estSavingCents: 2500 })])
    expect(model.totalSavingCents).toBe(7500)
  })

  it('tolerates a null saving', () => {
    const model = buildOverlayModel([move({ estSavingCents: null })])
    expect(model.totalSavingCents).toBe(0)
  })

  describe('when one booking has two competing findings', () => {
    it('prefers the live ask over an untouched draft', () => {
      const model = buildOverlayModel([
        move({ bookingId: 'b1', kind: 'cross_day_consolidation', state: 'possible' }),
        move({ bookingId: 'b1', kind: 'same_day_merge', state: 'awaiting' }),
      ])
      expect(model.movesByBooking.get('b1')?.state).toBe('awaiting')
      expect(model.movesByBooking.size).toBe(1)
    })

    it('prefers an accepted move over everything else — it needs a human', () => {
      const model = buildOverlayModel([
        move({ bookingId: 'b1', state: 'awaiting' }),
        move({ bookingId: 'b1', state: 'accepted' }),
      ])
      expect(model.movesByBooking.get('b1')?.state).toBe('accepted')
    })

    it('prefers an open draft over a finished one, so the grid shows what is still doable', () => {
      const model = buildOverlayModel([
        move({ bookingId: 'b1', state: 'declined' }),
        move({ bookingId: 'b1', state: 'possible' }),
      ])
      expect(model.movesByBooking.get('b1')?.state).toBe('possible')
    })

    it('breaks a same-state tie toward the bigger saving', () => {
      const model = buildOverlayModel([
        move({ bookingId: 'b1', state: 'possible', estSavingCents: 1000, summary: 'small' }),
        move({ bookingId: 'b1', state: 'possible', estSavingCents: 9000, summary: 'big' }),
      ])
      expect(model.movesByBooking.get('b1')?.item.summary).toBe('big')
    })

    it('counts a deduplicated booking once, not twice', () => {
      const model = buildOverlayModel([
        move({ bookingId: 'b1', state: 'possible' }),
        move({ bookingId: 'b1', state: 'awaiting' }),
      ])
      expect(model.counts.possible + model.counts.in_progress + model.counts.finalized).toBe(1)
    })
  })

  it('carries the connector targets through for drawing', () => {
    const model = buildOverlayModel([
      move({ bookingId: 'b1', kind: 'same_day_merge', toBoat: 'Curaçao' }),
      move({ bookingId: 'b2', kind: 'cross_day_consolidation', toDate: '2026-08-29' }),
    ])
    expect(model.movesByBooking.get('b1')?.toBoat).toBe('Curaçao')
    expect(model.movesByBooking.get('b2')?.toDate).toBe('2026-08-29')
  })

  it('handles an empty input', () => {
    const model = buildOverlayModel([])
    expect(model.movesByBooking.size).toBe(0)
    expect(model.gapsByLane.size).toBe(0)
    expect(model.totalSavingCents).toBe(0)
  })
})

describe('STATE_STYLES', () => {
  it('draws every terminal state muted and every live state not muted', () => {
    expect(STATE_STYLES.finalized.muted).toBe(true)
    expect(STATE_STYLES.declined.muted).toBe(true)
    expect(STATE_STYLES.expired.muted).toBe(true)
    expect(STATE_STYLES.possible.muted).toBe(false)
    expect(STATE_STYLES.awaiting.muted).toBe(false)
    expect(STATE_STYLES.accepted.muted).toBe(false)
  })

  it('never uses amber or emerald — those already mean captain status on this grid', () => {
    for (const style of Object.values(STATE_STYLES)) {
      const classes = `${style.ring} ${style.fill} ${style.text}`
      expect(classes).not.toMatch(/amber|emerald/)
    }
  })

  it('gives the accepted state the heaviest border, since it is the one needing action', () => {
    expect(STATE_STYLES.accepted.ring).toContain('border-2')
  })

  it('marks only the not-yet-sent state with a dashed border', () => {
    expect(STATE_STYLES.possible.ring).toContain('dashed')
    for (const [state, style] of Object.entries(STATE_STYLES)) {
      if (state !== 'possible') expect(style.ring).not.toContain('dashed')
    }
  })

  it('uses only real Tailwind border utilities (rings cannot be dashed)', () => {
    for (const style of Object.values(STATE_STYLES)) {
      expect(style.ring).not.toContain('ring-dashed')
    }
  })
})
