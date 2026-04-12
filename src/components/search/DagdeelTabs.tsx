'use client'

import type { Dagdeel } from '@/lib/search/dagdeel'

const TABS: { key: Dagdeel; label: string; icon: string }[] = [
  { key: 'all',       label: 'All',       icon: '✦' },
  { key: 'morning',   label: 'Morning',   icon: '☕' },
  { key: 'afternoon', label: 'Afternoon', icon: '☀️' },
  { key: 'evening',   label: 'Evening',   icon: '🌅' },
]

interface DagdeelTabsProps {
  active: Dagdeel
  onChange: (tab: Dagdeel) => void
}

export function DagdeelTabs({ active, onChange }: DagdeelTabsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {TABS.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-avenir font-semibold
            whitespace-nowrap transition-all duration-200
            ${active === tab.key
              ? 'bg-white text-primary shadow-md'
              : 'bg-white/30 text-white/90 hover:bg-white/50'}`}
        >
          <span>{tab.icon}</span>
          {tab.label}
        </button>
      ))}
    </div>
  )
}
