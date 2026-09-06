'use client'

import type { Bucket, BucketKey } from '@/lib/finance/cockpit/types'
import { eur } from './money'

interface AllocationBarProps {
  /** Cleared cash — the bar's 100%. */
  cashCents: number
  buckets: Bucket[]
  freeCents: number
  safetyMarginCents: number
  /** Σ requirements − cash when reserves exceed cash (shown as a note). */
  reserveOverrunCents: number
}

const BUCKET_COLOR: Record<BucketKey, string> = {
  obligations: '#64748b', // slate-500
  operational: '#0ea5e9', // sky-500
  owner_salary: '#eab308', // yellow-500 (warm gold so it doesn't clash with orange)
  goals: '#8b5cf6', // violet-500
}
const SAFETY_COLOR = '#f97316' // orange-500
const FREE_COLOR = '#10b981' // emerald-500

/** Diagonal stripes over the bucket colour — the "onderdekt" signal. */
function hatched(color: string): string {
  return `repeating-linear-gradient(135deg, ${color} 0 6px, rgba(255,255,255,0.55) 6px 10px)`
}

interface Segment {
  key: string
  label: string
  cents: number
  color: string
  underfunded: boolean
  shortfallCents: number
}

/**
 * "Waar is je geld voor bestemd?"
 *
 * The bar is a picture of one sentence: cleared cash, filled up bucket by bucket
 * in priority order, with the safety margin as an orange buffer and whatever is
 * left truly free to spend/invest in emerald green.
 */
export function AllocationBar({ cashCents, buckets, freeCents, safetyMarginCents, reserveOverrunCents }: AllocationBarProps) {
  const safetyFundedCents = Math.max(0, Math.min(freeCents, safetyMarginCents))
  const freeAboveMarginCents = Math.max(0, freeCents - safetyMarginCents)
  const safetyShortfallCents = Math.max(0, safetyMarginCents - freeCents)

  const segments: Segment[] = [
    ...buckets.map(b => ({
      key: b.key,
      label: b.label,
      cents: b.fundedCents,
      color: BUCKET_COLOR[b.key] ?? '#a1a1aa',
      underfunded: b.shortfallCents > 0,
      shortfallCents: b.shortfallCents,
    })),
    ...(safetyMarginCents > 0
      ? [
          {
            key: 'safety_margin',
            label: 'Veiligheidsmarge',
            cents: safetyFundedCents,
            color: SAFETY_COLOR,
            underfunded: safetyShortfallCents > 0,
            shortfallCents: safetyShortfallCents,
          },
        ]
      : []),
    {
      key: 'free',
      label: 'Vrij besteden',
      cents: freeAboveMarginCents,
      color: FREE_COLOR,
      underfunded: false,
      shortfallCents: 0,
    },
  ]

  const total = cashCents > 0 ? cashCents : 0
  const widthPct = (cents: number) => (total > 0 ? (Math.max(0, cents) / total) * 100 : 0)

  return (
    <div className="space-y-3">
      {/* The bar */}
      <div className="relative">
        <div className="flex h-3 sm:h-7 w-full overflow-hidden rounded-full bg-zinc-100" role="img" aria-label={`Verdeling van ${eur(cashCents)}`}>
          {total > 0 && segments.map(s => {
            const w = widthPct(s.cents)
            if (w <= 0) return null
            return (
              <div
                key={s.key}
                title={`${s.label}: ${eur(s.cents)}${s.underfunded ? ` (onderdekt ${eur(s.shortfallCents)})` : ''}`}
                className="h-full transition-[width] duration-300"
                style={{ width: `${w}%`, background: s.underfunded ? hatched(s.color) : s.color }}
              />
            )
          })}
        </div>
      </div>

      {total <= 0 && (
        <p className="text-sm text-zinc-500">Nog geen saldo bekend — de verdeling verschijnt zodra er cash is om te verdelen.</p>
      )}

      {/* Legend: stacked list on mobile, wrapped row on desktop */}
      <ul className="flex flex-col sm:flex-row sm:flex-wrap gap-x-5 gap-y-2 text-sm">
        {segments.map(s => (
          <li key={s.key} className="flex items-center justify-between sm:justify-start gap-2 min-w-0">
            <span className="flex items-center gap-2 min-w-0">
              <span
                className="w-3 h-3 rounded-sm shrink-0"
                style={{ background: s.underfunded ? hatched(s.color) : s.color }}
              />
              <span className="text-zinc-700 truncate">{s.label}</span>
            </span>
            <span className="tabular-nums text-zinc-900 font-medium shrink-0">
              {eur(s.cents)}
              {s.underfunded && (
                <span className="ml-1.5 text-xs font-medium text-red-600">onderdekt {eur(s.shortfallCents)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {reserveOverrunCents > 0 && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Je reserveringen zijn {eur(reserveOverrunCents)} hoger dan je werkelijke saldo. Pas je doelen, salarisdekking of operationele dekking aan.
        </p>
      )}
    </div>
  )
}
