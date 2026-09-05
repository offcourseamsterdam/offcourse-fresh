import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseChainMock, has, op, opArg, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'
import type { RevolutExpense } from '@/lib/revolut/client'

const h = vi.hoisted(() => ({
  classifyStructural: vi.fn(),
  loadRuleContext: vi.fn().mockResolvedValue({ today: '2026-09-05', staff: [], loanPayments: [], obligations: [], learnedRules: [] }),
  toClassifiable: vi.fn((row: unknown) => row),
  uploadFinanceAttachment: vi.fn().mockResolvedValue({ ok: true }),
  extractDocumentFields: vi.fn(),
  recomputeExpense: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/finance/cockpit/classify/rules', () => ({ classifyStructural: h.classifyStructural }))
vi.mock('@/lib/finance/cockpit/classify/apply', () => ({ loadRuleContext: h.loadRuleContext, toClassifiable: h.toClassifiable }))
vi.mock('@/lib/finance/attachment-storage', () => ({ uploadFinanceAttachment: h.uploadFinanceAttachment }))
vi.mock('./extract-document', () => ({ extractDocumentFields: h.extractDocumentFields }))
vi.mock('./recompute', () => ({ recomputeExpense: h.recomputeExpense }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { ensureExpensesForTransactions, revolutVatFromSplits, syncRevolutExpenses } from './sync-revolut'

const TX = {
  id: 'bt-1', revolut_id: 'rev-tx-1', type: 'card_payment', state: 'completed', amount_cents: -12100, fee_cents: 0,
  created_at: '2026-09-05T11:59:00Z', updated_at: '2026-09-05T12:00:00Z', completed_at: '2026-09-05T12:00:00Z', account_id: 'acct-1',
  currency: 'EUR', balance_after_cents: null, reference: null, description: 'BOL.COM BV', counterparty: null, merchant: { name: 'Bol.com' }, raw: {},
  category: null, subcategory: null, boat_id: null, goal_id: null, obligation_id: null, loan_payment_id: null, invoice_id: null, expense_id: null,
  classified_by: null, confidence: null, classification_reason: null, needs_review: false, reviewed_at: null, vat_cents: null,
  first_seen_at: '2026-09-05T12:00:00Z', last_synced_at: '2026-09-05T12:00:00Z', allocation_applied: null, allocation_applied_at: null,
}

const PDF = Buffer.concat([Buffer.from('%PDF-1.4 receipt bytes'), Buffer.alloc(32)])

function expense(over: Partial<RevolutExpense> = {}): RevolutExpense {
  return {
    id: 'rexp-1', state: 'approved', transaction_type: 'card_payment', merchant: 'Bol.com', transaction_id: 'rev-tx-1',
    expense_date: '2026-09-05T12:00:00Z', labels: {}, receipt_ids: [], spent_amount: { amount: 121, currency: 'EUR' },
    splits: [{ amount: { amount: 121, currency: 'EUR' }, tax_rate: { id: 't', name: 'BTW 21%', percentage: 21 } }],
    ...over,
  }
}

describe('revolutVatFromSplits', () => {
  it('€121 at 21% → €21, rate 21', () => {
    expect(revolutVatFromSplits(expense())).toEqual({ vatCents: 2100, ratePct: 21 })
  })
  it('mixed rates sum the VAT but report no single rate', () => {
    const e = expense({ splits: [
      { amount: { amount: 121, currency: 'EUR' }, tax_rate: { id: 'a', percentage: 21 } },
      { amount: { amount: 109, currency: 'EUR' }, tax_rate: { id: 'b', percentage: 9 } },
    ] })
    expect(revolutVatFromSplits(e)).toEqual({ vatCents: 3000, ratePct: null })
  })
  it('no rate picked in the app → nothing, never a guess', () => {
    expect(revolutVatFromSplits(expense({ splits: [{ amount: { amount: 121, currency: 'EUR' } }] }))).toEqual({ vatCents: null, ratePct: null })
  })
  it('non-euro or negative splits are never a VAT candidate', () => {
    expect(revolutVatFromSplits(expense({ splits: [{ amount: { amount: 121, currency: 'USD' }, tax_rate: { id: 't', percentage: 21 } }] }))).toEqual({ vatCents: null, ratePct: null })
    expect(revolutVatFromSplits(expense({ splits: [{ amount: { amount: -121, currency: 'EUR' }, tax_rate: { id: 't', percentage: 21 } }] }))).toEqual({ vatCents: null, ratePct: null })
  })
})

describe('ensureExpensesForTransactions', () => {
  beforeEach(() => { vi.clearAllMocks(); h.classifyStructural.mockReturnValue(null) })

  function db(rows: Record<string, unknown>[], insertError?: { code: string; message: string }) {
    return createSupabaseChainMock((q: RecordedQuery) => {
      if (q.table === 'bank_transactions' && has(q, 'update')) return { data: null }
      if (q.table === 'bank_transactions') return { data: rows }
      if (q.table === 'finance_expenses' && has(q, 'insert')) return insertError ? { data: null, error: insertError } : { data: { id: 'exp-new' } }
      if (q.table === 'finance_expenses') return { data: { id: 'exp-existing' } }
      return { data: null }
    })
  }

  it('creates a waiting_for_invoice record for a completed card payment and links the transaction to it', async () => {
    const mock = db([TX])
    const r = await ensureExpensesForTransactions(mock.client as never, { accountId: 'acct-1', since: '2026-08-01T00:00:00Z' })
    expect(r).toEqual({ scanned: 1, created: 1, ignored: 0 })
    expect(opArg(mock.queries, 'finance_expenses', 'insert')).toMatchObject({ bank_transaction_id: 'bt-1', cash_out_cents: 12100, status: 'waiting_for_invoice', supplier_name: 'Bol.com' })
    expect(opArg(mock.queries, 'bank_transactions', 'update')).toEqual({ expense_id: 'exp-new' })
  })

  it('scopes the scan to this account, completed, outgoing, not yet linked, since the window start', async () => {
    const mock = db([])
    await ensureExpensesForTransactions(mock.client as never, { accountId: 'acct-1', since: '2026-08-01T00:00:00Z' })
    const q = mock.queries.find(x => x.table === 'bank_transactions')!
    expect(q.ops.filter(o => o.method === 'eq').map(o => o.args)).toEqual([['account_id', 'acct-1'], ['state', 'completed']])
    expect(op(q, 'lt')?.args).toEqual(['amount_cents', 0])
    expect(op(q, 'is')?.args).toEqual(['expense_id', null])
    expect(op(q, 'gte')?.args).toEqual(['created_at', '2026-08-01T00:00:00Z'])
  })

  it('an internal transfer is recorded as ignored, still linked, never counted as created', async () => {
    h.classifyStructural.mockReturnValue({ category: 'transfer', subcategory: 'internal', confidence: 1, reason: 'own', source: 'rule' })
    const mock = db([{ ...TX, type: 'transfer', merchant: null, counterparty: { name: 'Off Course Pocket' } }])
    const r = await ensureExpensesForTransactions(mock.client as never, { accountId: 'acct-1', since: '2026-08-01T00:00:00Z' })
    expect(r).toEqual({ scanned: 1, created: 0, ignored: 1 })
    expect(opArg(mock.queries, 'finance_expenses', 'insert')).toMatchObject({ status: 'ignored' })
  })

  it('a race on the unique bank_transaction_id reuses the existing record', async () => {
    const mock = db([TX], { code: '23505', message: 'dup' })
    const r = await ensureExpensesForTransactions(mock.client as never, { accountId: 'acct-1', since: '2026-08-01T00:00:00Z' })
    expect(r.created).toBe(1)
    expect(opArg(mock.queries, 'bank_transactions', 'update')).toEqual({ expense_id: 'exp-existing' })
  })
})

describe('syncRevolutExpenses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.extractDocumentFields.mockResolvedValue({ fields: { vatCents: 2100, grossCents: 12100, documentKind: 'receipt' }, confidence: { vatCents: 1 } })
  })

  function db(opts: { expenseIdForTx?: string | null; knownReceiptIds?: string[]; knownOrphan?: boolean; shaDupId?: string | null; current?: Record<string, unknown> | null; expenseUpdateError?: { code: string; message: string } } = {}) {
    return createSupabaseChainMock((q: RecordedQuery) => {
      if (q.table === 'bank_transactions') return { data: opts.expenseIdForTx === undefined ? { expense_id: 'exp-1' } : opts.expenseIdForTx === null ? null : { expense_id: opts.expenseIdForTx } }
      if (q.table === 'finance_expenses') {
        if (has(q, 'update')) return opts.expenseUpdateError ? { data: null, error: opts.expenseUpdateError } : { data: null }
        return { data: opts.current ?? null } // change detection: what the record currently holds
      }
      if (q.table === 'finance_documents') {
        if (has(q, 'insert')) return { data: { id: 'doc-new' } }
        if (has(q, 'update')) return { data: null }
        const eqCol = op(q, 'eq')?.args[0]
        if (eqCol === 'revolut_receipt_id') return { data: (opts.knownReceiptIds ?? []).includes(op(q, 'eq')!.args[1] as string) ? { id: 'doc-known', expense_id: opts.knownOrphan ? null : 'exp-1' } : null }
        if (eqCol === 'sha256') return { data: opts.shaDupId ? { id: opts.shaDupId, file_path: 'revolut/original.pdf' } : null }
      }
      return { data: null }
    })
  }
  const client = (expenses: RevolutExpense[], receipt: Buffer = PDF) => ({
    listExpensesSince: vi.fn().mockResolvedValue(expenses),
    getExpenseReceipt: vi.fn().mockResolvedValue(receipt),
  })

  it('stamps the Revolut VAT onto the linked record and recomputes it', async () => {
    const mock = db()
    const c = client([expense()])
    const r = await syncRevolutExpenses(mock.client as never, c, { since: '2026-08-01T00:00:00Z' })
    expect(r).toMatchObject({ expensesSeen: 1, linked: 1, receiptsStored: 0 })
    expect(opArg(mock.queries, 'finance_expenses', 'update')).toMatchObject({ revolut_expense_id: 'rexp-1', revolut_expense_state: 'approved', revolut_vat_rate_pct: 21, revolut_vat_cents: 2100 })
    expect(h.recomputeExpense).toHaveBeenCalledWith(expect.anything(), 'exp-1')
  })

  it('unchanged Revolut facts → no write, no recompute (the 7-day window re-visits every expense every 15 minutes)', async () => {
    const mock = db({ current: { revolut_expense_id: 'rexp-1', revolut_expense_state: 'approved', revolut_vat_rate_pct: 21, revolut_vat_cents: 2100 } })
    const r = await syncRevolutExpenses(mock.client as never, client([expense()]), { since: '2026-08-01T00:00:00Z' })
    expect(r.linked).toBe(1)
    expect(queriesFor(mock.queries, 'finance_expenses', 'update')).toHaveLength(0)
    expect(h.recomputeExpense).not.toHaveBeenCalled()
  })

  it('a revolut_expense_id already on another record (23505) is logged and skipped — never wedges the run', async () => {
    const mock = db({ expenseUpdateError: { code: '23505', message: 'dup' } })
    const r = await syncRevolutExpenses(mock.client as never, client([expense(), expense({ id: 'rexp-2', transaction_id: 'rev-tx-2' })]), { since: '2026-08-01T00:00:00Z' })
    expect(r.expensesSeen).toBe(2)
    expect(r.failedExpenses).toBe(0)
  })

  it('one broken expense is counted and the rest still sync (and the orphan matching after us still runs)', async () => {
    const mock = db({ expenseUpdateError: { code: 'XX000', message: 'boom' } })
    const r = await syncRevolutExpenses(mock.client as never, client([expense(), expense({ id: 'rexp-2', transaction_id: 'rev-tx-2' })]), { since: '2026-08-01T00:00:00Z' })
    expect(r.failedExpenses).toBe(2)
    expect(r.expensesSeen).toBe(2)
  })

  it('downloads a new receipt once, stores it under a server key with the sniffed extension, hashes it, and reads it with Gemini', async () => {
    const mock = db()
    const c = client([expense({ receipt_ids: ['r-1'] })])
    const r = await syncRevolutExpenses(mock.client as never, c, { since: '2026-08-01T00:00:00Z' })
    expect(r.receiptsStored).toBe(1)
    expect(c.getExpenseReceipt).toHaveBeenCalledWith('rexp-1', 'r-1')
    // Server-generated key — never third-party identifiers in the storage path.
    expect(h.uploadFinanceAttachment.mock.calls[0][1]).toMatch(/^revolut\/[0-9a-f-]{36}\.pdf$/)
    expect(h.uploadFinanceAttachment.mock.calls[0][3]).toBe('application/pdf')
    const inserted = opArg(mock.queries, 'finance_documents', 'insert') as Record<string, unknown>
    expect(inserted).toMatchObject({ expense_id: 'exp-1', kind: 'revolut_receipt', source: 'revolut', revolut_receipt_id: 'r-1', file_path: h.uploadFinanceAttachment.mock.calls[0][1], mime_type: 'application/pdf', duplicate_of: null })
    expect(typeof inserted.sha256).toBe('string')
    expect(h.extractDocumentFields).toHaveBeenCalledWith(PDF.toString('base64'), 'application/pdf')
    expect(opArg(mock.queries, 'finance_documents', 'update')).toMatchObject({ extracted: expect.objectContaining({ vatCents: 2100 }) })
  })

  it('never downloads a receipt it already holds', async () => {
    const mock = db({ knownReceiptIds: ['r-1'] })
    const c = client([expense({ receipt_ids: ['r-1'] })])
    const r = await syncRevolutExpenses(mock.client as never, c, { since: '2026-08-01T00:00:00Z' })
    expect(c.getExpenseReceipt).not.toHaveBeenCalled()
    expect(r.receiptsStored).toBe(0)
    expect(queriesFor(mock.queries, 'finance_documents', 'update')).toHaveLength(0)
  })

  it('a receipt stored while the card payment was still pending is adopted by the record once the payment lands (review finding H1)', async () => {
    const mock = db({ knownReceiptIds: ['r-1'], knownOrphan: true })
    const c = client([expense({ receipt_ids: ['r-1'] })])
    await syncRevolutExpenses(mock.client as never, c, { since: '2026-08-01T00:00:00Z' })
    expect(c.getExpenseReceipt).not.toHaveBeenCalled()
    const adopt = queriesFor(mock.queries, 'finance_documents', 'update')[0]
    expect(op(adopt, 'update')!.args[0]).toEqual({ expense_id: 'exp-1' })
    expect(op(adopt, 'is')!.args).toEqual(['expense_id', null])
    expect(h.recomputeExpense).toHaveBeenCalledWith(expect.anything(), 'exp-1')
  })

  it('bytes that are not a PDF/image are never uploaded or sent to a model — but a file-less marker row stops the re-download every quarter-hour', async () => {
    const mock = db()
    const c = client([expense({ receipt_ids: ['r-1'] })], Buffer.from('<html>oops</html>'))
    const r = await syncRevolutExpenses(mock.client as never, c, { since: '2026-08-01T00:00:00Z' })
    expect(r.skippedReceipts).toBe(1)
    expect(h.uploadFinanceAttachment).not.toHaveBeenCalled()
    expect(h.extractDocumentFields).not.toHaveBeenCalled()
    expect(opArg(mock.queries, 'finance_documents', 'insert')).toMatchObject({ kind: 'revolut_receipt', revolut_receipt_id: 'r-1', file_path: null, extracted: expect.objectContaining({ skipped: true }) })
  })

  it('identical bytes already stored → recorded as a duplicate, not re-uploaded or re-extracted', async () => {
    const mock = db({ shaDupId: 'doc-original' })
    const c = client([expense({ receipt_ids: ['r-2'] })])
    await syncRevolutExpenses(mock.client as never, c, { since: '2026-08-01T00:00:00Z' })
    expect(h.uploadFinanceAttachment).not.toHaveBeenCalled()
    // The duplicate points at the ORIGINAL's file — its own key was never uploaded.
    expect(opArg(mock.queries, 'finance_documents', 'insert')).toMatchObject({ duplicate_of: 'doc-original', sha256: null, file_path: 'revolut/original.pdf' })
    expect(h.extractDocumentFields).not.toHaveBeenCalled()
  })

  it('an expense without a transaction (or one we have not synced) leaves an orphan receipt for the matcher', async () => {
    const mock = db({ expenseIdForTx: null })
    const c = client([expense({ transaction_id: undefined, receipt_ids: ['r-3'] })])
    const r = await syncRevolutExpenses(mock.client as never, c, { since: '2026-08-01T00:00:00Z' })
    expect(r).toMatchObject({ linked: 0, receiptsStored: 1, orphanReceipts: 1 })
    expect(opArg(mock.queries, 'finance_documents', 'insert')).toMatchObject({ expense_id: null })
    expect(h.recomputeExpense).not.toHaveBeenCalled()
  })

  it('a failed extraction is counted, the document is kept, the run continues', async () => {
    h.extractDocumentFields.mockRejectedValue(new Error('Gemini 503'))
    const mock = db()
    const r = await syncRevolutExpenses(mock.client as never, client([expense({ receipt_ids: ['r-1'] })]), { since: '2026-08-01T00:00:00Z' })
    expect(r).toMatchObject({ receiptsStored: 1, extractionFailures: 1 })
  })

  it('respects the per-run receipt budget', async () => {
    const mock = db()
    const c = client([expense({ receipt_ids: ['a', 'b', 'c'] })])
    const r = await syncRevolutExpenses(mock.client as never, c, { since: '2026-08-01T00:00:00Z', maxReceipts: 2 })
    expect(c.getExpenseReceipt).toHaveBeenCalledTimes(2)
    expect(r.receiptsStored).toBe(2)
    expect(queriesFor(mock.queries, 'finance_documents', 'insert')).toHaveLength(2)
  })
})
