'use client'

import { useState } from 'react'
import { CalendarDays } from 'lucide-react'

export interface DateRange {
  from: string  // YYYY-MM-DD
  to: string    // YYYY-MM-DD
}

interface DateRangePickerProps {
  value: DateRange
  onChange: (range: DateRange) => void
  className?: string
}

const PRESETS = [
  { label: '7d',  days: 7  },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '60d', days: 60 },
  { label: '90d', days: 90 },
] as const

/** Today as YYYY-MM-DD (local clock) */
function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** N days before `base` as YYYY-MM-DD (counts from base, so 6 days back = 7-day window) */
function daysBack(days: number, base: string): string {
  const d = new Date(`${base}T00:00:00`)
  d.setDate(d.getDate() - (days - 1))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function presetRange(days: number): DateRange {
  const to = today()
  return { from: daysBack(days, to), to }
}

function isPresetActive(value: DateRange, days: number): boolean {
  const p = presetRange(days)
  return value.from === p.from && value.to === p.to
}

export function DateRangePicker({ value, onChange, className = '' }: DateRangePickerProps) {
  const [showCustom, setShowCustom] = useState(false)

  function applyPreset(days: number) {
    onChange(presetRange(days))
    setShowCustom(false)
  }

  const activePreset = PRESETS.find(p => isPresetActive(value, p.days))
  const isCustomActive = !activePreset

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {PRESETS.map(p => (
        <button
          key={p.days}
          onClick={() => applyPreset(p.days)}
          className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
            isPresetActive(value, p.days)
              ? 'bg-[var(--color-primary)] text-white'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
          }`}
        >
          {p.label}
        </button>
      ))}
      <button
        onClick={() => setShowCustom(s => !s)}
        className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
          isCustomActive || showCustom
            ? 'bg-zinc-800 text-white'
            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
        }`}
      >
        <CalendarDays className="w-3 h-3" />
        {isCustomActive && !showCustom
          ? `${value.from} → ${value.to}`
          : 'Custom'}
      </button>

      {showCustom && (
        <div className="flex items-center gap-1.5 basis-full mt-1">
          <input
            type="date"
            value={value.from}
            max={value.to}
            onChange={e => onChange({ ...value, from: e.target.value })}
            className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 text-zinc-700 bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
          <span className="text-xs text-zinc-400">→</span>
          <input
            type="date"
            value={value.to}
            min={value.from}
            max={today()}
            onChange={e => onChange({ ...value, to: e.target.value })}
            className="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 text-zinc-700 bg-white focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
        </div>
      )}
    </div>
  )
}
