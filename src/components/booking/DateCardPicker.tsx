'use client'

import { useState } from 'react'
import { getToday, toDateStr } from '@/lib/utils'
import { DatePickerPanel } from '@/components/search/DatePickerPanel'

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface DateCardPickerProps {
  selectedDate: string | null
  onSelectDate: (date: string) => void
}

function buildUpcomingDates(count: number): { dateStr: string; day: number; dayName: string; month: string }[] {
  const today = getToday()
  const dates = []
  for (let i = 0; i < count; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    dates.push({
      dateStr: toDateStr(d),
      day: d.getDate(),
      dayName: SHORT_DAYS[d.getDay()],
      month: SHORT_MONTHS[d.getMonth()],
    })
  }
  return dates
}

export function DateCardPicker({ selectedDate, onSelectDate }: DateCardPickerProps) {
  const [showCalendar, setShowCalendar] = useState(false)
  const dates = buildUpcomingDates(4)

  // Calendar state for the expanded view
  const today = getToday()
  const todayStr = toDateStr(today)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const tomorrowStr = toDateStr(tomorrow)

  const [calYear, setCalYear] = useState(today.getFullYear())
  const [calMonth, setCalMonth] = useState(today.getMonth())
  const isPrevDisabled = calYear === today.getFullYear() && calMonth <= today.getMonth()

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) }
    else setCalMonth(m => m + 1)
  }

  function handleCalendarPick(d: string) {
    onSelectDate(d)
    setShowCalendar(false)
  }

  // Check if selected date is one of the 4 quick-pick cards
  const isQuickPickSelected = dates.some(d => d.dateStr === selectedDate)

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <p className="font-avenir font-semibold text-[15px] text-[var(--color-ink)]">
          Search availability by date
        </p>
        <button
          type="button"
          onClick={() => setShowCalendar(v => !v)}
          className="font-avenir text-sm font-medium text-[var(--color-primary)] hover:underline"
        >
          {showCalendar ? 'Hide calendar' : 'Show more dates'}
        </button>
      </div>

      {/* 4 date cards */}
      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
        {dates.map((d) => {
          const isSelected = selectedDate === d.dateStr
          return (
            <button
              key={d.dateStr}
              type="button"
              onClick={() => { onSelectDate(d.dateStr); setShowCalendar(false) }}
              className={`flex-shrink-0 min-w-[80px] py-3 px-4 rounded-xl text-center transition-all duration-150 ${
                isSelected
                  ? 'border-2 border-[var(--color-primary)] text-[var(--color-primary)] bg-white shadow-sm'
                  : 'border border-gray-200 text-gray-700 bg-white hover:border-gray-400'
              }`}
            >
              <div className={`text-xs font-semibold uppercase ${isSelected ? 'text-[var(--color-primary)]' : 'text-gray-500'}`}>
                {d.dayName}
              </div>
              <div className="text-2xl font-bold my-0.5">
                {d.day}
              </div>
              <div className={`text-xs font-medium ${isSelected ? 'text-[var(--color-primary)]' : 'text-gray-500'}`}>
                {d.month}
              </div>
            </button>
          )
        })}
      </div>

      {/* Selected date outside quick-pick range */}
      {selectedDate && !isQuickPickSelected && (
        <p className="font-avenir text-sm text-[var(--color-primary)] font-medium mt-2">
          Selected: {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}
        </p>
      )}

      {/* Expanded calendar */}
      {showCalendar && (
        <div className="mt-4 bg-white rounded-xl border border-gray-100 p-3">
          <DatePickerPanel
            todayStr={todayStr}
            tomorrowStr={tomorrowStr}
            date={selectedDate || ''}
            calYear={calYear}
            calMonth={calMonth}
            isPrevDisabled={isPrevDisabled}
            onPickDate={handleCalendarPick}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
            today={today}
            variant="inline"
          />
        </div>
      )}
    </div>
  )
}
