'use client'

interface StickyBookBarProps {
  priceDisplay: string | null
  durationDisplay: string | null
  maxGuests: number | null
}

export function StickyBookBar({ priceDisplay, durationDisplay, maxGuests }: StickyBookBarProps) {
  function scrollToBooking() {
    const el = document.getElementById('booking-panel')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 lg:hidden">
      <div className="bg-white/95 backdrop-blur-md border-t border-zinc-200 shadow-[0_-2px_12px_rgba(0,0,0,0.08)] px-4 py-3">
        <div className="flex items-center justify-between gap-3 max-w-lg mx-auto">
          {/* Info */}
          <div className="flex-1 min-w-0">
            {priceDisplay && (
              <p className="font-bold text-[var(--color-primary)] text-base leading-tight">
                {priceDisplay}
              </p>
            )}
            <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
              {durationDisplay && <span>{durationDisplay}</span>}
              {durationDisplay && maxGuests && <span>·</span>}
              {maxGuests && <span>max {maxGuests} guests</span>}
            </div>
          </div>

          {/* Book button */}
          <button
            onClick={scrollToBooking}
            className="flex-shrink-0 bg-teal-600 hover:bg-teal-700 text-white font-palmore text-sm px-6 py-2.5 rounded-full transition-colors"
          >
            Book
          </button>
        </div>
      </div>
    </div>
  )
}
