'use client'

import type { TransactionApiRow } from './api-types'
import { eurCents, dateNL } from './money'
import { transactionLabel, transactionBadge, classificationLabel, isIncoming } from './transaction-display'

interface TransactionListProps {
  transactions: TransactionApiRow[]
  /** Hide reference, balance-after and classification — the overview's "Recente transacties" card. */
  compact?: boolean
}

const BADGE_STYLE = {
  pending: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-700',
} as const

function Badge({ state }: { state: string }) {
  const badge = transactionBadge(state)
  if (!badge) return null
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap ${BADGE_STYLE[badge.tone]}`}>
      {badge.label}
    </span>
  )
}

function ClassificationChip({ tx }: { tx: TransactionApiRow }) {
  const label = classificationLabel(tx)
  if (!label) {
    return <span className="inline-flex items-center rounded-full border border-dashed border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-400 whitespace-nowrap">Nog niet geclassificeerd</span>
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${tx.needs_review ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-indigo-50 text-indigo-700'}`}>
      {label}
      {tx.needs_review && <span className="text-[10px] uppercase tracking-wide">· controle</span>}
    </span>
  )
}

/** Signed amount: "+€ 1.234,56" green for money in, "-€ 12,00" zinc for money out. Failed states are greyed. */
function Amount({ tx }: { tx: TransactionApiRow }) {
  const incoming = isIncoming(tx)
  const failed = transactionBadge(tx.state)?.tone === 'failed'
  const tone = failed ? 'text-zinc-400 line-through' : incoming ? 'text-emerald-700' : 'text-zinc-900'
  return (
    <span className={`text-sm font-semibold tabular-nums whitespace-nowrap ${tone}`}>
      {incoming ? '+' : ''}{eurCents(tx.amount_cents)}
    </span>
  )
}

/**
 * One list of bank transactions, rendered two ways from the same rows:
 * stacked cards under 640px, a table from `sm` up. Every amount goes through
 * money.ts; every label through transaction-display.ts — this component only
 * lays them out.
 */
export function TransactionList({ transactions, compact = false }: TransactionListProps) {
  if (transactions.length === 0) return null

  return (
    <>
      {/* Mobile: stacked cards */}
      <ul className="sm:hidden divide-y divide-zinc-100">
        {transactions.map(tx => (
          <li key={tx.id} className="py-3 flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900 truncate">{transactionLabel(tx)}</p>
                <p className="text-xs text-zinc-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span>{dateNL(tx.completed_at ?? tx.created_at)}</span>
                  {!compact && tx.reference && <><span>·</span><span className="truncate">{tx.reference}</span></>}
                  <Badge state={tx.state} />
                </p>
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <Amount tx={tx} />
                {!compact && tx.balance_after_cents != null && (
                  <span className="text-[11px] text-zinc-400 tabular-nums">saldo {eurCents(tx.balance_after_cents)}</span>
                )}
              </div>
            </div>
            {!compact && <div><ClassificationChip tx={tx} /></div>}
          </li>
        ))}
      </ul>

      {/* Desktop: table, scrolls inside its own container */}
      <div className="hidden sm:block overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-100">
              <th className="py-2 pr-3 font-medium whitespace-nowrap">Datum</th>
              <th className="py-2 pr-3 font-medium">Omschrijving</th>
              {!compact && <th className="py-2 pr-3 font-medium">Referentie</th>}
              <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Bedrag</th>
              {!compact && <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Saldo na</th>}
              {!compact && <th className="py-2 font-medium">Classificatie</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {transactions.map(tx => (
              <tr key={tx.id} className="align-top">
                <td className="py-2.5 pr-3 whitespace-nowrap text-zinc-600 tabular-nums">{dateNL(tx.completed_at ?? tx.created_at)}</td>
                <td className="py-2.5 pr-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-zinc-900 truncate max-w-[28rem]">{transactionLabel(tx)}</span>
                    <Badge state={tx.state} />
                  </div>
                </td>
                {!compact && <td className="py-2.5 pr-3 text-zinc-500 truncate max-w-[14rem]">{tx.reference ?? <span className="text-zinc-300">—</span>}</td>}
                <td className="py-2.5 pr-3 text-right"><Amount tx={tx} /></td>
                {!compact && (
                  <td className="py-2.5 pr-3 text-right text-zinc-500 tabular-nums whitespace-nowrap">
                    {tx.balance_after_cents != null ? eurCents(tx.balance_after_cents) : <span className="text-zinc-300">—</span>}
                  </td>
                )}
                {!compact && <td className="py-2.5"><ClassificationChip tx={tx} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
