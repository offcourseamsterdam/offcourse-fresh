'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

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
      <div className="text-center py-4">
        <p className="text-zinc-600 mb-2">
          Your payment was received, but the booking details are taking longer than usual.
        </p>
        <p className="text-sm text-zinc-500">
          Don&apos;t worry — your confirmation email is on its way. If it doesn&apos;t arrive
          within 15 minutes, reach out to us at{' '}
          <a href="mailto:cruise@offcourseamsterdam.com" className="text-[var(--color-primary)] hover:underline">
            cruise@offcourseamsterdam.com
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="text-center py-6">
      <Loader2 className="w-7 h-7 animate-spin text-[var(--color-primary)] mx-auto mb-4" />
      <p className="text-zinc-700 font-medium mb-1">Confirming your booking…</p>
      <p className="text-sm text-zinc-500">
        Your payment was received. We&apos;re finalising the details with the bank — this
        can take up to a minute. Please don&apos;t close this page.
      </p>
    </div>
  )
}
