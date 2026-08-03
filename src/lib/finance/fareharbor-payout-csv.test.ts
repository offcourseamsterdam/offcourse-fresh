import { describe, it, expect } from 'vitest'
import { parseFareHarborPayoutCsv } from './fareharbor-payout-csv'

// Header row shape matches the real "Sales-Payout Reconciliation" Detailed
// report, grouped by Payout ID, with "Payout Date" added as a column —
// "Payout ID" appears twice (grouping column + the date-lookup column).
const HEADER =
  'Payout ID,Created At,Payment or Refund ID,Gross,Processing Fee,Net,Payment Gross,Payment Processing Fee,Payment Net,Refund Gross,Refund Processing Fee,Refund Net,Subtotal Paid,BTW Laag (9%) Paid,BTW Hoog (21%) Paid,Tax Paid,Payout ID,Payout Date,Booking ID,Item,Availability'
const TITLE_ROW = ',Sales,,,,,,,,,,,,,,,,,Bookings,,'

describe('parseFareHarborPayoutCsv', () => {
  it('aggregates two detail rows sharing the same Payout ID into one payout', () => {
    const csv = [
      TITLE_ROW,
      HEADER,
      '#15365967,2025-06-27 @ 17:06,#214532494,€200.20,-€0.29,€199.91,€200.20,-€0.29,€199.91,€0.00,€0.00,€0.00,€183.67,€16.53,€0.00,€16.53,#15365967,2025-06-29,#293301006,Private Cruise,2025-06-29 @ 12:00',
      '#15365967,2025-06-27 @ 22:14,#214594437,€270.40,-€0.29,€270.11,€270.40,-€0.29,€270.11,€0.00,€0.00,€0.00,€248.07,€22.33,€0.00,€22.33,#15365967,2025-06-29,#293378989,Private Cruise,2025-07-11 @ 14:00',
    ].join('\n')

    const rows = parseFareHarborPayoutCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      payoutId: '15365967',
      payoutDate: '2025-06-29',
      grossCents: 47060,
      processingFeeCents: -58,
      netCents: 47002,
      subtotalPaidCents: 43174,
      vat9Cents: 3886,
      vat21Cents: 0,
      taxPaidCents: 3886,
      lineCount: 2,
    })
  })

  it('parses a single-line payout correctly', () => {
    const csv = [
      TITLE_ROW,
      HEADER,
      '#15217696,2025-06-11 @ 10:32,#211959579,€312.78,-€7.18,€305.60,€312.78,-€7.18,€305.60,€0.00,€0.00,€0.00,€286.95,€25.83,€0.00,€25.83,#15217696,2025-06-13,#289619317,Private Cruise,2025-06-15 @ 15:00',
    ].join('\n')

    const rows = parseFareHarborPayoutCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      payoutId: '15217696', payoutDate: '2025-06-13',
      grossCents: 31278, netCents: 30560, vat9Cents: 2583, lineCount: 1,
    })
  })

  it('skips the blank-Payout-ID bucket (payments with no assigned payout batch) and the grand-total row', () => {
    const csv = [
      TITLE_ROW,
      HEADER,
      '#15217696,2025-06-11 @ 10:32,#211959579,€312.78,-€7.18,€305.60,€312.78,-€7.18,€305.60,€0.00,€0.00,€0.00,€286.95,€25.83,€0.00,€25.83,#15217696,2025-06-13,#289619317,Private Cruise,2025-06-15 @ 15:00',
      ',,#999999999,€100.00,€0.00,€100.00,€100.00,€0.00,€100.00,€0.00,€0.00,€0.00,€91.74,€8.26,€0.00,€8.26,,,#999999999,Private Cruise,',
      '58 Payout IDs,,,€60629.60,-€315.74,€60313.86,,,,,,,,,,',
    ].join('\n')

    const rows = parseFareHarborPayoutCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].payoutId).toBe('15217696')
  })

  it('returns an empty array when no Payout ID header is found', () => {
    expect(parseFareHarborPayoutCsv('foo,bar\n1,2')).toEqual([])
  })

  it('handles negative amounts (refund-heavy payouts)', () => {
    const csv = [
      TITLE_ROW,
      HEADER,
      '#15931731,2025-09-01 @ 10:00,#300000000,-€70.00,€1.84,-€68.16,€0.00,€0.00,€0.00,-€70.00,€1.84,-€68.16,-€64.22,-€5.78,€0.00,-€5.78,#15931731,2025-09-02,#300000001,Private Cruise,',
    ].join('\n')

    const rows = parseFareHarborPayoutCsv(csv)
    expect(rows[0].netCents).toBe(-6816)
    expect(rows[0].vat9Cents).toBe(-578)
  })
})
