import { EXPENSE_STATUS_LABELS, type ExpenseStatus } from '@/lib/finance/expenses/status'

const TONE: Record<ExpenseStatus, string> = {
  ignored: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  waiting_for_invoice: 'bg-amber-50 text-amber-800 border-amber-200',
  waiting_for_payment: 'bg-sky-50 text-sky-800 border-sky-200',
  partially_matched: 'bg-violet-50 text-violet-800 border-violet-200',
  matched: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  needs_review: 'bg-red-50 text-red-800 border-red-200',
  ready_for_snelstart: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  sent_to_snelstart: 'bg-zinc-900 text-white border-zinc-900',
  booked: 'bg-zinc-200 text-zinc-700 border-zinc-300',
}

export function ExpenseStatusBadge({ status }: { status: string }) {
  const s = status as ExpenseStatus
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${TONE[s] ?? TONE.ignored}`}>
      {EXPENSE_STATUS_LABELS[s] ?? status}
    </span>
  )
}
