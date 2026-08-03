'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BOOKINGS_CHANGED_CHANNEL, BOOKINGS_CHANGED_EVENT } from '@/lib/realtime/bookings-channel'

/**
 * Calls `onChange` whenever the server signals (via Supabase Realtime
 * broadcast) that the `bookings` table was written to — event-based, no
 * polling interval. See src/lib/realtime/notify-bookings-changed.ts for the
 * server side and why broadcast (not Postgres Changes CDC) was chosen.
 *
 * Subscribes once per mount regardless of whether `onChange`'s identity is
 * stable across renders (it's read via a ref) — callers can pass an inline
 * function without triggering a resubscribe on every render.
 */
export function useBookingsChangedSignal(onChange: () => void): void {
  const onChangeRef = useRef(onChange)
  // Keep the ref in sync via its own effect (runs after every render) rather than
  // writing to it during render — refs must not be written/read during render.
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(BOOKINGS_CHANGED_CHANNEL)
      .on('broadcast', { event: BOOKINGS_CHANGED_EVENT }, () => {
        onChangeRef.current()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])
}
