/**
 * Everything Beer can do to an Expense Record from the UI (plan §6.2). Each
 * action changes exactly the inputs it is about and then lets
 * recomputeExpense() re-derive status/VAT — no action writes `status` itself
 * (except `ignore`, which IS an input to the status machine).
 *
 * The API routes under /api/admin/finance/expenses are thin: validate, call
 * one of these, return the recomputed row.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'
import { computeExpenseState, recomputeExpense, type DocumentRow, type ExpenseRow, type ExpenseState } from './recompute'
import { OPEN_STATUSES } from './status'
import { impliedRatePct } from './vat'

type Admin = ReturnType<typeof createAdminClient>

export class ExpenseActionError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message)
  }
}

async function loadExpense(supabase: Admin, id: string): Promise<ExpenseRow> {
  const { data, error } = await supabase.from('finance_expenses').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new ExpenseActionError('Uitgave niet gevonden.', 404)
  return data
}

function assertEditable(expense: ExpenseRow): void {
  if (expense.booked_at) throw new ExpenseActionError('Deze uitgave is al geboekt en kan niet meer worden aangepast.', 409)
}

/** Beer says: this document belongs to this payment. Confidence becomes 1 — a human link outranks any score. */
export async function linkDocument(supabase: Admin, expenseId: string, documentId: string): Promise<ExpenseState | null> {
  const expense = await loadExpense(supabase, expenseId)
  assertEditable(expense)
  if (expense.status === 'ignored') throw new ExpenseActionError('Deze uitgave is genegeerd. Kies eerst "Toch verwerken" en koppel dan het document.', 409)
  const { data: doc, error } = await supabase.from('finance_documents').select('id, expense_id, duplicate_of, extracted').eq('id', documentId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!doc) throw new ExpenseActionError('Document niet gevonden.', 404)
  if (doc.duplicate_of) throw new ExpenseActionError('Dit document is een duplicaat van een ander document; koppel het origineel.', 409)
  if (doc.expense_id && doc.expense_id !== expenseId) {
    throw new ExpenseActionError('Dit document hangt al aan een andere uitgave. Ontkoppel het daar eerst.', 409)
  }
  // Linking by hand answers any near-tie question the matcher had parked on the document.
  const extracted = { ...((doc.extracted as Record<string, unknown> | null) ?? {}) }
  delete extracted.matchReview
  const { error: upDoc } = await supabase.from('finance_documents').update({ expense_id: expenseId, extracted: extracted as unknown as Json }).eq('id', documentId)
  if (upDoc) throw new Error(upDoc.message)
  const { error: upExp } = await supabase
    .from('finance_expenses')
    .update({ match_confidence: 1, match_signals: { documentId, manual: true } as unknown as Json, matched_at: new Date().toISOString(), needs_review_reason: null, reviewed_at: new Date().toISOString() })
    .eq('id', expenseId)
  if (upExp) throw new Error(upExp.message)
  return recomputeExpense(supabase, expenseId)
}

/** Wrong match. The document goes back to the orphan pool; the payment's match evidence is cleared. */
export async function unlinkDocument(supabase: Admin, expenseId: string, documentId: string): Promise<ExpenseState | null> {
  const expense = await loadExpense(supabase, expenseId)
  assertEditable(expense)
  if (expense.snelstart_document_id === documentId) {
    throw new ExpenseActionError('Dit document is al naar SnelStart gestuurd; ontkoppelen zou de boekhouding uit de pas laten lopen.', 409)
  }
  const { error: upDoc } = await supabase.from('finance_documents').update({ expense_id: null }).eq('id', documentId).eq('expense_id', expenseId)
  if (upDoc) throw new Error(upDoc.message)
  // The facts that came off the wrong document must not stay on the record (they'd end up in the bookkeeper's subject line).
  const { error: upExp } = await supabase
    .from('finance_expenses')
    .update({ match_confidence: null, match_signals: null, matched_at: null, invoice_number: null, order_number: null, invoice_date: null, ...(expense.primary_document_id === documentId ? { primary_document_id: null } : {}) })
    .eq('id', expenseId)
  if (upExp) throw new Error(upExp.message)
  return recomputeExpense(supabase, expenseId)
}

