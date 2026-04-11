'use client'

import Image from 'next/image'
import { fmtEuros } from '@/lib/utils'
import { vatSummaryText } from '@/lib/extras/format'
import type { ExtrasCalculation } from '@/lib/extras/calculate'

interface BookingSummaryProps {
  listingTitle: string
  imageUrl: string | null
  category: 'private' | 'shared'
  date: string
  time: string
  boatName: string | null
  durationMinutes: number | null
  guestCount: number
  basePriceCents: number
  extrasCalculation: ExtrasCalculation | null
  cancellationPolicy?: string | null
  cruiseLabel?: string
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h} hour${h > 1 ? 's' : ''}`
  return `${h}h ${m}min`
}

export function BookingSummary({
  listingTitle,
  imageUrl,
  category,
  date,
  time,
  boatName,
  durationMinutes,
  guestCount,
  basePriceCents,
  extrasCalculation,
  cancellationPolicy,
  cruiseLabel,
}: BookingSummaryProps) {
  const extrasTotalCents = extrasCalculation?.extras_amount_cents ?? 0
  const grandTotalCents = basePriceCents + extrasTotalCents

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      {/* Boat / hero image */}
      {imageUrl && (
        <div className="relative h-36 w-full">
          <Image
            src={imageUrl}
            alt={boatName ?? listingTitle}
            fill
            className="object-cover"
            sizes="400px"
          />
        </div>
      )}

      <div className="p-5 space-y-4">
        {/* Listing title */}
        <div>
          <h3 className="font-bold text-zinc-900 text-base">{listingTitle}</h3>
          <span className="text-xs text-zinc-500 capitalize">{category} cruise</span>
        </div>

        {/* Details */}
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Date</span>
            <span className="font-medium text-zinc-800">{fmtDate(date)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Time</span>
            <span className="font-medium text-zinc-800">{time}</span>
          </div>
          {boatName && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Boat</span>
              <span className="font-medium text-zinc-800">{boatName}</span>
            </div>
          )}
          {durationMinutes && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Duration</span>
              <span className="font-medium text-zinc-800">{fmtDuration(durationMinutes)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-zinc-500">Guests</span>
            <span className="font-medium text-zinc-800">{guestCount}</span>
          </div>
        </div>

        {/* Price breakdown */}
        <div className="border-t border-zinc-100 pt-3 space-y-1.5 text-sm">
          <div className="flex justify-between text-zinc-600">
            <span>{cruiseLabel || 'Cruise'}</span>
            <span>{fmtEuros(basePriceCents)}</span>
          </div>

          {extrasCalculation?.line_items.map(li => (
            <div key={li.extra_id} className="flex justify-between text-zinc-600">
              <span>{li.name}</span>
              <span>{fmtEuros(li.amount_cents)}</span>
            </div>
          ))}

          <div className="border-t border-zinc-200 pt-2 mt-2">
            <div className="flex justify-between font-bold text-zinc-900">
              <span>Total</span>
              <span>{fmtEuros(grandTotalCents)}</span>
            </div>
            <div className="text-right text-[10px] text-zinc-400 mt-0.5">
              incl. {vatSummaryText(basePriceCents, extrasCalculation)}
            </div>
          </div>
        </div>

        {/* Cancellation policy */}
        {cancellationPolicy && (
          <div className="border-t border-zinc-100 pt-3">
            <h4 className="text-xs font-semibold text-zinc-700 mb-1">Cancellation policy</h4>
            <p className="text-xs text-zinc-500 leading-relaxed line-clamp-3">
              {cancellationPolicy}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
