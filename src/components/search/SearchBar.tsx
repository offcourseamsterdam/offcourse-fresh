'use client'

import { useState, useRef, useEffect } from 'react'
import { DatePickerPanel } from './DatePickerPanel'
import { GuestSelectorPanel } from './GuestSelectorPanel'

interface SearchBarProps {
  onSearch: (date: string, guests: number) => void
  initialDate?: string
  initialGuests?: number
  loading?: boolean
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

function formatDisplay(dateStr: string): string {
  if (!dateStr) return ''
  const today = getToday()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const [y, m, day] = dateStr.split('-').map(Number)
  const d = new Date(y, m - 1, day)
  const longDate = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  if (d.getTime() === today.getTime()) return `Today, ${longDate}`
  if (d.getTime() === tomorrow.getTime()) return `Tomorrow, ${longDate}`
  return longDate
}

export function SearchBar({
  onSearch,
  initialDate = '',
  initialGuests = 2,
  loading = false,
}: SearchBarProps) {
  const today = getToday()
  const todayStr = toDateStr(today)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const tomorrowStr = toDateStr(tomorrow)

  const [date, setDate] = useState(initialDate)
  const [guests, setGuests] = useState(initialGuests)
  const [panel, setPanel] = useState<'date' | 'guests' | null>(null)
  const [hovered, setHovered] = useState<'date' | 'guests' | null>(null)
  const [calYear, setCalYear] = useState(today.getFullYear())
  const [calMonth, setCalMonth] = useState(today.getMonth())

  const rootRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setPanel(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Close on scroll
  useEffect(() => {
    function onScroll() { setPanel(null) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function pickDate(d: string) {
    setDate(d)
    setPanel('guests')
  }

  function handleSubmit(e?: React.FormEvent | React.MouseEvent) {
    e?.preventDefault()
    if (!date) return
    setPanel(null)
    onSearch(date, guests)
  }

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) }
    else setCalMonth(m => m + 1)
  }

  const isPrevDisabled = calYear === today.getFullYear() && calMonth <= today.getMonth()
  const displayDate = formatDisplay(date)
  const guestLabel = `${guests} ${guests === 1 ? 'guest' : 'guests'}`

  const datePanelProps = {
    todayStr, tomorrowStr, date, calYear, calMonth, isPrevDisabled, today,
    onPickDate: pickDate, onPrevMonth: prevMonth, onNextMonth: nextMonth,
  }

  const guestsPanelProps = {
    guests, date, loading,
    onSetGuests: setGuests, onSubmit: handleSubmit,
  }

  return (
    <div ref={rootRef} className="relative w-full mx-auto z-[200]">

      {/* -- MOBILE layout: stacked card -- */}
      <form onSubmit={handleSubmit} className="sm:hidden flex flex-col bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">

        {/* When row */}
        <button type="button" onClick={() => setPanel(panel === 'date' ? null : 'date')}
          className={`flex items-center justify-between px-5 py-4 text-left transition-all ${panel === 'date' ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
          <div>
            <div className="text-[10px] font-avenir font-bold uppercase tracking-widest text-gray-400 leading-none">When</div>
            <div className={`font-avenir text-sm font-semibold mt-1 leading-none ${date ? 'text-primary' : 'text-gray-400'}`}>
              {displayDate || 'Add a date'}
            </div>
          </div>
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${panel === 'date' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M19 9l-7 7-7-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Date panel inline on mobile */}
        {panel === 'date' && (
          <div className="border-t border-gray-100 p-4">
            <DatePickerPanel {...datePanelProps} />
          </div>
        )}

        <div className="h-px bg-gray-100" />

        {/* Who row */}
        <button type="button" onClick={() => setPanel(panel === 'guests' ? null : 'guests')}
          className={`flex items-center justify-between px-5 py-4 text-left transition-all ${panel === 'guests' ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
          <div>
            <div className="text-[10px] font-avenir font-bold uppercase tracking-widest text-gray-400 leading-none">Who</div>
            <div className="font-avenir text-sm font-semibold mt-1 leading-none text-primary">{guestLabel}</div>
          </div>
          <svg className={`w-4 h-4 text-gray-400 transition-transform ${panel === 'guests' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M19 9l-7 7-7-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Guests panel inline on mobile */}
        {panel === 'guests' && (
          <div className="border-t border-gray-100 p-4">
            <GuestSelectorPanel {...guestsPanelProps} />
          </div>
        )}

        <div className="p-3 pt-2">
          <button type="submit" disabled={!date || loading}
            className="w-full flex items-center justify-center gap-2 bg-[#CC0000] hover:bg-[#aa0000] text-white rounded-xl py-3 font-avenir font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" strokeWidth="2.5" />
              <path d="m21 21-4.35-4.35" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            {loading ? 'Searching\u2026' : 'Search'}
          </button>
        </div>
      </form>

      {/* -- DESKTOP layout: horizontal pill -- */}
      <form onSubmit={handleSubmit}
        className="hidden sm:flex items-stretch bg-white rounded-full shadow-2xl border border-gray-100">

        {/* When */}
        <button type="button"
          onClick={() => setPanel(panel === 'date' ? null : 'date')}
          onMouseEnter={() => setHovered('date')}
          onMouseLeave={() => setHovered(null)}
          className={`flex-1 px-5 py-3 text-left rounded-full transition-all duration-150
            ${panel === 'date' ? 'bg-white shadow-lg ring-2 ring-black/10 z-10' : 'hover:bg-gray-50'}`}>
          <div className="text-[10px] font-avenir font-bold uppercase tracking-widest text-gray-400 leading-none">When</div>
          <div className={`font-avenir text-sm font-semibold mt-1 leading-none truncate ${date ? 'text-primary' : 'text-gray-400'}`}>
            {displayDate || 'Add a date'}
          </div>
        </button>

        <div className={`w-px my-3 shrink-0 transition-colors duration-150
          ${hovered || panel ? 'bg-transparent' : 'bg-gray-200'}`} />

        {/* Who */}
        <button type="button"
          onClick={() => setPanel(panel === 'guests' ? null : 'guests')}
          onMouseEnter={() => setHovered('guests')}
          onMouseLeave={() => setHovered(null)}
          className={`px-5 py-3 text-left rounded-full transition-all duration-150
            ${panel === 'guests' ? 'bg-white shadow-lg ring-2 ring-black/10 z-10' : 'hover:bg-gray-50'}`}>
          <div className="text-[10px] font-avenir font-bold uppercase tracking-widest text-gray-400 leading-none">Who</div>
          <div className="font-avenir text-sm font-semibold mt-1 leading-none text-primary">{guestLabel}</div>
        </button>

        {/* Search */}
        <div className="flex items-center p-1.5 pl-2">
          <button type="submit" disabled={!date || loading}
            className="flex items-center gap-2 rounded-full px-5 py-2.5 bg-[#CC0000] hover:bg-[#aa0000] active:bg-[#880000] text-white font-avenir font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md">
            {loading
              ? <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8" strokeWidth="2.5" />
                  <path d="m21 21-4.35-4.35" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
            }
            Search
          </button>
        </div>
      </form>

      {/* -- Desktop dropdown panels -- */}
      {panel === 'date' && (
        <div className="hidden sm:block absolute top-[calc(100%+10px)] left-0 z-[9999]">
          <DatePickerPanel {...datePanelProps} />
        </div>
      )}
      {panel === 'guests' && (
        <div className="hidden sm:block absolute top-[calc(100%+10px)] right-0 z-[9999]">
          <GuestSelectorPanel {...guestsPanelProps} />
        </div>
      )}

    </div>
  )
}
