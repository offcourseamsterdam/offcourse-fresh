import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseChainMock, has, op, opArg, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  recomputeExpense: vi.fn().mockResolvedValue({ status: 'matched' }),
  loadConnection: vi.fn().mockResolvedValue({ account_id: 'acc-1' }),
  isConnected: vi.fn().mockReturnValue(true),
  createRevolutClient: vi.fn(),
  createCounterparty: vi.fn().mockResolvedValue({ id: 'cp-1' }),
  createPaymentDraft: vi.fn().mockResolvedValue({ id: 'draft-1' }),
  logFinanceEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./recompute', async importOriginal => ({ ...(await importOriginal<typeof import('./recompute')>()), recomputeExpense: h.recomputeExpense }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/finance/cockpit/events', () => ({ logFinanceEvent: h.logFinanceEvent }))
vi.mock('@/lib/revolut/token-store', () => ({ loadConnection: h.loadConnection, isConnected: h.isConnected, createRevolutClient: h.createRevolutClient }))

import { ExpenseActionError, clearReview, confirmMatch, createSupplierAndLink, draftExpensePayment, ignoreExpense, linkDocument, linkSupplier, listExpenses, listOrphanDocuments, loadExpenseDetail, markBooked, setManualVat, unignoreExpense, unlinkDocument } from './actions'

const EXP = (over: Record<string, unknown> = {}) => ({
  id: 'exp-1', status: 'partially_matched', bank_transaction_id: 'tx-1', cash_out_cents: 12100, gross_cents: 12100, match_confidence: 0.7, matched_at: '2026-09-08T09:00:00Z',
  primary_document_id: 'doc-1', snelstart_sent_at: null, snelstart_document_id: null, booked_at: null, needs_review_reason: null, vat_source: 'invoice', vat_conflict: null, notes: null, created_at: '2026-09-05T12:00:00Z', ...over,
})
const DOC = (over: Record<string, unknown> = {}) => ({ id: 'doc-1', expense_id: null, duplicate_of: null, kind: 'invoice_pdf', link_fetch_status: null, file_path: 'email/g/x.pdf', source: 'email', extracted: { vatCents: 2100, grossCents: 12100, matchReview: { expenseIds: ['a', 'b'], flaggedAt: 'x' } }, created_at: '2026-09-08T09:00:00Z', ...over })

const SUPPLIER = { id: 'sup-1', name: 'Jachthaven Westerdok', iban: 'NL91ABNA0417164300', revolut_counterparty_id: null }

function db(opts: { expense?: Record<string, unknown> | null; doc?: Record<string, unknown> | null; docs?: Record<string, unknown>[]; docCount?: number; list?: Record<string, unknown>[]; supplier?: Record<string, unknown> | null; supplierInsertError?: { message: string } } = {}) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_expenses') {
      if (has(q, 'update')) return { data: null }
      if (has(q, 'order')) return { data: opts.list ?? [] }
      return { data: opts.expense === undefined ? EXP() : opts.expense }
    }
    if (q.table === 'finance_documents') {
      if (has(q, 'update')) return { data: null }
      if (op(q, 'select')?.args[1] && (op(q, 'select')!.args[1] as { head?: boolean }).head) return { data: null, count: opts.docCount ?? 1 }
      if (op(q, 'eq')?.args[0] === 'id') return { data: opts.doc === undefined ? DOC() : opts.doc }
      return { data: opts.docs ?? [DOC({ expense_id: 'exp-1' })] }
    }
    if (q.table === 'finance_suppliers') {
      if (has(q, 'insert')) return opts.supplierInsertError ? { data: null, error: opts.supplierInsertError } : { data: { id: 'sup-new', name: 'Nieuwe Leverancier' } }
      if (has(q, 'update')) return { data: null }
      // A select-by-id after the insert above must see the row that was just created, not the default fixture.
      if (op(q, 'eq')?.args[0] === 'id' && op(q, 'eq')!.args[1] === 'sup-new') return { data: { id: 'sup-new', name: 'Nieuwe Leverancier', iban: 'NL91ABNA0417164300', revolut_counterparty_id: null } }
      return { data: opts.supplier === undefined ? SUPPLIER : opts.supplier }
    }
    return { data: null }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.loadConnection.mockResolvedValue({ account_id: 'acc-1' })
  h.isConnected.mockReturnValue(true)
  h.createRevolutClient.mockResolvedValue({ createCounterparty: h.createCounterparty, createPaymentDraft: h.createPaymentDraft })
  h.createCounterparty.mockResolvedValue({ id: 'cp-1' })
  h.createPaymentDraft.mockResolvedValue({ id: 'draft-1' })
})

