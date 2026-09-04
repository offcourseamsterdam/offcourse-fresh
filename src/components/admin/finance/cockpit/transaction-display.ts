/**
 * Pure display helpers for bank transactions (Transacties page + the
 * "Recente transacties" card on the overview). No React, no fetching — so the
 * label/badge rules can be unit-tested and stay identical on both screens.
 */
import type { TransactionApiRow } from './api-types'

type LabelSource = Pick<TransactionApiRow, 'description' | 'merchant' | 'counterparty' | 'reference'>

function nameOf(json: Record<string, unknown> | null): string | null {
  if (!json) return null
  const name = json.name
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

/**
 * What to print as the transaction's title:
 * description → merchant.name → counterparty.name → reference → "Transactie".
 */
export function transactionLabel(tx: LabelSource): string {
  const description = tx.description?.trim()
  if (description) return description
  return nameOf(tx.merchant) ?? nameOf(tx.counterparty) ?? tx.reference?.trim() ?? 'Transactie'
}

export type TransactionBadge = { tone: 'pending' | 'failed'; label: string } | null

/** Revolut states we show a badge for. `completed` (the normal case) gets none. */
export function transactionBadge(state: string): TransactionBadge {
  switch (state) {
    case 'created':
    case 'pending':
      return { tone: 'pending', label: 'in behandeling' }
    case 'declined':
      return { tone: 'failed', label: 'geweigerd' }
    case 'failed':
      return { tone: 'failed', label: 'mislukt' }
    case 'reverted':
      return { tone: 'failed', label: 'teruggedraaid' }
    default:
      return null
  }
}

/** "category · subcategory", "category", or null when Phase 3 hasn't classified the row yet. */
export function classificationLabel(tx: Pick<TransactionApiRow, 'category' | 'subcategory'>): string | null {
  const category = tx.category?.trim()
  if (!category) return null
  const sub = tx.subcategory?.trim()
  return sub ? `${category} · ${sub}` : category
}

/** True when a positive amount should be painted green (money in) — only once it actually landed. */
export function isIncoming(tx: Pick<TransactionApiRow, 'amount_cents'>): boolean {
  return tx.amount_cents > 0
}
