import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseChainMock, has, op, opArg, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'
import type { GmailMessage } from '@/lib/gmail/client'

const h = vi.hoisted(() => ({
  getAttachmentData: vi.fn(),
  uploadFinanceAttachment: vi.fn().mockResolvedValue({ ok: true }),
  classifyFinanceEmail: vi.fn(),
  extractDocumentFields: vi.fn(),
  fetchPublicPdf: vi.fn(),
}))
vi.mock('@/lib/gmail/client', () => ({ getAttachmentData: h.getAttachmentData }))
vi.mock('@/lib/finance/attachment-storage', () => ({ uploadFinanceAttachment: h.uploadFinanceAttachment }))
vi.mock('./classify-email', async importOriginal => ({ ...(await importOriginal<typeof import('./classify-email')>()), classifyFinanceEmail: h.classifyFinanceEmail }))
vi.mock('./extract-document', () => ({ extractDocumentFields: h.extractDocumentFields }))
vi.mock('./fetch-link', () => ({ fetchPublicPdf: h.fetchPublicPdf }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { ingestFinanceEmailDocuments, mailDocumentKind, pickLinksToFetch } from './ingest-email'

const PDF = Buffer.concat([Buffer.from('%PDF-1.4 invoice'), Buffer.alloc(16)])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])

function message(over: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id: 'gmail-1', threadId: 't1', from: { email: 'noreply@bol.com', name: 'bol.com' }, to: [{ email: 'finance@offcourseamsterdam.com', name: '' }], cc: [],
    subject: 'Je bestelling is bevestigd', messageIdHeader: null, bodyText: 'Order #12345 confirmed. Total €121,00.', bodyHtml: null, attachments: [], ...over,
  }
}
const classification = (over: Record<string, unknown> = {}) => ({
  kind: 'order_confirmation', supplierName: 'bol.com', orderNumber: '12345', invoiceNumber: null, invoiceDate: null, grossCents: 12100, vatCents: null,
  currency: 'EUR', paymentReference: null, isPaidConfirmation: true, confidence: 0.9, reason: 'Orderbevestiging.', ...over,
})

function db(opts: { shaDup?: string | null } = {}) {
  let n = 0
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_documents') {
      if (has(q, 'insert')) return { data: { id: `doc-${++n}` } }
      if (has(q, 'update')) return { data: null }
      if (op(q, 'eq')?.args[0] === 'sha256') return { data: opts.shaDup ? { id: opts.shaDup, file_path: 'email/orig/original.pdf' } : null }
    }
    return { data: null }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.classifyFinanceEmail.mockResolvedValue(classification())
  h.extractDocumentFields.mockResolvedValue({ fields: { invoiceNumber: 'INV-2026-12345', vatCents: 2100, grossCents: 12100 }, confidence: { vatCents: 1 } })
  h.getAttachmentData.mockResolvedValue(PDF)
})

describe('pickLinksToFetch / mailDocumentKind', () => {
  it('fetches only document-looking links, never tracking or unsubscribe links, and keeps the rest visible', () => {
    const r = pickLinksToFetch([
      'https://bol.com/invoices/INV-1.pdf',
      'https://bol.com/unsubscribe?u=1',
      'https://track.bol.com/click?x',
      'https://bol.com/account/orders',
      'https://bol.com/download/factuur/2',
    ])
    expect(r.fetch).toEqual(['https://bol.com/invoices/INV-1.pdf', 'https://bol.com/download/factuur/2'])
    expect(r.keep).toEqual(['https://bol.com/account/orders'])
  })
  it('maps mail kinds to document kinds; the invoice-attached mail carries no row of its own', () => {
    expect(mailDocumentKind('order_confirmation')).toBe('order_confirmation_email')
    expect(mailDocumentKind('invoice_notification')).toBe('invoice_notification_email')
    expect(mailDocumentKind('invoice_attached')).toBeNull()
    expect(mailDocumentKind('other')).toBeNull()
  })
})

