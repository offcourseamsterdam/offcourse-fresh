import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseChainMock, has, op, opArg, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({ recomputeExpense: vi.fn().mockResolvedValue(null) }))
vi.mock('./recompute', () => ({ recomputeExpense: h.recomputeExpense }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { isMatchable, loadOpenExpenses, matchDocument, matchNewDocuments, matchOrphanDocuments, toMatchExpense } from './match-orchestrator'

const DOC = {
  id: 'doc-1', kind: 'invoice_pdf', created_at: '2026-09-08T09:00:00Z', expense_id: null, duplicate_of: null, link_fetch_status: null, file_path: 'email/g/x.pdf',
  extracted: { supplierName: 'bol.com b.v.', invoiceNumber: 'INV-2026-12345', orderNumber: '12345', invoiceDate: '2026-09-08', grossCents: 12100, vatCents: 2100, currency: 'EUR' },
}
const EXP = (over: Record<string, unknown> = {}) => ({ id: 'exp-bol', supplier_name: 'BOL.COM BV', cash_out_cents: 12100, paid_at: '2026-09-05T12:00:00Z', bank_transaction_id: 'tx-1', status: 'waiting_for_invoice', ...over })
const TX = (over: Record<string, unknown> = {}) => ({ id: 'tx-1', reference: null, description: 'BOL.COM BV AMSTERDAM', currency: 'EUR', counterparty: null, ...over })

function db(opts: { doc?: Record<string, unknown> | null; expenses?: Record<string, unknown>[]; txs?: Record<string, unknown>[]; orphans?: Record<string, unknown>[]; claimLost?: boolean } = {}) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_documents') {
      if (has(q, 'update')) return has(q, 'is') ? { data: opts.claimLost ? [] : [{ id: 'doc-1' }] } : { data: null }
      if (op(q, 'eq')?.args[0] === 'id') return { data: opts.doc === undefined ? DOC : opts.doc }
      if (has(q, 'in') && op(q, 'in')!.args[0] === 'id') return { data: (op(q, 'in')!.args[1] as string[]).map(id => ({ ...DOC, id })) }
      return { data: opts.orphans ?? [] }
    }
    if (q.table === 'finance_expenses') {
      if (has(q, 'update')) return { data: null }
      return { data: opts.expenses ?? [EXP()] }
    }
    if (q.table === 'bank_transactions') return { data: opts.txs ?? [TX()] }
    return { data: null }
  })
}

beforeEach(() => vi.clearAllMocks())

describe('helpers', () => {
  it('toMatchExpense reads the IBAN out of the counterparty JSON and tolerates a missing transaction', () => {
    expect(toMatchExpense(EXP() as never, TX({ counterparty: { iban: 'NL91ABNA0417164300' } }) as never).counterpartyIban).toBe('NL91ABNA0417164300')
    expect(toMatchExpense(EXP() as never, undefined).currency).toBeNull()
  })
  it('isMatchable refuses attached docs, duplicates, unfetched links, unknown mail, file-less markers and documents parked for review', () => {
    expect(isMatchable(DOC as never)).toBe(true)
    expect(isMatchable({ ...DOC, expense_id: 'x' } as never)).toBe(false)
    expect(isMatchable({ ...DOC, duplicate_of: 'y' } as never)).toBe(false)
    expect(isMatchable({ ...DOC, kind: 'invoice_link', link_fetch_status: 'blocked' } as never)).toBe(false)
    expect(isMatchable({ ...DOC, kind: 'invoice_link', link_fetch_status: 'fetched' } as never)).toBe(true)
    expect(isMatchable({ ...DOC, kind: 'other_email' } as never)).toBe(false)
    expect(isMatchable({ ...DOC, kind: 'revolut_receipt' } as never)).toBe(true)
    expect(isMatchable({ ...DOC, kind: 'revolut_receipt', file_path: null } as never)).toBe(false)
    expect(isMatchable({ ...DOC, extracted: { ...DOC.extracted, matchReview: { expenseIds: ['a', 'b'], flaggedAt: 'x' } } } as never)).toBe(false)
  })
  it('loadOpenExpenses only asks for payments still waiting, and joins their bank facts in one extra query', async () => {
    const mock = db()
    const open = await loadOpenExpenses(mock.client as never)
    expect(opArg(mock.queries, 'finance_expenses', 'in')).toBe('status')
    expect(op(queriesFor(mock.queries, 'finance_expenses', 'select')[0], 'in')!.args[1]).toEqual(['waiting_for_invoice', 'partially_matched'])
    expect(open[0]).toMatchObject({ id: 'exp-bol', bankDescription: 'BOL.COM BV AMSTERDAM', currency: 'EUR' })
  })
})

