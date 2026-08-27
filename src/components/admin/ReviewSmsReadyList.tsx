'use client'

import { useState } from 'react'
import { Loader2, MessageSquareText, Send } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtAdminDate } from '@/lib/admin/format'
import { SendReviewSmsModal } from '@/components/admin/booking-actions/SendReviewSmsModal'

interface ReadyBooking {
  id: string
  customer_name: string | null
  listing_title: string | null
  booking_date: string | null
  end_time: string | null
}

export function ReviewSmsReadyList() {
  const { data, isLoading, refresh } = useAdminFetch<{ bookings: ReadyBooking[] }>(
    '/api/admin/reviews/sms-ready'
  )
  const [sendingFor, setSendingFor] = useState<ReadyBooking | null>(null)

  const bookings = data?.bookings ?? []

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-zinc-100 flex items-center gap-2">
        <MessageSquareText className="w-4 h-4 text-indigo-500" />
        <h2 className="text-sm font-semibold text-zinc-900">Post-cruise SMS — ready to send</h2>
        <span className="text-xs text-zinc-400 ml-1">
          {isLoading ? 'checking…' : `${bookings.length} finished cruise${bookings.length === 1 ? '' : 's'}, not yet sent`}
        </span>
      </div>

      {isLoading && bookings.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-6 px-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}

      {!isLoading && bookings.length === 0 && (
        <p className="text-sm text-zinc-400 px-6 py-6">
          Nothing waiting — every cruise from the last 14 days has either been sent a review SMS
          already or hasn't finished yet.
        </p>
      )}

      {bookings.length > 0 && (
        <ul className="divide-y divide-zinc-100">
          {bookings.map(b => (
            <li key={b.id} className="flex items-center justify-between gap-4 px-6 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-900 truncate">{b.customer_name ?? '—'}</p>
                <p className="text-xs text-zinc-400 truncate">
                  {b.listing_title ?? 'Cruise'} · {fmtAdminDate(b.booking_date)}
                </p>
              </div>
              <button
                onClick={() => setSendingFor(b)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>
            </li>
          ))}
        </ul>
      )}

      {sendingFor && (
        <SendReviewSmsModal
          bookingId={sendingFor.id}
          guestName={sendingFor.customer_name}
          cruiseTitle={sendingFor.listing_title}
          onClose={() => setSendingFor(null)}
          onSuccess={() => { setSendingFor(null); refresh() }}
        />
      )}
    </div>
  )
}
