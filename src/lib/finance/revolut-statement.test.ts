import { describe, it, expect } from 'vitest'
import { parseRevolutStatementCsv, guessRevolutVatSplit } from './revolut-statement'

const HEADER =
  'Date & Time Started (UTC),Date & Time Completed (UTC),State,Type,Description,Invoice reference,Original currency,Original amount,Settlement currency,Settlement amount,Exchange rate,Fee currency,FX fee,Processing fee,Balance,Account,Business legal name,Transaction ID,Related transaction ID,Order ID,Order merchant external reference,Checkout browser URL,Order description,Order channel,Customer note,Order line items,Customer name,Customer email,Customer card number,Card brand,Card type,Card country,Card category,Order created by,Order total tip amount,Order custom field name,Order custom field value,Payment method,Amount refunded in settlement currency,Statement descriptor,Terminal hardware ID,Tip amount,Location name,Payment initiated by,Offline payment state,Order authorisation type,Payment Authorisation Date & Time (UTC),Payment Capture Date & Time (UTC),Processing fee type'

describe('parseRevolutStatementCsv', () => {
  it('parses a Settlement row and assigns its payoutDate from the Transfer that swept it', () => {
    const csv = [
      HEADER,
      '2025-08-20 15:03:17.394276,2025-08-21 15:03:20.66091,COMPLETED,Settlement,Settlement for joanie.kwok@gmail.com,,EUR,410.00,EUR,398.32,1.0000,EUR,0.00,-11.68,742.14,EUR Merchant,Rederij Zoomers & Schenk,68a5e3b5-34f8-af01-9331-7a47771bd82e,,68a5e3ad-0190-ad23-bc57-cf0941be1cba,,,Sail 21 August 1.5 hour tour,LINK,,[],Joanie Kwok,joanie.kwok@gmail.com,493253******5370,VISA,CREDIT,US,consumer,Jannah Schenk,,,,APPLE_PAY,0.00,Off Course*AMSTERDAM,,,,,,,2025-08-20 15:03:17.339,2025-08-20 15:03:19.042,Online - International consumer card',
      '2025-08-22 02:04:20.403029,2025-08-22 02:04:20.455833,COMPLETED,Transfer,Merchant payout to an internal account,,EUR,-742.14,EUR,-742.14,1.0000,EUR,0.00,0.00,0.00,EUR Merchant,Rederij Zoomers & Schenk,68a7d024-5512-ace8-96c2-3123dfc6b73d,,,,,,,,[],,,,,,,,,,,,,,,,,,,,,,,',
    ].join('\n')

    const rows = parseRevolutStatementCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      transactionId: '68a5e3b5-34f8-af01-9331-7a47771bd82e',
      occurredAt: '2025-08-20',
      payoutDate: '2025-08-22', // NOT the settlement date — when the Transfer actually happened
      description: 'Sail 21 August 1.5 hour tour',
      customerName: 'Joanie Kwok',
      originalAmountCents: 41000,
      settlementAmountCents: 39832,
      processingFeeCents: 1168,
    })
  })

  it('assigns the SAME payout date to multiple settlements swept by one Transfer', () => {
    const csv = [
      HEADER,
      '2025-08-20 05:02:18.202,2025-08-21 05:03:07.638647,COMPLETED,Settlement,Settlement for a@example.com,,EUR,347.50,EUR,343.82,1.0000,EUR,0.00,-3.68,343.82,EUR Merchant,Rederij Zoomers & Schenk,tx-a,,,,,,,,[],,,,,,,,,,,,,,,,,,,,,,,',
      '2025-08-20 15:03:17.339,2025-08-21 15:03:20.66091,COMPLETED,Settlement,Settlement for b@example.com,,EUR,410.00,EUR,398.32,1.0000,EUR,0.00,-11.68,742.14,EUR Merchant,Rederij Zoomers & Schenk,tx-b,,,,,,,,[],,,,,,,,,,,,,,,,,,,,,,,',
      '2025-08-22 02:04:20.403029,2025-08-22 02:04:20.455833,COMPLETED,Transfer,Merchant payout to an internal account,,EUR,-742.14,EUR,-742.14,1.0000,EUR,0.00,0.00,0.00,EUR Merchant,Rederij Zoomers & Schenk,tx-transfer,,,,,,,,[],,,,,,,,,,,,,,,,,,,,,,,',
    ].join('\n')

    const rows = parseRevolutStatementCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.payoutDate === '2025-08-22')).toBe(true)
  })

  it('leaves payoutDate null for a settlement with no Transfer after it yet (still unpaid)', () => {
    const csv = [
      HEADER,
      '2026-07-16 11:51:57.039737,2026-07-16 11:51:58.405308,COMPLETED,Settlement,Payment from E Van Erkelens,,EUR,304.30,EUR,301.06,1.0000,EUR,0.00,-3.24,853.21,EUR Merchant,Rederij Zoomers & Schenk,tx-unpaid,,,,,,,,[],,,,,,,,,,,,,,,,,,,,,,,',
    ].join('\n')

    const rows = parseRevolutStatementCsv(csv)
    expect(rows[0].payoutDate).toBeNull()
  })

  it('orders by COMPLETION time, not start time — a settlement completing after a Transfer waits for the NEXT one', () => {
    // Real account data: a settlement starting 08-22 16:25 completes 08-23 16:26 (a ~24h
    // settlement delay is normal for Revolut). The 08-24 02:00 Transfer only pays out
    // settlements that had already COMPLETED by then — this one had, so it's included —
    // but two others (completing 08-24 06:04 and 08-24 09:46) complete AFTER that transfer
    // and must wait for the 08-25 one instead. Sorting by start time alone gets this wrong.
    const csv = [
      HEADER,
      '2025-08-22 16:25:46.178901,2025-08-23 16:26:19.56599,COMPLETED,Settlement,Settlement for jobvanasch@gmail.com,,EUR,300.00,EUR,296.80,1.0000,EUR,0.00,-3.20,296.80,EUR Merchant,Rederij Zoomers & Schenk,tx-jobvanasch,,,,,,,,[],,,,,,,,,,,,,,,,,,,,,,,',
      '2025-08-23 06:03:32.164561,2025-08-24 06:04:44.802881,COMPLETED,Settlement,Sail trip 23 august,,EUR,364.60,EUR,360.75,1.0000,EUR,0.00,-3.85,360.75,EUR Merchant,Rederij Zoomers & Schenk,tx-frank,,,,,,,,[],,,,,,,,,,,,,,,,,,,,,,,',
      '2025-08-23 09:44:26.005742,2025-08-24 09:46:02.950688,COMPLETED,Settlement,Sail 2025 private tour,,EUR,330.00,EUR,326.50,1.0000,EUR,0.00,-3.50,687.25,EUR Merchant,Rederij Zoomers & Schenk,tx-ananda,,,,,,,,[],,,,,,,,,,,,,,,,,,,,,,,',
      '2025-08-24 02:00:24.0717,2025-08-24 02:00:24.146684,COMPLETED,Transfer,Merchant payout to an internal account,,EUR,-296.80,EUR,-296.80,1.0000,EUR,0.00,0.00,0.00,EUR Merchant,Rederij Zoomers & Schenk,tx-transfer1,,,,,,,,[],,,,,,,,,,,,,,,,,,,,,,,',
      '2025-08-25 02:04:59.022423,2025-08-25 02:04:59.065619,COMPLETED,Transfer,Merchant payout to an internal account,,EUR,-687.25,EUR,-687.25,1.0000,EUR,0.00,0.00,0.00,EUR Merchant,Rederij Zoomers & Schenk,tx-transfer2,,,,,,,,[],,,,,,,,,,,,,,,,,,,,,,,',
    ].join('\n')

    const rows = parseRevolutStatementCsv(csv)
    const byId = Object.fromEntries(rows.map(r => [r.transactionId, r]))
    expect(byId['tx-jobvanasch'].payoutDate).toBe('2025-08-24')
    expect(byId['tx-frank'].payoutDate).toBe('2025-08-25')
    expect(byId['tx-ananda'].payoutDate).toBe('2025-08-25')
  })

  it('sorts rows chronologically regardless of the order they appear in the CSV', () => {
    // Transfer listed FIRST in the file (Revolut exports newest-first) — must still be
    // treated as happening AFTER the settlement for payout-date purposes.
    const csv = [
      HEADER,
      '2025-08-22 02:04:20.403029,2025-08-22 02:04:20.455833,COMPLETED,Transfer,Merchant payout to an internal account,,EUR,-410.00,EUR,-410.00,1.0000,EUR,0.00,0.00,0.00,EUR Merchant,Rederij Zoomers & Schenk,tx-transfer,,,,,,,,[],,,,,,,,,,,,,,,,,,,,,,,',
      '2025-08-20 15:03:17.339,2025-08-21 15:03:20.66091,COMPLETED,Settlement,Settlement for b@example.com,,EUR,410.00,EUR,398.32,1.0000,EUR,0.00,-11.68,410.00,EUR Merchant,Rederij Zoomers & Schenk,tx-b,,,,,,,,[],,,,,,,,,,,,,,,,,,,,,,,',
    ].join('\n')

    const rows = parseRevolutStatementCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].payoutDate).toBe('2025-08-22')
  })

  it('handles a quoted order description containing an embedded literal newline', () => {
    const csv = [
      HEADER,
      '2025-12-23 11:43:30.093035,2025-12-23 11:43:32.094614,COMPLETED,Settlement,Payment from L.j.m.n. Nouws E/o E.a. Sierink,,EUR,62.50,EUR,61.68,1.0000,EUR,0.00,-0.82,1191.88,EUR Merchant,Rederij Zoomers & Schenk,694a8062-8495-a1d7-b56e-caa490b6aac8,,694a8034-1e74-a642-aeb5-1ed97fa32ffc,,,"- 2 prosecco\n- 1 water",LINK,,[],,,,,,,,Jannah Schenk,,,,OPEN_BANKING,0.00,,,,,,,,2025-12-23 11:42:56.048,,Pay by Bank - Pay by Bank',
    ].join('\n')

    const rows = parseRevolutStatementCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].description).toBe('- 2 prosecco\n- 1 water')
    expect(rows[0].originalAmountCents).toBe(6250)
  })

  it('falls back to Description when Order description is blank', () => {
    const csv = [
      HEADER,
      '2025-05-25 13:41:33.261619,2025-05-25 13:41:33.459617,COMPLETED,Settlement,Payment from Someone,,EUR,50.00,EUR,49.30,1.0000,EUR,0.00,-0.70,50.00,EUR Merchant,Rederij Zoomers & Schenk,tx-fallback,,,,,,,,[],,,,,,,,,,,,,,,,,,,,,,,',
    ].join('\n')

    const rows = parseRevolutStatementCsv(csv)
    expect(rows[0].description).toBe('Payment from Someone')
  })

  it('returns an empty array for a header-only file', () => {
    expect(parseRevolutStatementCsv(HEADER)).toEqual([])
  })
})

