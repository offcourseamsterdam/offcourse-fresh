'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

interface MonthSwitcherProps {
  year: number
  /** 0-indexed, matches Date.getUTCMonth() */
  month: number
  onChange: (year: number, month: number) => void
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Prev/next calendar-month switcher — caps at the current month, never lets you page into the future. */
export function MonthSwitcher({ year, month, onChange }: MonthSwitcherProps) {
  const now = new Date()
  const isCurrentMonth = year === now.getUTCFullYear() && month === now.getUTCMonth()

  function step(delta: number) {
    const d = new Date(Date.UTC(year, month + delta, 1))
    onChange(d.getUTCFullYear(), d.getUTCMonth())
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={() => step(-1)} className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors" aria-label="Previous month">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm font-medium text-zinc-700 w-32 text-center">{MONTH_LABELS[month]} {year}</span>
      <button
        onClick={() => step(1)}
        disabled={isCurrentMonth}
        className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        aria-label="Next month"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}
