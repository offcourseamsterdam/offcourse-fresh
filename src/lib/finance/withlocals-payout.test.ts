import { describe, it, expect } from 'vitest'
import { parseWithlocalsPayoutText } from './withlocals-payout'

// Real payout email body text (payout of €841.46, 1 July 2026). Guest first
// names are as they appear — kept minimal; these are the payout table rows.
const PAYOUT_TEXT = `Hi there,

We have prepared a new payout of €841.46 for you. Your payment is now being processed and will be sent to your account.

Payout details

Trip date & time Booking ID Guest Amount
Sunday, June 21, 2026 at 15:00 91ed6b24 Barbara €168.30
Trip date & time Booking ID Guest Amount
Wednesday, June 3, 2026 at 14:30 0d608c77 Errin €168.28
Trip date & time Booking ID Guest Amount
Wednesday, June 10, 2026 at 19:00 470bf92c Susan €168.30
Trip date & time Booking ID Guest Amount
Saturday, June 20, 2026 at 12:30 69f40f0f cameron €168.28
Trip date & time Booking ID Guest Amount
Thursday, June 25, 2026 at 21:30 15d20afd Samantha €168.30

Withlocals BV - Ten Hagestraat 4 - 5611 EG Eindhoven`

describe('parseWithlocalsPayoutText', () => {
  it('reads the headline payout total', () => {
    expect(parseWithlocalsPayoutText(PAYOUT_TEXT).totalCents).toBe(84146)
  })

  it('extracts every booking line', () => {
    const { lines } = parseWithlocalsPayoutText(PAYOUT_TEXT)
    expect(lines).toHaveLength(5)
    expect(lines[0]).toEqual({
      tripAt: 'Sunday, June 21, 2026 at 15:00',
      bookingId: '91ed6b24',
      guest: 'Barbara',
      amountCents: 16830,
    })
    expect(lines.map(l => l.bookingId)).toEqual(['91ed6b24', '0d608c77', '470bf92c', '69f40f0f', '15d20afd'])
  })

  it('the line amounts sum to the headline total (bank-reconciliation check)', () => {
    const p = parseWithlocalsPayoutText(PAYOUT_TEXT)
    expect(p.linesTotalCents).toBe(84146)
    expect(p.linesTotalCents).toBe(p.totalCents)
  })

  it('returns an empty line list (not a throw) when there are no rows', () => {
    const p = parseWithlocalsPayoutText('a new payout of €0.00 for you')
    expect(p.totalCents).toBe(0)
    expect(p.lines).toEqual([])
    expect(p.linesTotalCents).toBe(0)
  })
})