describe('matchDocument', () => {
  it('the PRD case: the bol.com invoice attaches to the €121 card payment and the record is recomputed', async () => {
    const mock = db()
    const outcome = await matchDocument(mock.client as never, 'doc-1')
    expect(outcome).toBe('attached')
    const claim = queriesFor(mock.queries, 'finance_documents', 'update')[0]
    expect(op(claim, 'update')!.args[0]).toEqual({ expense_id: 'exp-bol' })
    // Only an orphan can be claimed — the other matcher (Gmail poll vs Revolut pass) may have got there first.
    expect(op(claim, 'is')!.args).toEqual(['expense_id', null])
    const expUpdate = opArg(mock.queries, 'finance_expenses', 'update') as Record<string, unknown>
    expect(expUpdate.match_confidence).toBeGreaterThanOrEqual(0.9)
    expect(expUpdate.match_signals).toMatchObject({ documentId: 'doc-1', signals: expect.objectContaining({ exactAmount: true }) })
    expect(h.recomputeExpense).toHaveBeenCalledWith(expect.anything(), 'exp-bol')
  })

  it('a weaker fit still attaches, as partial — one click for Beer, no silent certainty', async () => {
    const mock = db({ expenses: [EXP({ cash_out_cents: 12150, supplier_name: 'Bol' })] })
    const outcome = await matchDocument(mock.client as never, 'doc-1')
    expect(outcome).toBe('attached_partial')
    expect((opArg(mock.queries, 'finance_expenses', 'update') as { match_confidence: number }).match_confidence).toBeLessThan(0.9)
  })

  it('losing the claim race → skipped, and the payment is not marked as matched', async () => {
    const mock = db({ claimLost: true })
    expect(await matchDocument(mock.client as never, 'doc-1')).toBe('skipped')
    expect(queriesFor(mock.queries, 'finance_expenses', 'update')).toHaveLength(0)
    expect(h.recomputeExpense).not.toHaveBeenCalled()
  })

  it('two look-alike payments: neither gets the document; both are flagged for review (only if not already flagged); the question is remembered on the document', async () => {
    const mock = db({ expenses: [EXP({ id: 'a' }), EXP({ id: 'b', paid_at: '2026-09-06T12:00:00Z' })] })
    const outcome = await matchDocument(mock.client as never, 'doc-1')
    expect(outcome).toBe('review')
    const docUpdates = queriesFor(mock.queries, 'finance_documents', 'update')
    expect(docUpdates).toHaveLength(1)
    expect(op(docUpdates[0], 'update')!.args[0]).toMatchObject({ extracted: expect.objectContaining({ matchReview: expect.objectContaining({ expenseIds: expect.arrayContaining(['a', 'b']) }) }) })
    const flagged = queriesFor(mock.queries, 'finance_expenses', 'update')
    expect(flagged).toHaveLength(2)
    expect(op(flagged[0], 'update')!.args[0]).toMatchObject({ needs_review_reason: expect.stringContaining('doc-1') })
    expect(op(flagged[0], 'is')!.args).toEqual(['needs_review_reason', null])
    expect(h.recomputeExpense).toHaveBeenCalledTimes(2)
  })

  it('no plausible payment → none, nothing written', async () => {
    const mock = db({ expenses: [EXP({ cash_out_cents: 999, supplier_name: 'Coolblue' })], txs: [TX({ description: 'COOLBLUE' })] })
    expect(await matchDocument(mock.client as never, 'doc-1')).toBe('none')
    expect(queriesFor(mock.queries, 'finance_expenses', 'update')).toHaveLength(0)
  })

  it('an already-attached or duplicate document is skipped without loading candidates', async () => {
    const mock = db({ doc: { ...DOC, expense_id: 'exp-x' } })
    expect(await matchDocument(mock.client as never, 'doc-1')).toBe('skipped')
    expect(queriesFor(mock.queries, 'finance_expenses', 'select')).toHaveLength(0)
  })

  it('a payment takes one document per pass: the second document in a batch cannot grab the same payment; documents are loaded in one query', async () => {
    const mock = db()
    const tally = await matchNewDocuments(mock.client as never, ['doc-1', 'doc-2'])
    expect(tally.attached).toBe(1)
    expect(tally.none).toBe(1)
    // No per-document re-read: the only finance_documents SELECT is the one `.in('id', …)` batch load.
    const reads = mock.queries.filter(q => q.table === 'finance_documents' && q.ops[0]?.method === 'select')
    expect(reads).toHaveLength(1)
    expect(op(reads[0], 'in')!.args[0]).toBe('id')
  })
})

describe('matchOrphanDocuments', () => {
  it('re-scores recent orphans only, oldest first, and returns the tally', async () => {
    const mock = db({ orphans: [DOC] })
    const tally = await matchOrphanDocuments(mock.client as never, { windowDays: 30 })
    const q = queriesFor(mock.queries, 'finance_documents', 'select')[0]
    expect(op(q, 'is')!.args).toEqual(['expense_id', null])
    expect(op(q, 'gte')!.args[0]).toBe('created_at')
    expect(op(q, 'limit')!.args[0]).toBe(200)
    expect(tally.attached).toBe(1)
  })
  it('an empty orphan list makes no candidate query at all', async () => {
    const mock = db({ orphans: [] })
    await matchOrphanDocuments(mock.client as never)
    expect(queriesFor(mock.queries, 'finance_expenses', 'select')).toHaveLength(0)
  })
})
