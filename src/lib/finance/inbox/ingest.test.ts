import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GmailMessage } from '@/lib/gmail/client'
import type { FinanceInvoiceDetection } from './detect'

const h = vi.hoisted(() => ({
  getAttachmentData: vi.fn(),
  uploadFinanceAttachment: vi.fn(),
  extractInvoiceFields: vi.fn(),
}))
vi.mock('@/lib/gmail/client', () => ({ getAttachmentData: h.getAttachmentData }))
vi.mock('@/lib/finance/attachment-storage', () => ({ uploadFinanceAttachment: h.uploadFinanceAttachment }))
vi.mock('@/lib/finance/invoices/extract', () => ({ extractInvoiceFields: h.extractInvoiceFields }))

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

function gmailMessage(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id: 'gmail-msg-1',
    threadId: 'thread-1',
    from: { email: 'mare@offcourseamsterdam.com', name: 'Mare' },
    to: [{ email: 'facturen@offcourseamsterdam.com', name: 'Facturen' }],
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
})

describe('ingestFinanceMessage', () => {
  it('known staff, first invoice ever — auto-creates their supplier row, needs_review only on the missing iban', async () => {
    state.staff.push({ id: 'staff-1', name: 'Mare', hourly_rate_cents: 3750 })
    state.shifts.push({ id: 'shift-1', booking_id: 'booking-uuid-1', date: '2026-08-30', start_at: '2026-08-30T14:00:00Z', end_at: '2026-08-30T18:00:00Z', staff_id: 'staff-1', status: 'confirmed' })
    state.bookings.push({ id: 'booking-uuid-1', booking_id: 'OC-2026-00001' })

    const result = await ingestFinanceMessage(supabase, gmailMessage(), 'msgrow-1', detection({ senderKind: 'staff', staffId: 'staff-1', trusted: true }))

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

    await ingestFinanceMessage(supabase, gmailMessage(), null, detection({ senderKind: 'staff', staffId: 'staff-1', trusted: true }))

    expect(state.financeSuppliers).toHaveLength(1)
    expect(state.financeInvoices[0].supplier_id).toBe('sup-existing')
  })

  it('known supplier already on file with iban set — full end-to-end match, status ready', async () => {
    state.staff.push({ id: 'staff-1', name: 'Mare', hourly_rate_cents: 3750 })
    state.financeSuppliers.push({ id: 'sup-1', name: 'Mare', staff_id: 'staff-1', iban: 'NL01TEST0123456789' })
    state.shifts.push({ id: 'shift-1', booking_id: 'booking-uuid-1', date: '2026-08-30', start_at: '2026-08-30T14:00:00Z', end_at: '2026-08-30T18:00:00Z', staff_id: 'staff-1', status: 'confirmed' })
    state.bookings.push({ id: 'booking-uuid-1', booking_id: 'OC-2026-00001' })

    const result = await ingestFinanceMessage(supabase, gmailMessage(), 'msgrow-1', detection({ senderKind: 'supplier', supplierId: 'sup-1', trusted: true }))

    expect(state.financeInvoices[0].status).toBe('ready')
    expect(result).toBe('factuur.pdf: klaar om te betalen')
  })

  it('known non-skipper supplier (no staff_id) — never attempts shift matching', async () => {
    state.financeSuppliers.push({ id: 'sup-marina', name: 'Jachthaven Westerdok', staff_id: null, iban: 'NL01TEST0123456789' })
    h.extractInvoiceFields.mockResolvedValue({ fields: { ...FULL_MATCH_EXTRACTED, hours: null, rateCents: null }, confidence: {} })

    await ingestFinanceMessage(supabase, gmailMessage(), null, detection({ senderKind: 'supplier', supplierId: 'sup-marina', trusted: true }))

    const invoice = state.financeInvoices[0]
    expect(invoice.matched_shift_id).toBeNull()
    const checks = invoice.checks as { key: string; ok: boolean; detail: string }[]
    expect(checks.find(c => c.key === 'skipper')?.detail).toContain('Jachthaven Westerdok')
  })

  it('unknown sender with a PDF attached — invoice created with no supplier, needs_review', async () => {
    const result = await ingestFinanceMessage(supabase, gmailMessage(), 'msgrow-1', detection())

    expect(state.financeInvoices).toHaveLength(1)
    expect(state.financeInvoices[0].supplier_id).toBeNull()
    expect(state.financeInvoices[0].status).toBe('needs_review')
    expect(result).toBe('factuur.pdf: nog te controleren')
  })

  it('unknown sender, no PDF attachment — flags for manual review, creates no invoice', async () => {
    const result = await ingestFinanceMessage(supabase, gmailMessage({ attachments: [] }), null, detection({ trusted: false }))

    expect(result).toContain('Onbekende afzender')
    expect(state.financeInvoices).toHaveLength(0)
  })

  it('trusted sender, no PDF attachment — silent no-op', async () => {
    const result = await ingestFinanceMessage(supabase, gmailMessage({ attachments: [] }), null, detection({ senderKind: 'staff', staffId: 'staff-1', trusted: true }))

    expect(result).toBeNull()
    expect(state.financeInvoices).toHaveLength(0)
    expect(state.financeSuppliers).toHaveLength(0)
  })

  it('extraction fails — invoice row still exists, downgraded to needs_review with a note, never throws', async () => {
    h.extractInvoiceFields.mockRejectedValue(new Error('Gemini 503'))

    const result = await ingestFinanceMessage(supabase, gmailMessage(), 'msgrow-1', detection({ trusted: false }))

    expect(state.financeInvoices).toHaveLength(1)
    expect(state.financeInvoices[0].status).toBe('needs_review')
    expect(state.financeInvoices[0].decision_note).toContain('mislukt')
    expect(result).toContain('automatische verwerking mislukt')
  })

  it('attachment download fails — no invoice row left behind, never throws', async () => {
    h.getAttachmentData.mockRejectedValue(new Error('Gmail API 500'))

    const result = await ingestFinanceMessage(supabase, gmailMessage(), 'msgrow-1', detection({ trusted: false }))

    expect(state.financeInvoices).toHaveLength(0)
    expect(result).toContain('opslaan mislukt')
  })

  it('two PDF attachments on one message — both processed independently', async () => {
    const result = await ingestFinanceMessage(
      supabase,
      gmailMessage({
        attachments: [
          { filename: 'a.pdf', mimeType: 'application/pdf', attachmentId: 'att-a', size: 1 },
          { filename: 'b.pdf', mimeType: 'application/pdf', attachmentId: 'att-b', size: 1 },
        ],
      }),
      'msgrow-1',
      detection({ trusted: false }),
    )

    expect(state.financeInvoices).toHaveLength(2)
    expect(result).toBe('a.pdf: nog te controleren · b.pdf: nog te controleren')
  })
})
