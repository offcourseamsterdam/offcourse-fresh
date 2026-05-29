'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { fmtTime, fmtPrice, ratePrice } from './helpers'
import type { Contact, Listing, Slot, Rate } from './types'

interface GuestInfoStepProps {
  contact: Contact
  onContactChange: (contact: Contact) => void
  selectedListing: Listing | null
  selectedSlot: Slot | null
  selectedRate: Rate | null
  guestCount: number
  date: string
  onBack: () => void
  onContinue: () => void
}

export function GuestInfoStep({
  contact,
  onContactChange,
  selectedListing,
  selectedSlot,
  selectedRate,
  guestCount,
  date,
  onBack,
  onContinue,
}: GuestInfoStepProps) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-700 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Guest information</CardTitle>
          <CardDescription className="text-xs">Required by FareHarbor for booking confirmation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600">Full name <span className="text-red-500">*</span></label>
              <Input value={contact.name} onChange={e => onContactChange({ ...contact, name: e.target.value })} placeholder="Jane Doe" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600">Email <span className="text-red-500">*</span></label>
              <Input type="email" value={contact.email} onChange={e => onContactChange({ ...contact, email: e.target.value })} placeholder="jane@example.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600">Phone <span className="text-red-500">*</span></label>
              <Input type="tel" value={contact.phone} onChange={e => onContactChange({ ...contact, phone: e.target.value })} placeholder="+31 6 12 34 56 78" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600">Note <span className="text-zinc-400">(optional)</span></label>
              <Input value={contact.note} onChange={e => onContactChange({ ...contact, note: e.target.value })} placeholder="Dietary requirements, celebration…" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Booking summary — base + city tax + total */}
      <Card className="bg-zinc-50 border-zinc-200">
        <CardContent className="pt-4 text-sm space-y-1.5">
          <p className="font-semibold text-zinc-900">{selectedListing?.title}</p>
          <p className="text-zinc-500">{date} · {selectedSlot && fmtTime(selectedSlot.start_at)} – {selectedSlot && fmtTime(selectedSlot.end_at)}</p>
          <p className="text-zinc-500">{selectedRate?.customer_type.singular} · {guestCount} guest{guestCount !== 1 ? 's' : ''}</p>
          {(() => {
            const baseCents = selectedRate ? ratePrice(selectedRate) : undefined
            if (baseCents === undefined) return null
            const cityTaxCents = guestCount * 260
            const totalCents = baseCents + cityTaxCents
            return (
              <div className="pt-2 mt-1 border-t border-zinc-200 space-y-1">
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Base</span>
                  <span>{fmtPrice(baseCents)}</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>City tax · €2.60 × {guestCount}</span>
                  <span>{fmtPrice(cityTaxCents)}</span>
                </div>
                <div className="flex justify-between font-semibold text-zinc-900 pt-1 border-t border-zinc-200">
                  <span>Total</span>
                  <span>{fmtPrice(totalCents)}</span>
                </div>
                <p className="text-[10px] text-zinc-400 mt-0.5">Extras added on the next step.</p>
              </div>
            )
          })()}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          disabled={!contact.name || !contact.email || !contact.phone}
          onClick={onContinue}
        >
          Continue to extras
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
