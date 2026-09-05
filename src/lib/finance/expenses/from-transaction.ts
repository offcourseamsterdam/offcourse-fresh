/**
 * Which bank transactions become an Expense Record, and what the record looks
 * like the moment it's born (plan §3.1). Pure: the sync step hands it a
 * `bank_transactions` row and the structural classification it already
 * computes for Phase 3, and gets back either "make this record" or "this will
 * never need a document" — so the Missing-invoices KPI only ever counts
 * purchases, not our own transfers or Revolut's fees.
 */
import type { Classification } from '@/lib/finance/cockpit/classify/rules'

export interface ExpenseSourceTransaction {
  id: string
  type: string
  state: string
  amountCents: number
  completedAt: string | null
  createdAt: string
  merchantName: string | null
  counterpartyName: string | null
  description: string | null
  reference: string | null
}

/** Revolut transaction types that are never a purchase with a document behind it. */
const NEVER_A_PURCHASE = new Set(['fee', 'exchange', 'topup', 'refund', 'atm'])

export type ExpenseDecision =
  | { kind: 'skip'; reason: 'incoming' | 'not_completed' }
  | { kind: 'ignored'; reason: string; insert: ExpenseInsert }
  | { kind: 'create'; insert: ExpenseInsert }

export interface ExpenseInsert {
  bank_transaction_id: string
  cash_out_cents: number
  paid_at: string
  supplier_name: string | null
  status: 'waiting_for_invoice' | 'ignored'
  needs_review_reason: null
  notes: string | null
}

/**
 * `structural` is classifyStructural()'s answer for this transaction (null when
 * no rule fired). Two of its answers mean "no document will ever exist":
 * an internal transfer between our own accounts, and a Revolut fee.
 */
export function decideExpenseForTransaction(tx: ExpenseSourceTransaction, structural: Classification | null): ExpenseDecision {
  if (tx.amountCents >= 0) return { kind: 'skip', reason: 'incoming' }
  if (tx.state !== 'completed') return { kind: 'skip', reason: 'not_completed' }

  const base = {
    bank_transaction_id: tx.id,
    cash_out_cents: Math.abs(tx.amountCents),
    paid_at: tx.completedAt ?? tx.createdAt,
    supplier_name: tx.merchantName ?? tx.counterpartyName ?? tx.description ?? null,
    needs_review_reason: null as null,
  }

  const internal = structural?.category === 'transfer' && structural.subcategory === 'internal'
  const fee = structural?.category === 'operating' && structural.subcategory === 'fees'
  if (NEVER_A_PURCHASE.has(tx.type) || internal || fee) {
    const reason = internal ? 'Overboeking tussen eigen rekeningen' : fee || tx.type === 'fee' ? 'Bankkosten' : `Revolut-type ${tx.type}`
    return { kind: 'ignored', reason, insert: { ...base, status: 'ignored', notes: `Automatisch genegeerd: ${reason.toLowerCase()} — hier hoort geen factuur of bon bij.` } }
  }

  return { kind: 'create', insert: { ...base, status: 'waiting_for_invoice', notes: null } }
}
