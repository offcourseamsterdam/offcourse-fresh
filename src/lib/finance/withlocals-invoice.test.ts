import { describe, it, expect } from 'vitest'
import { parseWithlocalsInvoiceText, parseWithlocalsInvoicePdf } from './withlocals-invoice'

// Real flattened text of a Withlocals invoice PDF (invoice #0707022). The only
// identifiers here are Off Course's own entity + a booking UUID — no guest PII
// (the invoice never names the guest; that's only in the payout email).
const INVOICE_TEXT = `Billed To:  Rederij Zoomers & Schenk Herenmarkt 93A 1013EC Amsterdam NL VAT Reg. Nr.: 223259287 Customer ID: c-8fd0a663-558e-4988-8343- 12606279b32e  Withlocals B.V.  info@withlocals.com Ten Hagestraat 4 5611 EG Eindhoven The Netherlands VAT Reg. Nr.: NL852909470B01  Status: Paid   Invoice Date:  Monday May 18 2026, 16:11  Service Delivered  Booking description: 'Secret Amsterdam Boat Tour: Off the Beaten Canals' on 2026-06-21T15:00 with 3 guests Booking identifier:   91ed6b24-d955-4ef6-ab38-21882150b43f  Item   Qty   Price  Tour price   1   € 247.50  Charges to host   Amount (incl. VAT)   VAT (21%)   Amount (ex. VAT)  Service fee Withlocals   32%   € 79.20   € 13.75   € 65.45 Net charges   € 79.20   € 13.75   € 65.45  Payment by guest   Amount  Paid to withlocals   € 247.50  Net payable to host by Withlocals   € 168.30  Total payment received: € 168.30 from Withlocals.  Important:   As a host you are responsible for determining the applicable tax laws related to the payment you receive.  Invoice   Invoice number # 0707022`

// A second real invoice (#0718534) — 4 guests, larger amounts — to prove the
// parser isn't overfit to one row.
const INVOICE_TEXT_2 = `Invoice Date:  Sunday July 12 2026, 16:42  Service Delivered  Booking description: 'Secret Amsterdam Boat Tour: Off the Beaten Canals' on 2026-07-19T09:30 with 4 guests Booking identifier:   708c3e55-51aa-4b2a-afd1-373cb0aff798  Item   Qty   Price  Tour price   1   € 320.00  Charges to host   Amount (incl. VAT)   VAT (21%)   Amount (ex. VAT)  Service fee Withlocals   32%   € 102.40   € 17.77   € 84.63 Net charges   € 102.40   € 17.77   € 84.63  Payment by guest   Amount  Paid to withlocals   € 320.00  Net payable to host by Withlocals   € 217.60  Total payment received: € 217.60 from Withlocals.  Invoice number # 0718534`

describe('parseWithlocalsInvoiceText', () => {
  it('extracts every field from a real invoice', () => {
    expect(parseWithlocalsInvoiceText(INVOICE_TEXT)).toEqual({
      bookingId: '91ed6b24-d955-4ef6-ab38-21882150b43f',
      invoiceNumber: '0707022',
      invoiceDate: '2026-05-18',
      tourName: 'Secret Amsterdam Boat Tour: Off the Beaten Canals',
      tripAt: '2026-06-21T15:00',
      guestCount: 3,
      tourPriceCents: 24750,
      serviceFeeInclCents: 7920,
      serviceFeeVatCents: 1375,
      serviceFeeExCents: 6545,
      netPayoutCents: 16830,
    })
  })

  it('parses a second invoice with different amounts and guest count', () => {
    const inv = parseWithlocalsInvoiceText(INVOICE_TEXT_2)
    expect(inv.invoiceNumber).toBe('0718534')
    expect(inv.guestCount).toBe(4)
    expect(inv.tourPriceCents).toBe(32000)
    expect(inv.serviceFeeInclCents).toBe(10240)
    expect(inv.serviceFeeVatCents).toBe(1777)
    expect(inv.netPayoutCents).toBe(21760)
  })

  it('the economics reconcile: tour price − service fee = net payout', () => {
    const inv = parseWithlocalsInvoiceText(INVOICE_TEXT)
    expect(inv.tourPriceCents! - inv.serviceFeeInclCents!).toBe(inv.netPayoutCents!)
    // and the fee's own VAT split adds up
    expect(inv.serviceFeeExCents! + inv.serviceFeeVatCents!).toBe(inv.serviceFeeInclCents!)
  })

  it('returns nulls, not throws, on unrelated text', () => {
    const inv = parseWithlocalsInvoiceText('this is not a withlocals invoice')
    expect(inv.bookingId).toBeNull()
    expect(inv.tourPriceCents).toBeNull()
    expect(inv.netPayoutCents).toBeNull()
  })
})

describe('parseWithlocalsInvoicePdf', () => {
  // 30s: generates a real PDF with pdf-lib and parses it back through pdfjs.
  // Both are genuinely slow (~2-4s) and slower still under the full suite's
  // parallel CPU load — the default 5s is not enough headroom.
  it('parses a generated PDF end-to-end through pdfjs (synthetic fixture)', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib')
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([600, 850])
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const words = INVOICE_TEXT.split(' ').filter(Boolean)
    let x = 20, y = 820
    for (const word of words) {
      if (x > 550) { x = 20; y -= 14 }
      page.drawText(word, { x, y, size: 8, font })
      x += word.length * 5 + 6
    }
    const buffer = Buffer.from(await pdf.save())

    const inv = await parseWithlocalsInvoicePdf(buffer)
    expect(inv.bookingId).toBe('91ed6b24-d955-4ef6-ab38-21882150b43f')
    expect(inv.netPayoutCents).toBe(16830)
  }, 30_000)
})
