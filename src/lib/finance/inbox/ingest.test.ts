import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GmailMessage } from '@/lib/gmail/client'
import type { FinanceInvoiceDetection } from './detect'

const h = vi.hoisted(() => ({
  getAttachmentData: vi.fn(),
  uploadFinanceAttachment: vi.fn(),
  extractInvoiceFields: vi.fn(),
  notifyInvoiceArrived: vi.fn().mockResolvedValue(undefined),
  ingestFinanceEmailDocuments: vi.fn(),
  matchNewDocuments: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/gmail/client', () => ({ getAttachmentData: h.getAttachmentData }))
vi.mock('@/lib/finance/attachment-storage', () => ({ uploadFinanceAttachment: h.uploadFinanceAttachment }))
vi.mock('@/lib/finance/invoices/extract', () => ({ extractInvoiceFields: h.extractInvoiceFields }))
// The Slack nudge (invoices/notify.ts) is a side effect of a successful ingest — never a real DM from a test run.
vi.mock('@/lib/finance/invoices/notify', () => ({ notifyInvoiceArrived: h.notifyInvoiceArrived }))
// Non-staff mail is the Expense Record pipeline's business (plan 2026-09-05 §2.3); here we only assert the hand-off.
vi.mock('@/lib/finance/expenses/ingest-email', () => ({ ingestFinanceEmailDocuments: h.ingestFinanceEmailDocuments }))
vi.mock('@/lib/finance/expenses/match-orchestrator', () => ({ matchNewDocuments: h.matchNewDocuments }))

const state = vi.hoisted(() => ({
  staff: [] as Record<string, unknown>[],
  financeSuppliers: [] as Record<string, unknown>[],
  shifts: [] as Record<string, unknown>[],
  bookings: [] as Record<string, unknown>[],
  financeInvoices: [] as Record<string, unknown>[],
}))

// A small, generic PostgREST-like fake: every filter method narrows an
// in-memory array; maybeSingle/single/await-directly are all supported since
// ingest.ts uses all three shapes across its different queries.
function makeTable(rows: Record<string, unknown>[], idPrefix: string) {
  return {
    select: () => {
      const filters: Array<(r: Record<string, unknown>) => boolean> = []
      const builder = {
        eq: (col: string, val: unknown) => { filters.push(r => r[col] === val); return builder },
        neq: (col: string, val: unknown) => { filters.push(r => r[col] !== val); return builder },
        gte: (col: string, val: unknown) => { filters.push(r => (r[col] as string) >= (val as string)); return builder },
        lte: (col: string, val: unknown) => { filters.push(r => (r[col] as string) <= (val as string)); return builder },
        in: (col: string, vals: unknown[]) => { filters.push(r => vals.includes(r[col])); return builder },
        not: (col: string, op: string, val: unknown) => {
          if (op === 'is' && val === null) filters.push(r => r[col] !== null && r[col] !== undefined)
          return builder
        },
        maybeSingle: async () => {
          const found = rows.filter(r => filters.every(f => f(r)))
          return { data: found[0] ?? null, error: null }
        },
        single: async () => {
          const found = rows.filter(r => filters.every(f => f(r)))
          return found[0] ? { data: found[0], error: null } : { data: null, error: { message: 'not found' } }
        },
        then: (resolve: (v: { data: Record<string, unknown>[]; error: null }) => void) => {
          resolve({ data: rows.filter(r => filters.every(f => f(r))), error: null })
        },
      }
      return builder
    },
    insert: (row: Record<string, unknown>) => {
      const created = { id: `${idPrefix}-${rows.length + 1}`, iban: null, ...row }
      rows.push(created)
      return { select: () => ({ single: async () => ({ data: created, error: null }) }) }
    },
    update: (patch: Record<string, unknown>) => ({
      eq: async (col: string, val: unknown) => {
        const found = rows.find(r => r[col] === val)
        if (found) Object.assign(found, patch)
        return { data: null, error: null }
      },
    }),
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'staff') return makeTable(state.staff, 'staff')
      if (table === 'finance_suppliers') return makeTable(state.financeSuppliers, 'sup')
      if (table === 'shifts') return makeTable(state.shifts, 'shift')
      if (table === 'bookings') return makeTable(state.bookings, 'booking')
      if (table === 'finance_invoices') return makeTable(state.financeInvoices, 'inv')
      throw new Error(`unmocked table ${table}`)
    },
  }),
}))

// Imported after the mocks above so ingest.ts picks up the mocked modules.
const { ingestFinanceMessage } = await import('./ingest')
const { createAdminClient } = await import('@/lib/supabase/admin')

