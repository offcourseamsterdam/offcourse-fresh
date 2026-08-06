'use client'

import { useState } from 'react'
import { Phone, X } from 'lucide-react'
import { useVoice } from '@/components/admin/VoiceProvider'
import { normalizePhoneE164 } from '@/lib/phone/normalize'

/**
 * "Call a number" — top-right of the inbox. Places an outbound call through
 * the shared browser softphone (VoiceProvider); the call itself is answered
 * on the floating VoicePhone widget, same as an inbound call. Hidden entirely
 * when voice isn't configured (no Twilio number set up yet) — nothing to do here.
 */
export function CallButton() {
  const voice = useVoice()
  const [open, setOpen] = useState(false)
  const [number, setNumber] = useState('')

  if (!voice) return null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    // Also fills in the NL country code for a locally-formatted number (e.g.
    // "06 12345678") — not just stripping separators — so it still matches
    // the strict PHONE_PATTERN the outbound webhook validates against (see
    // twilio-voice/outbound/route.ts), which requires a leading `+`.
    const normalized = normalizePhoneE164(number)
    if (!voice || !normalized) return
    voice.startCall(normalized)
    setOpen(false)
    setNumber('')
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={voice.state !== 'idle'}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Phone className="w-3.5 h-3.5" /> Call a number
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <form
            onSubmit={submit}
            className="absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border border-zinc-200 bg-white shadow-lg p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400">Call a number</p>
              <button type="button" onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              type="tel"
              autoFocus
              value={number}
              onChange={e => setNumber(e.target.value)}
              placeholder="+31 6..."
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="submit"
              disabled={!number.trim()}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-3 py-2 text-xs font-semibold"
            >
              <Phone className="w-3.5 h-3.5" /> Call
            </button>
          </form>
        </>
      )}

      {voice.error && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl border border-red-200 bg-red-50 shadow-lg p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-red-700 leading-relaxed">{voice.error}</p>
            <button onClick={voice.clearError} className="shrink-0 text-red-400 hover:text-red-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
