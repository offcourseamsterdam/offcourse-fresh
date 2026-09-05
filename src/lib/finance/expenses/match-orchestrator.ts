/**
 * The matcher's hands (plan §4.2). expenses/match.ts decides; this file loads
 * the candidates, writes the outcome and asks recompute.ts to re-derive the
 * record. Both directions run through the same routine:
 *
 *   new document  → matchDocument(id)          score it against every open payment
 *   new payment   → matchOrphanDocuments()      re-score every orphan document,
 *                                               each against every open payment
 *
 * One document attaches to at most one payment. A near-tie flags BOTH
 * candidate payments for review and leaves the document an orphan; Beer picks
 * from the UI. Nothing here ever creates a payment or an expense record.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'
import type { DocumentFields } from './extract-document'
import { decideMatch, rankCandidates, type MatchDocument, type MatchDocumentKind, type MatchExpense, type MatchScore } from './match'
import { recomputeExpense, type DocumentRow, type ExpenseRow } from './recompute'

type Admin = ReturnType<typeof createAdminClient>

/** Payments still looking for a document. */
const OPEN_FOR_MATCHING = ['waiting_for_invoice', 'partially_matched'] as const
/** Document kinds that can attach to a payment. Not: unfetched links, unknown mail, duplicates. */
const MATCHABLE_KINDS: MatchDocumentKind[] = ['invoice_pdf', 'receipt_image', 'revolut_receipt', 'invoice_link', 'order_confirmation_email', 'invoice_notification_email', 'payment_confirmation_email']
/** Orphans older than this are Beer's to link by hand — the matcher stops re-scoring them. */
export const ORPHAN_WINDOW_DAYS = 45
export const ORPHAN_BATCH_LIMIT = 200

type TxSlice = { id: string; reference: string | null; description: string | null; currency: string; counterparty: Json | null }
type ExpenseSlice = Pick<ExpenseRow, 'id' | 'supplier_name' | 'cash_out_cents' | 'paid_at' | 'bank_transaction_id' | 'status'>

export interface OpenExpenseCandidate extends MatchExpense {
  status: string
}

function ibanFromCounterparty(counterparty: Json | null): string | null {
  if (!counterparty || typeof counterparty !== 'object' || Array.isArray(counterparty)) return null
  const c = counterparty as Record<string, unknown>
  return typeof c.iban === 'string' ? c.iban : null
}

export function toMatchExpense(expense: ExpenseSlice, tx: TxSlice | undefined): OpenExpenseCandidate {
  return {
    id: expense.id,
    status: expense.status,
    cashOutCents: expense.cash_out_cents,
    paidAt: expense.paid_at,
    supplierName: expense.supplier_name,
    bankReference: tx?.reference ?? null,
    bankDescription: tx?.description ?? null,
    counterpartyIban: ibanFromCounterparty(tx?.counterparty ?? null),
    currency: tx?.currency ?? null,
  }
}

export function toMatchDocument(doc: Pick<DocumentRow, 'id' | 'kind' | 'extracted' | 'created_at'>): MatchDocument {
  return { id: doc.id, kind: doc.kind as MatchDocumentKind, extracted: (doc.extracted ?? {}) as Partial<DocumentFields>, createdAt: doc.created_at }
}

/** Stamped on a document's `extracted` when a near-tie sent it to Beer; the matcher then leaves it alone until he links it. */
export interface MatchReviewMarker {
  expenseIds: string[]
  flaggedAt: string
}

export function isMatchable(doc: Pick<DocumentRow, 'kind' | 'expense_id' | 'duplicate_of' | 'link_fetch_status' | 'extracted' | 'file_path'>): boolean {
  if (doc.expense_id || doc.duplicate_of) return false
  if (!MATCHABLE_KINDS.includes(doc.kind as MatchDocumentKind)) return false
  if (doc.kind === 'invoice_link' && doc.link_fetch_status !== 'fetched') return false
  // File-carrying kinds need the file (a marker row for an unreadable receipt has none).
  if ((doc.kind === 'invoice_pdf' || doc.kind === 'receipt_image' || doc.kind === 'revolut_receipt' || doc.kind === 'invoice_link') && !doc.file_path) return false
  if ((doc.extracted as { matchReview?: MatchReviewMarker } | null)?.matchReview) return false
  return true
}

type DocForMatch = Pick<DocumentRow, 'id' | 'kind' | 'extracted' | 'created_at' | 'expense_id' | 'duplicate_of' | 'link_fetch_status' | 'file_path'>
const DOC_COLUMNS = 'id, kind, extracted, created_at, expense_id, duplicate_of, link_fetch_status, file_path'

/** Every payment that still wants a document, with the bank facts the scorer reads. */
export async function loadOpenExpenses(supabase: Admin): Promise<OpenExpenseCandidate[]> {
  const { data: expenses, error } = await supabase
    .from('finance_expenses')
    .select('id, supplier_name, cash_out_cents, paid_at, bank_transaction_id, status')
    .in('status', [...OPEN_FOR_MATCHING])
    .not('bank_transaction_id', 'is', null)
  if (error) throw new Error(error.message)
  const rows = (expenses ?? []) as ExpenseSlice[]
  const txIds = rows.map(e => e.bank_transaction_id).filter((id): id is string => !!id)
  const txById = new Map<string, TxSlice>()
  if (txIds.length > 0) {
    const { data: txs, error: txErr } = await supabase.from('bank_transactions').select('id, reference, description, currency, counterparty').in('id', txIds)
    if (txErr) throw new Error(txErr.message)
    for (const t of (txs ?? []) as TxSlice[]) txById.set(t.id, t)
  }
  return rows.map(e => toMatchExpense(e, e.bank_transaction_id ? txById.get(e.bank_transaction_id) : undefined))
}

