'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Check } from 'lucide-react'

interface ConfirmationStepProps {
  bookingLoading: boolean
  bookingError: string | null
  booking: unknown
  paymentIntentId: string | null
  paymentLinkUrl?: string | null
  onReset: () => void
}

export function ConfirmationStep({
  bookingLoading,
  bookingError,
  booking,
  paymentIntentId,
  paymentLinkUrl,
  onReset,
}: ConfirmationStepProps) {
  return (
    <div className="space-y-4">
      {bookingLoading && (
        <Card>
          <CardContent className="pt-6 flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
            <div>
              <p className="text-sm font-medium text-zinc-900">Payment confirmed</p>
              <p className="text-xs text-zinc-500 mt-0.5">Creating your FareHarbor booking…</p>
            </div>
          </CardContent>
        </Card>
      )}

      {bookingError && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4 text-sm text-red-700 space-y-2">
            <p className="font-semibold">Payment succeeded but booking failed</p>
            <p>{bookingError}</p>
            {paymentIntentId && (
              <p className="text-xs text-red-500">Payment Intent: {paymentIntentId} — contact support with this ID.</p>
            )}
          </CardContent>
        </Card>
      )}

      {booking !== null && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center">
                <Check className="w-3.5 h-3.5 text-white" />
              </div>
              <CardTitle className="text-sm text-emerald-900">
                {paymentLinkUrl ? 'Betaallink verstuurd!' : 'Booking confirmed!'}
              </CardTitle>
            </div>
            {paymentIntentId && (
              <CardDescription className="text-xs text-emerald-700 mt-1">
                Payment: {paymentIntentId}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {paymentLinkUrl && (
              <div className="space-y-2">
                <p className="text-xs text-emerald-700">Klant ontvangt betaallink per email. Link voor je eigen referentie:</p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={paymentLinkUrl}
                    className="flex-1 rounded border border-emerald-200 bg-white px-3 py-1.5 text-xs font-mono text-zinc-700 select-all min-w-0"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(paymentLinkUrl)}
                    className="shrink-0 px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
            {!paymentLinkUrl && (
              <pre className="text-xs bg-white border border-emerald-100 rounded-lg p-4 overflow-auto max-h-80 text-zinc-700 whitespace-pre-wrap">
                {JSON.stringify(booking, null, 2)}
              </pre>
            )}
            <Button variant="outline" size="sm" onClick={onReset}>
              Start new booking
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
