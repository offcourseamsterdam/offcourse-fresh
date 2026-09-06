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
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { createRevolutClient, loadConnection, isConnected } from '@/lib/revolut/token-store'
import { DRAFT_REFUSAL_TEXT, createSinglePaymentDraft, ensureRevolutCounterparty, validateSupplierForDraft } from '@/lib/revolut/draft-payment'
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

/**
 * Beer picks an existing payee for this Expense Record — this is what unlocks `draft_payment`.
 * The supplier's own name wins over whatever the document/AI guessed, once confirmed by hand.
 */
export async function linkSupplier(supabase: Admin, expenseId: string, supplierId: string): Promise<ExpenseState | null> {
  const expense = await loadExpense(supabase, expenseId)
  assertEditable(expense)
  const { data: supplier, error: supErr } = await supabase.from('finance_suppliers').select('id, name').eq('id', supplierId).maybeSingle()
  if (supErr) throw new Error(supErr.message)
  if (!supplier) throw new ExpenseActionError('Leverancier niet gevonden.', 404)
  const { error } = await supabase.from('finance_expenses').update({ supplier_id: supplier.id, supplier_name: supplier.name, updated_at: new Date().toISOString() }).eq('id', expenseId)
  if (error) throw new Error(error.message)
  return recomputeExpense(supabase, expenseId)
}

export interface CreateSupplierInput {
  name: string
  iban: string
}

/** A brand-new payee, created and linked in one step — the IBAN is validated before the row ever exists. */
export async function createSupplierAndLink(supabase: Admin, expenseId: string, input: CreateSupplierInput): Promise<ExpenseState | null> {
  await loadExpense(supabase, expenseId) // 404s before touching finance_suppliers
  const check = validateSupplierForDraft({ id: '', name: input.name, iban: input.iban, revolut_counterparty_id: null })
  if (!check.ok) throw new ExpenseActionError(DRAFT_REFUSAL_TEXT[check.reason], 400)
  const { data: supplier, error } = await supabase.from('finance_suppliers').insert({ name: input.name, iban: check.iban }).select('id, name').single()
  if (error || !supplier) throw new Error(error?.message ?? 'Could not create supplier')
  await logFinanceEvent(supabase, { event_type: 'supplier_created', actor: 'user', entity_type: 'supplier', entity_id: supplier.id, payload: { name: supplier.name, via: 'expense', expense_id: expenseId } })
  return linkSupplier(supabase, expenseId, supplier.id)
}

/**
 * Drafts a Revolut payment for this Expense Record's linked supplier. Only meaningful while the
 * record is `waiting_for_payment`: a bank transaction already present means the money already
 * left the account, and a second draft would risk paying it twice. Idempotent — a second click
 * reuses the pinned draft id instead of creating a duplicate.
 */
export async function draftExpensePayment(supabase: Admin, expenseId: string): Promise<ExpenseState | null> {
  const expense = await loadExpense(supabase, expenseId)
  assertEditable(expense)
  if (expense.bank_transaction_id) throw new ExpenseActionError('Er is al een betaling voor deze uitgave — een nieuw concept zou dubbel betalen.', 409)
  if (expense.status !== 'waiting_for_payment') throw new ExpenseActionError('Alleen te gebruiken als er een factuur is maar nog geen betaling.', 409)
  if (expense.gross_cents == null) throw new ExpenseActionError('Nog geen bedrag bekend om te betalen.', 409)

  if (!expense.revolut_draft_id) {
    let supplier: { id: string; name: string; iban: string | null; revolut_counterparty_id: string | null } | null = null
    if (expense.supplier_id) {
      const { data, error } = await supabase.from('finance_suppliers').select('id, name, iban, revolut_counterparty_id').eq('id', expense.supplier_id).maybeSingle()
      if (error) throw new Error(error.message)
      supplier = data
    }
    const validated = validateSupplierForDraft(supplier)
    if (!validated.ok) throw new ExpenseActionError(DRAFT_REFUSAL_TEXT[validated.reason], 409)

    const connectionRow = await loadConnection(supabase)
    if (!isConnected(connectionRow)) throw new ExpenseActionError('Revolut is niet gekoppeld.', 400)
    if (!connectionRow.account_id) throw new ExpenseActionError('Geen Revolut-rekening geselecteerd om van te betalen.', 400)

    const client = await createRevolutClient(supabase)
    const counterpartyId = await ensureRevolutCounterparty(supabase, client, supplier!, validated.iban)
    const title = `${expense.ref} ${supplier!.name}${expense.invoice_number ? ` #${expense.invoice_number}` : ''}`
    const draftId = await createSinglePaymentDraft(client, { accountId: connectionRow.account_id, counterpartyId, amountCents: expense.gross_cents, title, reference: title })

    const { error: pinErr } = await supabase.from('finance_expenses').update({ revolut_draft_id: draftId, updated_at: new Date().toISOString() }).eq('id', expenseId)
    if (pinErr) throw new Error(`Payment draft ${draftId} created but could not be recorded: ${pinErr.message}`)

    await logFinanceEvent(supabase, {
      event_type: 'expense_payment_drafted',
      actor: 'user',
      entity_type: 'expense',
      entity_id: expenseId,
      delta_cents: expense.gross_cents,
      payload: { ref: expense.ref, supplier_id: supplier!.id, revolut_draft_id: draftId },
    })
  }
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
