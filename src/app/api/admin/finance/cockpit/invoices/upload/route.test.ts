import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  findOrCreateContactByField: vi.fn(),
  processInvoiceFile: vi.fn(),
  loadSupplierById: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/contacts/find-or-create', () => ({ findOrCreateContactByField: h.findOrCreateContactByField }))
vi.mock('@/lib/finance/invoices/process', () => ({ processInvoiceFile: h.processInvoiceFile, loadSupplierById: h.loadSupplierById }))

import { POST } from './route'

const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/invoices/upload'

function db(opts: { existingConversation?: Record<string, unknown> | null } = {}) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'conversations') {
      if (has(q, 'update')) return { data: null }
      if (has(q, 'insert')) return { data: { id: 'conv-new' } }
      return { data: opts.existingConversation ?? null }
    }
    if (q.table === 'messages' && has(q, 'insert')) return { data: { id: 'msg-1' } }
    return { data: null }
  })
}

function pdfFile(name = 'factuur.pdf', bytes = 'x'.repeat(100), type = 'application/pdf'): File {
  return new File([bytes], name, { type })
}

function reqWith(file: File | null, supplierId?: string): NextRequest {
  const form = new FormData()
  if (file) form.set('file', file)
  if (supplierId !== undefined) form.set('supplier_id', supplierId)
  return new NextRequest(BASE, { method: 'POST', body: form })
}

describe('POST /api/admin/finance/cockpit/invoices/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.findOrCreateContactByField.mockResolvedValue('contact-1')
    h.processInvoiceFile.mockResolvedValue({ invoiceId: 'inv-1', summary: 'factuur.pdf: nog te controleren' })
    h.loadSupplierById.mockResolvedValue(null)
  })

  it('passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await POST(reqWith(pdfFile()))).status).toBe(401)
  })

  it('rejects when no file is present', async () => {
    const res = await POST(reqWith(null))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('No file')
  })

  it('rejects a non-PDF file (wrong type and wrong extension)', async () => {
    const res = await POST(reqWith(pdfFile('factuur.jpg', 'x', 'image/jpeg')))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('PDF')
  })

  it('accepts a .pdf-named file even with a generic/missing mime type', async () => {
    h.createAdminClient.mockReturnValue(db().client)
    const res = await POST(reqWith(pdfFile('factuur.pdf', 'x', '')))
    expect(res.status).toBe(201)
  })

  it('rejects an empty file', async () => {
    const res = await POST(reqWith(pdfFile('factuur.pdf', '')))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('empty')
  })

  it('rejects a file over the size limit', async () => {
    const res = await POST(reqWith(pdfFile('factuur.pdf', 'x'.repeat(16 * 1024 * 1024))))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('too large')
  })

  it('rejects an invalid supplier_id', async () => {
    const res = await POST(reqWith(pdfFile(), 'not-a-uuid'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('supplier_id')
  })

  it('first upload ever: creates the contact + conversation + message, calls processInvoiceFile with source=upload', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)

    const res = await POST(reqWith(pdfFile('factuur.pdf')))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data).toEqual({ invoiceId: 'inv-1', conversationId: 'conv-new', summary: 'factuur.pdf: nog te controleren' })

    expect(h.findOrCreateContactByField).toHaveBeenCalledWith(expect.anything(), 'email', 'handmatig@offcourseamsterdam.internal', 'Handmatige upload')
    expect(opArg(mock.queries, 'conversations', 'insert')).toMatchObject({
      channel: 'email',
      provider_thread_id: 'manual-invoice-uploads',
      source_category: 'finance',
      contact_id: 'contact-1',
    })
    expect(opArg(mock.queries, 'messages', 'insert')).toMatchObject({
      conversation_id: 'conv-new',
      direction: 'in',
      provider: 'manual',
    })

    const call = h.processInvoiceFile.mock.calls[0][1]
    expect(call.source).toBe('upload')
    expect(call.sourceMessageId).toBe('msg-1')
    expect(call.supplier).toBeNull()
    expect(call.storagePath).toContain('upload/')
    expect(call.storagePath).toContain('factuur.pdf')
  })

  it('a second upload reuses the existing manual-upload conversation — no new contact/conversation created', async () => {
    const mock = db({ existingConversation: { id: 'conv-existing', unread_count: 2 } })
    h.createAdminClient.mockReturnValue(mock.client)

    const res = await POST(reqWith(pdfFile()))
    expect(res.status).toBe(201)
    expect((await res.json()).data.conversationId).toBe('conv-existing')

    expect(h.findOrCreateContactByField).not.toHaveBeenCalled()
    expect(mock.queries.some(q => q.table === 'conversations' && has(q, 'insert'))).toBe(false)
    expect(opArg(mock.queries, 'conversations', 'update')).toMatchObject({ unread_count: 3, status: 'open' })
  })

  it('a valid supplier_id resolves the supplier and passes it through to processInvoiceFile', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    const supplier = { id: 'sup-1', name: 'Mare', staffId: 'staff-1', iban: null, hourlyRateCents: 3750 }
    h.loadSupplierById.mockResolvedValue(supplier)

    const supplierId = '11111111-1111-4111-8111-111111111111'
    await POST(reqWith(pdfFile(), supplierId))

    expect(h.loadSupplierById).toHaveBeenCalledWith(expect.anything(), supplierId)
    expect(h.processInvoiceFile.mock.calls[0][1].supplier).toBe(supplier)
  })
})
