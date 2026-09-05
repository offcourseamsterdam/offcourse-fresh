import { FileText, Link2, Mail, Receipt } from 'lucide-react'
import { dateNL, eur } from '@/components/admin/finance/cockpit/money'
import { ExpenseStatusBadge } from './ExpenseStatusBadge'
import type { ExpenseApiRow } from './api-types'

function DocIcon({ expense }: { expense: ExpenseApiRow }) {
  if (!expense.primary_document_id) return <Mail className="w-3.5 h-3.5 text-zinc-300" role="img" aria-label="Nog geen document" />
  if (expense.invoice_number) return <FileText className="w-3.5 h-3.5 text-zinc-500" role="img" aria-label="Factuur" />
  return <Receipt className="w-3.5 h-3.5 text-zinc-500" role="img" aria-label="Bon" />
}

/** One line in the Uitgaven list: who, when paid, how much, VAT with its provenance, status. */
export function ExpenseRowItem({ expense, onSelect }: { expense: ExpenseApiRow; onSelect: (e: ExpenseApiRow) => void }) {
  const amount = expense.cash_out_cents ?? expense.gross_cents
  const vatLabel = expense.vat_cents != null ? `${eur(expense.vat_cents)}${expense.vat_rate_pct != null ? ` · ${Number(expense.vat_rate_pct)}%` : ''}` : '—'
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(expense)}
        className="w-full text-left grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1fr)_7rem_8rem_auto] items-center gap-x-3 gap-y-1 px-3 py-3 min-h-[44px] rounded-xl hover:bg-zinc-50 transition-colors"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 min-w-0">
            <DocIcon expense={expense} />
            <span className="truncate text-sm font-medium text-zinc-900">{expense.supplier_name ?? 'Onbekende leverancier'}</span>
            <span className="hidden sm:inline text-[11px] text-zinc-400 tabular-nums">{expense.ref}</span>
          </span>
          <span className="block text-xs text-zinc-500 truncate">
            {expense.paid_at ? `Betaald ${dateNL(expense.paid_at)}` : expense.invoice_date ? `Factuur ${dateNL(expense.invoice_date)}` : `Ontvangen ${dateNL(expense.created_at)}`}
            {expense.invoice_number ? ` · ${expense.invoice_number}` : expense.order_number ? ` · order ${expense.order_number}` : ''}
            {expense.snelstart_sent_at ? <Link2 className="inline w-3 h-3 ml-1 -mt-0.5 text-zinc-400" role="img" aria-label="Naar SnelStart gestuurd" /> : null}
          </span>
        </span>
        <span className="text-right text-sm font-semibold tabular-nums text-zinc-900 sm:order-none order-1">{amount != null ? eur(amount) : '—'}</span>
        <span className="hidden sm:block text-right text-xs tabular-nums text-zinc-500">BTW {vatLabel}</span>
        <span className="col-span-2 sm:col-span-1 justify-self-start sm:justify-self-end"><ExpenseStatusBadge status={expense.status} /></span>
      </button>
    </li>
  )
}
