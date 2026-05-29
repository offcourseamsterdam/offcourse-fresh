'use client'

import { useEffect, useState } from 'react'
import {
  formatCutoffDateTime,
  getNextCutoff,
  type CancellationTier,
} from '@/lib/cancellation/policy'

interface CancellationCutoffProps {
  /** Departure datetime — typically `new Date(booking_date + 'T' + start_time)`. */
  departureAt: Date
  /** Tiered policy from the parent FH item. */
  tiers: CancellationTier[]
  /** Render the soft top divider line (true in the checkout summary, false under the booking button). */
  bordered?: boolean
}

/**
 * Live-updating cutoff line for the booking summary on the checkout page.
 *
 *   "You can cancel for free until **Fri 9 May, 14:30**."
 *   "You can still cancel for a 50% refund until **Sat 10 May, 14:30**."
 *
 * Renders nothing if there is no useful upcoming cutoff (i.e. the user is
 * already inside the lowest non-zero tier or departure is in the past).
 */
export function CancellationCutoff({ departureAt, tiers, bordered = true }: CancellationCutoffProps) {
  // Re-render exactly when the next tier boundary is crossed — never sooner.
  // For a booking 5 days out the timer doesn't fire at all (we render null below).
  // For a booking inside a tier above the lowest, one timeout fires at the boundary,
  // re-renders, and re-schedules itself for the following boundary.
  const [, setTick] = useState(0)
  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined
    function schedule() {
      const next = getNextCutoff(departureAt, tiers)
      if (!next) return
      const ms = next.cutoffAt.getTime() - Date.now()
      if (ms <= 0) {
        setTick(t => t + 1)
        return
      }
      id = setTimeout(() => {
        setTick(t => t + 1)
        schedule()
      }, ms)
    }
    schedule()
    return () => {
      if (id) clearTimeout(id)
    }
  }, [departureAt, tiers])

  const cutoff = getNextCutoff(departureAt, tiers)
  if (!cutoff) return null

  const cutoffLabel = formatCutoffDateTime(cutoff.cutoffAt)
  const refundPhrase =
    cutoff.refundPercent === 100 ? 'for free' : `for a ${cutoff.refundPercent}% refund`
  const stillPrefix = cutoff.refundPercent === 100 ? 'can' : 'can still'

  return (
    <div className={bordered ? 'border-t border-zinc-100 pt-3' : ''}>
      <p className="text-xs text-zinc-600 leading-relaxed">
        You {stillPrefix} cancel {refundPhrase} until{' '}
        <span className="font-semibold text-zinc-900">{cutoffLabel}</span>.
      </p>
    </div>
  )
}