describe('linkDocument', () => {
  it('attaches the document, sets confidence 1 (a human beats a score), clears review, recomputes', async () => {
    const mock = db()
    await linkDocument(mock.client as never, 'exp-1', 'doc-1')
    // The near-tie question parked on the document is answered by the manual link.
    expect(opArg(mock.queries, 'finance_documents', 'update')).toEqual({ expense_id: 'exp-1', extracted: { vatCents: 2100, grossCents: 12100 } })
    expect(opArg(mock.queries, 'finance_expenses', 'update')).toMatchObject({ match_confidence: 1, needs_review_reason: null, match_signals: { documentId: 'doc-1', manual: true } })
    expect(h.recomputeExpense).toHaveBeenCalledWith(expect.anything(), 'exp-1')
  })
  it('refuses a document that already belongs to another payment, and a duplicate', async () => {
    await expect(linkDocument(db({ doc: DOC({ expense_id: 'exp-other' }) }).client as never, 'exp-1', 'doc-1')).rejects.toThrow(/andere uitgave/)
    await expect(linkDocument(db({ doc: DOC({ duplicate_of: 'doc-0' }) }).client as never, 'exp-1', 'doc-1')).rejects.toThrow(/duplicaat/)
  })
  it('an ignored record must be un-ignored before a document can be linked to it (otherwise the document vanishes into "ignored")', async () => {
    await expect(linkDocument(db({ expense: EXP({ status: 'ignored' }) }).client as never, 'exp-1', 'doc-1')).rejects.toThrow(/Toch verwerken/)
  })
  it('a booked record is frozen', async () => {
    const err = await linkDocument(db({ expense: EXP({ booked_at: '2026-09-10T00:00:00Z' }) }).client as never, 'exp-1', 'doc-1').catch(e => e)
    expect(err).toBeInstanceOf(ExpenseActionError)
    expect(err.status).toBe(409)
  })
  it('404 when the expense does not exist', async () => {
    const err = await linkDocument(db({ expense: null }).client as never, 'nope', 'doc-1').catch(e => e)
    expect(err.status).toBe(404)
  })
})

describe('unlinkDocument', () => {
  it('returns the document to the orphan pool and clears the match evidence (and primary if it was that document)', async () => {
    const mock = db()
    await unlinkDocument(mock.client as never, 'exp-1', 'doc-1')
    const docUpdate = queriesFor(mock.queries, 'finance_documents', 'update')[0]
    expect(op(docUpdate, 'update')!.args[0]).toEqual({ expense_id: null })
    expect(op(docUpdate, 'eq')!.args).toEqual(['id', 'doc-1'])
    // ...and the facts read off the wrong document leave with it — they'd otherwise end up in the bookkeeper's subject line.
    expect(opArg(mock.queries, 'finance_expenses', 'update')).toEqual({ match_confidence: null, match_signals: null, matched_at: null, invoice_number: null, order_number: null, invoice_date: null, primary_document_id: null })
  })
  it('never detaches the document that already went to SnelStart', async () => {
    await expect(unlinkDocument(db({ expense: EXP({ snelstart_document_id: 'doc-1' }) }).client as never, 'exp-1', 'doc-1')).rejects.toThrow(/SnelStart/)
  })
})

