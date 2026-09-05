/**
 * The Revolut half of the Finance Inbox v2 (plan §3.1): runs right after the
 * transaction sync, in the same 15-minute cron.
 *
 *  1. ensureExpensesForTransactions — every completed outgoing transaction that
 *     has no Expense Record yet gets one (or is recorded as `ignored` when a
 *     structural rule says no document will ever exist: internal transfers,
 *     Revolut fees). This is what makes "Wacht op factuur" appear the moment a
 *     card is swiped, not when someone remembers.
 *  2. syncRevolutExpenses — Revolut's own expense objects (the VAT rate Beer
 *     picked in the app, the receipt photo he attached) are pulled in and
 *     stamped onto the matching record via transaction_id; receipts are
 *     downloaded once, type-sniffed, hashed, stored, and read by Gemini.
 *
 * Idempotent on every path: unique indexes on bank_transaction_id,
 * revolut_expense_id, revolut_receipt_id and sha256 turn a re-run into a no-op.
 */
import { randomUUID } from 'node:crypto'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { Database, Json } from '@/lib/supabase/types'
import type { RevolutClient, RevolutExpense } from '@/lib/revolut/client'
import { toCents } from '@/lib/revolut/client'
import { classifyStructural, type RuleContext } from '@/lib/finance/cockpit/classify/rules'
import { loadRuleContext, toClassifiable } from '@/lib/finance/cockpit/classify/apply'
import { uploadFinanceAttachment } from '@/lib/finance/attachment-storage'
import { decideExpenseForTransaction, type ExpenseSourceTransaction } from './from-transaction'
import { MAX_DOCUMENT_BYTES, sha256Hex, sniffDocumentType } from './documents'
import { extractDocumentFields } from './extract-document'
import { recomputeExpense } from './recompute'
import { vatFromGrossAndRate } from './vat'

type Admin = ReturnType<typeof createAdminClient>
type BankTxRow = Database['public']['Tables']['bank_transactions']['Row']

/** Receipts per run — each is a download + upload + Gemini call; the rest follows next quarter-hour. */
export const MAX_RECEIPTS_PER_RUN = 10
/** Wall-clock budget for the receipt work inside one cron run (the route has maxDuration 60 and the cash sync ran first). */
export const RECEIPT_TIME_BUDGET_MS = 25_000

function toSource(row: BankTxRow): ExpenseSourceTransaction {
  return {
    id: row.id,
    type: row.type,
    state: row.state,
    amountCents: row.amount_cents,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    merchantName: (row.merchant as { name?: string } | null)?.name ?? null,
    counterpartyName: (row.counterparty as { name?: string } | null)?.name ?? null,
    description: row.description,
    reference: row.reference,
  }
}

export interface EnsureResult {
  scanned: number
  created: number
  ignored: number
}

export async function ensureExpensesForTransactions(
  supabase: Admin,
  opts: { accountId: string; since: string; limit?: number },
  ctx?: RuleContext,
): Promise<EnsureResult> {
  const ruleCtx = ctx ?? (await loadRuleContext(supabase))
  const { data: rows, error } = await supabase
    .from('bank_transactions')
    .select('*')
    .eq('account_id', opts.accountId)
    .eq('state', 'completed')
    .lt('amount_cents', 0)
    .is('expense_id', null)
    .gte('created_at', opts.since)
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? 500)
  if (error) throw new Error(error.message)

  const result: EnsureResult = { scanned: 0, created: 0, ignored: 0 }
  for (const row of rows ?? []) {
    result.scanned++
    const decision = decideExpenseForTransaction(toSource(row), classifyStructural(toClassifiable(row), ruleCtx))
    if (decision.kind === 'skip') continue

    let expenseId: string | null = null
    const { data: inserted, error: insErr } = await supabase.from('finance_expenses').insert(decision.insert).select('id').single()
    if (inserted) expenseId = inserted.id
    else if (insErr?.code === '23505') {
      const { data: existing } = await supabase.from('finance_expenses').select('id').eq('bank_transaction_id', row.id).maybeSingle()
      expenseId = existing?.id ?? null
    } else if (insErr) throw new Error(insErr.message)
    if (!expenseId) continue

    const { error: linkErr } = await supabase.from('bank_transactions').update({ expense_id: expenseId }).eq('id', row.id)
    if (linkErr) throw new Error(linkErr.message)
    if (decision.kind === 'ignored') result.ignored++
    else result.created++
  }
  return result
}

