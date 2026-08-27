'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, MessageSquareText } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface SendReviewSmsModalProps {
  bookingId: string
  guestName: string | null
  cruiseTitle: string | null
  onClose: () => void
  onSuccess: () => void
}

interface PreviewState {
  alreadySent: boolean
  sentAt: string | null
  smsEnabled: boolean
}

export function SendReviewSmsModal({
  bookingId,
  guestName,
  cruiseTitle,
  onClose,
  onSuccess,
}: SendReviewSmsModalProps) {
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [message, setMessage] = useState('')
  const [phone, setPhone] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadPreview() {
      try {
        const res = await fetch(`/api/admin/bookings/${bookingId}/review-sms`)
        const json = await res.json()
        if (!json.ok) throw new Error(json.error ?? 'Failed to load preview')
        if (cancelled) return
        const p = json.data.preview
        setPreview({
          alreadySent: p.alreadySent,
          sentAt: p.sentAt,
          smsEnabled: p.smsEnabled,
        })
        setMessage(p.message)
        setPhone(p.normalizedPhone || p.rawPhone || '')
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load preview')
      } finally {
        if (!cancelled) setLoadingPreview(false)
      }
    }
    loadPreview()
    return () => {
      cancelled = true
    }
  }, [bookingId])

  async function handleSend() {
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/review-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          message,
          force: preview?.alreadySent ? true : undefined,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Failed to send SMS')
      toast.success(
        'Review SMS sent',
        json.data.mock
          ? { description: 'Test mode — no real SMS was sent (Twilio not configured)' }
          : undefined
      )
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSending(false)
    }
  }

  const alreadySent = preview?.alreadySent ?? false

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
            <MessageSquareText className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-900">Send review SMS</h2>
            <p className="text-sm text-zinc-500 mt-0.5">
              Post-cruise text with the recommendations map + review link.
            </p>
          </div>
        </div>

        <div className="bg-zinc-50 rounded-lg px-4 py-3 space-y-1 text-sm">
          <p className="font-medium text-zinc-900">{guestName ?? '—'}</p>
          <p className="text-zinc-500">{cruiseTitle ?? '—'}</p>
        </div>

        {loadingPreview ? (
          <div className="flex items-center justify-center py-6 text-zinc-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <>
            {alreadySent && (
              <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                Already sent{preview?.sentAt ? ` ${new Date(preview.sentAt).toLocaleString()}` : ''}.
                Sending again will resend to this number.
              </p>
            )}
            {preview && !preview.smsEnabled && (
              <p className="text-sm text-zinc-500 bg-zinc-50 rounded-lg px-3 py-2">
                Auto-send is off in Reviews settings — this only sends this one SMS manually.
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Phone number
              </label>
              <input
                type="text"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+31612345678"
                className="w-full border border-zinc-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Message
              </label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={5}
                className="w-full border border-zinc-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 resize-none"
              />
              <p className="text-xs text-zinc-400">{message.length} characters</p>
            </div>
          </>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="outline" size="sm" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={sending || loadingPreview || !phone.trim() || !message.trim()}
          >
            {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {sending ? 'Sending…' : alreadySent ? 'Resend SMS' : 'Send SMS'}
          </Button>
        </div>
      </div>
    </div>
  )
}