describe('confirmMatch / clearReview / ignore / vat / booked', () => {
  it('confirm lifts a partial match to 1 but only when a document is actually attached', async () => {
    const mock = db()
    await confirmMatch(mock.client as never, 'exp-1')
    expect(opArg(mock.queries, 'finance_expenses', 'update')).toMatchObject({ match_confidence: 1, match_signals: { manual: true, confirmedFrom: 0.7 } })
    await expect(confirmMatch(db({ docCount: 0 }).client as never, 'exp-1')).rejects.toThrow(/geen document/)
  })
  it('clearReview only clears the flag; recompute decides the status', async () => {
    const mock = db({ expense: EXP({ needs_review_reason: 'near tie' }) })
    await clearReview(mock.client as never, 'exp-1')
    expect(opArg(mock.queries, 'finance_expenses', 'update')).toMatchObject({ needs_review_reason: null })
    expect(h.recomputeExpense).toHaveBeenCalled()
  })
  it('ignore is the one action that writes status itself, and is refused after a SnelStart send', async () => {
    const mock = db()
    await ignoreExpense(mock.client as never, 'exp-1', 'privé')
    expect(opArg(mock.queries, 'finance_expenses', 'update')).toMatchObject({ status: 'ignored', notes: 'privé' })
    await expect(ignoreExpense(db({ expense: EXP({ snelstart_sent_at: '2026-09-09T00:00:00Z' }) }).client as never, 'exp-1', null)).rejects.toThrow(/SnelStart/)
  })
  it('manual VAT derives the rate from gross, marks source manual, clears a conflict; rejects VAT above gross', async () => {
    const mock = db({ expense: EXP({ vat_conflict: { some: 'conflict' } }) })
    await setManualVat(mock.client as never, 'exp-1', { vatCents: 2100 })
    expect(opArg(mock.queries, 'finance_expenses', 'update')).toMatchObject({ vat_cents: 2100, vat_rate_pct: 21, vat_source: 'manual', vat_conflict: null })
    await expect(setManualVat(db().client as never, 'exp-1', { vatCents: 99999 })).rejects.toThrow(/hoger/)
    await expect(setManualVat(db().client as never, 'exp-1', { vatCents: -1 })).rejects.toThrow()
  })
  it('booked requires a prior SnelStart send and is idempotent', async () => {
    await expect(markBooked(db().client as never, 'exp-1')).rejects.toThrow(/doorsturen/)
    const mock = db({ expense: EXP({ snelstart_sent_at: '2026-09-09T00:00:00Z' }) })
    await markBooked(mock.client as never, 'exp-1')
    expect(opArg(mock.queries, 'finance_expenses', 'update')).toMatchObject({ booked_at: expect.any(String) })
    const again = db({ expense: EXP({ snelstart_sent_at: '2026-09-09T00:00:00Z', booked_at: '2026-09-10T00:00:00Z' }) })
    await markBooked(again.client as never, 'exp-1')
    expect(queriesFor(again.queries, 'finance_expenses', 'update')).toHaveLength(0)
  })
})

