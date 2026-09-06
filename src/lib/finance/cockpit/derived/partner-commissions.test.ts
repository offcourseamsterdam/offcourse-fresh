import { describe, it, expect } from 'vitest'
import {
  partnerCommissionObligations,
  type PartnerRow,
  type PartnerBookingInput,
  type PartnerSettlementInput,
} from './partner-commissions'

describe('partnerCommissionObligations', () => {
  const partners: PartnerRow[] = [
    { id: 'p1', name: 'Things To Do In Amsterdam' },
    { id: 'p2', name: 'Fabienne Huizer' },
    { id: 'p3', name: 'Reseller Boat Local' },
  ]

  const bookings: PartnerBookingInput[] = [
    // p1 in 2026-Q3
    {
      partner_id: 'p1',
      booking_date: '2026-08-15T14:00:00Z',
      commission_amount_cents: 10000,
      booking_source: 'affiliate_link',
      campaigns: { settlement_model: 'affiliate' },
    },
    {
      partner_id: 'p1',
      booking_date: '2026-09-01T14:00:00Z',
      commission_amount_cents: 64100,
      booking_source: 'affiliate_link',
      campaigns: { settlement_model: 'affiliate' },
    },
    // p1 in 2026-Q2
    {
      partner_id: 'p1',
      booking_date: '2026-05-10T14:00:00Z',
      commission_amount_cents: 44275,
      booking_source: 'affiliate_link',
      campaigns: { settlement_model: 'affiliate' },
    },
    // p2 in 2026-Q3
    {
      partner_id: 'p2',
      booking_date: '2026-07-20T14:00:00Z',
      commission_amount_cents: 1400,
      booking_source: 'affiliate_link',
      campaigns: { settlement_model: 'affiliate' },
    },
    // p3 (reseller -> partner owes us, not an obligation for us)
    {
      partner_id: 'p3',
      booking_date: '2026-08-01T14:00:00Z',
      commission_amount_cents: 5000,
      booking_source: 'partner_invoice',
      campaigns: { settlement_model: 'reseller' },
    },
  ]

  const settlements: PartnerSettlementInput[] = [
    // Partially settle p1 in Q3 by 20000 cents
    {
      partner_id: 'p1',
      quarter: '2026-Q3',
      settlement_type: 'affiliate',
      amount_cents: 20000,
    },
  ]

  it('computes outstanding commissions owed and labels running quarters as provisional', () => {
    const proposals = partnerCommissionObligations(
      { partners, bookings, settlements },
      { today: '2026-09-05' },
    )

    // Expected:
    // p1 2026-Q2: 44275 cents, closed quarter (dueDate: 2026-07-31)
    // p1 2026-Q3: (10000 + 64100) - 20000 = 54100 cents, running quarter (dueDate: 2026-10-31)
    // p2 2026-Q3: 1400 cents, running quarter (dueDate: 2026-10-31)
    // p3: 0 proposals (reseller)

    expect(proposals).toHaveLength(3)

    const p1Q2 = proposals.find(p => p.partnerId === 'p1' && p.quarter === '2026-Q2')!
    expect(p1Q2).toBeDefined()
    expect(p1Q2.amountCents).toBe(44275)
    expect(p1Q2.dueDate).toBe('2026-07-31')
    expect(p1Q2.isProvisional).toBe(false)
    expect(p1Q2.title).toBe('Commissie Things To Do In Amsterdam (2026-Q2)')

    const p1Q3 = proposals.find(p => p.partnerId === 'p1' && p.quarter === '2026-Q3')!
    expect(p1Q3).toBeDefined()
    expect(p1Q3.amountCents).toBe(54100)
    expect(p1Q3.dueDate).toBe('2026-10-31')
    expect(p1Q3.isProvisional).toBe(true)
    expect(p1Q3.title).toContain('loopt nog')

    const p2Q3 = proposals.find(p => p.partnerId === 'p2' && p.quarter === '2026-Q3')!
    expect(p2Q3).toBeDefined()
    expect(p2Q3.amountCents).toBe(1400)
    expect(p2Q3.dueDate).toBe('2026-10-31')
    expect(p2Q3.isProvisional).toBe(true)
  })

  it('omits fully settled partners', () => {
    const fullySettled: PartnerSettlementInput[] = [
      { partner_id: 'p2', quarter: '2026-Q3', settlement_type: 'affiliate', amount_cents: 1400 },
    ]
    const proposals = partnerCommissionObligations(
      {
        partners: [{ id: 'p2', name: 'Fabienne Huizer' }],
        bookings: [
          {
            partner_id: 'p2',
            booking_date: '2026-07-20T14:00:00Z',
            commission_amount_cents: 1400,
            booking_source: 'affiliate',
            campaigns: { settlement_model: 'affiliate' },
          },
        ],
        settlements: fullySettled,
      },
      { today: '2026-09-05' },
    )

    expect(proposals).toHaveLength(0)
  })
})
