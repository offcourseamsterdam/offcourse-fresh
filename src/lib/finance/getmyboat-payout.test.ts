import { describe, it, expect } from 'vitest'
import { parseGetMyBoatPayoutText } from './getmyboat-payout'

// Real payout email text (names/ids kept, this is the actual example that
// shaped the parser).
const REAL_PAYOUT_TEXT = `
Your payout of €641.25 EUR is on the way

It can take 5-10 days for your banking institution to make the funds available in your account.

Getmyboat checks the identity of every customer we send you to protect you from online fraud.

Your bookings are safer with Getmyboat.

TRANSACTIONS INCLUDED:

5367603
Fri, 22 May 2026, Paige Krul
€299.25 EUR

Base Cost €299.25 EUR
5680543
Sat, 23 May 2026, Dmitrii Tiunkin
€342.00 EUR

Base Cost €342.00 EUR

Allow at least 72 hours after receiving this payout email before reaching out to Customer Service with questions.
`

describe('parseGetMyBoatPayoutText', () => {
  it('extracts the headline payout total', () => {
    const { totalCents } = parseGetMyBoatPayoutText(REAL_PAYOUT_TEXT)
    expect(totalCents).toBe(64125)
  })

  it('extracts every transaction line with booking id, date, guest, and amount', () => {
    const { lines } = parseGetMyBoatPayoutText(REAL_PAYOUT_TEXT)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      bookingId: '5367603', charterDate: '2026-05-22', guest: 'Paige Krul', amountCents: 29925,
    })
    expect(lines[1]).toEqual({
      bookingId: '5680543', charterDate: '2026-05-23', guest: 'Dmitrii Tiunkin', amountCents: 34200,
    })
  })

  it('linesTotalCents matches the headline total (this payout balances)', () => {
    const { totalCents, linesTotalCents } = parseGetMyBoatPayoutText(REAL_PAYOUT_TEXT)
    expect(linesTotalCents).toBe(totalCents)
  })

  it('parses a guest name with punctuation without breaking the row regex', () => {
    const text = `Your payout of €100.00 EUR is on the way\n\nTRANSACTIONS INCLUDED:\n\n1234567\nMon, 1 Jun 2026, O'Brien-Smith\n€100.00 EUR\n\nBase Cost €100.00 EUR\n`
    const { lines } = parseGetMyBoatPayoutText(text)
    expect(lines[0].guest).toBe("O'Brien-Smith")
  })

  it('returns no lines and null total for text with no matching content', () => {
    const { totalCents, lines } = parseGetMyBoatPayoutText('Nothing relevant here.')
    expect(totalCents).toBeNull()
    expect(lines).toEqual([])
  })
})
