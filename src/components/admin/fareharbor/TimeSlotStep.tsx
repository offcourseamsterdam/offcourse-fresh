'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { fmtTime, fmtPrice, ratePrice } from './helpers'
import type { Listing, Slot, Rate } from './types'

interface TimeSlotStepProps {
  listing: Listing
  date: string
  selectedSlot: Slot | null
  selectedRate: Rate | null
  guestCount: number
  onBack: () => void
  onPickSlot: (slot: Slot) => void
  onPickRate: (rate: Rate) => void
  onGuestCountChange: (count: number) => void
  onContinue: () => void
}

export function TimeSlotStep({
  listing,
  date,
  selectedSlot,
  selectedRate,
  guestCount,
  onBack,
  onPickSlot,
  onPickRate,
  onGuestCountChange,
  onContinue,
}: TimeSlotStepProps) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-700 transition-colors mb-2">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to listings
      </button>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{listing.title}</CardTitle>
          {listing.tagline && (
            <CardDescription className="text-xs">{listing.tagline}</CardDescription>
          )}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Pick a time slot</CardTitle>
        </CardHeader>
        <CardContent>
          {listing.slots.length === 0 ? (
            <p className="text-sm text-zinc-400 italic">No slots available on {date}</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {listing.slots.map(slot => (
                <button
                  key={slot.pk}
                  onClick={() => onPickSlot(slot)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    selectedSlot?.pk === slot.pk
                      ? 'border-zinc-900 bg-zinc-900 text-white'
                      : 'border-zinc-200 bg-white hover:border-zinc-400'
                  }`}
                >
                  <p className="text-sm font-medium">{fmtTime(slot.start_at)}</p>
                  <p className={`text-xs mt-0.5 ${selectedSlot?.pk === slot.pk ? 'text-zinc-300' : 'text-zinc-400'}`}>
                    → {fmtTime(slot.end_at)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedSlot && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Pick a duration & boat</CardTitle>
            <CardDescription className="text-xs">Each option is a different boat + duration combo</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {selectedSlot.customer_type_rates.map(rate => {
                const price = ratePrice(rate)
                return (
                  <button
                    key={rate.pk}
                    onClick={() => onPickRate(rate)}
                    className={`w-full flex items-center justify-between p-4 rounded-lg border text-left transition-all ${
                      selectedRate?.pk === rate.pk
                        ? 'border-zinc-900 bg-zinc-900 text-white'
                        : 'border-zinc-200 bg-white hover:border-zinc-400'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium">{rate.customer_type.singular}</p>
                      <p className="text-xs mt-0.5 text-zinc-400">
                        Rate PK {rate.pk} · capacity {rate.capacity}
                      </p>
                    </div>
                    {price !== undefined && (
                      <p className={`text-sm font-semibold ${selectedRate?.pk === rate.pk ? 'text-white' : 'text-zinc-900'}`}>
                        {fmtPrice(price)}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>

            {selectedRate && (
              <div className="pt-2 flex items-center gap-4">
                <label className="text-sm font-medium text-zinc-700">Number of guests</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onGuestCountChange(Math.max(1, guestCount - 1))}
                    className="w-8 h-8 rounded-full border border-zinc-200 text-zinc-600 hover:bg-zinc-100 transition-colors text-sm font-bold"
                  >−</button>
                  <span className="w-6 text-center text-sm font-semibold">{guestCount}</span>
                  <button
                    onClick={() => onGuestCountChange(Math.min(12, guestCount + 1))}
                    className="w-8 h-8 rounded-full border border-zinc-200 text-zinc-600 hover:bg-zinc-100 transition-colors text-sm font-bold"
                  >+</button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button disabled={!selectedSlot || !selectedRate} onClick={onContinue}>
          Continue to guest info
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
