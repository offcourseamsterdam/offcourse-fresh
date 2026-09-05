/**
 * The one place an Expense Record's derived fields are (re)computed: VAT and
 * its provenance, the primary document, the status. Every writer — the Revolut
 * sync, the e-mail ingest, the matcher, a manual action — changes its inputs
 * and then calls recomputeExpense(). Nothing else writes status/vat columns,
 * so they can never disagree with the documents underneath them.
 *
 * `computeExpenseState` is pure and carries the rules; `recomputeExpense` is
 * the thin load → compute → save around it.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import type { Database, Json } from '@/lib/supabase/types'
import type { DocumentFields } from './extract-document'
import { deriveStatus, type ExpenseStatus } from './status'
import { resolveVat, type VatCandidate, type VatResolution } from './vat'

type Admin = ReturnType<typeof createAdminClient>
export type ExpenseRow = Database['public']['Tables']['finance_expenses']['Row']
export type DocumentRow = Database['public']['Tables']['finance_documents']['Row']

/**
 * Documents that carry a cost breakdown — enough to book against. An order
 * confirmation is not one, and neither is a PDF that Gemini read as an order
 * confirmation / quote / shipping label (review finding H2: a webshop's PDF
 * order confirmation must not travel to the bookkeeper as "the invoice").
 * A row without a stored file (a marker for an unreadable receipt) never counts.
 */
export function isCostDocument(d: Pick<DocumentRow, 'kind' | 'link_fetch_status' | 'file_path' | 'extracted'>): boolean {
  if (!d.file_path) return false
  const readAs = (d.extracted as { documentKind?: string | null } | null)?.documentKind ?? null
  if (readAs === 'order_confirmation' || readAs === 'other') return false
  if (d.kind === 'invoice_pdf' || d.kind === 'receipt_image' || d.kind === 'revolut_receipt') return true
  if (d.kind === 'invoice_link') return d.link_fetch_status === 'fetched'
  return false
}

/** A PDF/image that Gemini read as an order confirmation behaves like an order-confirmation mail for status purposes. */
function isOrderLike(d: Pick<DocumentRow, 'kind' | 'extracted'>): boolean {
  if (d.kind === 'order_confirmation_email' || d.kind === 'invoice_notification_email') return true
  return (d.extracted as { documentKind?: string | null } | null)?.documentKind === 'order_confirmation'
}

const PRIMARY_PREFERENCE: DocumentRow['kind'][] = ['invoice_pdf', 'invoice_link', 'revolut_receipt', 'receipt_image', 'order_confirmation_email']

/** What goes to SnelStart: an invoice beats a receipt beats an order mail (plan §2.2). Duplicates never win. */
export function pickPrimaryDocument(docs: DocumentRow[]): DocumentRow | null {
  const eligible = docs.filter(d => !d.duplicate_of && (isCostDocument(d) || isOrderLike(d)))
  eligible.sort((a, b) => PRIMARY_PREFERENCE.indexOf(a.kind as DocumentRow['kind']) - PRIMARY_PREFERENCE.indexOf(b.kind as DocumentRow['kind']) || a.created_at.localeCompare(b.created_at))
  return eligible[0] ?? null
}

function extracted(d: DocumentRow): Partial<DocumentFields> {
  return (d.extracted ?? {}) as Partial<DocumentFields>
}

/** Every VAT figure the sources offer, labelled — resolveVat() picks and flags. */
export function vatCandidatesFrom(expense: ExpenseRow, docs: DocumentRow[]): VatCandidate[] {
  const out: VatCandidate[] = []
  if (expense.vat_source === 'manual' && expense.vat_cents != null) {
    out.push({ source: 'manual', vatCents: expense.vat_cents, ratePct: expense.vat_rate_pct == null ? null : Number(expense.vat_rate_pct) })
  }
  for (const d of docs) {
    if (d.duplicate_of) continue
    const e = extracted(d)
    if (e.vatCents == null) continue
    if (!isCostDocument(d)) continue
    if (d.kind === 'invoice_pdf' || d.kind === 'invoice_link') out.push({ source: 'invoice', vatCents: e.vatCents, ratePct: e.vatRatePct ?? null })
    else if (d.kind === 'receipt_image' || d.kind === 'revolut_receipt') out.push({ source: 'receipt', vatCents: e.vatCents, ratePct: e.vatRatePct ?? null })
  }
  if (expense.revolut_vat_cents != null) {
    out.push({ source: 'revolut', vatCents: expense.revolut_vat_cents, ratePct: expense.revolut_vat_rate_pct == null ? null : Number(expense.revolut_vat_rate_pct) })
  }
  return out
}

