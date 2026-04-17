'use client'

import { useState } from 'react'

export type PeriodKey = '7d' | '30d' | '90d' | 'custom'

interface PeriodSelectorProps {
  value: PeriodKey
  onChange: (period: PeriodKey, from: string, to: string) => void
}

function getDateRange(period: PeriodKey): { from: string; to: string } {
  const to = new Date()
  const from = new Date()

  switch (period) {
    case '7d':
      from.setDate(from.getDate() - 7)
      break
    case '30d':
      from.setDate(from.getDate() - 30)
      break
    case '90d':
      from.setDate(from.getDate() - 90)
      break
    default:
      from.setDate(from.getDate() - 30)
  }

  return { from: from.toISOString(), to: to.toISOString() }
}

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
]

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          onClick={() => {
            const range = getDateRange(p.key)
            onChange(p.key, range.from, range.to)
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            value === p.key
              ? 'bg-zinc-900 text-white'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
          }`}
        >
          {p.label}
        </button>
      ))}

      {value === 'custom' ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => {
              setCustomFrom(e.target.value)
              if (customTo) onChange('custom', new Date(e.target.value).toISOString(), new Date(customTo).toISOString())
            }}
            className="px-2 py-1 rounded-lg border border-zinc-200 text-xs text-zinc-600"
          />
          <span className="text-xs text-zinc-400">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => {
              setCustomTo(e.target.value)
              if (customFrom) onChange('custom', new Date(customFrom).toISOString(), new Date(e.target.value).toISOString())
            }}
            className="px-2 py-1 rounded-lg border border-zinc-200 text-xs text-zinc-600"
          />
        </div>
      ) : (
        <button
          onClick={() => {
            const range = getDateRange('30d')
            setCustomFrom(range.from.slice(0, 10))
            setCustomTo(range.to.slice(0, 10))
            onChange('custom', range.from, range.to)
          }}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-colors"
        >
          Custom
        </button>
      )}
    </div>
  )
}

export { getDateRange }
