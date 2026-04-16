'use client'

export type CategoryFilter = 'all' | 'private' | 'shared'

interface CategoryTabsProps {
  value: CategoryFilter
  onChange: (category: CategoryFilter) => void
}

const TABS: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'private', label: 'Private' },
  { key: 'shared', label: 'Shared' },
]

export function CategoryTabs({ value, onChange }: CategoryTabsProps) {
  return (
    <div className="flex rounded-lg border border-zinc-200 overflow-hidden">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            value === tab.key
              ? 'bg-zinc-900 text-white'
              : 'bg-white text-zinc-500 hover:bg-zinc-50'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
