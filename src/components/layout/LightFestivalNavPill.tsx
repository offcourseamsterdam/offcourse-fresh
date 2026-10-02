'use client'

import { Link, usePathname } from '@/i18n/navigation'
import { LIGHT_FESTIVAL_PAGE_PATH, showLightFestivalPill } from '@/lib/cruise/light-festival'

// Seasonal header pill: "✨ Light Festival / Starts 26 Nov" with the moving
// rainbow ring, linking to the Light Festival cruise. Hidden on that page itself
// and automatically gone after the festival's last night.
export function LightFestivalNavPill() {
  const pathname = usePathname()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date())
  if (!showLightFestivalPill(today) || pathname === LIGHT_FESTIVAL_PAGE_PATH) return null

  return (
    <Link
      href={LIGHT_FESTIVAL_PAGE_PATH}
      className="btn-festival-glow [--lf-fill:#14143e] flex flex-col justify-center flex-shrink-0 min-h-[44px] px-2.5 sm:px-4 rounded-full leading-tight"
      aria-label="Amsterdam Light Festival cruise, starts 26 November"
    >
      <span className="lf-pill-title font-avenir font-bold text-xs sm:text-sm whitespace-nowrap">
        <span aria-hidden="true">✨ </span>Light Festival
      </span>
      <span className="font-avenir text-[10px] sm:text-[11px] text-white/85 whitespace-nowrap"><span className="hidden sm:inline">Starts </span>26 Nov</span>
    </Link>
  )
}
