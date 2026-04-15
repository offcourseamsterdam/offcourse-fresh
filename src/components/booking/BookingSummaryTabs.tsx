'use client'

interface Tab {
  label: string
  panelIndex: number
}

interface BookingSummaryTabsProps {
  tabs: Tab[]
  currentPanel: number
  onTabClick: (panelIndex: number) => void
}

export function BookingSummaryTabs({ tabs, currentPanel, onTabClick }: BookingSummaryTabsProps) {
  if (tabs.length === 0) return null

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 mb-4">
      {tabs.map((tab) => (
        <button
          key={tab.label}
          type="button"
          onClick={() => onTabClick(tab.panelIndex)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
            tab.panelIndex === currentPanel
              ? 'border-2 border-[var(--color-primary)] text-[var(--color-primary)] bg-white'
              : 'border border-gray-200 text-[var(--color-ink)] bg-white hover:border-gray-400 cursor-pointer'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
