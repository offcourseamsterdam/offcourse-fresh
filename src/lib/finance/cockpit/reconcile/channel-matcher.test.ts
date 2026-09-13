import { describe, it, expect } from 'vitest'
import { matchTransactionToPayout, type CandidatePool } from './channel-matcher'

const mockPool: CandidatePool = {
  viator: [
    {
      id: 'viator-1',
      document_number: 'VI0000000274502',
      advice_date: '2026-07-08',
      total_amount_cents: 173492,
      raw_filename: 'VI0000000274502.xlsx',
    },
  ],
  gyg: [
    {
      id: 'gyg-1',
      payment_number: 'GPS804000809655',
      payment_run_date: '2026-07-06',
      amount_cents: 104814,
    },
  ],
  boatlocal: [
    {
      id: 'bl-1',
      invoice_number: 'BL-2026-04-OP-0001',
      issue_date: '2026-05-08',
      operator_payout_cents: 247789,
      vat_9_in_payout_cents: 20459,
    },
  ],
  fareharbor: [
    {
      id: 'fh-1',
      payout_id: '15365967',
      payout_date: '2025-06-29',
      bank_payout_date: '2025-07-01',
      net_cents: 47002,
      vat9_cents: 3886,
      vat21_cents: 0,
      subtotal_paid_cents: 43174,
    },
  ],
}

describe('channel-matcher', () => {
  it('matches Viator transaction by exact amount', () => {
    const res = matchTransactionToPayout(
      {
        amountCents: 173492,
        description: 'Payment from Viator Limited',
        reference: '1772371',
        createdAt: '2026-07-09T10:00:00Z',
      },
      mockPool
    )

    expect(res).not.toBeNull()
    expect(res?.channel).toBe('viator')
    expect(res?.recordId).toBe('viator-1')
    expect(res?.vat9Cents).toBe(14325)
    expect(res?.confidence).toBe(1.0)
  })

  it('matches GetYourGuide transaction by exact amount', () => {
    const res = matchTransactionToPayout(
      {
        amountCents: 104814,
        description: 'Payment from GetYourGuide Deutschland GmbH',
        reference: 'GETYOURGUIDE PAYMENT JULY',
        createdAt: '2026-07-07T10:00:00Z',
      },
      mockPool
    )

    expect(res).not.toBeNull()
    expect(res?.channel).toBe('getyourguide')
    expect(res?.recordId).toBe('gyg-1')
    expect(res?.reference).toBe('GPS804000809655')
  })

  it('matches BoatLocal transaction by invoice number', () => {
    const res = matchTransactionToPayout(
      {
        amountCents: 247789,
        description: 'Payment from Boat Local',
        reference: 'BL-2026-04-OP-0001',
        createdAt: '2026-07-16T10:00:00Z',
      },
      mockPool
    )

    expect(res).not.toBeNull()
    expect(res?.channel).toBe('boatlocal')
    expect(res?.recordId).toBe('bl-1')
    expect(res?.vat9Cents).toBe(20459)
  })

  it('matches FareHarbor transaction by exact amount', () => {
    const res = matchTransactionToPayout(
      {
        amountCents: 47002,
        description: 'FHOFFCOURSE payout',
        reference: '15365967',
        createdAt: '2025-07-01T10:00:00Z',
      },
      mockPool
    )

    expect(res).not.toBeNull()
    expect(res?.channel).toBe('fareharbor')
    expect(res?.recordId).toBe('fh-1')
    expect(res?.vat9Cents).toBe(3886)
  })

  it('returns null for unrelated transaction', () => {
    const res = matchTransactionToPayout(
      {
        amountCents: 5000,
        description: 'Random deposit',
        reference: null,
        createdAt: '2026-07-01T10:00:00Z',
      },
      mockPool
    )

    expect(res).toBeNull()
  })
})
