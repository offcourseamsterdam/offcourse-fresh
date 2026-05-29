'use client'

import { BOOKING_SOURCES } from '@/lib/constants'

const COLOR_MAP: Record<string, string> = {
  complimentary: 'bg-purple-100 text-purple-700',
  withlocals: 'bg-blue-100 text-blue-700',
  clickandboat: 'bg-sky-100 text-sky-700',
  getyourguide: 'bg-orange-100 text-orange-700',
  tripadvisor: 'bg-green-100 text-green-700',
  stripe_recovery: 'bg-amber-100 text-amber-700',
}

interface Props {
  source: string | null
  /** When true, returns null for website bookings (detail row style).
   *  When false (default), returns "Regular" label (table cell style). */
  hideIfWebsite?: boolean
}

export function BookingSourceBadge({ source, hideIfWebsite = false }: Props) {
  const isInternal = source && source !== 'website'
  if (!isInternal) {
    return hideIfWebsite
      ? null
      : <span className="text-xs text-zinc-400">Direct</span>
  }
  const label = BOOKING_SOURCES.find(s => s.value === source)?.label ?? source
  const color = COLOR_MAP[source] ?? 'bg-zinc-100 text-zinc-600'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  )
}
