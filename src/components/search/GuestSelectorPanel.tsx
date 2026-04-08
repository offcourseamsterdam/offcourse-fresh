export interface GuestSelectorPanelProps {
  guests: number
  date: string
  loading: boolean
  onSetGuests: (updater: (prev: number) => number) => void
  onSubmit: (e?: React.MouseEvent) => void
}

export function GuestSelectorPanel({
  guests,
  date,
  loading,
  onSetGuests,
  onSubmit,
}: GuestSelectorPanelProps) {
  return (
    <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-gray-100 p-4 sm:p-5 z-50 w-full sm:w-64">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-avenir font-bold text-sm text-gray-900">Guests</div>
          <div className="font-avenir text-xs text-gray-400 mt-0.5">Max 12 per boat</div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => onSetGuests(g => Math.max(1, g - 1))} disabled={guests <= 1}
            className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 text-lg leading-none font-bold hover:border-gray-500 disabled:opacity-25 transition-all">
            −
          </button>
          <span className="font-avenir font-bold text-base w-5 text-center text-primary">{guests}</span>
          <button type="button" onClick={() => onSetGuests(g => Math.min(12, g + 1))} disabled={guests >= 12}
            className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 text-lg leading-none font-bold hover:border-gray-500 disabled:opacity-25 transition-all">
            +
          </button>
        </div>
      </div>
      {date && (
        <button type="button" onClick={onSubmit} disabled={loading}
          className="mt-4 w-full py-2.5 rounded-full bg-[#CC0000] hover:bg-[#aa0000] text-white font-avenir font-bold text-sm transition-all disabled:opacity-40">
          {loading ? 'Searching\u2026' : 'Search'}
        </button>
      )}
    </div>
  )
}
