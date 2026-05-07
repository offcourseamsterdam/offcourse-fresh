'use client'

import { useState } from 'react'
import { Loader2, RefreshCw, UtensilsCrossed, Send, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { BookingStatusBadge } from '@/components/admin/BookingStatusBadge'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtAdminDate, fmtAdminTime, fmtAdminAmountRounded } from '@/lib/admin/format'
import type { AdminExtraLineItem } from '@/lib/admin/types'

// ── Types ──────────────────────────────────────────────────────────────────

interface CateringBooking {
  id: string
  customer_name: string | null
  listing_title: string | null
  tour_item_name: string | null
  booking_date: string | null
  start_time: string | null
  guest_count: number | null
  status: string | null
  extras_selected: AdminExtraLineItem[] | null
  catering_email_sent_at: string | null
  cateringItems: AdminExtraLineItem[]
  cateringAmountCents: number
}

interface CateringData {
  bookings: CateringBooking[]
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CateringPage() {
  const { data, isLoading, error, refresh } =
    useAdminFetch<CateringData>('/api/admin/catering')

  const [sending, setSending] = useState<Record<string, boolean>>({})
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({})

  const bookings = data?.bookings ?? []

  async function handleSendEmail(bookingId: string) {
    setSending(prev => ({ ...prev, [bookingId]: true }))
    setSendErrors(prev => { const n = { ...prev }; delete n[bookingId]; return n })
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/catering-email`, {
        method: 'POST',
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error((json as Record<string, string>).error ?? 'Failed to send')
      }
      refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error'
      setSendErrors(prev => ({ ...prev, [bookingId]: msg }))
    } finally {
      setSending(prev => ({ ...prev, [bookingId]: false }))
    }
  }

  return (
    <div className="p-8 max-w-none space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 flex items-center gap-2">
            <UtensilsCrossed className="w-6 h-6 text-amber-500" />
            Catering
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Bookings with food &amp; drink orders · send to supplier when ready
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </Button>
      </div>

      <AdminErrorBanner error={error} />

      {/* Loading */}
      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading catering orders…
        </div>
      )}

      {/* Empty state */}
      {!isLoading && bookings.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <UtensilsCrossed className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          No catering orders yet.
        </div>
      )}

      {/* Table */}
      {bookings.length > 0 && (
        <div className="rounded-lg border border-zinc-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider min-w-[100px]">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider min-w-[200px]">Cruise</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider min-w-[160px]">Guest</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider min-w-[200px]">Items</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider w-28">Catering total</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider w-28">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider w-32">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {bookings.map(b => {
                  const isSent = !!b.catering_email_sent_at
                  const isSending = sending[b.id]
                  const sendError = sendErrors[b.id]

                  return (
                    <tr key={b.id} className="hover:bg-zinc-50 transition-colors">
                      {/* Date + time */}
                      <td className="px-4 py-3 text-zinc-900 whitespace-nowrap">
                        <p>{fmtAdminDate(b.booking_date)}</p>
                        <p className="text-xs text-zinc-400">{fmtAdminTime(b.start_time)}</p>
                      </td>

                      {/* Cruise */}
                      <td className="px-4 py-3 text-zinc-900">
                        <p>{b.listing_title ?? b.tour_item_name ?? '—'}</p>
                        {b.guest_count && (
                          <p className="text-xs text-zinc-400">{b.guest_count} guests</p>
                        )}
                      </td>

                      {/* Guest */}
                      <td className="px-4 py-3">
                        <p className="text-zinc-900 font-medium">{b.customer_name ?? '—'}</p>
                        <div className="mt-0.5">
                          <BookingStatusBadge status={b.status} />
                        </div>
                      </td>

                      {/* Catering items summary */}
                      <td className="px-4 py-3">
                        <div className="space-y-0.5">
                          {b.cateringItems.map((item, i) => (
                            <p key={i} className="text-xs text-zinc-600">
                              {item.quantity && item.quantity > 1 ? `${item.quantity}× ` : ''}{item.name}
                            </p>
                          ))}
                        </div>
                      </td>

                      {/* Catering total */}
                      <td className="px-4 py-3 text-zinc-900 font-semibold whitespace-nowrap">
                        {fmtAdminAmountRounded(b.cateringAmountCents)}
                      </td>

                      {/* Status badge */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {isSent ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">
                            <CheckCircle2 className="w-3 h-3" />
                            Sent
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded-full">
                            Pending
                          </span>
                        )}
                        {isSent && b.catering_email_sent_at && (
                          <p className="text-[10px] text-zinc-400 mt-0.5">
                            {fmtAdminDate(b.catering_email_sent_at.split('T')[0])}
                          </p>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3">
                        {sendError && (
                          <p className="text-xs text-red-600 mb-1">{sendError}</p>
                        )}
                        {!isSent ? (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleSendEmail(b.id)}
                            disabled={isSending}
                            className="text-xs gap-1"
                          >
                            {isSending ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Send className="w-3 h-3" />
                            )}
                            {isSending ? 'Sending…' : 'Send to supplier'}
                          </Button>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
