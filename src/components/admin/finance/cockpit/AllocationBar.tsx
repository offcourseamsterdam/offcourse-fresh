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
  owner_salary: '#f59e0b', // amber-500
  goals: '#8b5cf6', // violet-500
}
const FREE_COLOR = '#34d399' // emerald-400

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
 * in priority order, with whatever is left as "Vrij". Segments always add up to
 * cash because the engine computed them that way — the component never does
 * its own arithmetic beyond turning cents into percentages.
 *
 * The safety margin is a *line*, not a bucket: a marker inside the free segment
 * showing how much of "Vrij" Beer wants to leave untouched.
 */
export function AllocationBar({ cashCents, buckets, freeCents, safetyMarginCents, reserveOverrunCents }: AllocationBarProps) {
  const segments: Segment[] = [
    ...buckets.map(b => ({
      key: b.key,
      label: b.label,
      cents: b.fundedCents,
      color: BUCKET_COLOR[b.key] ?? '#a1a1aa',
      underfunded: b.shortfallCents > 0,
      shortfallCents: b.shortfallCents,
    })),
    { key: 'free', label: 'Vrij', cents: freeCents, color: FREE_COLOR, underfunded: false, shortfallCents: 0 },
  ]

  const total = cashCents > 0 ? cashCents : 0
  const widthPct = (cents: number) => (total > 0 ? (Math.max(0, cents) / total) * 100 : 0)

  // Marker sits `safetyMargin` into the free segment, capped at the bar's end.
  const claimedCents = Math.max(0, total - Math.max(0, freeCents))
  const markerCents = claimedCents + Math.min(Math.max(0, safetyMarginCents), Math.max(0, freeCents))
  const markerPct = total > 0 ? (markerCents / total) * 100 : 0
  const marginFits = freeCents >= safetyMarginCents

  return (
    <div className="space-y-3">
      {/* Threshold label — desktop only; on mobile it lives in the legend list. */}
      {total > 0 && (
        <div className="hidden sm:block relative h-5 text-[11px] text-zinc-500">
          <span
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${Math.min(97, Math.max(3, markerPct))}%` }}
          >
            Gewenste veiligheidsmarge {eur(safetyMarginCents)}
          </span>
        </div>
      )}

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
        {total > 0 && (
          <div
            aria-hidden="true"
            className={`absolute -top-1 -bottom-1 w-0 border-l-2 border-dashed ${marginFits ? 'border-zinc-700' : 'border-red-500'}`}
            style={{ left: `${markerPct}%` }}
          />
        )}
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
        <li className="sm:hidden flex items-center justify-between gap-2 pt-1 border-t border-zinc-100">
          <span className="flex items-center gap-2 text-zinc-700">
            <span className={`w-0 h-3 border-l-2 border-dashed shrink-0 ${marginFits ? 'border-zinc-700' : 'border-red-500'}`} />
            Gewenste veiligheidsmarge
          </span>
          <span className="tabular-nums text-zinc-900 font-medium">{eur(safetyMarginCents)}</span>
        </li>
      </ul>

      {reserveOverrunCents > 0 && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Je reserveringen zijn {eur(reserveOverrunCents)} hoger dan je werkelijke saldo. Pas je doelen, salarisdekking of operationele dekking aan.
        </p>
      )}
    </div>
  )
}
