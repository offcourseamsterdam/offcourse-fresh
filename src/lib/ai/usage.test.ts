import { describe, it, expect } from 'vitest'
import { computeCostEurCents, crossedThresholds } from './usage'

describe('computeCostEurCents', () => {
  it('prices a typical Ghost call (Sonnet: $3/M in, $15/M out, ×0.92 EUR)', () => {
    // 1500 in + 200 out → (1500×3 + 200×15)/1M = $0.0075 → €0.0069 → 0.69 cents
    const cents = computeCostEurCents('claude-sonnet-4-20250514', 1500, 200)
    expect(cents).toBeCloseTo(0.69, 2)
  })

  it('falls back to Sonnet pricing for unknown models', () => {
    expect(computeCostEurCents('some-future-model', 1500, 200)).toBeCloseTo(0.69, 2)
  })

  it('returns 0 for zero tokens', () => {
    expect(computeCostEurCents('claude-sonnet-4-20250514', 0, 0)).toBe(0)
  })

  it('a million output tokens costs €13.80 — the scale of a runaway', () => {
    expect(computeCostEurCents('claude-sonnet-4-20250514', 0, 1_000_000)).toBeCloseTo(1380, 0)
  })
})

describe('crossedThresholds', () => {
  it('returns nothing when no €5 line is crossed', () => {
    expect(crossedThresholds(100, 400)).toEqual([]) // €1 → €4
  })

  it('detects a single crossing', () => {
    expect(crossedThresholds(480, 520)).toEqual([5]) // €4.80 → €5.20
  })

  it('detects multiple crossings in one jump', () => {
    expect(crossedThresholds(400, 1600)).toEqual([5, 10, 15]) // €4 → €16
  })

  it('does not re-alert a threshold already passed', () => {
    expect(crossedThresholds(520, 980)).toEqual([]) // €5.20 → €9.80
  })

  it('handles exact threshold landings', () => {
    expect(crossedThresholds(499.99, 500)).toEqual([5])
  })

  it('handles a fresh system starting at zero', () => {
    expect(crossedThresholds(0, 30)).toEqual([]) // first 30 cents: silence
  })
})
