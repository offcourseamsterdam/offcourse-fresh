'use client'

import { useState } from 'react'
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { Loader2 } from 'lucide-react'
import { fmtEuros } from '@/lib/utils'
import { SESSION_BOOKING_KEY } from '@/lib/constants'
import type { BookingData } from './types'

/** Payment step — needs to render inside <Elements>. */
export function PaymentStep({
  amountCents,
  onSuccess,
  bookingData,
}: {
  amountCents: number
  onSuccess: (paymentIntentId: string) => void
  bookingData: BookingData
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setPaying(true)
    setError(null)

    // Save booking state for iDEAL redirect recovery
    sessionStorage.setItem(SESSION_BOOKING_KEY, JSON.stringify(bookingData))

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.href.split('?')[0],
      },
      redirect: 'if_required',
    })

    if (result.error) {
      setError(result.error.message ?? 'Payment failed. Please try again.')
      setPaying(false)
    } else if (result.paymentIntent?.status === 'succeeded') {
      sessionStorage.removeItem(SESSION_BOOKING_KEY)
      onSuccess(result.paymentIntent.id)
    }
  }

  return (
    <form onSubmit={handlePay} className="space-y-4">
      <h2 className="text-lg font-bold text-zinc-900">Payment</h2>
      <PaymentElement options={{ wallets: { applePay: 'auto', googlePay: 'auto' } }} />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || !elements || paying}
        className="w-full py-3.5 rounded-xl bg-[var(--color-accent)] text-white text-sm font-bold hover:bg-[var(--color-accent-dark)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {paying ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Processing...
          </span>
        ) : (
          `Confirm & Pay ${fmtEuros(amountCents)}`
        )}
      </button>

      <p className="text-[10px] text-zinc-400 text-center">
        By confirming, you agree to our cancellation policy and terms of service.
      </p>
      <p className="text-[10px] text-zinc-400 text-center">
        📄 A VAT invoice will be included in your confirmation email.
      </p>
    </form>
  )
}