const supabase = createAdminClient()
// Every call belongs to a conversation (the Slack deep link target); the tests don't care which.
const ingest = (msg: GmailMessage, rowId: string | null, det: FinanceInvoiceDetection) => ingestFinanceMessage(supabase, msg, rowId, det, 'conv-1')

function gmailMessage(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id: 'gmail-msg-1',
    threadId: 'thread-1',
    from: { email: 'mare@offcourseamsterdam.com', name: 'Mare' },
    to: [{ email: 'facturen@offcourseamsterdam.com', name: 'Facturen' }],
    cc: [],
    subject: 'Factuur augustus',
    messageIdHeader: null,
    bodyText: 'zie bijlage',
    bodyHtml: null,
    attachments: [{ filename: 'factuur.pdf', mimeType: 'application/pdf', attachmentId: 'att-1', size: 12345 }],
    ...overrides,
  }
}

function detection(overrides: Partial<FinanceInvoiceDetection> = {}): FinanceInvoiceDetection {
  return { category: 'finance', senderKind: 'unknown', staffId: null, supplierId: null, trusted: false, ...overrides }
}

// Beer, 2026-09-05: an owner (Beer/Jannah, user_profiles role=admin) forwarding a receipt is an
// expense document, not "invoicing himself" — even though the same person also has a `staff` row.
const OWNER = { senderKind: 'owner' as const, staffId: 'staff-1', trusted: true }

const FULL_MATCH_EXTRACTED = {
  invoiceNumber: 'INV-1',
  invoiceDate: '2026-09-01',
  supplierName: 'Mare',
  iban: 'NL01TEST0123456789',
  tourDate: '2026-08-30',
  bookingRef: null,
  hours: 4,
  rateCents: 3750,
  amountCents: 15000,
  vatCents: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  state.staff.length = 0
  state.financeSuppliers.length = 0
  state.shifts.length = 0
  state.bookings.length = 0
  state.financeInvoices.length = 0
  h.getAttachmentData.mockResolvedValue(Buffer.from('%PDF-1.4 fake'))
  h.uploadFinanceAttachment.mockResolvedValue({ ok: true })
  h.extractInvoiceFields.mockResolvedValue({ fields: FULL_MATCH_EXTRACTED, confidence: {} })
  h.ingestFinanceEmailDocuments.mockResolvedValue({ documentIds: ['doc-1'], kind: 'invoice_attached', summary: 'Factuur van Jachthaven Westerdok · 1 document vastgelegd' })
})

// Every non-staff test below uses this: a skipper is a payable, everyone else is an expense document.
const STAFF = { senderKind: 'staff' as const, staffId: 'staff-1' }