describe('listExpenses / loadExpenseDetail', () => {
  it('"open" expands to every status that still needs something; text search is sanitised into an ilike OR (filter grammar, wildcards and quotes stripped)', async () => {
    const mock = db({ list: [] })
    await listExpenses(mock.client as never, { status: 'open', q: 'bol%,(x)*_"\\y' })
    const q = queriesFor(mock.queries, 'finance_expenses', 'select')[0]
    expect(op(q, 'in')!.args[1]).toEqual(['waiting_for_invoice', 'waiting_for_payment', 'partially_matched', 'matched', 'needs_review', 'ready_for_snelstart'])
    expect(op(q, 'or')!.args[0]).toBe('ref.ilike.%bol x y%,supplier_name.ilike.%bol x y%,invoice_number.ilike.%bol x y%,order_number.ilike.%bol x y%')
    expect(op(q, 'limit')!.args[0]).toBe(51)
  })
  it('cursor: fetches limit+1 and returns the last shown created_at as nextBefore only when more exist', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => EXP({ id: `e${i}`, created_at: `2026-09-0${3 - i}T00:00:00Z` }))
    const r = await listExpenses(db({ list: rows }).client as never, { limit: 2 })
    expect(r.expenses.map(e => e.id)).toEqual(['e0', 'e1'])
    expect(r.nextBefore).toBe('2026-09-02T00:00:00Z')
    expect((await listExpenses(db({ list: rows.slice(0, 2) }).client as never, { limit: 2 })).nextBefore).toBeNull()
  })
  it('detail explains the derived status with the SAME rules as recompute — an unconfirmed e-mail document parks at matched', async () => {
    const r = await loadExpenseDetail(db({ expense: EXP({ match_confidence: 0.95 }) }).client as never, 'exp-1')
    expect(r.documents).toHaveLength(1)
    expect(r.derivedStatus).toBe('matched')
    expect(r.provenanceTrusted).toBe(false)
    const confirmed = await loadExpenseDetail(db({ expense: EXP({ match_confidence: 1 }) }).client as never, 'exp-1')
    expect(confirmed.derivedStatus).toBe('ready_for_snelstart')
    expect(confirmed.provenanceTrusted).toBe(true)
  })

  it('unignore only works on an ignored record and hands the status back to the machine', async () => {
    await expect(unignoreExpense(db().client as never, 'exp-1')).rejects.toMatchObject({ status: 409 })
    const mock = db({ expense: EXP({ status: 'ignored' }) })
    await unignoreExpense(mock.client as never, 'exp-1')
    expect(opArg(mock.queries, 'finance_expenses', 'update')).toEqual({ status: 'waiting_for_invoice' })
    expect(h.recomputeExpense).toHaveBeenCalledWith(expect.anything(), 'exp-1')
  })

  it('the orphan pool: unlinked, non-duplicate, not plain mail, newest first, capped', async () => {
    const mock = db({ docs: [] })
    await listOrphanDocuments(mock.client as never, { limit: 9999 })
    const q = queriesFor(mock.queries, 'finance_documents', 'select')[0]
    expect(op(q, 'is')!.args).toEqual(['expense_id', null])
    expect(op(q, 'neq')!.args).toEqual(['kind', 'other_email'])
    expect(op(q, 'limit')!.args[0]).toBe(500)
  })
})

describe('linkSupplier / createSupplierAndLink', () => {
  it('links an existing supplier and takes its confirmed name over whatever was guessed', async () => {
    const mock = db()
    await linkSupplier(mock.client as never, 'exp-1', 'sup-1')
    expect(opArg(mock.queries, 'finance_expenses', 'update')).toMatchObject({ supplier_id: 'sup-1', supplier_name: 'Jachthaven Westerdok' })
    expect(h.recomputeExpense).toHaveBeenCalledWith(expect.anything(), 'exp-1')
  })

  it('404s on an unknown supplier id, an ignored/booked record is still frozen', async () => {
    await expect(linkSupplier(db({ supplier: null }).client as never, 'exp-1', 'nope')).rejects.toMatchObject({ status: 404 })
    await expect(linkSupplier(db({ expense: EXP({ booked_at: '2026-09-10T00:00:00Z' }) }).client as never, 'exp-1', 'sup-1')).rejects.toMatchObject({ status: 409 })
  })

  it('creates a new supplier with a validated, normalised IBAN and links it in one step', async () => {
    const mock = db()
    await createSupplierAndLink(mock.client as never, 'exp-1', { name: 'Nieuwe Leverancier', iban: 'nl91 abna 0417 1643 00' })
    expect(opArg(mock.queries, 'finance_suppliers', 'insert')).toEqual({ name: 'Nieuwe Leverancier', iban: 'NL91ABNA0417164300' })
    expect(opArg(mock.queries, 'finance_expenses', 'update')).toMatchObject({ supplier_id: 'sup-new' })
    expect(h.logFinanceEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: 'supplier_created' }))
  })

  it('refuses a bad IBAN before ever touching finance_suppliers', async () => {
    const mock = db()
    await expect(createSupplierAndLink(mock.client as never, 'exp-1', { name: 'X', iban: 'NL91ABNA0417164301' })).rejects.toThrow(/klopt niet/)
    expect(queriesFor(mock.queries, 'finance_suppliers', 'insert')).toHaveLength(0)
  })
})

