import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { parseViatorSheetRows, parseViatorPaymentAdviceFile } from './viator-payment-advice'

// Shape mirrors a real Viator "Payment Advice" export: header/address block,
// a blank row, the data table (header row + line items), then a TOTAL PAYMENT
// row using the same column as CONVERTED AMOUNT.
function sampleRows(): unknown[][] {
  return [
    [null, 'PAYMENT ADVICE', null, null, null, null, null, null, '08-Jul-26'],
    [],
    [null, 'From:'],
    [null, 'Viator, Inc.'],
    [],
    [
      null, 'VIATOR REFERENCE', 'ARRIVAL DATE', 'SALE DATE', 'VENDOR REFERENCE',
      'AMOUNT', 'CURRENCY', 'CONVERTED AMOUNT', 'CONVERTED CURRENCY',
      'TOUR GRADE CODE', 'TOUR GRADE TITLE',
    ],
    [null, '1395016905', '06/05/2026', '06/03/2026', 'P5', '48.10', 'USD', '40.6', 'EUR', 'TG1', 'Hidden Gems Cruise 15:30'],
    [null, '1402020647', '06/28/2026', '05/25/2026', 'P5', '-47.48', 'USD', '40.6', 'EUR', 'TG1', 'Hidden Gems Cruise 21:30'],
    [null, '1402020647', '06/28/2026', '06/18/2026', 'P5', '-47.48', 'USD', '-40.6', 'EUR', 'TG1', 'Hidden Gems Cruise 21:30'],
    [null, '1403096545', '06/03/2026', '05/27/2026', 'P8', '1259574.00', 'COP', '296.0', 'EUR', 'TG3', 'Embarcación Diana : 2 Hrs - Max 8 ppl 19:00'],
    [null, 'TOTAL PAYMENT', null, null, null, null, null, '1734.92'],
    [],
    [null, 'Please note new postal address:'],
  ]
}

describe('parseViatorSheetRows', () => {
  it('extracts the advice date from the header block', () => {
    const advice = parseViatorSheetRows(sampleRows())
    expect(advice.adviceDate).toBe('2026-07-08')
  })

  it('extracts the document number from the filename', () => {
    const advice = parseViatorSheetRows(sampleRows(), 'VI0000000274502_EUR_20260708_EUR_SUP_BNK.xlsx')
    expect(advice.documentNumber).toBe('VI0000000274502')
  })

  it('parses each line item with dates converted to ISO and amounts to cents', () => {
    const advice = parseViatorSheetRows(sampleRows())
    expect(advice.lines[0]).toEqual({
      viatorReference: '1395016905',
      arrivalDate: '2026-06-05',
      saleDate: '2026-06-03',
      vendorReference: 'P5',
      grossAmount: 48.10,
      grossCurrency: 'USD',
      convertedAmountCents: 4060,
      tourGradeCode: 'TG1',
      tourGradeTitle: 'Hidden Gems Cruise 15:30',
    })
  })

  it('keeps a currency other than USD/EUR (e.g. COP) as reported, using the converted EUR cents', () => {
    const advice = parseViatorSheetRows(sampleRows())
    const cop = advice.lines.find(l => l.grossCurrency === 'COP')
    expect(cop).toMatchObject({ grossAmount: 1259574, convertedAmountCents: 29600 })
  })

  it('keeps duplicate references with differing converted signs as separate lines (refund reversal pairs)', () => {
    const advice = parseViatorSheetRows(sampleRows())
    const dupes = advice.lines.filter(l => l.viatorReference === '1402020647')
    expect(dupes).toHaveLength(2)
    expect(dupes.map(l => l.convertedAmountCents)).toEqual([4060, -4060])
  })

  it('reads TOTAL PAYMENT as the batch total and stops parsing lines after it', () => {
    const advice = parseViatorSheetRows(sampleRows())
    expect(advice.totalAmountCents).toBe(173492)
    expect(advice.lines).toHaveLength(4)
  })

  it('falls back to AMOUNT/CURRENCY when CONVERTED AMOUNT is omitted (all-EUR advice)', () => {
    // Real-world case: when every line in the advice is already EUR, Viator
    // drops the CONVERTED AMOUNT/CONVERTED CURRENCY columns entirely instead
    // of repeating the same figure.
    const rows: unknown[][] = [
      [null, 'PAYMENT ADVICE', null, null, null, null, null, '09-Feb-26'],
      [
        null, 'VIATOR REFERENCE', 'ARRIVAL DATE', 'SALE DATE', 'VENDOR REFERENCE',
        'AMOUNT', 'CURRENCY', 'TOUR GRADE CODE', 'TOUR GRADE TITLE',
      ],
      [null, '1354491371', '01/28/2026', '01/26/2026', 'P5', '114.84', 'EUR', 'TG1', 'Geheime Amsterdam Boottocht 13:30'],
      [null, '1357441801', '01/29/2026', '01/28/2026', 'P8', '183.15', 'EUR', 'TG2', '1.5 Hour Private Cruise 14:00'],
      [null, 'TOTAL PAYMENT', null, null, null, '297.99'],
    ]

    const advice = parseViatorSheetRows(rows)
    expect(advice.totalAmountCents).toBe(29799)
    expect(advice.lines).toHaveLength(2)
    expect(advice.lines[0]).toMatchObject({ grossAmount: 114.84, grossCurrency: 'EUR', convertedAmountCents: 11484 })
    expect(advice.lines[1]).toMatchObject({ grossAmount: 183.15, grossCurrency: 'EUR', convertedAmountCents: 18315 })
  })

  it('returns an empty result without crashing when no header row is found', () => {
    const advice = parseViatorSheetRows([[null, 'Not a payment advice']])
    expect(advice).toEqual({ documentNumber: null, adviceDate: null, totalAmountCents: null, lines: [] })
  })
})

describe('parseViatorPaymentAdviceFile', () => {
  it('parses a real .xlsx buffer end-to-end through exceljs', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('VIATOR PAYMENT ADVICE')
    sampleRows().forEach(row => sheet.addRow(row))
    const buffer = await workbook.xlsx.writeBuffer()

    const advice = await parseViatorPaymentAdviceFile(buffer as unknown as Buffer, 'VI0000000274502_EUR_20260708_EUR_SUP_BNK.xlsx')

    expect(advice.documentNumber).toBe('VI0000000274502')
    expect(advice.adviceDate).toBe('2026-07-08')
    expect(advice.totalAmountCents).toBe(173492)
    expect(advice.lines).toHaveLength(4)
  })
})
