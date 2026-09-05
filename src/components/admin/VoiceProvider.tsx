'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Shared Twilio.Device instance for the admin softphone — a React Context so
 * both the always-on incoming-call widget (VoicePhone) and any outbound
 * "call this number" UI (e.g. the inbox's CallButton) drive the SAME
 * registered device, instead of each mounting its own (which would either
 * double-register the identity or leave outbound calling with no device to use).
 */

type CallState = 'idle' | 'ringing' | 'dialing' | 'connected'

interface VoiceContextValue {
  state: CallState
  /** The other party: the incoming caller's number, or the number being dialed out. */
  peer: string | null
  muted: boolean
  /** Set when a call fails (permission denied, device error, etc.) — persists
   *  after the call resets to 'idle' so there's something on screen to read;
   *  callers clear it explicitly rather than it vanishing with the call state. */
  error: string | null
  clearError: () => void
  answer: () => void
  decline: () => void
  hangup: () => void
  toggleMute: () => void
  /** Places an outbound call through the shared device. No-ops if a call is already in progress. */
  startCall: (toNumber: string) => void
}

const VoiceContext = createContext<VoiceContextValue | null>(null)

/** Returns null when VoiceProvider isn't mounted (or voice isn't configured yet) — callers decide whether to hide the UI. */
export function useVoice() {
  return useContext(VoiceContext)
}

/** Twilio's own error.message is developer-facing ("PermissionDeniedError
 *  (31401): The browser or end-user denied permissions to user media...") —
 *  translate the ones a non-technical admin will actually hit into something
 *  they can act on; anything else falls back to the raw message rather than
 *  hiding it. */
function friendlyTwilioError(twilioError: { code?: number; message: string }): string {
  if (twilioError.code === 31401) {
    return "Microphone access is blocked for this site. Allow it in your browser's site settings (click the padlock in the address bar), then try calling again."
  }
  return twilioError.message
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CallState>('idle')
  const [peer, setPeer] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deviceRef = useRef<import('@twilio/voice-sdk').Device | null>(null)
  const callRef = useRef<import('@twilio/voice-sdk').Call | null>(null)

  useEffect(() => {
    let cancelled = false

    function reset() {
      setState('idle')
      setPeer(null)
      setMuted(false)
      callRef.current = null
    }

    function wireCallEvents(call: import('@twilio/voice-sdk').Call) {
      call.on('accept', () => setState('connected'))
      call.on('disconnect', reset)
      call.on('cancel', reset)
      call.on('reject', reset)
      call.on('error', twilioError => {
        console.error('[VoiceProvider] Call error:', twilioError.message)
        setError(friendlyTwilioError(twilioError))
        reset()
      })
    }

    async function fetchVoiceToken(): Promise<string | null> {
      const res = await fetch('/api/admin/voice/token')
      const json = await res.json()
      return res.ok ? json.data.token : null
    }

    async function setup() {
      try {
        const token = await fetchVoiceToken()
        // Not configured yet (no Twilio number/API key) — stay silent, not every
        // admin has voice set up, and this must never break the rest of the admin.
        if (!token || cancelled) return

        const { Device } = await import('@twilio/voice-sdk')
        const device = new Device(token, { logLevel: 'error' })
        deviceRef.current = device

        device.on('incoming', call => {
          // A second call arriving while one is already ringing/connected must
          // not clobber the active call's ref — that would orphan it (hangup
          // would then disconnect the WRONG call) while its own event handlers
          // stay wired in the background with nothing pointing at them.
          // Twilio doesn't reject the second leg for us; reject it here instead.
          if (callRef.current) {
            call.reject()
            return
          }
          callRef.current = call
          setPeer(call.parameters.From ?? 'Unknown number')
          setState('ringing')
          wireCallEvents(call)
        })

        device.on('error', twilioError => {
          if (cancelled || device.state === 'destroyed') return
          // 31005 on unmount or transient socket renegotiation is handled by Twilio's internal reconnection
          if (twilioError.code === 31005) {
            console.warn('[VoiceProvider] Twilio Device connection event (reconnecting):', twilioError.message)
            return
          }
          console.error('[VoiceProvider] Twilio Device error:', twilioError.message)
        })

        // The Access Token (ttl: 3600, see admin/voice/token/route.ts) expires
        // after an hour — Twilio fires this a few minutes ahead of that so a
        // fresh token can be swapped in before the Device silently stops being
        // able to register/receive calls on a long-open inbox tab.
        device.on('tokenWillExpire', async () => {
          try {
            const freshToken = await fetchVoiceToken()
            if (freshToken) device.updateToken(freshToken)
          } catch (err) {
            console.error('[VoiceProvider] Could not refresh the expiring Access Token:', err)
          }
        })

        if (!cancelled) {
          await device.register()
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[VoiceProvider] Could not start the softphone:', err)
        }
      }
    }

    setup()
    return () => {
      cancelled = true
      if (deviceRef.current) {
        deviceRef.current.removeAllListeners()
        deviceRef.current.destroy()
        deviceRef.current = null
      }
    }
  }, [])

  function answer() {
    callRef.current?.accept()
  }

  function decline() {
    callRef.current?.reject()
    setState('idle')
    setPeer(null)
    callRef.current = null
  }

  function hangup() {
    callRef.current?.disconnect()
  }

  function toggleMute() {
    const next = !muted
    callRef.current?.mute(next)
    setMuted(next)
  }

  function startCall(toNumber: string) {
    const device = deviceRef.current
    if (!device || state !== 'idle' || !toNumber.trim()) return
    setPeer(toNumber)
    setState('dialing')
    device
      .connect({ params: { To: toNumber } })
      .then(call => {
        callRef.current = call
        call.on('accept', () => setState('connected'))
        call.on('disconnect', () => {
          setState('idle')
          setPeer(null)
          callRef.current = null
        })
        call.on('cancel', () => {
          setState('idle')
          setPeer(null)
          callRef.current = null
        })
        call.on('reject', () => {
          setState('idle')
          setPeer(null)
          callRef.current = null
        })
        call.on('error', twilioError => {
          console.error('[VoiceProvider] Outbound call error:', twilioError.message)
          setError(friendlyTwilioError(twilioError))
          setState('idle')
          setPeer(null)
          callRef.current = null
        })
      })
      .catch(err => {
        console.error('[VoiceProvider] Could not place the call:', err)
        setError(err instanceof Error ? friendlyTwilioError(err as { code?: number; message: string }) : 'Could not place the call.')
        setState('idle')
        setPeer(null)
      })
  }

  function clearError() {
    setError(null)
  }

  return (
    <VoiceContext.Provider value={{ state, peer, muted, error, clearError, answer, decline, hangup, toggleMute, startCall }}>
      {children}
    </VoiceContext.Provider>
  )
}
