'use client'

export type CruiseTypeFilter = 'all' | 'private' | 'shared'

const CHIPS: { key: CruiseTypeFilter; label: string }[] = [
  { key: 'all',     label: 'All' },
  { key: 'private', label: 'Private 🚤' },
  { key: 'shared',  label: 'Shared 🎟️' },
]

interface TypeChipsProps {
  active: CruiseTypeFilter
  onChange: (type: CruiseTypeFilter) => void
}

export function TypeChips({ active, onChange }: TypeChipsProps) {
  return (
    <div className="flex gap-1.5">
      {CHIPS.map(chip => (
        <button
          key={chip.key}
          onClick={() => onChange(chip.key)}
          className={`px-3 py-1 rounded-full text-xs font-avenir font-medium
            transition-all duration-200
            ${active === chip.key
              ? 'bg-white/90 text-primary shadow-sm'
              : 'bg-white/20 text-white/80 hover:bg-white/40'}`}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}
