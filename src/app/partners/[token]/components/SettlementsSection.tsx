import { CheckCircle2 } from 'lucide-react'
import { quarterLabel } from '@/lib/quarters'
import { fmtEuros } from '@/lib/utils'

interface Row {
  quarter: string
  isCurrent: boolean
  bookingCount: number
  baseAmountCents: number
  netAmountCents: number
  settled: boolean
  settledAt: string | null
}

interface Props {
  partnerInvoiceRows: Row[]
  affiliateRows: Row[]
}

export function SettlementsSection({ partnerInvoiceRows, affiliateRows }: Props) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Settlements</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Each quarter rolls up into one payout.</p>
      </div>

      {partnerInvoiceRows.length > 0 && (
        <SettlementCard
          title="Partner invoice — you owe Off Course"
          subtitle="You collected ticket prices on the desk. We invoice the net (ticket − commission) at quarter end."
          rows={partnerInvoiceRows}
          tone="rose"
        />
      )}
      {affiliateRows.length > 0 && (
        <SettlementCard
          title="Affiliate — Off Course owes you"
          subtitle="Customers paid us online via your tracking link. We pay you the commission at quarter end."
          rows={affiliateRows}
          tone="emerald"
        />
      )}
    </section>
  )
}

function SettlementCard({
  title,
  subtitle,
  rows,
  tone,
}: {
  title: string
  subtitle: string
  rows: Row[]
  tone: 'rose' | 'emerald'
}) {
  const headerBg = tone === 'rose' ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'
  const amountColor = tone === 'rose' ? 'text-rose-900' : 'text-emerald-900'
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
      <div className={`px-5 py-3 border-b ${headerBg}`}>
        <p className="font-semibold text-zinc-900">{title}</p>
        <p className="text-xs text-zinc-600 mt-0.5 leading-relaxed">{subtitle}</p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 border-b border-zinc-100">
          <tr>
            <th className="text-left px-5 py-2.5 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Quarter</th>
            <th className="text-right px-5 py-2.5 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Bookings</th>
            <th className="text-right px-5 py-2.5 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Tickets</th>
            <th className="text-right px-5 py-2.5 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Amount</th>
            <th className="text-right px-5 py-2.5 font-semibold text-zinc-500 text-[10px] uppercase tracking-wide">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map(r => (
            <tr key={r.quarter}>
              <td className="px-5 py-3 text-zinc-900">
                {quarterLabel(r.quarter)}
                {r.isCurrent && <span className="ml-2 text-[10px] uppercase tracking-wide text-zinc-400">in progress</span>}
              </td>
              <td className="px-5 py-3 text-right text-zinc-700">{r.bookingCount}</td>
              <td className="px-5 py-3 text-right text-zinc-700">{fmtEuros(r.baseAmountCents)}</td>
              <td className={`px-5 py-3 text-right font-semibold ${amountColor}`}>{fmtEuros(r.netAmountCents)}</td>
              <td className="px-5 py-3 text-right">
                {r.settled ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 bg-emerald-100 rounded-full">
                    <CheckCircle2 className="w-3 h-3" />
                    Settled {r.settledAt ? new Date(r.settledAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                  </span>
                ) : r.isCurrent ? (
                  <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold text-zinc-500 bg-zinc-100 rounded-full">In progress</span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold text-amber-700 bg-amber-100 rounded-full">Outstanding</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
