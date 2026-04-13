'use client'

import { useState } from 'react'
import { DatePickerPanel } from '@/components/search/DatePickerPanel'
import { toDateStr, getToday } from '@/lib/utils'

interface DateStepProps {
  mode: 'private' | 'shared'
  initialDate?: string
  initialGuests?: number
  onConfirm: (date: string, guests: number) => void
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
    // For shared, guest count is determined by ticket selection — pass 1 for slot fetching
    onConfirm(d, mode === 'shared' ? 1 : guests)
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
        variant="inline"
      />
    </div>
  )
}
