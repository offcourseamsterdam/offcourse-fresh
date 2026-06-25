'use client'

import Image from 'next/image'
import { fmtEuros, formatDate } from '@/lib/utils'
import { vatSummaryText } from '@/lib/extras/format'
import type { ExtrasCalculation } from '@/lib/extras/calculate'

interface TicketLineItem {
  label: string
  count: number
  priceCents: number
}

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
  cityTaxCents?: number
  cruiseLabel?: string
  discountAmountCents?: number
  /** Per-ticket-type breakdown for shared cruises (adult × N, child × N, etc.) */
  ticketBreakdown?: TicketLineItem[]
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
  cityTaxCents,
  cruiseLabel,
  discountAmountCents,
  ticketBreakdown,
}: BookingSummaryProps) {
  const extrasTotalCents = extrasCalculation?.extras_amount_cents ?? 0
  const grossCents = basePriceCents + extrasTotalCents + (cityTaxCents ?? 0)
  const grandTotalCents = Math.max(0, grossCents - (discountAmountCents ?? 0))

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
            <span className="font-medium text-zinc-800">{formatDate(date + 'T12:00:00')}</span>
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
          {ticketBreakdown && ticketBreakdown.length > 0 ? (
            ticketBreakdown.map(t => (
              <div key={t.label} className="flex justify-between">
                <span className="text-zinc-500">{t.label}</span>
                <span className="font-medium text-zinc-800">×{t.count}</span>
              </div>
            ))
          ) : (
            <div className="flex justify-between">
              <span className="text-zinc-500">Guests</span>
              <span className="font-medium text-zinc-800">{guestCount}</span>
            </div>
          )}
        </div>

        {/* Price breakdown */}
        <div className="border-t border-zinc-100 pt-3 space-y-1.5 text-sm">
          {ticketBreakdown && ticketBreakdown.length > 0 ? (
            ticketBreakdown.map(t => (
              <div key={t.label} className="flex justify-between text-zinc-600">
                <span>{t.label} ×{t.count}</span>
                <span>{fmtEuros(t.priceCents * t.count)}</span>
              </div>
            ))
          ) : (
            <div className="flex justify-between text-zinc-600">
              <span>{cruiseLabel || 'Cruise'}</span>
              <span>{fmtEuros(basePriceCents)}</span>
            </div>
          )}

          {extrasCalculation?.line_items.map(li => {
            const qty = li.quantity
            const label = li.is_per_person_pick && qty > 0
              ? `${li.name} — for ${qty} ${qty === 1 ? 'person' : 'people'}`
              : qty > 1
                ? `${li.name} ×${qty}`
                : li.name
            return (
              <div key={li.extra_id} className="flex justify-between text-zinc-600">
                <span>{label}</span>
                <span>{fmtEuros(li.amount_cents)}</span>
              </div>
            )
          })}

          {cityTaxCents && cityTaxCents > 0 && (
            <div className="flex justify-between text-zinc-600">
              <span>City tax</span>
              <span>{fmtEuros(cityTaxCents)}</span>
            </div>
          )}

          {discountAmountCents && discountAmountCents > 0 && (
            <div className="flex justify-between text-emerald-700 font-medium">
              <span>Prepaid</span>
              <span>−{fmtEuros(discountAmountCents)}</span>
            </div>
          )}

          <div className="border-t border-zinc-200 pt-2 mt-2">
            <div className="flex justify-between font-bold text-zinc-900">
              <span>Total</span>
              <span>{discountAmountCents && discountAmountCents >= grossCents ? 'Included' : fmtEuros(grandTotalCents)}</span>
            </div>
            <div className="text-right text-[10px] text-zinc-400 mt-0.5">
              incl. {vatSummaryText(basePriceCents, extrasCalculation)}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
