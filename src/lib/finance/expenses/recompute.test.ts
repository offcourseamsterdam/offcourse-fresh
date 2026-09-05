import { describe, it, expect } from 'vitest'
import { computeExpenseState, isCostDocument, pickPrimaryDocument, vatCandidatesFrom, type DocumentRow, type ExpenseRow } from './recompute'

function expense(over: Partial<ExpenseRow> = {}): ExpenseRow {
  return {
    id: 'exp-1', ref: 'FIN-000001', status: 'waiting_for_invoice', supplier_id: null, supplier_name: 'Bol.com',
    bank_transaction_id: 'bt-1', cash_out_cents: 12100, paid_at: '2026-09-05T12:00:00Z',
    revolut_expense_id: null, revolut_expense_state: null, revolut_vat_rate_pct: null, revolut_vat_cents: null,
    primary_document_id: null, order_number: null, invoice_number: null, invoice_date: null,
    gross_cents: null, net_cents: null, vat_cents: null, vat_rate_pct: null, vat_source: null, vat_conflict: null,
    match_confidence: null, match_signals: null, matched_at: null,
    snelstart_sent_at: null, snelstart_document_id: null, snelstart_recipient: null, snelstart_message_id: null, booked_at: null,
    needs_review_reason: null, reviewed_at: null, notes: null, created_at: '2026-09-05T12:00:00Z', updated_at: '2026-09-05T12:00:00Z',
    ...over,
  }
}

function doc(over: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: 'doc-1', expense_id: 'exp-1', kind: 'invoice_pdf', source: 'email', source_message_id: null,
    revolut_expense_id: null, revolut_receipt_id: null, file_path: 'email/x/uuid.pdf', original_filename: 'factuur.pdf', mime_type: 'application/pdf',
    sha256: 'abc', extracted: null, link_url: null, link_fetch_status: null, duplicate_of: null, created_at: '2026-09-06T09:00:00Z',
    ...over,
  }
}

describe('isCostDocument / pickPrimaryDocument', () => {
  it('invoices and receipts count; an order confirmation does not; a link only once fetched', () => {
    expect(isCostDocument(doc({ kind: 'invoice_pdf' }))).toBe(true)
    expect(isCostDocument(doc({ kind: 'revolut_receipt' }))).toBe(true)
    expect(isCostDocument(doc({ kind: 'order_confirmation_email', file_path: null }))).toBe(false)
    expect(isCostDocument(doc({ kind: 'invoice_link', link_fetch_status: 'blocked', file_path: null }))).toBe(false)
    expect(isCostDocument(doc({ kind: 'invoice_link', link_fetch_status: 'fetched' }))).toBe(true)
  })

  it('a PDF that Gemini read as an order confirmation or "other" is NOT a cost document; a file-less marker row never is', () => {
    expect(isCostDocument(doc({ extracted: { documentKind: 'order_confirmation' } as never }))).toBe(false)
    expect(isCostDocument(doc({ extracted: { documentKind: 'other' } as never }))).toBe(false)
    expect(isCostDocument(doc({ extracted: { documentKind: 'invoice' } as never }))).toBe(true)
    expect(isCostDocument(doc({ kind: 'revolut_receipt', file_path: null, extracted: { skipped: true } as never }))).toBe(false)
  })

  it('an invoice beats a receipt beats an order mail for SnelStart; duplicates never win', () => {
    const docs = [
      doc({ id: 'order', kind: 'order_confirmation_email', file_path: null }),
      doc({ id: 'receipt', kind: 'revolut_receipt', source: 'revolut' }),
      doc({ id: 'dupe', kind: 'invoice_pdf', duplicate_of: 'inv' }),
      doc({ id: 'inv', kind: 'invoice_pdf' }),
    ]
    expect(pickPrimaryDocument(docs)?.id).toBe('inv')
    expect(pickPrimaryDocument(docs.filter(d => d.id !== 'inv' && d.id !== 'dupe'))?.id).toBe('receipt')
    expect(pickPrimaryDocument([docs[0]])?.id).toBe('order')
    expect(pickPrimaryDocument([])).toBeNull()
  })
})

describe('vatCandidatesFrom', () => {
  it('labels each source and skips duplicates', () => {
    const e = expense({ revolut_vat_cents: 2000, revolut_vat_rate_pct: 20 })
    const docs = [
      doc({ id: 'inv', extracted: { vatCents: 2100, vatRatePct: 21 } as never }),
      doc({ id: 'rcpt', kind: 'revolut_receipt', extracted: { vatCents: 2100 } as never }),
      doc({ id: 'dupe', duplicate_of: 'inv', extracted: { vatCents: 999 } as never }),
    ]
    expect(vatCandidatesFrom(e, docs)).toEqual([
      { source: 'invoice', vatCents: 2100, ratePct: 21 },
      { source: 'receipt', vatCents: 2100, ratePct: null },
      { source: 'revolut', vatCents: 2000, ratePct: 20 },
    ])
  })
  it('a manual figure is a candidate that outranks all others', () => {
    const cands = vatCandidatesFrom(expense({ vat_source: 'manual', vat_cents: 2100 }), [])
    expect(cands).toEqual([{ source: 'manual', vatCents: 2100, ratePct: null }])
  })
})

