const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function buildCalendarCells(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = Array(firstDay).fill(null)
  for (let i = 1; i <= daysInMonth; i++) cells.push(i)
  return cells
}

export interface DatePickerPanelProps {
  todayStr: string
  tomorrowStr: string
  date: string
  calYear: number
  calMonth: number
  isPrevDisabled: boolean
  onPickDate: (dateStr: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
  today: Date
}

export function DatePickerPanel({
  todayStr,
  tomorrowStr,
  date,
  calYear,
  calMonth,
  isPrevDisabled,
  onPickDate,
  onPrevMonth,
  onNextMonth,
  today,
}: DatePickerPanelProps) {
  const cells = buildCalendarCells(calYear, calMonth)

  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-gray-100 p-4 sm:p-5 z-50 w-full sm:w-[320px]">
      {/* Today / Tomorrow */}
      <div className="flex gap-2 mb-4 sm:mb-5">
        {[{ label: 'Today', value: todayStr }, { label: 'Tomorrow', value: tomorrowStr }].map(({ label, value }) => (
          <button
            key={label}
            type="button"
            onClick={() => onPickDate(value)}
            className={`flex-1 py-2 rounded-full text-sm font-avenir font-semibold border transition-all duration-150
              ${date === value
                ? 'bg-primary text-white border-primary'
                : 'border-gray-200 text-gray-700 hover:border-primary hover:text-primary'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={onPrevMonth} disabled={isPrevDisabled}
          className="p-1.5 rounded-full hover:bg-gray-100 disabled:opacity-25 transition-colors">
          <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M15 18l-6-6 6-6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="font-avenir font-bold text-sm text-gray-900">
          {MONTH_NAMES[calMonth]} {calYear}
        </span>
        <button type="button" onClick={onNextMonth}
          className="p-1.5 rounded-full hover:bg-gray-100 transition-colors">
          <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M9 18l6-6-6-6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_INITIALS.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-avenir font-bold uppercase tracking-wider text-gray-400 py-1">{d}</div>
        ))}
      </div>

      {/* Days */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const m = String(calMonth + 1).padStart(2, '0')
          const dd = String(day).padStart(2, '0')
          const cellStr = `${calYear}-${m}-${dd}`
          const cellDate = new Date(calYear, calMonth, day)
          const isPast = cellDate < today
          const isSelected = cellStr === date
          const isToday = cellStr === todayStr
          return (
            <button key={i} type="button" disabled={isPast} onClick={() => onPickDate(cellStr)}
              className={`aspect-square flex items-center justify-center mx-0.5 rounded-full text-sm font-avenir font-medium transition-all duration-100
                ${isPast ? 'text-gray-300 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-100'}
                ${isSelected ? '!bg-primary text-white hover:!bg-primary-dark' : ''}
                ${isToday && !isSelected ? 'font-bold text-[#CC0000]' : ''}`}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}
