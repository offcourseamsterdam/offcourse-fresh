import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { parseGetYourGuidePaymentText, parseGetYourGuidePaymentPdf } from './getyourguide-payment'

// Flattened text content mirrors what pdfjs extracts from a real GetYourGuide
// "Your payment is confirmed" PDF (see the PR/session notes for the source).
const SAMPLE_TEXT = `Zoomers & Schenk Rederij  93 Herenmarkt  1013 EL Amsterdam  Netherlands  VAT: NL867981374B01  Payment number   GPS804000809655  Payment run date   July 6, 2026  Account number   607167  GetYourGuide Deutschland GmbH Sonnenburger Strasse 71-75 10437 Berlin Germany  supplier@getyourguide.com www.getyourguide.com  Amtsgericht Charlottenburg HRB 132059 VAT ID No. DE276456081 Managing Directors: Johannes Reck, Tao Tao, Nils Chrestin  Payment Confirmation   GPS804000809655  Amount (EUR)  30-June-2026   Invoice GIS-000100644089   1,048.14  Total Payment   1,048.14  The total balance will be transferred to the following bank account:`

describe('parseGetYourGuidePaymentText', () => {
  it('extracts the payment number, run date, account number, invoice number and total', () => {
    const payment = parseGetYourGuidePaymentText(SAMPLE_TEXT)
    expect(payment).toEqual({
      paymentNumber: 'GPS804000809655',
      paymentRunDate: '2026-07-06',
      accountNumber: '607167',
      invoiceNumber: 'GIS-000100644089',
      amountCents: 104814,
    })
  })

  it('handles four-figure totals with thousands separators', () => {
    const text = SAMPLE_TEXT.replaceAll('1,048.14', '12,345.67')
    const payment = parseGetYourGuidePaymentText(text)
    expect(payment.amountCents).toBe(1234567)
  })

  it('returns all-null fields without crashing on unrecognised text', () => {
    const payment = parseGetYourGuidePaymentText('not a getyourguide payment at all')
    expect(payment).toEqual({
      paymentNumber: null,
      paymentRunDate: null,
      accountNumber: null,
      invoiceNumber: null,
      amountCents: null,
    })
  })
})

describe('parseGetYourGuidePaymentPdf', () => {
  // 30s: generates a real PDF with pdf-lib and parses it back through pdfjs.
  // Both are genuinely slow (~2-4s) and slower still under the full suite's
  // parallel CPU load — the default 5s is not enough headroom.
  it('parses a real PDF end-to-end through pdfjs (synthetic fixture, not a real payout document)', async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([600, 400])
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const lines = SAMPLE_TEXT.split('  ').filter(Boolean)
    lines.forEach((line, i) => {
      page.drawText(line.trim(), { x: 20, y: 380 - i * 14, size: 9, font })
    })
    const buffer = Buffer.from(await pdf.save())

    const payment = await parseGetYourGuidePaymentPdf(buffer)
    expect(payment).toEqual({
      paymentNumber: 'GPS804000809655',
      paymentRunDate: '2026-07-06',
      accountNumber: '607167',
      invoiceNumber: 'GIS-000100644089',
      amountCents: 104814,
    })
  }, 30_000)
})
