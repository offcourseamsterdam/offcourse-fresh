import { describe, it, expect } from 'vitest'
import { formatMissingInvoicesMessage, missingInvoiceCutoff, type MissingInvoiceShift, MISSING_INVOICE_LOOKBACK_DAYS } from './missing'

const shift = (o: Partial<MissingInvoiceShift> = {}): MissingInvoiceShift => ({
  id: 's1',
  staffName: 'Mare',
  date: '2026-08-20',
  boatName: 'Diana',
  ...o,
})

describe('missingInvoiceCutoff', () => {
  it('is 14 days before today by default', () => {
    expect(missingInvoiceCutoff('2026-09-04')).toBe('2026-08-21')
    expect(MISSING_INVOICE_LOOKBACK_DAYS).toBe(14)
  })

  it('honours a custom lookback', () => {
    expect(missingInvoiceCutoff('2026-09-04', 7)).toBe('2026-08-28')
  })
})

describe('formatMissingInvoicesMessage', () => {
  it('returns empty string for no shifts — caller skips posting entirely', () => {
    expect(formatMissingInvoicesMessage([])).toBe('')
  })

  it('lists each shift with staff, date and boat', () => {
    const msg = formatMissingInvoicesMessage([shift(), shift({ id: 's2', staffName: 'Bas', date: '2026-08-15', boatName: 'Curaçao' })])
    expect(msg).toContain('2 diensten zonder factuur')
    expect(msg).toContain('• Mare — 2026-08-20 (Diana)')
    expect(msg).toContain('• Bas — 2026-08-15 (Curaçao)')
  })

  it('singular wording for exactly one shift', () => {
    expect(formatMissingInvoicesMessage([shift()])).toContain('1 dienst zonder factuur')
  })

  it('omits the boat parenthetical when boatName is null', () => {
    const msg = formatMissingInvoicesMessage([shift({ boatName: null })])
    expect(msg).toContain('• Mare — 2026-08-20')
    expect(msg).not.toContain('(Diana)')
  })

  it('caps the listed shifts at 20 and summarises the rest', () => {
    const many = Array.from({ length: 25 }, (_, i) => shift({ id: `s${i}`, staffName: `Staff ${i}` }))
    const msg = formatMissingInvoicesMessage(many)
    expect(msg).toContain('25 diensten zonder factuur')
    expect(msg.match(/^•/gm)?.length).toBe(20)
    expect(msg).toContain('…en nog 5 meer')
  })
})
