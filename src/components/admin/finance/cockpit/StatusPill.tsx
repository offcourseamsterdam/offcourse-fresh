'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { StatusLevel } from '@/lib/finance/cockpit/types'

interface StatusPillProps {
  level: StatusLevel
  label: string
  reasons: string[]
}

const STYLE: Record<StatusLevel, { pill: string; dot: string }> = {
  healthy: { pill: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  attention: { pill: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  tight: { pill: 'bg-red-50 text-red-800 border-red-200', dot: 'bg-red-500' },
}

/**
 * Financieel gezond / Let op / Te krap. The reasons show on hover (desktop)
 * and on tap (mobile) — same list, two ways in.
 */
export function StatusPill({ level, label, reasons }: StatusPillProps) {
  const [open, setOpen] = useState(false)
  const style = STYLE[level]
  const hasReasons = reasons.length > 0

  return (
    <div className="relative inline-block group">
      <button
        type="button"
        onClick={() => hasReasons && setOpen(o => !o)}
        aria-expanded={open}
        title={hasReasons ? reasons.join(' · ') : undefined}
        className={`inline-flex items-center gap-2 min-h-[44px] sm:min-h-0 px-3.5 py-1.5 rounded-full border text-sm font-medium ${style.pill} ${hasReasons ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className={`w-2 h-2 rounded-full ${style.dot}`} />
        {label}
        {hasReasons && <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>

      {hasReasons && (
        <div
          className={`sm:absolute sm:left-0 sm:top-full sm:mt-2 sm:w-80 z-20 mt-2 rounded-xl border border-zinc-200 bg-white shadow-lg p-3 text-sm text-zinc-700 ${
            open ? 'block' : 'hidden sm:group-hover:block'
          }`}
        >
          <ul className="space-y-1.5">
            {reasons.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
