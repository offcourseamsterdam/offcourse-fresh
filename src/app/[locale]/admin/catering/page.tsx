'use client'

import { useState, Fragment, useEffect } from 'react'
import { Loader2, RefreshCw, UtensilsCrossed, Send, CheckCircle2, ChevronDown, ChevronUp, Mail, X, Copy, Check } from 'lucide-react'
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
  category: string | null
  customer_type_name: string | null
  extras_selected: AdminExtraLineItem[] | null
  catering_email_sent_at: string | null
  cateringItems: AdminExtraLineItem[]
  cateringAmountCents: number
}

interface CateringData {
  bookings: CateringBooking[]
}

interface CateringEmailPreview {
  text: string
  alreadySent: boolean
  fhNote: string | null
}

// ── Toast ─────────────────────────────────────────────────────────────────

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 bg-zinc-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg">
      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
      {message}
    </div>
  )
}

// ── Confirm modal ──────────────────────────────────────────────────────────

function CateringConfirmModal({
  booking,
  isSending,
  onConfirm,
  onClose,
}: {
  booking: CateringBooking
  isSending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const { data, isLoading } =
    useAdminFetch<CateringEmailPreview>(`/api/admin/bookings/${booking.id}/catering-email`)

  const [copied, setCopied] = useState(false)

  function copyFhNote() {
    if (!data?.fhNote) return
    navigator.clipboard.writeText(data.fhNote).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const isSent = !!booking.catering_email_sent_at

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">
              {isSent ? 'Resend food order?' : 'Send food order?'}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {booking.listing_title ?? '—'} · {fmtAdminDate(booking.booking_date)} · {booking.customer_name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 transition-colors p-1 rounded-lg hover:bg-zinc-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* Catering items */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">
              Order
            </p>
            <div className="divide-y divide-zinc-100 border border-zinc-100 rounded-lg overflow-hidden">
              {booking.cateringItems.map((item, i) => {
                const qty = item.quantity ?? 1
                const qtyLabel = item.is_per_person_pick
                  ? `for ${qty} ${qty === 1 ? 'person' : 'people'}`
                  : qty > 1 ? `×${qty}` : null
                return (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 bg-white">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-zinc-800">{item.name}</span>
                      {qtyLabel && (
                        <span className="text-xs text-zinc-400">{qtyLabel}</span>
                      )}
                      {item.source === 'extras_upsell' && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                          Upsell
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-medium text-zinc-700">
                      {fmtAdminAmountRounded(item.amount_cents ?? 0)}
                    </span>
                  </div>
                )
              })}
              <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-50">
                <span className="text-xs font-semibold text-zinc-500">Total</span>
                <span className="text-sm font-semibold text-zinc-900">
                  {fmtAdminAmountRounded(booking.cateringAmountCents)}
                </span>
              </div>
            </div>
          </div>

          {/* FareHarbor note */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                FareHarbor note
              </p>
              {data?.fhNote && (
                <button
                  onClick={copyFhNote}
                  className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
                >
                  {copied
                    ? <><Check className="w-3 h-3" /> Copied</>
                    : <><Copy className="w-3 h-3" /> Copy</>
                  }
                </button>
              )}
            </div>

            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-400 py-4 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : data?.fhNote ? (
              <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-lg p-4 leading-relaxed">
                {data.fhNote}
              </pre>
            ) : (
              <p className="text-xs text-zinc-400 italic">No note to set — no catering or guest note.</p>
            )}

            <p className="text-[11px] text-zinc-400 mt-2">
              FareHarbor doesn&apos;t support API note updates — copy and paste manually in the{' '}
              <a
                href={`https://fareharbor.com/offcourse/manage/`}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-500 hover:underline"
              >
                FH dashboard
              </a>
              .
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-100 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSending}>
            Cancel
          </Button>
          <Button
            variant={isSent ? 'outline' : 'primary'}
            size="sm"
            onClick={onConfirm}
            disabled={isSending}
            className="gap-1.5"
          >
            {isSending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
              : <><Send className="w-3.5 h-3.5" /> {isSent ? 'Resend to supplier' : 'Send to supplier'}</>
            }
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Email preview panel (row expand) ──────────────────────────────────────

function EmailPreview({ bookingId }: { bookingId: string }) {
  const { data, isLoading, error } =
    useAdminFetch<CateringEmailPreview>(`/api/admin/bookings/${bookingId}/catering-email`)

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400 py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading preview…
      </div>
    )
  }

  if (error || !data?.text) {
    return (
      <div className="text-sm text-red-500 py-4 px-6">
        Could not load email preview.
      </div>
    )
  }

  return (
    <div className="border-t border-zinc-100 bg-zinc-50">
      <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-100">
        <Mail className="w-4 h-4 text-zinc-400" />
        <span className="text-xs font-medium text-zinc-500">
          {data.alreadySent ? 'Email sent to supplier — preview below' : 'Email preview (not yet sent)'}
        </span>
      </div>
      <div className="px-6 py-4">
        <pre className="whitespace-pre-wrap font-sans text-sm text-zinc-700 bg-white border border-zinc-200 rounded-lg p-5 leading-relaxed">
          {data.text}
        </pre>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CateringPage() {
  const { data, isLoading, error, refresh } =
    useAdminFetch<CateringData>('/api/admin/catering')

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sending, setSending] = useState<Record<string, boolean>>({})
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [confirmingBooking, setConfirmingBooking] = useState<CateringBooking | null>(null)

  const bookings = data?.bookings ?? []

  function toggleRow(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function handleSendEmail(bookingId: string) {
    setSending(prev => ({ ...prev, [bookingId]: true }))
    setSendErrors(prev => { const n = { ...prev }; delete n[bookingId]; return n })
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/catering-email`, { method: 'POST' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error((json as Record<string, string>).error ?? 'Failed to send')
      }
      const json = await res.json()
      const recipient: string = json.data?.recipient ?? 'supplier'
      const isResend: boolean = json.data?.resent ?? false
      setToast(isResend ? `Order resent to ${recipient}` : `Email sent to ${recipient}`)
      setConfirmingBooking(null)
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
            Food Orders
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Bookings with food pre-orders · send to supplier when ready · click a row to preview the email
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </Button>
      </div>

      <AdminErrorBanner error={error} />

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading food orders…
        </div>
      )}

      {!isLoading && bookings.length === 0 && (
        <div className="text-sm text-zinc-400 py-12 text-center">
          <UtensilsCrossed className="w-8 h-8 mx-auto mb-3 text-zinc-200" />
          No food orders yet.
        </div>
      )}

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
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider w-28">Food total</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider w-28">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider w-36">Action</th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white">
                {bookings.map(b => {
                  const isSent = !!b.catering_email_sent_at
                  const isSending = sending[b.id]
                  const sendError = sendErrors[b.id]
                  const isExpanded = !!expanded[b.id]

                  const boatLabel = b.customer_type_name
                    ?? (b.category ? b.category.charAt(0).toUpperCase() + b.category.slice(1) : null)

                  return (
                    <Fragment key={b.id}>
                      <tr
                        className="hover:bg-zinc-50 transition-colors cursor-pointer"
                        onClick={() => toggleRow(b.id)}
                      >
                        <td className="px-4 py-3 text-zinc-900 whitespace-nowrap">
                          <p>{fmtAdminDate(b.booking_date)}</p>
                          <p className="text-xs text-zinc-400">{fmtAdminTime(b.start_time)}</p>
                        </td>

                        <td className="px-4 py-3 text-zinc-900">
                          <p>{b.listing_title ?? b.tour_item_name ?? '—'}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {b.guest_count && (
                              <p className="text-xs text-zinc-400">{b.guest_count} guests</p>
                            )}
                            {boatLabel && (
                              <p className="text-xs text-amber-600 font-medium">{boatLabel}</p>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <p className="text-zinc-900 font-medium">{b.customer_name ?? '—'}</p>
                          <div className="mt-0.5">
                            <BookingStatusBadge status={b.status} />
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <div className="space-y-0.5">
                            {b.cateringItems.map((item, i) => {
                              const qty = item.quantity ?? 1
                              const label = item.is_per_person_pick && qty > 0
                                ? `${item.name} (for ${qty} ${qty === 1 ? 'person' : 'people'})`
                                : qty > 1
                                  ? `${qty}× ${item.name}`
                                  : item.name
                              return (
                                <div key={i} className="flex items-center gap-1.5">
                                  <p className="text-xs text-zinc-600">{label}</p>
                                  {item.source === 'extras_upsell' && (
                                    <span className="inline-block text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 whitespace-nowrap">
                                      Pre-ordered
                                    </span>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </td>

                        <td className="px-4 py-3 text-zinc-900 font-semibold whitespace-nowrap">
                          {fmtAdminAmountRounded(b.cateringAmountCents)}
                        </td>

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

                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          {sendError && (
                            <p className="text-xs text-red-600 mb-1">{sendError}</p>
                          )}
                          <Button
                            variant={isSent ? 'outline' : 'primary'}
                            size="sm"
                            onClick={() => setConfirmingBooking(b)}
                            disabled={isSending}
                            className="text-xs gap-1"
                          >
                            {isSending
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Send className="w-3 h-3" />
                            }
                            {isSending ? 'Sending…' : isSent ? 'Resend' : 'Send to supplier'}
                          </Button>
                        </td>

                        <td className="px-4 py-3 text-zinc-400">
                          {isExpanded
                            ? <ChevronUp className="w-4 h-4" />
                            : <ChevronDown className="w-4 h-4" />
                          }
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <EmailPreview bookingId={b.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {confirmingBooking && (
        <CateringConfirmModal
          booking={confirmingBooking}
          isSending={!!sending[confirmingBooking.id]}
          onConfirm={() => handleSendEmail(confirmingBooking.id)}
          onClose={() => setConfirmingBooking(null)}
        />
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}
