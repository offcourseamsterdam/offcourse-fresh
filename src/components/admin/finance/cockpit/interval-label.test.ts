import { describe, it, expect } from 'vitest'
import { intervalLabelNL, recurrenceLabelNL } from './interval-label'
import type { RecurrenceInterval } from '@/lib/finance/cockpit/derived/recurring'

describe('intervalLabelNL', () => {
  it('labels every known interval in Dutch', () => {
    expect(intervalLabelNL(1)).toBe('per maand')
    expect(intervalLabelNL(3)).toBe('per kwartaal')
    expect(intervalLabelNL(6)).toBe('per halfjaar')
    expect(intervalLabelNL(12)).toBe('per jaar')
  })

  it('falls back to a generic label for an unrecognised interval', () => {
    expect(intervalLabelNL(4 as RecurrenceInterval)).toBe('elke 4 maanden')
  })
})

describe('recurrenceLabelNL', () => {
  it('returns null for a one-off (no recurrence)', () => {
    expect(recurrenceLabelNL(null)).toBeNull()
    expect(recurrenceLabelNL(undefined)).toBeNull()
    expect(recurrenceLabelNL(0)).toBeNull()
  })

  it('labels the known intervals and falls back for anything else', () => {
    expect(recurrenceLabelNL(1)).toBe('per maand')
    expect(recurrenceLabelNL(12)).toBe('per jaar')
    expect(recurrenceLabelNL(2)).toBe('elke 2 maanden')
  })
})
