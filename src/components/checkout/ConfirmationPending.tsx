'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail } from 'lucide-react'
import { BookingProgressSteps } from './BookingProgressSteps'

/**
 * Shown on the confirmation page when the booking row isn't in the database
 * yet. With iDEAL the customer often arrives here seconds before the Stripe
 * webhook finishes creating the booking — so instead of "not found", poll for
 * up to a minute and refresh the page once the booking appears.
 */
export function ConfirmationPending({ paymentIntent }: { paymentIntent: string }) {
  const router = useRouter()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    const POLL_INTERVAL_MS = 2500
    const MAX_ATTEMPTS = 24 // ~60 seconds total

    async function poll() {
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !cancelled; attempt++) {
        try {
          const res = await fetch(
            `/api/booking-flow/confirmation-status?payment_intent=${encodeURIComponent(paymentIntent)}`,
          )
          const json = await res.json()
          if (json.ok && json.data?.found) {
            // Booking exists now — re-render the server page with full details.
            router.refresh()
            return
          }
        } catch {
          // Network blip — keep polling.
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
      }
      if (!cancelled) setTimedOut(true)
    }

    poll()
    return () => { cancelled = true }
  }, [paymentIntent, router])

  if (timedOut) {
    return (
      <div className="space-y-4">
        <BookingProgressSteps stage="pending" />
        <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
          <Mail className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" />
          <div>
            <p className="text-sm font-medium text-blue-900">
              Your payment is safe — no need to pay again
            </p>
            <p className="mt-0.5 text-xs text-blue-700">
              The booking is taking a little longer than usual to finalise. As soon as it&apos;s
              confirmed we&apos;ll email you the details — and if anything is wrong with the
              payment, we&apos;ll email you about that too. Nothing more to do on your side.
              Still nothing after 15 minutes? Reach us at{' '}
              <a href="mailto:cruise@offcourseamsterdam.com" className="underline hover:text-blue-900">
                cruise@offcourseamsterdam.com
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <BookingProgressSteps stage="pending" />
      <p className="text-center text-xs text-zinc-500">
        Your payment went through — you&apos;re all paid. We&apos;re just reserving your boat now.
        Please keep this page open; it updates automatically.
      </p>
    </div>
  )
}
