/**
 * Expands everything the business must pay within the planning horizon into a
 * flat, dated list. Pure: rows in, occurrences out.
 *
 * Sources:
 * - finance_obligations rows (one-off, or recurring — expanded here, never stored)
 * - finance_loan_payments rows (unpaid)
 *
 * An amount appears exactly once. Loan-generated obligation rows are NOT
 * expected in `rows` (the loan payments table is the single source for loans).
 */

import { addDays, addMonths, type ISODate } from './dates'
import type { Horizon, LoanPaymentRow, ObligationOccurrence, ObligationRow } from './types'

export function horizonEnd(today: ISODate, horizon: Horizon): ISODate {
  switch (horizon) {
    case '30d': return addDays(today, 30)
    case '3m': return addMonths(today, 3)
    case '12m': return addMonths(today, 12)
  }
}

export interface ExpandOptions {
  today: ISODate
  horizon: Horizon
}

export function expandObligations(
  rows: ObligationRow[],
  loanPayments: LoanPaymentRow[],
  { today, horizon }: ExpandOptions,
): ObligationOccurrence[] {
  const end = horizonEnd(today, horizon)
  const out: ObligationOccurrence[] = []

  for (const row of rows) {
    if (row.status !== 'open') continue
    if (row.kind === 'loan') continue // loans come from loanPayments; never double-count

    if (!row.recurrenceMonths) {
      if (row.dueDate <= end) {
        out.push(occ(row, row.dueDate, row.id, row.dueDate < today))
      }
      continue
    }

    // Recurring: occurrences at dueDate + k·months that fall in [today, end].
    // Earlier occurrences are assumed settled — a recurring row is a rhythm,
    // not a ledger; mark the row paid/rolled if reality differs.
    const until = row.recurrenceUntil && row.recurrenceUntil < end ? row.recurrenceUntil : end
    for (let k = 0; k < 400; k++) {
      const d = addMonths(row.dueDate, k * row.recurrenceMonths)
      if (d > until) break
      if (d < today) continue
      out.push(occ(row, d, `${row.id}:${d}`, false))
    }
  }

  for (const p of loanPayments) {
    if (p.isPaid) continue
    if (p.dueDate > end) continue
    out.push({
      key: `loan:${p.id}`,
      title: `${p.loanName} — rente${p.principalCents > 0 ? ' + aflossing' : ''}`,
      kind: 'loan',
      amountCents: p.totalCents,
      dueDate: p.dueDate,
      source: 'loan',
      sourceId: p.loanId,
      overdue: p.dueDate < today,
    })
  }

  out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.title.localeCompare(b.title)))
  return out
}

function occ(row: ObligationRow, dueDate: ISODate, key: string, overdue: boolean): ObligationOccurrence {
  return {
    key: `obl:${key}`,
    title: row.title,
    kind: row.kind,
    amountCents: row.amountCents,
    dueDate,
    source: 'obligation',
    sourceId: row.id,
    overdue,
    boatId: row.boatId ?? null,
    sourceKey: row.sourceKey ?? null,
  }
}

export function sumObligations(occurrences: ObligationOccurrence[]): number {
  return occurrences.reduce((s, o) => s + o.amountCents, 0)
}