describe('ingestFinanceMessage', () => {
  it('known staff, first invoice ever — auto-creates their supplier row, needs_review only on the missing iban', async () => {
    state.staff.push({ id: 'staff-1', name: 'Mare', hourly_rate_cents: 3750 })
    state.shifts.push({ id: 'shift-1', booking_id: 'booking-uuid-1', date: '2026-08-30', start_at: '2026-08-30T14:00:00Z', end_at: '2026-08-30T18:00:00Z', staff_id: 'staff-1', status: 'confirmed' })
    state.bookings.push({ id: 'booking-uuid-1', booking_id: 'OC-2026-00001' })

    const result = await ingest(gmailMessage(), 'msgrow-1', detection({ senderKind: 'staff', staffId: 'staff-1', trusted: true }))

    expect(state.financeSuppliers).toHaveLength(1)
    expect(state.financeSuppliers[0]).toMatchObject({ name: 'Mare', staff_id: 'staff-1' })
    expect(state.financeInvoices).toHaveLength(1)
    const invoice = state.financeInvoices[0]
    expect(invoice.status).toBe('needs_review')
    expect(invoice.source).toBe('email')
    expect(invoice.source_message_id).toBe('msgrow-1')
    expect(invoice.matched_shift_id).toBe('shift-1')
    expect(invoice.matched_booking_id).toBe('booking-uuid-1')
    expect(invoice.expected_amount_cents).toBe(15000)
    const checks = invoice.checks as { key: string; ok: boolean }[]
    expect(checks.find(c => c.key === 'iban')?.ok).toBe(false)
    expect(checks.filter(c => c.key !== 'iban').every(c => c.ok)).toBe(true)
    expect(result).toBe('factuur.pdf: nog te controleren')
  })

  it('known staff with an existing supplier row — reuses it, does not create a second one', async () => {
    state.staff.push({ id: 'staff-1', name: 'Mare', hourly_rate_cents: 3750 })
    state.financeSuppliers.push({ id: 'sup-existing', name: 'Mare', staff_id: 'staff-1', iban: 'NL01TEST0123456789' })

    await ingest(gmailMessage(), 'msgrow-1', detection({ senderKind: 'staff', staffId: 'staff-1', trusted: true }))

    expect(state.financeSuppliers).toHaveLength(1)
    expect(state.financeInvoices[0].supplier_id).toBe('sup-existing')
  })

  it('an owner (Beer/Jannah) forwarding mail is never a payable, even though they also have a staff row — routed to the Expense Record pipeline', async () => {
    state.staff.push({ id: 'staff-1', name: 'Beer', hourly_rate_cents: 3750 })

    const result = await ingest(gmailMessage({ from: { email: 'info@offcourseamsterdam.com', name: 'Beer' } }), 'msgrow-1', detection(OWNER))

    expect(h.ingestFinanceEmailDocuments).toHaveBeenCalledTimes(1)
    expect(state.financeInvoices).toHaveLength(0)
    expect(state.financeSuppliers).toHaveLength(0)
    expect(h.extractInvoiceFields).not.toHaveBeenCalled()
    expect(result).toBe('Factuur van Jachthaven Westerdok · 1 document vastgelegd')
  })

  it('a known NON-staff supplier (marina, webshop) is not a payable — routed to the Expense Record pipeline, no finance_invoices row', async () => {
    state.financeSuppliers.push({ id: 'sup-marina', name: 'Jachthaven Westerdok', staff_id: null, iban: 'NL01TEST0123456789' })

    const result = await ingest(gmailMessage({ from: { email: 'info@westerdok.nl', name: 'Jachthaven' } }), 'msgrow-1', detection({ senderKind: 'supplier', supplierId: 'sup-marina', trusted: true }))

    expect(h.ingestFinanceEmailDocuments).toHaveBeenCalledTimes(1)
    expect(h.ingestFinanceEmailDocuments.mock.calls[0][2]).toBe('msgrow-1')
    expect(h.matchNewDocuments).toHaveBeenCalledWith(expect.anything(), ['doc-1'])
    expect(state.financeInvoices).toHaveLength(0)
    expect(h.extractInvoiceFields).not.toHaveBeenCalled()
    expect(result).toBe('Factuur van Jachthaven Westerdok · 1 document vastgelegd')
  })

  it('an unknown sender with a PDF is an expense document, never an unpaid invoice waiting for approval', async () => {
    await ingest(gmailMessage({ from: { email: 'noreply@bol.com', name: 'bol.com' } }), 'msgrow-1', detection())

    expect(h.ingestFinanceEmailDocuments).toHaveBeenCalledTimes(1)
    expect(state.financeInvoices).toHaveLength(0)
    expect(h.notifyInvoiceArrived).not.toHaveBeenCalled()
  })

  it('an unknown sender without attachments still goes through the expense pipeline (it may be an order confirmation)', async () => {
    h.ingestFinanceEmailDocuments.mockResolvedValue({ documentIds: [], kind: 'other', summary: 'Geen financiële inhoud herkend.' })
    const result = await ingest(gmailMessage({ attachments: [] }), 'msgrow-1', detection({ trusted: false }))

    expect(h.ingestFinanceEmailDocuments).toHaveBeenCalledTimes(1)
    expect(h.matchNewDocuments).not.toHaveBeenCalled()
    expect(result).toBe('Geen financiële inhoud herkend.')
  })

  it('a matcher failure never wedges the poll — the documents are filed, the summary still returns', async () => {
    h.matchNewDocuments.mockRejectedValueOnce(new Error('db down'))
    const result = await ingest(gmailMessage(), 'msgrow-1', detection())
    expect(result).toContain('1 document vastgelegd')
  })

  it('a PDF attached but no messages-row id (should be unreachable in practice) — skips rather than inserting with a null attachment', async () => {
    const result = await ingest(gmailMessage(), null, detection({ ...STAFF, trusted: true }))

    expect(result).toContain('geen bericht-id')
    expect(state.financeInvoices).toHaveLength(0)
    expect(h.ingestFinanceEmailDocuments).not.toHaveBeenCalled()
  })

  it('trusted sender, no PDF attachment — silent no-op', async () => {
    const result = await ingest(gmailMessage({ attachments: [] }), 'msgrow-1', detection({ senderKind: 'staff', staffId: 'staff-1', trusted: true }))

    expect(result).toBeNull()
    expect(state.financeInvoices).toHaveLength(0)
    expect(state.financeSuppliers).toHaveLength(0)
  })

  it('extraction fails — invoice row still exists, downgraded to needs_review with a note, never throws', async () => {
    h.extractInvoiceFields.mockRejectedValue(new Error('Gemini 503'))

    const result = await ingest(gmailMessage(), 'msgrow-1', detection(STAFF))

    expect(state.financeInvoices).toHaveLength(1)
    expect(state.financeInvoices[0].status).toBe('needs_review')
    expect(state.financeInvoices[0].decision_note).toContain('mislukt')
    expect(result).toContain('automatische verwerking mislukt')
  })

  it('attachment download fails — no invoice row left behind, never throws', async () => {
    h.getAttachmentData.mockRejectedValue(new Error('Gmail API 500'))

    const result = await ingest(gmailMessage(), 'msgrow-1', detection(STAFF))

    expect(state.financeInvoices).toHaveLength(0)
    expect(result).toContain('opslaan mislukt')
  })

  it('two PDF attachments on one message — both processed independently', async () => {
    const result = await ingest(
      gmailMessage({
        attachments: [
          { filename: 'a.pdf', mimeType: 'application/pdf', attachmentId: 'att-a', size: 1 },
          { filename: 'b.pdf', mimeType: 'application/pdf', attachmentId: 'att-b', size: 1 },
        ],
      }),
      'msgrow-1',
      detection(STAFF),
    )

    expect(state.financeInvoices).toHaveLength(2)
    expect(result).toBe('a.pdf: nog te controleren · b.pdf: nog te controleren')
  })

  it('the storage key is server-generated under the message prefix — never the sender\'s filename', async () => {
    await ingest(gmailMessage({ attachments: [{ filename: '../../etc/passwd.pdf', mimeType: 'application/pdf', attachmentId: 'att-1', size: 1 }] }), 'msgrow-1', detection(STAFF))

    const [, storagePath] = h.uploadFinanceAttachment.mock.calls[0]
    expect(storagePath).toMatch(/^email\/gmail-msg-1\/[0-9a-f-]{36}\.pdf$/)
    expect(storagePath).not.toContain('passwd')
    expect(state.financeInvoices[0].file_path).toBe(storagePath)
    // The display name survives, neutralised, in its own column.
    expect(state.financeInvoices[0].original_filename).toBe('.._.._etc_passwd.pdf')
  })

  it('two attachments with the same filename get two different keys', async () => {
    await ingest(
      gmailMessage({
        attachments: [
          { filename: 'factuur.pdf', mimeType: 'application/pdf', attachmentId: 'att-a', size: 1 },
          { filename: 'factuur.pdf', mimeType: 'application/pdf', attachmentId: 'att-b', size: 1 },
        ],
      }),
      'msgrow-1',
      detection(STAFF),
    )
    const keys = h.uploadFinanceAttachment.mock.calls.map(c => c[1])
    expect(new Set(keys).size).toBe(2)
    expect(state.financeInvoices).toHaveLength(2)
  })

  it('an oversized attachment is skipped before download, the rest of the message still processes', async () => {
    const result = await ingest(
      gmailMessage({
        attachments: [
          { filename: 'huge.pdf', mimeType: 'application/pdf', attachmentId: 'att-huge', size: 16 * 1024 * 1024 },
          { filename: 'ok.pdf', mimeType: 'application/pdf', attachmentId: 'att-ok', size: 1 },
        ],
      }),
      'msgrow-1',
      detection(STAFF),
    )
    expect(h.getAttachmentData).toHaveBeenCalledTimes(1)
    expect(h.getAttachmentData).toHaveBeenCalledWith('gmail-msg-1', 'att-ok')
    expect(state.financeInvoices).toHaveLength(1)
    expect(result).toContain('huge.pdf: te groot')
    expect(result).toContain('ok.pdf: nog te controleren')
  })

  it('bytes that are not a PDF (despite the mime type) are refused before anything is stored', async () => {
    h.getAttachmentData.mockResolvedValue(Buffer.from('<html>not a pdf</html>'))
    const result = await ingest(gmailMessage(), 'msgrow-1', detection(STAFF))
    expect(h.uploadFinanceAttachment).not.toHaveBeenCalled()
    expect(state.financeInvoices).toHaveLength(0)
    expect(result).toContain('geen geldige PDF')
  })

  it('a processed invoice triggers exactly one Slack nudge, deep-linked to its conversation', async () => {
    await ingest(gmailMessage(), 'msgrow-1', detection({ senderKind: 'staff', staffId: 'staff-1', trusted: true }))
    expect(h.notifyInvoiceArrived).toHaveBeenCalledTimes(1)
    expect(h.notifyInvoiceArrived).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv-1', filename: 'factuur.pdf', status: 'needs_review' }))
  })
})
