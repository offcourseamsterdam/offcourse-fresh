import { describe, it, expect } from 'vitest'
import { computeInvoiceDueDate } from './invoicing'

describe('computeInvoiceDueDate', () => {
  it('computes due date as exactly 14 days after the tour date', () => {
    const { dueDateFormatted, dueDateTimestamp } = computeInvoiceDueDate('2026-09-15', 14)
    expect(dueDateFormatted).toBe('2026-09-29')
    expect(dueDateTimestamp).toBeGreaterThan(0)
  })

  it('handles custom days after tour (e.g. 30 days)', () => {
    const { dueDateFormatted } = computeInvoiceDueDate('2026-09-01', 30)
    expect(dueDateFormatted).toBe('2026-10-01')
  })

  it('guarantees dueDateTimestamp is in the future for Stripe requirement', () => {
    const pastTourDate = '2020-01-01'
    const { dueDateTimestamp } = computeInvoiceDueDate(pastTourDate, 14)
    const nowTimestamp = Math.floor(Date.now() / 1000)
    expect(dueDateTimestamp).toBeGreaterThan(nowTimestamp)
  })
})
