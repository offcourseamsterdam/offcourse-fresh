'use client'

import { Calendar, Users, Clock, Ship, Ticket, Sparkles, Check } from 'lucide-react'
import type { Step } from './booking-state'

const STEP_ICONS: Record<Step, React.ComponentType<{ className?: string }>> = {
  date: Calendar,
  guests: Users,
  time: Clock,
  boat: Ship,
  tickets: Ticket,
  extras: Sparkles,
}

const STEP_LABELS: Record<Step, string> = {
  date: 'Date',
  guests: 'Guests',
  time: 'Time',
  boat: 'Boat',
  tickets: 'Tickets',
  extras: 'Extras',
}

/**
 * Per-step summary. Either a plain string (single-line tab) or
 * `{ value, subline }` (two-line tab — only used for the boat tab on
 * private cruises so the duration can sit under the boat name).
 */
type SummaryValue = string | { value: string; subline?: string }

interface BookingStepTabsProps {
  steps: Step[]
  currentStep: Step
  /** Per-step display value once that step has been completed */
  summaries: Partial<Record<Step, SummaryValue | undefined>>
  /** Returns true if the user has progressed past this step */
  isCompleted: (step: Step) => boolean
  onStepClick: (step: Step) => void
}

/**
 * Horizontal tab strip for the sidebar booking panel — replaces the vertical
 * accordion. Each tab shows an icon stacked above the chosen value (or the
 * step label when pending). Tabs distribute evenly and are flex-1 so the strip
 * always fills the parent width.
 *
 * Visual states per tab:
 *  - active     → primary color, primary 2px bottom border, value bold
 *  - completed  → dark ink, green check overlay on the icon, clickable
 *  - pending    → muted grey, not clickable, shows step label
 */
export function BookingStepTabs({
  steps,
  currentStep,
  summaries,
  isCompleted,
  onStepClick,
}: BookingStepTabsProps) {
  if (steps.length === 0) return null

  return (
    <div className="flex w-full border-b border-zinc-200 -mx-1">
      {steps.map((step) => {
        const Icon = STEP_ICONS[step]
        const active = step === currentStep
        const done = isCompleted(step)
        const enabled = active || done
        const raw = summaries[step]
        const summaryValue = typeof raw === 'string' ? raw : raw?.value
        const subline = typeof raw === 'string' ? undefined : raw?.subline
        const text =
          (active || done) ? (summaryValue ?? STEP_LABELS[step]) : STEP_LABELS[step]
        const ariaSuffix = summaryValue ? `: ${summaryValue}${subline ? ` ${subline}` : ''}` : ''

        return (
          <button
            key={step}
            type="button"
            onClick={() => enabled && onStepClick(step)}
            disabled={!enabled}
            aria-current={active ? 'step' : undefined}
            aria-label={`${STEP_LABELS[step]}${ariaSuffix}`}
            className={`flex-1 min-w-0 flex flex-col items-center gap-1 pt-0 pb-2.5 px-1
              border-b-2 transition-colors text-[10px] leading-tight text-center
              ${
                active
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)] font-semibold'
                  : done
                    ? 'border-transparent text-zinc-700 hover:text-[var(--color-primary)] cursor-pointer'
                    : 'border-transparent text-zinc-300 cursor-not-allowed'
              }`}
          >
            <span className="relative inline-flex">
              <Icon className="w-4 h-4" />
              {done && !active && (
                <span className="absolute -top-1 -right-1.5 w-3 h-3 rounded-full bg-emerald-500 ring-1 ring-white flex items-center justify-center">
                  <Check className="w-2 h-2 text-white" strokeWidth={3.5} />
                </span>
              )}
            </span>
            <span className="truncate w-full px-0.5">{text}</span>
            {subline && (active || done) && (
              <span className="text-[9px] text-zinc-400 leading-tight font-normal truncate w-full px-0.5">
                {subline}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