export type MatchOutcome = 'attached' | 'attached_partial' | 'review' | 'none' | 'skipped'

/** Returns false when another matcher (the 2-minute Gmail poll vs the 15-minute Revolut pass) attached it first. */
async function attachDocument(supabase: Admin, documentId: string, expenseId: string, match: MatchScore): Promise<boolean> {
  const { data: claimed, error: docErr } = await supabase
    .from('finance_documents')
    .update({ expense_id: expenseId })
    .eq('id', documentId)
    .is('expense_id', null)
    .select('id')
  if (docErr) throw new Error(docErr.message)
  if (!claimed || claimed.length === 0) return false
  const { error: expErr } = await supabase
    .from('finance_expenses')
    .update({
      match_confidence: match.score,
      match_signals: { documentId, score: match.score, signals: match.signals } as unknown as Json,
      matched_at: new Date().toISOString(),
    })
    .eq('id', expenseId)
  if (expErr) throw new Error(expErr.message)
  await recomputeExpense(supabase, expenseId)
  return true
}

/**
 * Scores one orphan document against every open payment and acts on the
 * decision. `openExpenses` may be passed in when a batch is scoring many
 * documents against the same set (attached ones are dropped from it in place).
 */
export async function matchDocument(supabase: Admin, documentOrId: string | DocForMatch, openExpenses?: OpenExpenseCandidate[]): Promise<MatchOutcome> {
  let doc: DocForMatch | null
  if (typeof documentOrId === 'string') {
    const { data, error } = await supabase.from('finance_documents').select(DOC_COLUMNS).eq('id', documentOrId).maybeSingle()
    if (error) throw new Error(error.message)
    doc = data
  } else {
    doc = documentOrId
  }
  if (!doc || !isMatchable(doc)) return 'skipped'

  const candidates = openExpenses ?? (await loadOpenExpenses(supabase))
  const decision = decideMatch(rankCandidates(toMatchDocument(doc), candidates))

  switch (decision.kind) {
    case 'auto':
    case 'partial': {
      const attached = await attachDocument(supabase, doc.id, decision.best.expense.id, decision.best.match)
      if (!attached) return 'skipped'
      // A payment takes one document per pass; a second document for the same payment waits for the next run.
      const i = candidates.findIndex(c => c.id === decision.best.expense.id)
      if (i >= 0) candidates.splice(i, 1)
      return decision.kind === 'auto' ? 'attached' : 'attached_partial'
    }
    case 'review': {
      const reason = `${decision.reason} (document ${doc.id})`
      // Remember the question on the document, so the next pass doesn't ask it again after Beer clicks "Gecontroleerd".
      const marker: MatchReviewMarker = { expenseIds: [decision.best.expense.id, decision.runnerUp.expense.id], flaggedAt: new Date().toISOString() }
      const { error: markErr } = await supabase
        .from('finance_documents')
        .update({ extracted: { ...((doc.extracted as Record<string, unknown> | null) ?? {}), matchReview: marker } as unknown as Json })
        .eq('id', doc.id)
      if (markErr) throw new Error(markErr.message)
      for (const c of [decision.best, decision.runnerUp]) {
        const { error: upErr } = await supabase
          .from('finance_expenses')
          .update({ needs_review_reason: reason })
          .eq('id', c.expense.id)
          .is('needs_review_reason', null)
        if (upErr) throw new Error(upErr.message)
        await recomputeExpense(supabase, c.expense.id)
      }
      return 'review'
    }
    default:
      return 'none'
  }
}

/** After ingest: the freshly filed documents, in order. Errors are per document, never fatal for the batch. */
export async function matchNewDocuments(supabase: Admin, documentIds: string[]): Promise<Record<MatchOutcome, number>> {
  if (documentIds.length === 0) return { attached: 0, attached_partial: 0, review: 0, none: 0, skipped: 0 }
  const { data: docs, error } = await supabase.from('finance_documents').select(DOC_COLUMNS).in('id', documentIds)
  if (error) throw new Error(error.message)
  const byId = new Map((docs ?? []).map(d => [d.id, d]))
  return matchDocumentRows(supabase, documentIds.map(id => byId.get(id)).filter((d): d is DocForMatch => !!d))
}

async function matchDocumentRows(supabase: Admin, docs: DocForMatch[]): Promise<Record<MatchOutcome, number>> {
  const tally: Record<MatchOutcome, number> = { attached: 0, attached_partial: 0, review: 0, none: 0, skipped: 0 }
  if (docs.length === 0) return tally
  const open = await loadOpenExpenses(supabase)
  for (const doc of docs) {
    try {
      tally[await matchDocument(supabase, doc, open)]++
    } catch (err) {
      console.error(`[finance/expenses/match] document ${doc.id}:`, err instanceof Error ? err.message : err)
    }
  }
  return tally
}

/** After a payment sync: every recent orphan gets another look, because the payment it was waiting for may just have arrived. */
export async function matchOrphanDocuments(supabase: Admin, opts: { windowDays?: number; limit?: number } = {}): Promise<Record<MatchOutcome, number>> {
  const since = new Date(Date.now() - (opts.windowDays ?? ORPHAN_WINDOW_DAYS) * 86_400_000).toISOString()
  const { data: docs, error } = await supabase
    .from('finance_documents')
    .select(DOC_COLUMNS)
    .is('expense_id', null)
    .is('duplicate_of', null)
    .in('kind', MATCHABLE_KINDS)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? ORPHAN_BATCH_LIMIT)
  if (error) throw new Error(error.message)
  return matchDocumentRows(supabase, (docs ?? []) as DocForMatch[])
}
