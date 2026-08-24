import { Check, CircleAlert, X } from 'lucide-react'
import { formatTierLines, type CancellationTier } from '@/lib/cancellation/policy'

interface CancellationPolicyCardProps {
  tiers: CancellationTier[]
  /** Pride-only styling: the full-refund checkmark becomes a 🌈 emoji instead. */
  isSpecialEvent?: boolean
  /** Spans both columns of the surrounding grid. Default true (existing behavior).
   *  Set false to sit side-by-side with the Drinks card instead — used when the
   *  Food card above has already claimed the wide row (see ExtrasGrid). */
  wide?: boolean
}

/**
 * Read-only card shown on the public cruise detail page under
 * "Things you need to know". Spans both columns of the surrounding grid.
 *
 * Renders one row per tier: status icon + bold refund label + muted detail line.
 * Visual rhythm matches the Food / Drinks cards next to it.
 */
export function CancellationPolicyCard({ tiers, isSpecialEvent, wide = true }: CancellationPolicyCardProps) {
  const lines = formatTierLines(tiers)

  return (
    <div className={`bg-white rounded-xl p-5 shadow-sm ${wide ? 'sm:col-span-2' : ''}`}>
      <h3 className="font-avenir font-bold text-[18px] text-[var(--color-primary)] mb-4">
        Cancellation Policy
      </h3>
      <ul className="space-y-3">
        {lines.map((line, i) => (
          <li key={i} className="flex items-start gap-3">
            {isSpecialEvent && line.refundPercent === 100 ? (
              <span className="mt-0.5 flex-shrink-0 w-6 h-6 flex items-center justify-center text-sm leading-none" aria-hidden="true">
                🌈
              </span>
            ) : (
              <span
                className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${iconWrapClass(
                  line.refundPercent
                )}`}
              >
                <TierIcon refundPercent={line.refundPercent} />
              </span>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--color-ink)]">{line.label}</p>
              <p className="text-xs text-[var(--color-muted)] mt-0.5">{line.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function iconWrapClass(percent: number): string {
  if (percent === 100) return 'bg-emerald-50 text-emerald-600'
  if (percent === 0) return 'bg-zinc-100 text-zinc-400'
  return 'bg-amber-50 text-amber-600'
}

function TierIcon({ refundPercent }: { refundPercent: number }) {
  if (refundPercent === 100) return <Check className="w-3.5 h-3.5" />
  if (refundPercent === 0) return <X className="w-3.5 h-3.5" />
  return <CircleAlert className="w-3.5 h-3.5" />
}
