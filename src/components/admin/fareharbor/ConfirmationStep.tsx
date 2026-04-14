'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, Check } from 'lucide-react'

interface ConfirmationStepProps {
  bookingLoading: boolean
  bookingError: string | null
  booking: unknown
  paymentIntentId: string | null
  onReset: () => void
}

export function ConfirmationStep({
  bookingLoading,
  bookingError,
  booking,
  paymentIntentId,
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
              <CardTitle className="text-sm text-emerald-900">Booking confirmed!</CardTitle>
            </div>
            {paymentIntentId && (
              <CardDescription className="text-xs text-emerald-700 mt-1">
                Payment: {paymentIntentId}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-white border border-emerald-100 rounded-lg p-4 overflow-auto max-h-80 text-zinc-700 whitespace-pre-wrap">
              {JSON.stringify(booking, null, 2)}
            </pre>
            <Button variant="outline" size="sm" onClick={onReset} className="mt-4">
              Start new booking
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