describe('guessRevolutVatSplit', () => {
  it('suggests 100% cruise (9%) when only a cruise keyword matches', () => {
    expect(guessRevolutVatSplit('Sail 21 August 1.5 hour tour', 41000)).toEqual({
      vat9GrossCents: 41000, vat21GrossCents: 0,
    })
    expect(guessRevolutVatSplit('Tochtje Diana 10-01-2026', 26363)).toEqual({
      vat9GrossCents: 26363, vat21GrossCents: 0,
    })
  })

  it('suggests 100% extras (21%) when only an extras keyword matches', () => {
    expect(guessRevolutVatSplit('Drankjes', 4900)).toEqual({ vat9GrossCents: 0, vat21GrossCents: 4900 })
    expect(guessRevolutVatSplit('T-shirts, vrienden en familie', 3500)).toEqual({
      vat9GrossCents: 0, vat21GrossCents: 3500,
    })
  })

  it('returns null (no suggestion) when a description matches both sides', () => {
    // the real "Vaartocht sail 22 augustus 2 uur + 2 t shirts" case — actually split 250/50 by Beer
    expect(guessRevolutVatSplit('Vaartocht sail 22 augustus 2 uur + 2 t shirts', 30000)).toBeNull()
  })

  it('returns null (no suggestion) when a description matches neither side', () => {
    // the real "Aad - vrijdag 21:00" and "Josh verjaardagscadeau" cases — both turned out to be 9%,
    // but neither is guessable from the text, which is exactly why they need a human to confirm
    expect(guessRevolutVatSplit('Aad - vrijdag 21:00', 24750)).toBeNull()
    expect(guessRevolutVatSplit('Josh verjaardagscadeau', 19800)).toBeNull()
  })

  it('does not silently guess wrong on a real false-positive case', () => {
    // "Anniversary 17-06-2026 drinks+charcuterie" matches the extras keywords but Beer
    // confirmed it's actually 100% cruise (9%) — proof a single-keyword match isn't reliable
    // enough to auto-apply. This test just documents the description ends up with SOME
    // suggestion (extras, per the keywords) that a human must be free to override — it must
    // never be written as final without confirmation.
    const guess = guessRevolutVatSplit('Anniversary 17-06-2026 drinks+charcuterie', 36680)
    expect(guess).toEqual({ vat9GrossCents: 0, vat21GrossCents: 36680 })
  })
})