/**
 * Revolut gives a rate per split, never an amount. Sum the VAT inside each
 * split's gross; report one rate only when every split agrees (a mixed
 * 21%/9% receipt has no single rate — that's null, not an average).
 */
export function revolutVatFromSplits(expense: RevolutExpense): { vatCents: number | null; ratePct: number | null } {
  // Euro splits with a rate only: a USD split would be compared against a euro invoice, a negative split (refund line) would produce negative VAT.
  const rated = (expense.splits ?? []).filter(s => typeof s.tax_rate?.percentage === 'number' && (s.amount?.currency ?? 'EUR').toUpperCase() === 'EUR' && s.amount.amount >= 0)
  if (rated.length === 0) return { vatCents: null, ratePct: null }
  const vatCents = rated.reduce((sum, s) => sum + vatFromGrossAndRate(toCents(s.amount.amount), s.tax_rate!.percentage!), 0)
  const rates = new Set(rated.map(s => s.tax_rate!.percentage!))
  return { vatCents, ratePct: rates.size === 1 ? [...rates][0] : null }
}

export interface ExpenseSyncResult {
  expensesSeen: number
  linked: number
  receiptsStored: number
  orphanReceipts: number
  skippedReceipts: number
  extractionFailures: number
  /** Expenses whose sync threw; logged, skipped, retried next run. */
  failedExpenses: number
}

