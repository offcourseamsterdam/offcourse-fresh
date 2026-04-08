'use client'

import { useState } from 'react'
import { DatePickerPanel } from '@/components/search/DatePickerPanel'
import { Minus, Plus } from 'lucide-react'

interface DateStepProps {
  mode: 'private' | 'shared'
  initialDate?: string
  initialGuests?: number
  onConfirm: (date: string, guests: number) => void
}

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function DateStep({ mode, initialDate = '', initialGuests = 2, onConfirm }: DateStepProps) {
  const today = getToday()
  const todayStr = toDateStr(today)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const tomorrowStr = toDateStr(tomorrow)

  const [date, setDate] = useState(initialDate)
  const [guests, setGuests] = useState(initialGuests)
  const [calYear, setCalYear] = useState(initialDate ? Number(initialDate.split('-')[0]) : today.getFullYear())
  const [calMonth, setCalMonth] = useState(initialDate ? Number(initialDate.split('-')[1]) - 1 : today.getMonth())

  const isPrevDisabled = calYear === today.getFullYear() && calMonth <= today.getMonth()

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) }
    else setCalMonth(m => m + 1)
  }

  function handlePickDate(d: string) {
    setDate(d)
    // For private tours, confirm immediately (no guest count needed)
    if (mode === 'private') {
      onConfirm(d, guests)
    }
  }

  function handleConfirmShared() {
    if (date) {
      onConfirm(date, guests)
    }
  }

  return (
    <div className="space-y-4">
      <DatePickerPanel
        todayStr={todayStr}
        tomorrowStr={tomorrowStr}
        date={date}
        calYear={calYear}
        calMonth={calMonth}
        isPrevDisabled={isPrevDisabled}
        onPickDate={handlePickDate}
        onPrevMonth={prevMonth}
        onNextMonth={nextMonth}
        today={today}
      />

      {/* Guest counter — shared tours only */}
      {mode === 'shared' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-zinc-800">Guests</div>
              <div className="text-xs text-zinc-500">How many tickets?</div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setGuests(g => Math.max(1, g - 1))}
                disabled={guests <= 1}
                className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="w-6 text-center font-semibold text-zinc-800 tabular-nums">{guests}</span>
              <button
                type="button"
                onClick={() => setGuests(g => Math.min(12, g + 1))}
                disabled={guests >= 12}
                className="w-8 h-8 rounded-full border border-zinc-300 flex items-center justify-center text-zinc-600 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {date && (
            <button
              type="button"
              onClick={handleConfirmShared}
              className="w-full py-2.5 rounded-xl bg-[var(--color-primary)] text-white text-sm font-semibold hover:bg-[var(--color-primary-dark)] transition-colors"
            >
              Check availability
            </button>
          )}
        </div>
      )}
    </div>
  )
}