/** "Yes, this partial match is right." Same effect as a manual link of the already-attached document. */
export async function confirmMatch(supabase: Admin, expenseId: string): Promise<ExpenseState | null> {
  const expense = await loadExpense(supabase, expenseId)
  assertEditable(expense)
  const { count, error } = await supabase.from('finance_documents').select('id', { count: 'exact', head: true }).eq('expense_id', expenseId)
  if (error) throw new Error(error.message)
  if (!count) throw new ExpenseActionError('Er hangt nog geen document aan deze uitgave om te bevestigen.', 409)
  const { error: upExp } = await supabase
    .from('finance_expenses')
    .update({ match_confidence: 1, match_signals: { manual: true, confirmedFrom: expense.match_confidence } as unknown as Json, matched_at: expense.matched_at ?? new Date().toISOString(), needs_review_reason: null, reviewed_at: new Date().toISOString() })
    .eq('id', expenseId)
  if (upExp) throw new Error(upExp.message)
  return recomputeExpense(supabase, expenseId)
}

/** No document will ever exist (or it's private / a refund). Reversible with `unignore`. */
export async function ignoreExpense(supabase: Admin, expenseId: string, note: string | null): Promise<ExpenseState | null> {
  const expense = await loadExpense(supabase, expenseId)
  assertEditable(expense)
  if (expense.snelstart_sent_at) throw new ExpenseActionError('Al naar SnelStart gestuurd; negeren kan niet meer.', 409)
  const { error } = await supabase
    .from('finance_expenses')
    .update({ status: 'ignored', needs_review_reason: null, reviewed_at: new Date().toISOString(), ...(note ? { notes: note } : {}) })
    .eq('id', expenseId)
  if (error) throw new Error(error.message)
  return recomputeExpense(supabase, expenseId)
}

export async function unignoreExpense(supabase: Admin, expenseId: string): Promise<ExpenseState | null> {
  const expense = await loadExpense(supabase, expenseId)
  if (expense.status !== 'ignored') throw new ExpenseActionError('Deze uitgave is niet genegeerd.', 409)
  // Give the status machine a neutral starting point; recompute derives the real one.
  const { error } = await supabase.from('finance_expenses').update({ status: 'waiting_for_invoice' }).eq('id', expenseId)
  if (error) throw new Error(error.message)
  return recomputeExpense(supabase, expenseId)
}

/** Beer looked at the flag (duplicate suspicion, near-tie, VAT conflict) and is satisfied. */
export async function clearReview(supabase: Admin, expenseId: string): Promise<ExpenseState | null> {
  const expense = await loadExpense(supabase, expenseId)
  assertEditable(expense)
  const { error } = await supabase.from('finance_expenses').update({ needs_review_reason: null, reviewed_at: new Date().toISOString() }).eq('id', expenseId)
  if (error) throw new Error(error.message)
  return recomputeExpense(supabase, expenseId)
}

export interface ManualVatInput {
  vatCents: number
  /** Optional; derived from gross when omitted. */
  ratePct?: number | null
}

/** Beer settles the VAT by hand. `manual` outranks every other source and also clears a conflict. */
export async function setManualVat(supabase: Admin, expenseId: string, input: ManualVatInput): Promise<ExpenseState | null> {
  const expense = await loadExpense(supabase, expenseId)
  assertEditable(expense)
  if (!Number.isInteger(input.vatCents) || input.vatCents < 0) throw new ExpenseActionError('BTW-bedrag moet een geheel aantal centen ≥ 0 zijn.')
  const gross = expense.gross_cents ?? expense.cash_out_cents
  if (gross != null && input.vatCents > gross) throw new ExpenseActionError('BTW kan niet hoger zijn dan het brutobedrag.')
  const ratePct = input.ratePct ?? (gross != null ? impliedRatePct(gross, input.vatCents) : null)
  const { error } = await supabase
    .from('finance_expenses')
    .update({ vat_cents: input.vatCents, vat_rate_pct: ratePct, vat_source: 'manual', vat_conflict: null, reviewed_at: new Date().toISOString() })
    .eq('id', expenseId)
  if (error) throw new Error(error.message)
  return recomputeExpense(supabase, expenseId)
}

