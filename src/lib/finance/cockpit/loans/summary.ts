/**
 * Per-loan summary derived from its materialised finance_loan_payments rows.
 * Pure: rows in, summary out.
 */

export interface LoanPaymentLike {
  due_date: string
  interest_cents: number
  principal_cents: number
  total_cents: number
  is_paid: boolean
}

export interface LoanSummary {
  /** Σ principal of unpaid periods — what is still owed. */
  outstandingCents: number
  nextPayment: { due_date: string; total_cents: number } | null
  paidPeriods: number
  totalPeriods: number
  totalInterestCents: number
}

export function summarizeLoanPayments(rows: LoanPaymentLike[]): LoanSummary {
  const unpaid = rows.filter(r => !r.is_paid).sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0))
  const next = unpaid[0]
  return {
    outstandingCents: unpaid.reduce((s, r) => s + r.principal_cents, 0),
    nextPayment: next ? { due_date: next.due_date, total_cents: next.total_cents } : null,
    paidPeriods: rows.length - unpaid.length,
    totalPeriods: rows.length,
    totalInterestCents: rows.reduce((s, r) => s + r.interest_cents, 0),
  }
}
