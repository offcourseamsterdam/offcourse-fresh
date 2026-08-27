'use client'

import { Sparkles, Send, Clock, Check, X as XIcon, AlertTriangle, ArrowRight } from 'lucide-react'
import { leftPx, blockMinWidthPx } from '@/lib/admin/planning-time-grid'
import { fmtCostEuros } from '@/lib/scheduling/shift-cost'
import { STATE_STYLES, type MoveMarker, type GapMarker } from './optimizer-overlay-model'

/**
 * The optimizer's findings drawn ON the Planning grid, rather than only
 * listed in the side drawer (Beer, 2026-08-27: "a visual overlay not just
 * text based side panel").
 *
 * Division of labour: this overlay is the MAP — where the opportunities are
 * and how far along each one is, scannable without opening anything. The
 * existing OptimizerPanel stays the DETAIL: the drafted SMS/email copy and
 * the actual "Approve & send" button. Clicking a marker here opens that
 * panel focused on the same proposal.
 *
 * Colour vocabulary is deliberately violet/indigo throughout: the grid
 * already spends amber on "shift has no captain" and emerald on "assigned",
 * so an optimizer marker in either of those hues would read as captain
 * status. State is carried by icon + ring weight instead — see STATE_STYLES.
 */

const ICONS = {
  sparkles: Sparkles,
  send: Send,
  clock: Clock,
  check: Check,
  x: XIcon,
  alert: AlertTriangle,
} as const

/** A dashed ghost box over an idle span. `same_day_gap` findings have no
 *  proposal behind them in the backend — there is no ask to send, so this is
 *  deliberately inert: it shows wasted paid time, it doesn't offer an action. */
export function GapGhost({ gap }: { gap: GapMarker }) {
  const left = leftPx(gap.startAt)
  const width = blockMinWidthPx(gap.startAt, gap.endAt)
  const saving = gap.item.estSavingCents

  return (
    <div
      title={`${gap.item.summary}${saving ? `\n≈ ${fmtCostEuros(saving)} paid waiting` : '\nCaptain unassigned — cost unknown'}\nNo ask exists for gaps — informational only`}
      style={{ left, width }}
      className="absolute inset-y-1 z-[2] rounded border border-dashed border-violet-300 bg-violet-50/40 pointer-events-auto"
    >
      {width >= 44 && (
        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-violet-400 tabular-nums">
          {saving ? fmtCostEuros(saving) : 'idle'}
        </span>
      )}
    </div>
  )
}

/**
 * The marker pinned to a departure chip that has an optimizer finding.
 *
 * Sits at the chip's top-right corner rather than replacing any of it — the
 * chip's own content (time, guests, captain status) stays fully readable,
 * which matters because the overlay is a layer you flip on and off, not a
 * different view of the same data.
 */
export function MoveMarkerBadge({
  marker,
  startTime,
  onOpen,
  onHoverChange,
  isHighlighted,
}: {
  marker: MoveMarker
  startTime: string | null
  onOpen: (marker: MoveMarker) => void
  onHoverChange: (marker: MoveMarker | null) => void
  isHighlighted: boolean
}) {
  const style = STATE_STYLES[marker.state]
  const Icon = ICONS[style.icon]
  const item = marker.item
  const saving = item.estSavingCents

  const tooltip = [
    `${style.label}${item.guestName ? ` · ${item.guestName}` : ''}`,
    item.summary,
    saving ? `≈ ${fmtCostEuros(saving)}` : null,
    marker.toDate ? `Moves to ${marker.toDate}` : marker.toBoat ? `Moves to ${marker.toBoat}` : null,
    item.proposalId ? 'Click to open it in the Optimizer panel' : 'No ask drafted for this one',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <button
      type="button"
      title={tooltip}
      onClick={e => {
        e.stopPropagation() // never let this also trigger the chip's own booking modal
        onOpen(marker)
      }}
      onMouseEnter={() => onHoverChange(marker)}
      onMouseLeave={() => onHoverChange(null)}
      style={{ left: leftPx(startTime) }}
      className={`absolute -top-1 z-40 flex items-center gap-0.5 rounded-full px-1 py-0.5 shadow-sm transition-all ${style.ring} ${style.fill} ${style.text} ${
        style.muted ? 'opacity-60 hover:opacity-100' : ''
      } ${isHighlighted ? 'scale-110' : ''}`}
    >
      <Icon className="w-2.5 h-2.5 shrink-0" />
      {saving != null && saving > 0 && (
        <span className="text-[8px] font-semibold tabular-nums leading-none">{fmtCostEuros(saving)}</span>
      )}
      {marker.toDate && <ArrowRight className="w-2 h-2 shrink-0 opacity-70" />}
    </button>
  )
}

/**
 * Legend + phase counts, shown while the overlay is on.
 *
 * Worth the space because the marker vocabulary is icon-based: without this
 * the difference between "sent, waiting on them" and "they said yes, rebook
 * it" is a shape you'd have to learn. The counts double as the answer to
 * "is there anything to do?" without scanning the whole grid.
 */
export function OverlayLegend({
  counts,
  totalSavingCents,
  onOpenPanel,
}: {
  counts: Record<'possible' | 'in_progress' | 'finalized', number>
  totalSavingCents: number
  onOpenPanel: () => void
}) {
  const entries: { state: keyof typeof STATE_STYLES; count?: number }[] = [
    { state: 'possible', count: counts.possible },
    { state: 'awaiting' },
    { state: 'accepted' },
    { state: 'finalized', count: counts.finalized },
  ]

  return (
    <div className="flex items-center gap-3 flex-wrap px-3 py-2 rounded-lg bg-violet-50/70 border border-violet-100 text-[11px]">
      <span className="inline-flex items-center gap-1 font-semibold text-violet-700">
        <Sparkles className="w-3 h-3" /> Optimizer overlay
      </span>

      {entries.map(({ state, count }) => {
        const style = STATE_STYLES[state]
        const Icon = ICONS[style.icon]
        return (
          <span key={state} className="inline-flex items-center gap-1 text-zinc-500">
            <span className={`inline-flex items-center rounded-full p-0.5 ${style.ring} ${style.fill} ${style.text}`}>
              <Icon className="w-2.5 h-2.5" />
            </span>
            {style.label}
            {count != null && count > 0 && <span className="font-semibold text-zinc-700 tabular-nums">{count}</span>}
          </span>
        )
      })}

      <span className="inline-flex items-center gap-1 text-zinc-500">
        <span className="inline-block w-4 h-2.5 rounded border border-dashed border-violet-300 bg-violet-50/40" />
        Paid idle time
      </span>

      {counts.in_progress > 0 && (
        <span className="text-zinc-500">
          <span className="font-semibold text-zinc-700 tabular-nums">{counts.in_progress}</span> out with guests
        </span>
      )}

      {totalSavingCents > 0 && (
        <span className="ml-auto text-violet-700 font-semibold tabular-nums">
          up to {fmtCostEuros(totalSavingCents)}
        </span>
      )}

      <button onClick={onOpenPanel} className="text-violet-600 hover:text-violet-800 font-medium underline underline-offset-2">
        Open panel
      </button>
    </div>
  )
}
