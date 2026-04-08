'use client'

import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ArrowLeft } from 'lucide-react'
import { fmtTime, fmtPrice, ratePrice } from './helpers'
import { PaymentForm } from './PaymentForm'
import type { Listing, Slot, Rate, Contact, PendingBooking } from './types'
import type { ExtrasCalculation } from '@/lib/extras/calculate'

// Load Stripe once at module level (not inside the component)
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

interface PaymentStepProps {
  clientSecret: string
  selectedListing: Listing
  selectedSlot: Slot
  selectedRate: Rate
  guestCount: number
  date: string
  contact: Contact
  grandTotalCents: number | null
  extrasStep: { selectedExtraIds: string[]; calculation: ExtrasCalculation } | null
  onBack: () => void
  onPaymentSuccess: (paymentIntentId: string) => void
}

export function PaymentStep({
  clientSecret,
  selectedListing,
  selectedSlot,
  selectedRate,
  guestCount,
  date,
  contact,
  grandTotalCents,
  extrasStep,
  onBack,
  onPaymentSuccess,
}: PaymentStepProps) {
  const bookingPayload: Omit<PendingBooking, 'paymentIntentId'> = {
    availPk: selectedSlot.pk,
    customerTypeRatePk: selectedRate.pk,
    guestCount,
    category: selectedListing.category,
    contact,
    selectedListing,
    selectedSlot,
    selectedRate,
    date,
    selectedExtraIds: extrasStep?.selectedExtraIds ?? [],
    extrasCalculation: extrasStep?.calculation ?? null,
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-700 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </button>

      {/* Compact summary */}
      <Card className="bg-zinc-50 border-zinc-200">
        <CardContent className="pt-4 text-sm flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-zinc-900">{selectedListing.title}</p>
            <p className="text-zinc-500 text-xs mt-0.5">{date} · {fmtTime(selectedSlot.start_at)} – {fmtTime(selectedSlot.end_at)} · {guestCount} guest{guestCount !== 1 ? 's' : ''}</p>
          </div>
          {grandTotalCents !== null ? (
            <p className="text-lg font-bold text-zinc-900 flex-shrink-0">{fmtPrice(grandTotalCents)}</p>
          ) : ratePrice(selectedRate) !== undefined && (
            <p className="text-lg font-bold text-zinc-900 flex-shrink-0">{fmtPrice(ratePrice(selectedRate)!)}</p>
          )}
        </CardContent>
      </Card>

      {/* Stripe Payment Element */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Payment</CardTitle>
          <CardDescription className="text-xs">Secured by Stripe — cards, Apple Pay, Google Pay accepted</CardDescription>
        </CardHeader>
        <CardContent>
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: 'stripe',
                variables: {
                  colorPrimary: '#18181b', // zinc-900
                  borderRadius: '8px',
                  fontFamily: 'inherit',
                },
              },
            }}
          >
            <PaymentForm
              amountCents={grandTotalCents ?? ratePrice(selectedRate)!}
              onSuccess={onPaymentSuccess}
              bookingPayload={bookingPayload}
            />
          </Elements>
        </CardContent>
      </Card>
    </div>
  )
}