/** The bookkeeper has processed it. Terminal. */
export async function markBooked(supabase: Admin, expenseId: string): Promise<ExpenseState | null> {
  const expense = await loadExpense(supabase, expenseId)
  if (expense.booked_at) return recomputeExpense(supabase, expenseId)
  if (!expense.snelstart_sent_at) throw new ExpenseActionError('Nog niet naar SnelStart gestuurd; eerst doorsturen, dan pas als geboekt markeren.', 409)
  const { error } = await supabase.from('finance_expenses').update({ booked_at: new Date().toISOString() }).eq('id', expenseId)
  if (error) throw new Error(error.message)
  return recomputeExpense(supabase, expenseId)
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export const EXPENSE_LIST_LIMIT = 50

export interface ExpenseListFilters {
  status?: ExpenseRow['status'] | 'open' | null
  q?: string | null
  /** Cursor: rows created strictly before this ISO timestamp. */
  before?: string | null
  limit?: number
}

export interface ExpenseListResult {
  expenses: ExpenseRow[]
  nextBefore: string | null
}

/** Newest first, cursor-paged like the transactions list. `status: 'open'` = everything that still needs something. */
export async function listExpenses(supabase: Admin, f: ExpenseListFilters = {}): Promise<ExpenseListResult> {
  const limit = Math.min(Math.max(f.limit ?? EXPENSE_LIST_LIMIT, 1), 200)
  let q = supabase.from('finance_expenses').select('*').order('created_at', { ascending: false }).limit(limit + 1)
  if (f.status === 'open') q = q.in('status', [...OPEN_STATUSES])
  else if (f.status) q = q.eq('status', f.status)
  if (f.before) q = q.lt('created_at', f.before)
  if (f.q) {
    // PostgREST filter grammar (`,()`), LIKE wildcards (`%_*`) and quoting (`"\\`) all become spaces — a search term is data.
    const term = f.q.replace(/[%,()*_"\\]/g, ' ').replace(/\s+/g, ' ').trim()
    if (term) q = q.or(`ref.ilike.%${term}%,supplier_name.ilike.%${term}%,invoice_number.ilike.%${term}%,order_number.ilike.%${term}%`)
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rows = data ?? []
  const page = rows.slice(0, limit)
  return { expenses: page, nextBefore: rows.length > limit ? page[page.length - 1].created_at : null }
}

export interface ExpenseDetail {
  expense: ExpenseRow
  documents: DocumentRow[]
  /** What the status machine would say — lets the UI explain "why this status". */
  derivedStatus: ExpenseRow['status']
  /** False = the cost document came from an unknown sender and nothing independent confirms it; one click ("Koppeling bevestigen") makes it trusted. */
  provenanceTrusted: boolean
}

export async function loadExpenseDetail(supabase: Admin, expenseId: string): Promise<ExpenseDetail> {
  const expense = await loadExpense(supabase, expenseId)
  const { data: documents, error } = await supabase.from('finance_documents').select('*').eq('expense_id', expenseId).order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  const docs = documents ?? []
  // One set of rules (recompute.ts), not a second copy: this is exactly what the next recompute would decide.
  const state = computeExpenseState(expense, docs)
  return { expense, documents: docs, derivedStatus: state.status, provenanceTrusted: state.provenanceTrusted }
}

/** Documents nobody has claimed yet — the "link by hand" pool. Newest first. */
export async function listOrphanDocuments(supabase: Admin, opts: { limit?: number } = {}): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from('finance_documents')
    .select('*')
    .is('expense_id', null)
    .is('duplicate_of', null)
    .neq('kind', 'other_email')
    .order('created_at', { ascending: false })
    .limit(Math.min(opts.limit ?? 100, 500))
  if (error) throw new Error(error.message)
  return data ?? []
}
