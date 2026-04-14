'use client'

import { useState, FormEvent } from 'react'
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { Button } from '@/components/ui/button'
import { Loader2, ChevronRight } from 'lucide-react'
import { fmtPrice } from './helpers'
import type { PendingBooking } from './types'

interface PaymentFormProps {
  amountCents: number
  onSuccess: (paymentIntentId: string) => void
  bookingPayload: Omit<PendingBooking, 'paymentIntentId'>
}

export function PaymentForm({ amountCents, onSuccess, bookingPayload }: PaymentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePay(e: FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setPaying(true)
    setError(null)

    // Save booking state to sessionStorage BEFORE confirmPayment.
    // If the payment method requires a full-page redirect (iDEAL, Bancontact etc.),
    // the page will reload and we restore this state from the URL params + sessionStorage.
    sessionStorage.setItem('pendingBooking', JSON.stringify(bookingPayload))

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Stripe appends ?payment_intent=pi_xxx&redirect_status=succeeded on return
        return_url: window.location.href.split('?')[0],
      },
      redirect: 'if_required', // stays on-page for cards, Apple Pay, Google Pay, 3DS modal
    })

    if (result.error) {
      // Payment failed or was cancelled — clear sessionStorage, show error
      sessionStorage.removeItem('pendingBooking')
      setError(result.error.message ?? 'Payment failed. Please try again.')
      setPaying(false)
    } else if (result.paymentIntent?.status === 'succeeded') {
      // On-page success (cards, Apple Pay, Google Pay, 3DS)
      sessionStorage.removeItem('pendingBooking')
      onSuccess(result.paymentIntent.id)
    }
    // If redirect happened: this code never runs — page is gone.
    // The useEffect in the parent handles restoration on return.
  }

  return (
    <form onSubmit={handlePay} className="space-y-4">
      <PaymentElement options={{ wallets: { applePay: 'auto', googlePay: 'auto' } }} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={!stripe || !elements || paying} className="bg-zinc-900 hover:bg-zinc-700 min-w-32">
          {paying ? (
            <><Loader2 className="w-4 h-4 animate-spin mr-2" />Processing…</>
          ) : (
            <>Pay {fmtPrice(amountCents)}<ChevronRight className="w-4 h-4 ml-1" /></>
          )}
        </Button>
      </div>
    </form>
  )
}
