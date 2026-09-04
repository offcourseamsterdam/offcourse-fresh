'use client'

export type StatTone = 'default' | 'green' | 'amber' | 'red'

interface StatCardProps {
  title: string
  value: string
  subtitle?: string
  tone?: StatTone
  /** Second line under the value, rendered in the tone colour (e.g. "€ 800 onder gewenste veiligheidsmarge"). */
  note?: React.ReactNode
  /** Opens the WhyDrawer for this number. */
  onWhy?: () => void
  /** Optional inline action next to the title (e.g. "Saldo invoeren"). */
  action?: React.ReactNode
}

const VALUE_TONE: Record<StatTone, string> = {
  default: 'text-zinc-900',
  green: 'text-emerald-600',
  amber: 'text-amber-600',
  red: 'text-red-600',
}

const NOTE_TONE: Record<StatTone, string> = {
  default: 'text-zinc-500',
  green: 'text-emerald-700',
  amber: 'text-amber-700',
  red: 'text-red-700',
}

const CARD_TONE: Record<StatTone, string> = {
  default: 'border-zinc-200',
  green: 'border-emerald-200 bg-emerald-50/40',
  amber: 'border-amber-200 bg-amber-50/40',
  red: 'border-red-200 bg-red-50/40',
}

/** One KPI tile. Amounts must already be formatted (use `eur()`), never raw cents. */
export function StatCard({ title, value, subtitle, tone = 'default', note, onWhy, action }: StatCardProps) {
  return (
    <div className={`rounded-2xl border bg-white shadow-sm p-4 sm:p-5 flex flex-col gap-2 min-w-0 ${CARD_TONE[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 leading-snug">{title}</p>
        {action}
      </div>
      <p className={`text-2xl sm:text-3xl font-semibold tabular-nums tracking-tight break-words ${VALUE_TONE[tone]}`}>{value}</p>
      {note && <p className={`text-xs ${NOTE_TONE[tone]}`}>{note}</p>}
      {(subtitle || onWhy) && (
        <div className="flex items-end justify-between gap-2 mt-auto pt-1">
          {subtitle ? <p className="text-xs text-zinc-500 leading-snug">{subtitle}</p> : <span />}
          {onWhy && (
            <button
              type="button"
              onClick={onWhy}
              className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline min-h-[44px] sm:min-h-0 -my-2 sm:my-0 px-1"
            >
              Waarom?
            </button>
          )}
        </div>
      )}
    </div>
  )
}
