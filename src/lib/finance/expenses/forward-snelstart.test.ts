import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseChainMock, has, op, opArg, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  sendNewEmail: vi.fn(),
  downloadFinanceAttachment: vi.fn(),
  recomputeExpense: vi.fn().mockResolvedValue(null),
  postSlackOps: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/gmail/client', () => ({ sendNewEmail: h.sendNewEmail }))
vi.mock('@/lib/finance/attachment-storage', () => ({ downloadFinanceAttachment: h.downloadFinanceAttachment }))
vi.mock('./recompute', () => ({ recomputeExpense: h.recomputeExpense }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackOps: h.postSlackOps }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { buildForwardEmail, forwardExpenseToSnelstart, forwardReadyExpenses, releaseStaleClaims } from './forward-snelstart'

const EXPENSE = (over: Record<string, unknown> = {}) => ({
  id: 'exp-1', ref: 'FIN-000042', status: 'ready_for_snelstart', supplier_name: 'bol.com b.v.', invoice_number: 'INV-2026-12345', order_number: '12345',
  invoice_date: '2026-09-08', paid_at: '2026-09-05T12:00:00Z', gross_cents: 12100, vat_cents: 2100, net_cents: 10000, vat_rate_pct: 21, vat_source: 'invoice',
  primary_document_id: 'doc-1', snelstart_sent_at: null, notes: null, vat_conflict: null, ...over,
})
const DOC = (over: Record<string, unknown> = {}) => ({ id: 'doc-1', kind: 'invoice_pdf', file_path: 'email/g1/x.pdf', original_filename: 'factuur bol.pdf', mime_type: 'application/pdf', ...over })

function db(opts: { expense?: Record<string, unknown> | null; doc?: Record<string, unknown> | null; claimed?: boolean; ready?: Record<string, unknown>[]; autoForward?: boolean; stale?: Array<{ id: string; ref: string }> } = {}) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_settings') return { data: { snelstart_auto_forward: opts.autoForward ?? true } }
    if (q.table === 'finance_expenses') {
      if (has(q, 'update')) {
        if (has(q, 'lt')) return { data: opts.stale ?? [] } // releaseStaleClaims
        if (has(q, 'is')) return { data: (opts.claimed ?? true) ? [{ id: 'exp-1' }] : [] }
        return { data: null }
      }
      if (has(q, 'in')) return { data: opts.ready ?? [{ id: 'exp-1', ref: 'FIN-000042' }] }
      return { data: opts.expense === undefined ? EXPENSE() : opts.expense }
    }
    if (q.table === 'finance_documents') return { data: opts.doc === undefined ? DOC() : opts.doc }
    return { data: null }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('SNELSTART_INBOX_EMAIL', 'books@example.test')
  h.sendNewEmail.mockResolvedValue({ id: 'gm-1', threadId: 't-1' })
  h.downloadFinanceAttachment.mockResolvedValue(Buffer.from('%PDF-1.4'))
})

describe('buildForwardEmail', () => {
  it('subject carries ref, supplier and invoice number with ASCII hyphens only; body has the facts; filename is ref-prefixed', () => {
    const mail = buildForwardEmail(EXPENSE({ supplier_name: 'Café — Zuid' }) as never, DOC() as never, 'books@example.test')
    expect(mail.to).toBe('books@example.test')
    expect(mail.subject).toBe('[FIN-000042] Café - Zuid - INV-2026-12345')
    expect(mail.body).toContain('Referentie: FIN-000042')
    expect(mail.body).toContain('Factuurnummer: INV-2026-12345')
    // Plain ASCII money — a bookkeeping scanner reads "EUR 21,00", never "€" + a non-breaking space (mojibake class of commit 79dc249).
    expect(mail.body).toContain('BTW: EUR 21,00 (21%) - bron: invoice')
    expect(mail.body).toContain('Bruto: EUR 121,00')
    expect(/[^\x00-\x7f]/.test(mail.body.replace(/Café — Zuid/g, ''))).toBe(false)
    expect(mail.body).toContain('Bijlage: factuur (PDF) (factuur bol.pdf)')
    expect(mail.attachmentFilename).toBe('FIN-000042_factuur bol.pdf')
  })
  it('falls back to the invoice date (or payment date) when there is no invoice number', () => {
    expect(buildForwardEmail(EXPENSE({ invoice_number: null }) as never, DOC() as never, 'b@x.test').subject).toBe('[FIN-000042] bol.com b.v. - 2026-09-08')
    expect(buildForwardEmail(EXPENSE({ invoice_number: null, invoice_date: null }) as never, DOC() as never, 'b@x.test').subject).toBe('[FIN-000042] bol.com b.v. - 2026-09-05')
  })
})