describe('computeExpenseState — the PRD scenarios', () => {
  it('A: payment, no document → waiting_for_invoice, gross from the payment, no VAT', () => {
    const s = computeExpenseState(expense(), [])
    expect(s.status).toBe('waiting_for_invoice')
    expect(s.grossCents).toBe(12100)
    expect(s.vat.source).toBeNull()
    expect(s.primaryDocumentId).toBeNull()
  })

  it('payment + order confirmation only → partially_matched, order number lifted from the mail', () => {
    const s = computeExpenseState(expense(), [doc({ kind: 'order_confirmation_email', file_path: null, extracted: { orderNumber: '12345' } as never })])
    expect(s.status).toBe('partially_matched')
    expect(s.orderNumber).toBe('12345')
  })

  it('the bol.com happy path: payment + auto-matched e-mailed invoice with VAT → matched (one click), because nothing independent confirms an unknown sender\'s PDF', () => {
    const e = expense({ match_confidence: 0.96 as never })
    const inv = doc({ extracted: { invoiceNumber: 'INV-2026-12345', invoiceDate: '2026-09-05', vatCents: 2100, vatRatePct: 21, supplierName: 'bol.com' } as never })
    const s = computeExpenseState(e, [inv])
    expect(s.status).toBe('matched')
    expect(s.provenanceTrusted).toBe(false)
    // Beer confirms (or links by hand) → confidence 1 → trusted → ready.
    expect(computeExpenseState(expense({ match_confidence: 1 as never }), [inv]).status).toBe('ready_for_snelstart')
    // Or Revolut's own rate agrees with the invoice → two independent sources → ready without a click.
    const agreed = computeExpenseState(expense({ match_confidence: 0.96 as never, revolut_vat_cents: 2100, revolut_vat_rate_pct: 21 }), [inv])
    expect(agreed.status).toBe('ready_for_snelstart')
    expect(agreed.provenanceTrusted).toBe(true)
    expect(s.vat).toMatchObject({ vatCents: 2100, netCents: 10000, ratePct: 21, source: 'invoice', conflict: null })
    expect(s.primaryDocumentId).toBe('doc-1')
    expect(s.invoiceNumber).toBe('INV-2026-12345')
    expect(s.invoiceDate).toBe('2026-09-05')
    expect(s.supplierName).toBe('Bol.com') // the record's own name wins over the document's
  })

  it('the PRD VAT conflict: invoice €21 vs Revolut €20 → needs_review with both figures recorded', () => {
    const e = expense({ match_confidence: 1 as never, revolut_vat_cents: 2000, revolut_vat_rate_pct: 20 })
    const s = computeExpenseState(e, [doc({ extracted: { vatCents: 2100 } as never })])
    expect(s.status).toBe('needs_review')
    expect(s.vat.conflict).toEqual({ invoice: 2100, revolut: 2000 })
    expect(s.vat.vatCents).toBe(2100) // the invoice still wins for the figure itself
  })

  it('B: the ice-cream receipt — payment + Revolut receipt + Revolut rate agreeing → ready', () => {
    const e = expense({ cash_out_cents: 2420, match_confidence: 1 as never, revolut_vat_cents: 420, revolut_vat_rate_pct: 21, supplier_name: 'Supermarkt X' })
    const s = computeExpenseState(e, [doc({ kind: 'revolut_receipt', source: 'revolut', extracted: { vatCents: 420, grossCents: 2420 } as never })])
    expect(s.status).toBe('ready_for_snelstart')
    expect(s.vat).toMatchObject({ vatCents: 420, netCents: 2000, source: 'receipt', conflict: null })
  })

  it('C: invoice, no payment → waiting_for_payment; gross comes from the document', () => {
    const e = expense({ bank_transaction_id: null, cash_out_cents: null })
    const s = computeExpenseState(e, [doc({ extracted: { grossCents: 12100, vatCents: 2100 } as never })])
    expect(s.status).toBe('waiting_for_payment')
    expect(s.grossCents).toBe(12100)
  })

  it('a manual VAT figure ends a conflict', () => {
    const e = expense({ match_confidence: 1 as never, revolut_vat_cents: 2000, vat_source: 'manual', vat_cents: 2100 })
    const s = computeExpenseState(e, [doc({ extracted: { vatCents: 2100 } as never })])
    expect(s.status).toBe('ready_for_snelstart')
    expect(s.vat.source).toBe('manual')
    expect(s.vat.conflict).toBeNull()
  })

  it('a webshop\'s PDF order confirmation attached to a payment is order-only: partially_matched, never a cost document to forward', () => {
    const s = computeExpenseState(expense({ match_confidence: 0.95 as never }), [doc({ extracted: { documentKind: 'order_confirmation', orderNumber: '12345', vatCents: 2100 } as never })])
    expect(s.status).toBe('partially_matched')
    expect(s.hasCostDocument).toBe(false)
    expect(s.vat.source).toBeNull()
    expect(s.primaryDocumentId).toBe('doc-1') // still shown as the primary (order) document
  })

  it('ignored stays ignored; sent stays sent, whatever the documents say', () => {
    expect(computeExpenseState(expense({ status: 'ignored' }), []).status).toBe('ignored')
    expect(computeExpenseState(expense({ snelstart_sent_at: '2026-09-07T00:00:00Z' }), []).status).toBe('sent_to_snelstart')
  })
})