describe('draftExpensePayment', () => {
  it('the happy path: no draft yet, valid supplier IBAN → counterparty + draft created, pinned, event logged', async () => {
    const mock = db({ expense: EXP({ status: 'waiting_for_payment', bank_transaction_id: null, supplier_id: 'sup-1', revolut_draft_id: null, ref: 'FIN-000042' }) })
    await draftExpensePayment(mock.client as never, 'exp-1')
    expect(h.createCounterparty).toHaveBeenCalledWith({ company_name: 'Jachthaven Westerdok', bank_country: 'NL', currency: 'EUR', iban: 'NL91ABNA0417164300' })
    expect(h.createPaymentDraft).toHaveBeenCalledTimes(1)
    const payment = h.createPaymentDraft.mock.calls[0][0].payments[0]
    expect(payment).toMatchObject({ account_id: 'acc-1', receiver: { counterparty_id: 'cp-1' }, amount: 121, currency: 'EUR' })
    expect(opArg(mock.queries, 'finance_expenses', 'update')).toMatchObject({ revolut_draft_id: 'draft-1' })
    expect(h.logFinanceEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: 'expense_payment_drafted', delta_cents: 12100 }))
    expect(h.recomputeExpense).toHaveBeenCalledWith(expect.anything(), 'exp-1')
  })

  it('a second click is idempotent: the pinned draft is reused, Revolut is never called again', async () => {
    const mock = db({ expense: EXP({ status: 'waiting_for_payment', bank_transaction_id: null, supplier_id: 'sup-1', revolut_draft_id: 'draft-existing' }) })
    await draftExpensePayment(mock.client as never, 'exp-1')
    expect(h.createPaymentDraft).not.toHaveBeenCalled()
    expect(queriesFor(mock.queries, 'finance_expenses', 'update')).toHaveLength(0)
    expect(h.recomputeExpense).toHaveBeenCalledWith(expect.anything(), 'exp-1')
  })

  it('never once a bank transaction already exists — that money already left, a second draft would risk double-paying', async () => {
    const mock = db({ expense: EXP({ status: 'matched', bank_transaction_id: 'tx-1' }) })
    await expect(draftExpensePayment(mock.client as never, 'exp-1')).rejects.toMatchObject({ status: 409 })
    expect(h.createPaymentDraft).not.toHaveBeenCalled()
  })

  it('refuses outside waiting_for_payment, with no amount, with no linked supplier, and with an invalid/missing IBAN', async () => {
    await expect(draftExpensePayment(db({ expense: EXP({ status: 'ready_for_snelstart', bank_transaction_id: null }) }).client as never, 'exp-1')).rejects.toMatchObject({ status: 409 })
    await expect(draftExpensePayment(db({ expense: EXP({ status: 'waiting_for_payment', bank_transaction_id: null, gross_cents: null }) }).client as never, 'exp-1')).rejects.toMatchObject({ status: 409 })
    await expect(draftExpensePayment(db({ expense: EXP({ status: 'waiting_for_payment', bank_transaction_id: null, supplier_id: null }) }).client as never, 'exp-1')).rejects.toThrow(/leverancier/)
    await expect(draftExpensePayment(db({ expense: EXP({ status: 'waiting_for_payment', bank_transaction_id: null, supplier_id: 'sup-1' }), supplier: { ...SUPPLIER, iban: null } }).client as never, 'exp-1')).rejects.toThrow(/IBAN/)
  })

  it('refuses when Revolut is not connected or has no account selected, before creating anything', async () => {
    h.isConnected.mockReturnValue(false)
    await expect(draftExpensePayment(db({ expense: EXP({ status: 'waiting_for_payment', bank_transaction_id: null, supplier_id: 'sup-1' }) }).client as never, 'exp-1')).rejects.toThrow(/niet gekoppeld/)
    expect(h.createCounterparty).not.toHaveBeenCalled()
  })
})