/** One Revolut expense object → our record + its receipts. Throws only for this expense; the caller keeps going. */
async function syncOneRevolutExpense(
  supabase: Admin,
  client: Pick<RevolutClient, 'getExpenseReceipt'>,
  e: RevolutExpense,
  budget: { receipts: number; deadline: number },
  result: ExpenseSyncResult,
): Promise<void> {
  let expenseId: string | null = null
  if (e.transaction_id) {
    const { data: bt } = await supabase.from('bank_transactions').select('expense_id').eq('revolut_id', e.transaction_id).maybeSingle()
    expenseId = bt?.expense_id ?? null
  }

  let changed = false
  if (expenseId) {
    const vat = revolutVatFromSplits(e)
    // Only write (and recompute) when Revolut's facts actually changed — the 7-day window re-visits every expense every 15 minutes.
    const { data: current } = await supabase.from('finance_expenses').select('revolut_expense_id, revolut_expense_state, revolut_vat_rate_pct, revolut_vat_cents').eq('id', expenseId).maybeSingle()
    const same =
      current?.revolut_expense_id === e.id &&
      current?.revolut_expense_state === e.state &&
      (current?.revolut_vat_rate_pct == null ? null : Number(current.revolut_vat_rate_pct)) === vat.ratePct &&
      current?.revolut_vat_cents === vat.vatCents
    if (!same) {
      const { error } = await supabase
        .from('finance_expenses')
        .update({ revolut_expense_id: e.id, revolut_expense_state: e.state, revolut_vat_rate_pct: vat.ratePct, revolut_vat_cents: vat.vatCents, updated_at: new Date().toISOString() })
        .eq('id', expenseId)
      if (error) {
        // 23505: another record already carries this revolut_expense_id (Revolut re-linked the expense to a different transaction).
        // Not ours to resolve automatically — log, and leave this expense alone rather than wedge the whole run.
        if (error.code === '23505') {
          console.error(`[finance/expenses/sync-revolut] revolut expense ${e.id} already linked to another record; skipping`)
          return
        }
        throw new Error(error.message)
      }
      changed = true
    }
    result.linked++
  }

  for (const receiptId of e.receipt_ids ?? []) {
    const { data: known } = await supabase.from('finance_documents').select('id, expense_id').eq('revolut_receipt_id', receiptId).maybeSingle()
    if (known) {
      // Stored while the card payment was still pending → orphan. The payment has landed now: adopt it (review finding H1).
      if (!known.expense_id && expenseId) {
        const { error } = await supabase.from('finance_documents').update({ expense_id: expenseId }).eq('id', known.id).is('expense_id', null)
        if (error) throw new Error(error.message)
        changed = true
      }
      continue
    }
    if (budget.receipts <= 0 || Date.now() > budget.deadline) break
    budget.receipts--

    let bytes: Buffer
    try {
      bytes = await client.getExpenseReceipt(e.id, receiptId)
    } catch (err) {
      console.error(`[finance/expenses/sync-revolut] receipt ${receiptId} download failed:`, err instanceof Error ? err.message : err)
      result.skippedReceipts++
      continue
    }
    const type = sniffDocumentType(bytes)
    if (!type || bytes.length > MAX_DOCUMENT_BYTES) {
      // Remember that this one is unreadable, or the budget is burnt on it every quarter-hour for a week. No file → never a cost document.
      await supabase.from('finance_documents').insert({
        expense_id: expenseId, kind: 'revolut_receipt', source: 'revolut', revolut_expense_id: e.id, revolut_receipt_id: receiptId,
        file_path: null, mime_type: null, extracted: { skipped: true, reason: type ? 'too_large' : 'unrecognised_bytes' } as Json,
      })
      result.skippedReceipts++
      continue
    }

    const sha = sha256Hex(bytes)
    const { data: dup } = await supabase.from('finance_documents').select('id, file_path').eq('sha256', sha).maybeSingle()
    const path = dup ? dup.file_path : `revolut/${randomUUID()}.${type.ext}`
    if (!dup) {
      const up = await uploadFinanceAttachment(supabase, path as string, bytes, type.mimeType)
      if (!up.ok) throw new Error(`receipt upload failed: ${up.error}`)
    }

    const { data: doc, error: docErr } = await supabase
      .from('finance_documents')
      .insert({
        expense_id: expenseId,
        kind: 'revolut_receipt',
        source: 'revolut',
        revolut_expense_id: e.id,
        revolut_receipt_id: receiptId,
        file_path: path,
        original_filename: `receipt-${receiptId}.${type.ext}`,
        mime_type: type.mimeType,
        sha256: dup ? null : sha,
        duplicate_of: dup?.id ?? null,
      })
      .select('id')
      .single()
    if (docErr) {
      if (docErr.code === '23505') continue // a parallel run stored it first
      throw new Error(docErr.message)
    }
    result.receiptsStored++
    changed = true
    if (!expenseId) result.orphanReceipts++

    if (!dup && doc) {
      try {
        const extraction = await extractDocumentFields(bytes.toString('base64'), type.mimeType)
        await supabase.from('finance_documents').update({ extracted: { ...extraction.fields, confidence: extraction.confidence } }).eq('id', doc.id)
      } catch (err) {
        console.error(`[finance/expenses/sync-revolut] receipt ${receiptId} extraction failed:`, err instanceof Error ? err.message : err)
        result.extractionFailures++
      }
    }
  }

  if (expenseId && changed) await recomputeExpense(supabase, expenseId)
}

export async function syncRevolutExpenses(
  supabase: Admin,
  client: Pick<RevolutClient, 'listExpensesSince' | 'getExpenseReceipt'>,
  opts: { since: string; maxReceipts?: number; timeBudgetMs?: number },
): Promise<ExpenseSyncResult> {
  const result: ExpenseSyncResult = { expensesSeen: 0, linked: 0, receiptsStored: 0, orphanReceipts: 0, skippedReceipts: 0, extractionFailures: 0, failedExpenses: 0 }
  const expenses = await client.listExpensesSince(opts.since)
  const budget = { receipts: opts.maxReceipts ?? MAX_RECEIPTS_PER_RUN, deadline: Date.now() + (opts.timeBudgetMs ?? RECEIPT_TIME_BUDGET_MS) }

  for (const e of expenses) {
    result.expensesSeen++
    try {
      await syncOneRevolutExpense(supabase, client, e, budget, result)
    } catch (err) {
      // One broken expense (storage hiccup, constraint) must not stop the rest — or the orphan matching that follows.
      console.error(`[finance/expenses/sync-revolut] expense ${e.id} failed:`, err instanceof Error ? err.message : err)
      result.failedExpenses++
    }
  }
  return result
}