export interface ExpenseState {
  status: ExpenseStatus
  vat: VatResolution
  primaryDocumentId: string | null
  grossCents: number | null
  /** Filled from the primary cost document when the record doesn't have them yet. */
  supplierName: string | null
  invoiceNumber: string | null
  orderNumber: string | null
  invoiceDate: string | null
  hasCostDocument: boolean
  /** See StatusInputs.provenanceTrusted — false means "one click before it may go out". */
  provenanceTrusted: boolean
}

export function computeExpenseState(expense: ExpenseRow, docs: DocumentRow[]): ExpenseState {
  const live = docs.filter(d => !d.duplicate_of)
  const hasCostDocument = live.some(isCostDocument)
  const hasOrderConfirmationOnly = !hasCostDocument && live.some(isOrderLike)
  const primary = pickPrimaryDocument(live)
  const primaryFields = primary ? extracted(primary) : {}
  const costFields = live.filter(isCostDocument).map(extracted)

  // The payment is the truth for what left the account; a document only stands in when there is no payment yet.
  const grossCents = expense.cash_out_cents ?? costFields.find(f => f.grossCents != null)?.grossCents ?? null
  const candidates = vatCandidatesFrom(expense, live)
  const vat = resolveVat(grossCents, candidates)

  // Provenance: who put this cost document here? Revolut (Beer, in the app) or Beer by hand
  // (confidence 1 = manual link/confirm) → trusted. An e-mailed document is trusted only when
  // a second, independent VAT source (Revolut's rate) agrees with it — otherwise one click.
  const manualMatch = expense.match_confidence != null && Number(expense.match_confidence) >= 1
  const costDocs = live.filter(isCostDocument)
  const fromRevolut = costDocs.some(d => d.source === 'revolut' || d.source === 'upload')
  const revolutAgrees = vat.vatCents != null && candidates.some(c => c.source === 'revolut' && Math.abs(c.vatCents - (vat.vatCents ?? 0)) <= 2) && candidates.some(c => c.source !== 'revolut')
  const provenanceTrusted = manualMatch || fromRevolut || revolutAgrees || expense.vat_source === 'manual'

  const status = deriveStatus({
    ignored: expense.status === 'ignored',
    hasPayment: !!expense.bank_transaction_id,
    hasCostDocument,
    hasOrderConfirmationOnly,
    matchConfidence: expense.match_confidence == null ? null : Number(expense.match_confidence),
    vatResolved: vat.source !== null,
    vatConflict: vat.conflict !== null,
    flaggedForReview: !!expense.needs_review_reason,
    provenanceTrusted,
    sentToSnelstartAt: expense.snelstart_sent_at,
    bookedAt: expense.booked_at,
  })

  const firstCost = costFields[0] ?? {}
  return {
    status,
    vat,
    primaryDocumentId: primary?.id ?? null,
    grossCents,
    supplierName: expense.supplier_name ?? primaryFields.supplierName ?? firstCost.supplierName ?? null,
    invoiceNumber: expense.invoice_number ?? firstCost.invoiceNumber ?? primaryFields.invoiceNumber ?? null,
    orderNumber: expense.order_number ?? primaryFields.orderNumber ?? firstCost.orderNumber ?? null,
    invoiceDate: expense.invoice_date ?? firstCost.invoiceDate ?? null,
    hasCostDocument,
    provenanceTrusted,
  }
}

/** Loads, computes, saves. Returns the new state so callers can react (Slack on needs_review, etc.). */
export async function recomputeExpense(supabase: Admin, expenseId: string): Promise<ExpenseState | null> {
  const [{ data: expense, error: expErr }, { data: docs, error: docErr }] = await Promise.all([
    supabase.from('finance_expenses').select('*').eq('id', expenseId).maybeSingle(),
    supabase.from('finance_documents').select('*').eq('expense_id', expenseId),
  ])
  if (expErr) throw new Error(expErr.message)
  if (docErr) throw new Error(docErr.message)
  if (!expense) return null

  const state = computeExpenseState(expense, docs ?? [])
  const { error } = await supabase
    .from('finance_expenses')
    .update({
      status: state.status,
      primary_document_id: state.primaryDocumentId,
      gross_cents: state.grossCents,
      net_cents: state.vat.netCents,
      // A manual VAT figure is Beer's; never overwrite it with a resolved one.
      ...(expense.vat_source === 'manual' ? {} : { vat_cents: state.vat.vatCents, vat_rate_pct: state.vat.ratePct, vat_source: state.vat.source }),
      vat_conflict: (state.vat.conflict as Json | null) ?? null,
      supplier_name: state.supplierName,
      invoice_number: state.invoiceNumber,
      order_number: state.orderNumber,
      invoice_date: state.invoiceDate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', expenseId)
  if (error) throw new Error(error.message)
  return state
}
