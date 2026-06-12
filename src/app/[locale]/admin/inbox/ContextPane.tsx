'use client'

import { useState } from 'react'
import { CalendarDays, Globe, Mail, Phone } from 'lucide-react'
import { adminMutate } from '@/hooks/useAdminSave'
import type { InboxConversationDetail } from './types'

const STATUS_OPTIONS = ['open', 'pending', 'resolved'] as const

interface Props {
  detail: InboxConversationDetail
  onChanged: () => void
}

/** Right pane — who you're talking to: contact card, their bookings, workflow. */
export function ContextPane({ detail, onChanged }: Props) {
  const { conversation, bookings } = detail
  const contact = conversation.contact
  const [saving, setSaving] = useState(false)

  async function setStatus(status: (typeof STATUS_OPTIONS)[number]) {
    if (status === conversation.status || saving) return
    setSaving(true)
    try {
      await adminMutate(`/api/admin/inbox/conversations/${conversation.id}`, 'PATCH', { status })
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {/* Workflow */}
      <div>
        <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-2">Status</p>
        <div className="flex items-center gap-1">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              disabled={saving}
              className={`px-2.5 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
                conversation.status === s
                  ? s === 'resolved'
                    ? 'bg-emerald-600 text-white'
                    : s === 'pending'
                      ? 'bg-blue-600 text-white'
                      : 'bg-amber-500 text-white'
                  : 'text-zinc-500 hover:bg-zinc-100'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Contact card */}
      <div>
        <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-2">Customer</p>
        <p className="text-sm font-semibold text-zinc-900">{contact?.name ?? 'Unknown'}</p>
        <div className="mt-1.5 space-y-1 text-xs text-zinc-500">
          {contact?.email && (
            <p className="flex items-center gap-1.5">
              <Mail className="w-3 h-3" /> {contact.email}
            </p>
          )}
          {contact?.phone_e164 && (
            <p className="flex items-center gap-1.5">
              <Phone className="w-3 h-3" /> {contact.phone_e164}
            </p>
          )}
          {contact?.locale && (
            <p className="flex items-center gap-1.5">
              <Globe className="w-3 h-3" /> {contact.locale.toUpperCase()}
            </p>
          )}
        </div>
        {contact?.notes && (
          <p className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
            {contact.notes}
          </p>
        )}
      </div>

      {/* Bookings */}
      <div>
        <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-2">Bookings</p>
        {bookings.length === 0 && <p className="text-xs text-zinc-400">No bookings found for this customer.</p>}
        <div className="space-y-2">
          {bookings.map(b => (
            <div key={b.id} className="rounded-lg border border-zinc-200 px-3 py-2">
              <p className="text-xs font-semibold text-zinc-800 flex items-center gap-1.5">
                <CalendarDays className="w-3 h-3 text-zinc-400" />
                {b.booking_date ?? '—'}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5 truncate">{b.listing_title ?? 'Cruise'}</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                {b.guest_count ? `${b.guest_count} guests · ` : ''}
                {b.receipt_total_display ?? ''}
                {b.status ? ` · ${b.status}` : ''}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
