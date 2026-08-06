'use client'

import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react'
import { useVoice } from './VoiceProvider'

/**
 * The floating call widget — mounted once in the admin layout so it's live on
 * every admin page, not just /admin/inbox. Reflects whatever VoiceProvider's
 * shared Device is doing: an inbound call ringing in, an outbound call being
 * dialed (from the inbox's CallButton), or a connected call either way.
 *
 * No persistent "phone is ready" chrome — the whole point is to be invisible
 * until a call is actually happening.
 */
export function VoicePhone() {
  const voice = useVoice()
  if (!voice || voice.state === 'idle') return null

  const { state, peer, muted, answer, decline, hangup, toggleMute } = voice

  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-xl bg-zinc-900 text-white shadow-xl px-4 py-3 w-72">
      {state === 'ringing' && (
        <>
          <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-1">Incoming call</p>
          <p className="text-sm font-semibold mb-3 truncate">{peer}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={answer}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-xs font-semibold"
            >
              <Phone className="w-3.5 h-3.5" /> Answer
            </button>
            <button
              onClick={decline}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 px-3 py-2 text-xs font-semibold"
            >
              <PhoneOff className="w-3.5 h-3.5" /> Decline
            </button>
          </div>
        </>
      )}
      {state === 'dialing' && (
        <>
          <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-1">Calling…</p>
          <p className="text-sm font-semibold mb-3 truncate">{peer}</p>
          <button
            onClick={hangup}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 px-3 py-2 text-xs font-semibold"
          >
            <PhoneOff className="w-3.5 h-3.5" /> Cancel
          </button>
        </>
      )}
      {state === 'connected' && (
        <>
          <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-1">On call</p>
          <p className="text-sm font-semibold mb-3 truncate">{peer}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${
                muted ? 'bg-amber-600 hover:bg-amber-700' : 'bg-zinc-700 hover:bg-zinc-600'
              }`}
            >
              {muted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              onClick={hangup}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 px-3 py-2 text-xs font-semibold"
            >
              <PhoneOff className="w-3.5 h-3.5" /> Hang up
            </button>
          </div>
        </>
      )}
    </div>
  )
}
