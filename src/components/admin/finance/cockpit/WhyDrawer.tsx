'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { Horizon, WhyLine } from '@/lib/finance/cockpit/types'
import { HORIZON_LABELS } from '@/lib/finance/cockpit/types'
import { eur, dateNL } from './money'

interface WhyDrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  horizon: Horizon
  horizonEnd: string
  lines: WhyLine[]
}

/**
 * "Waarom?" — the calculation behind every KPI, line by line.
 *
 * Renders exactly what the API returned in `why[]`; there is no client-side
 * math here on purpose (plan §2 rule 5: one formula, everywhere). Right-side
 * drawer on desktop, bottom sheet on mobile.
 */
export function WhyDrawer({ open, onClose, title = 'Waarom dit bedrag?', horizon, horizonEnd, lines }: WhyDrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl bg-white shadow-2xl flex flex-col animate-modal-in sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:w-[420px] sm:max-h-none sm:rounded-none"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-100 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Horizon: {HORIZON_LABELS[horizon]} · tot {dateNL(horizonEnd)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Sluiten"
            className="text-zinc-400 hover:text-zinc-600 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 -m-2 sm:m-0 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <ol className="overflow-y-auto px-5 py-4 space-y-1 text-sm">
          {lines.map((line, i) => {
            const isStart = line.op === 'start'
            const isSubtotal = line.op === '='
            const isInfo = line.op === 'info'
            const isDeduction = line.op === '-'
            return (
              <li
                key={i}
                className={`flex items-start gap-3 py-2 ${isSubtotal ? 'border-t border-zinc-200 mt-1 pt-3' : ''}`}
              >
                <span
                  className={`w-4 shrink-0 text-center tabular-nums ${
                    isDeduction ? 'text-red-500' : isSubtotal ? 'text-zinc-900 font-semibold' : 'text-zinc-300'
                  }`}
                >
                  {isDeduction ? '−' : isSubtotal ? '=' : isInfo ? 'i' : ''}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`${isSubtotal || isStart ? 'font-semibold text-zinc-900' : isInfo ? 'text-zinc-500 italic' : 'text-zinc-700'}`}>
                    {line.label}
                  </p>
                  {line.detail && <p className="text-xs text-zinc-500 mt-0.5">{line.detail}</p>}
                </div>
                <span
                  className={`tabular-nums shrink-0 ${
                    isSubtotal || isStart
                      ? `font-semibold ${line.amountCents < 0 ? 'text-red-600' : 'text-zinc-900'}`
                      : isDeduction ? 'text-zinc-700' : 'text-zinc-500'
                  }`}
                >
                  {eur(line.amountCents)}
                </span>
              </li>
            )
          })}
          {lines.length === 0 && (
            <li className="text-zinc-500 py-2">Geen berekening beschikbaar.</li>
          )}
        </ol>
      </aside>
    </div>
  )
}