describe('forwardExpenseToSnelstart', () => {
  it('happy path: claims, downloads the ORIGINAL file, sends it attached, records message id, recomputes', async () => {
    const mock = db()
    const r = await forwardExpenseToSnelstart(mock.client as never, 'exp-1', { actor: 'cron' })
    expect(r).toEqual({ ok: true, messageId: 'gm-1', recipient: 'books@example.test' })
    // Claim happens before the download and the send.
    const updates = queriesFor(mock.queries, 'finance_expenses', 'update')
    expect(op(updates[0], 'update')!.args[0]).toMatchObject({ snelstart_sent_at: expect.any(String) })
    expect(op(updates[0], 'is')!.args).toEqual(['snelstart_sent_at', null])
    expect(h.downloadFinanceAttachment).toHaveBeenCalledWith(expect.anything(), 'email/g1/x.pdf')
    const sent = h.sendNewEmail.mock.calls[0][0]
    expect(sent.to).toBe('books@example.test')
    expect(sent.attachments).toHaveLength(1)
    expect(sent.attachments[0]).toMatchObject({ filename: 'FIN-000042_factuur bol.pdf', mimeType: 'application/pdf' })
    expect(op(updates[1], 'update')!.args[0]).toMatchObject({ snelstart_document_id: 'doc-1', snelstart_recipient: 'books@example.test', snelstart_message_id: 'gm-1' })
    expect(h.recomputeExpense).toHaveBeenCalledWith(expect.anything(), 'exp-1')
  })

  it('written once: a record that was already sent is refused before anything is downloaded', async () => {
    const mock = db({ expense: EXPENSE({ snelstart_sent_at: '2026-09-01T00:00:00Z' }) })
    expect(await forwardExpenseToSnelstart(mock.client as never, 'exp-1', { actor: 'manual' })).toEqual({ ok: false, reason: 'already_sent' })
    expect(h.downloadFinanceAttachment).not.toHaveBeenCalled()
    expect(h.sendNewEmail).not.toHaveBeenCalled()
  })

  it('a lost claim race (another sender got there first) sends nothing', async () => {
    const mock = db({ claimed: false })
    expect(await forwardExpenseToSnelstart(mock.client as never, 'exp-1', { actor: 'cron' })).toEqual({ ok: false, reason: 'already_sent' })
    expect(h.sendNewEmail).not.toHaveBeenCalled()
  })

  it('the cron only sends ready_for_snelstart; a manual send may go out from matched — never from a partial match or a record under review', async () => {
    expect(await forwardExpenseToSnelstart(db({ expense: EXPENSE({ status: 'matched' }) }).client as never, 'exp-1', { actor: 'cron' })).toEqual({ ok: false, reason: 'not_ready' })
    expect((await forwardExpenseToSnelstart(db({ expense: EXPENSE({ status: 'matched' }) }).client as never, 'exp-1', { actor: 'manual' })).ok).toBe(true)
    expect(await forwardExpenseToSnelstart(db({ expense: EXPENSE({ status: 'partially_matched' }) }).client as never, 'exp-1', { actor: 'manual' })).toEqual({ ok: false, reason: 'not_confirmed' })
    expect(await forwardExpenseToSnelstart(db({ expense: EXPENSE({ status: 'needs_review' }) }).client as never, 'exp-1', { actor: 'manual' })).toEqual({ ok: false, reason: 'not_confirmed' })
    expect(await forwardExpenseToSnelstart(db({ expense: EXPENSE({ status: 'waiting_for_invoice' }) }).client as never, 'exp-1', { actor: 'manual' })).toEqual({ ok: false, reason: 'not_confirmed' })
  })

  it('a VAT conflict blocks every actor — the body would state a disputed figure as fact', async () => {
    expect(await forwardExpenseToSnelstart(db({ expense: EXPENSE({ vat_conflict: { invoice: 2100, revolut: 900 } }) }).client as never, 'exp-1', { actor: 'manual' })).toEqual({ ok: false, reason: 'vat_conflict' })
    expect(h.sendNewEmail).not.toHaveBeenCalled()
  })

  it('no recipient configured → refused, never a hardcoded fallback mailbox', async () => {
    vi.stubEnv('SNELSTART_INBOX_EMAIL', '')
    const r = await forwardExpenseToSnelstart(db().client as never, 'exp-1', { actor: 'manual' })
    expect(r).toMatchObject({ ok: false, reason: 'not_configured' })
    expect(h.sendNewEmail).not.toHaveBeenCalled()
    expect(await forwardReadyExpenses(db().client as never)).toMatchObject({ enabled: false, sent: 0 })
  })

  it('never from ignored or booked, and never without a real file (an order mail is not a document to book from)', async () => {
    expect(await forwardExpenseToSnelstart(db({ expense: EXPENSE({ status: 'ignored' }) }).client as never, 'exp-1', { actor: 'manual' })).toEqual({ ok: false, reason: 'ignored_or_booked' })
    expect(await forwardExpenseToSnelstart(db({ expense: EXPENSE({ primary_document_id: null }) }).client as never, 'exp-1', { actor: 'manual' })).toEqual({ ok: false, reason: 'no_document' })
    const r = await forwardExpenseToSnelstart(db({ doc: DOC({ kind: 'order_confirmation_email', file_path: null }) }).client as never, 'exp-1', { actor: 'manual' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no_document')
  })

  it('a failed send releases the claim so the next run can retry', async () => {
    h.sendNewEmail.mockRejectedValue(new Error('Gmail 500'))
    const mock = db()
    const r = await forwardExpenseToSnelstart(mock.client as never, 'exp-1', { actor: 'cron' })
    expect(r).toEqual({ ok: false, reason: 'send_failed', detail: 'Gmail 500' })
    const updates = queriesFor(mock.queries, 'finance_expenses', 'update')
    expect(op(updates[updates.length - 1], 'update')!.args[0]).toEqual({ snelstart_sent_at: null })
    expect(h.recomputeExpense).not.toHaveBeenCalled()
  })

  it('the mail is out: a failure in our own post-send bookkeeping is logged, the outcome stays ok (never a second send)', async () => {
    h.recomputeExpense.mockRejectedValueOnce(new Error('db hiccup'))
    const r = await forwardExpenseToSnelstart(db().client as never, 'exp-1', { actor: 'cron' })
    expect(r.ok).toBe(true)
  })

  it('a missing file in storage releases the claim and reports download_failed', async () => {
    h.downloadFinanceAttachment.mockResolvedValue(null)
    const mock = db()
    const r = await forwardExpenseToSnelstart(mock.client as never, 'exp-1', { actor: 'cron' })
    expect(r).toMatchObject({ ok: false, reason: 'download_failed' })
    expect(h.sendNewEmail).not.toHaveBeenCalled()
  })
})

describe('forwardReadyExpenses', () => {
  it('respects the auto-forward switch', async () => {
    const mock = db({ autoForward: false })
    expect(await forwardReadyExpenses(mock.client as never)).toEqual({ enabled: false, considered: 0, sent: 0, released: [], failed: [] })
    expect(queriesFor(mock.queries, 'finance_expenses', 'select')).toHaveLength(0)
  })

  it('asks only for ready, unsent records with a document, oldest match first, and tallies', async () => {
    const mock = db()
    const r = await forwardReadyExpenses(mock.client as never)
    const listing = queriesFor(mock.queries, 'finance_expenses', 'in')[0]
    expect(op(listing, 'in')!.args).toEqual(['status', ['ready_for_snelstart']])
    expect(op(listing, 'is')!.args).toEqual(['snelstart_sent_at', null])
    expect(op(listing, 'not')!.args).toEqual(['primary_document_id', 'is', null])
    expect(opArg(mock.queries, 'finance_expenses', 'limit')).toBe(10)
    expect(r).toEqual({ enabled: true, considered: 1, sent: 1, released: [], failed: [] })
    expect(h.postSlackOps).not.toHaveBeenCalled()
  })

  it('a claim from a crashed run (set >15 min ago, nothing sent) is released, recomputed and reported before the batch', async () => {
    const mock = db({ stale: [{ id: 'exp-9', ref: 'FIN-000009' }] })
    const r = await forwardReadyExpenses(mock.client as never)
    expect(r.released).toEqual(['FIN-000009'])
    const release = queriesFor(mock.queries, 'finance_expenses', 'update').find(q => has(q, 'lt'))!
    expect(op(release, 'update')!.args[0]).toEqual({ snelstart_sent_at: null })
    expect(op(release, 'is')!.args).toEqual(['snelstart_message_id', null])
    expect(h.recomputeExpense).toHaveBeenCalledWith(expect.anything(), 'exp-9')
    expect(h.postSlackOps).toHaveBeenCalledWith(expect.stringContaining('vastgelopen claim'))
  })

  it('releaseStaleClaims alone: nothing stale → nothing written back', async () => {
    const mock = db()
    expect(await releaseStaleClaims(mock.client as never)).toEqual([])
    expect(h.recomputeExpense).not.toHaveBeenCalled()
  })

  it('a failure is reported to Beer\'s DM and does not stop the batch', async () => {
    h.downloadFinanceAttachment.mockResolvedValue(null)
    const mock = db()
    const r = await forwardReadyExpenses(mock.client as never)
    expect(r.sent).toBe(0)
    expect(r.failed).toEqual([{ id: 'exp-1', ref: 'FIN-000042', reason: 'download_failed', detail: 'email/g1/x.pdf' }])
    expect(h.postSlackOps).toHaveBeenCalledWith(expect.stringContaining('FIN-000042: download_failed'))
  })
})