describe('ingestFinanceEmailDocuments', () => {
  it('the PRD order confirmation (no PDF) becomes one order_confirmation_email document carrying the order number', async () => {
    const mock = db()
    const r = await ingestFinanceEmailDocuments(mock.client as never, message(), 'msgrow-1')
    expect(r.kind).toBe('order_confirmation')
    expect(r.documentIds).toEqual(['doc-1'])
    expect(opArg(mock.queries, 'finance_documents', 'insert')).toMatchObject({
      kind: 'order_confirmation_email', source: 'email', source_message_id: 'msgrow-1',
      extracted: expect.objectContaining({ orderNumber: '12345', grossCents: 12100, isPaidConfirmation: true }),
    })
    expect(r.summary).toContain('Orderbevestiging van bol.com (#12345)')
    expect(h.getAttachmentData).not.toHaveBeenCalled()
  })

  it('a PDF attachment becomes an invoice_pdf document under a server key, hashed, extracted by Gemini', async () => {
    h.classifyFinanceEmail.mockResolvedValue(classification({ kind: 'invoice_attached' }))
    const mock = db()
    const r = await ingestFinanceEmailDocuments(mock.client as never, message({ attachments: [{ filename: '../factuur.pdf', mimeType: 'application/pdf', attachmentId: 'a1', size: 1000 }] }), 'msgrow-1')
    expect(r.documentIds).toHaveLength(1)
    const inserted = opArg(mock.queries, 'finance_documents', 'insert') as Record<string, unknown>
    expect(inserted).toMatchObject({ kind: 'invoice_pdf', source: 'email', mime_type: 'application/pdf', original_filename: '.._factuur.pdf', duplicate_of: null })
    expect(String(inserted.file_path)).toMatch(/^email\/gmail-1\/[0-9a-f-]{36}\.pdf$/)
    expect(typeof inserted.sha256).toBe('string')
    expect(h.uploadFinanceAttachment.mock.calls[0][3]).toBe('application/pdf')
    expect(h.extractDocumentFields).toHaveBeenCalledWith(PDF.toString('base64'), 'application/pdf')
    expect(opArg(mock.queries, 'finance_documents', 'update')).toMatchObject({ extracted: expect.objectContaining({ invoiceNumber: 'INV-2026-12345' }) })
  })

  it('an image attachment is a receipt_image; a PDF-named image is still an image (bytes decide)', async () => {
    h.getAttachmentData.mockResolvedValue(JPG)
    const mock = db()
    await ingestFinanceEmailDocuments(mock.client as never, message({ attachments: [{ filename: 'bon.pdf', mimeType: 'application/pdf', attachmentId: 'a1', size: 500 }] }), 'msgrow-1')
    const inserted = queriesFor(mock.queries, 'finance_documents', 'insert').map(q => op(q, 'insert')!.args[0] as Record<string, unknown>)
    expect(inserted.find(i => i.kind === 'receipt_image')).toMatchObject({ mime_type: 'image/jpeg' })
    expect(String(inserted.find(i => i.kind === 'receipt_image')!.file_path)).toMatch(/\.jpg$/)
  })

  it('bytes that are neither PDF nor image are skipped with a note, nothing stored', async () => {
    h.getAttachmentData.mockResolvedValue(Buffer.from('MZ....exe'))
    const mock = db()
    const r = await ingestFinanceEmailDocuments(mock.client as never, message({ attachments: [{ filename: 'factuur.pdf', mimeType: 'application/pdf', attachmentId: 'a1', size: 500 }] }), 'msgrow-1')
    expect(h.uploadFinanceAttachment).not.toHaveBeenCalled()
    expect(r.summary).toContain('geen geldige PDF of afbeelding')
  })

  it('identical bytes already stored → duplicate_of, no upload, no second extraction', async () => {
    h.classifyFinanceEmail.mockResolvedValue(classification({ kind: 'invoice_attached' }))
    const mock = db({ shaDup: 'doc-original' })
    await ingestFinanceEmailDocuments(mock.client as never, message({ attachments: [{ filename: 'factuur.pdf', mimeType: 'application/pdf', attachmentId: 'a1', size: 500 }] }), 'msgrow-1')
    expect(h.uploadFinanceAttachment).not.toHaveBeenCalled()
    expect(h.extractDocumentFields).not.toHaveBeenCalled()
    expect(opArg(mock.queries, 'finance_documents', 'insert')).toMatchObject({ duplicate_of: 'doc-original', sha256: null, file_path: 'email/orig/original.pdf' })
  })

  it('an unsure classification never makes the server fetch a link — the links are recorded for manual download instead', async () => {
    h.classifyFinanceEmail.mockResolvedValue(classification({ kind: 'invoice_notification', confidence: 0.55 }))
    const mock = db()
    const r = await ingestFinanceEmailDocuments(mock.client as never, message({ bodyText: 'Your invoice: https://www.bol.com/invoices/INV-1.pdf' }), 'msgrow-1')
    expect(h.fetchPublicPdf).not.toHaveBeenCalled()
    const link = queriesFor(mock.queries, 'finance_documents', 'insert').map(q => op(q, 'insert')!.args[0] as Record<string, unknown>).find(i => i.kind === 'invoice_link')
    expect(link).toMatchObject({ link_fetch_status: 'not_attempted', link_url: 'https://www.bol.com/invoices/INV-1.pdf' })
    expect(r.summary).toContain('classificatie onzeker')
  })

  it('an oversized attachment on an otherwise unclassifiable mail still leaves its note in the summary', async () => {
    h.classifyFinanceEmail.mockResolvedValue(classification({ kind: 'other', confidence: 0.3 }))
    const r = await ingestFinanceEmailDocuments(db().client as never, message({ attachments: [{ filename: 'huge.pdf', mimeType: 'application/pdf', attachmentId: 'a1', size: 16 * 1024 * 1024 }] }), 'msgrow-1')
    expect(r.summary).toContain('huge.pdf: te groot')
  })

  it('the PRD "your invoice is available" mail: fetches the public PDF link and stores it as a fetched invoice_link', async () => {
    h.classifyFinanceEmail.mockResolvedValue(classification({ kind: 'invoice_notification', invoiceNumber: 'INV-2026-12345' }))
    h.fetchPublicPdf.mockResolvedValue({ ok: true, bytes: PDF, finalUrl: 'https://www.bol.com/invoices/INV-2026-12345.pdf' })
    const mock = db()
    const r = await ingestFinanceEmailDocuments(mock.client as never, message({ bodyText: 'Your invoice for order #12345 is now available: https://www.bol.com/invoices/INV-2026-12345.pdf' }), 'msgrow-1')
    expect(h.fetchPublicPdf).toHaveBeenCalledWith('https://www.bol.com/invoices/INV-2026-12345.pdf')
    const inserted = queriesFor(mock.queries, 'finance_documents', 'insert').map(q => op(q, 'insert')!.args[0] as Record<string, unknown>)
    expect(inserted[0]).toMatchObject({ kind: 'invoice_notification_email' })
    expect(inserted[1]).toMatchObject({ kind: 'invoice_link', link_url: 'https://www.bol.com/invoices/INV-2026-12345.pdf', link_fetch_status: 'fetched', mime_type: 'application/pdf' })
    expect(r.documentIds).toHaveLength(2)
  })

  it('a blocked link (login page) is recorded as blocked for manual download, never retried into a portal', async () => {
    h.classifyFinanceEmail.mockResolvedValue(classification({ kind: 'invoice_notification' }))
    h.fetchPublicPdf.mockResolvedValue({ ok: false, reason: 'not_pdf' })
    const mock = db()
    const r = await ingestFinanceEmailDocuments(mock.client as never, message({ bodyText: 'Download your invoice: https://portal.example.com/invoice/123' }), 'msgrow-1')
    const link = queriesFor(mock.queries, 'finance_documents', 'insert').map(q => op(q, 'insert')!.args[0] as Record<string, unknown>).find(i => i.kind === 'invoice_link')
    expect(link).toMatchObject({ link_fetch_status: 'blocked' })
    expect(r.summary).toContain('handmatig downloaden')
    expect(h.uploadFinanceAttachment).not.toHaveBeenCalled()
  })

  it('links in an order confirmation are never fetched; links are only for invoice notifications without an attachment', async () => {
    const mock = db()
    await ingestFinanceEmailDocuments(mock.client as never, message({ bodyText: 'Order confirmed. https://bol.com/invoices/x.pdf' }), 'msgrow-1')
    expect(h.fetchPublicPdf).not.toHaveBeenCalled()
  })

  it('noise (newsletter) with no attachments creates nothing', async () => {
    h.classifyFinanceEmail.mockResolvedValue(classification({ kind: 'other', confidence: 0.3 }))
    const mock = db()
    const r = await ingestFinanceEmailDocuments(mock.client as never, message({ subject: 'Zomerdeals!' }), 'msgrow-1')
    expect(r.documentIds).toEqual([])
    expect(queriesFor(mock.queries, 'finance_documents', 'insert')).toHaveLength(0)
  })

  it('a classifier outage still files the attachments — the PDF matters more than the label', async () => {
    h.classifyFinanceEmail.mockRejectedValue(new Error('Claude 529'))
    const mock = db()
    const r = await ingestFinanceEmailDocuments(mock.client as never, message({ attachments: [{ filename: 'factuur.pdf', mimeType: 'application/pdf', attachmentId: 'a1', size: 500 }] }), 'msgrow-1')
    expect(r.kind).toBeNull()
    expect(r.documentIds).toHaveLength(1)
  })

  it('an oversized attachment is noted and skipped before download', async () => {
    const mock = db()
    const r = await ingestFinanceEmailDocuments(mock.client as never, message({ attachments: [{ filename: 'huge.pdf', mimeType: 'application/pdf', attachmentId: 'a1', size: 16 * 1024 * 1024 }] }), 'msgrow-1')
    expect(h.getAttachmentData).not.toHaveBeenCalled()
    expect(r.summary).toContain('huge.pdf: te groot')
  })
})
