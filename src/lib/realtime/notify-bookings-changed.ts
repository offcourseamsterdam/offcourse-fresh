/**
 * Ping any open admin Bookings/Planning page to refetch the moment the
 * `bookings` table actually changes — event-based, not a polling interval.
 *
 * Uses Supabase Realtime's broadcast REST endpoint (a single fire-and-forget
 * HTTP POST) rather than opening a websocket from inside a short-lived API
 * route/webhook handler. Carries no data — the browser still fetches via the
 * existing admin-authenticated /api/admin/bookings/local route, so this
 * message never needs to (and must not) include customer PII.
 *
 * Deliberately NOT wired through Postgres Changes / RLS on `bookings`: that
 * table is currently locked to service_role only (no client-side SELECT
 * policy at all), and broadcast keeps it that way — nothing about `bookings`
 * itself becomes reachable from the browser.
 *
 * No-ops silently when Supabase env vars are missing (dev/CI). Never throws —
 * this is a best-effort side channel, same philosophy as postSlackText.
 */

import { BOOKINGS_CHANGED_CHANNEL, BOOKINGS_CHANGED_EVENT } from './bookings-channel'

export async function notifyBookingsChanged(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return

  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ topic: BOOKINGS_CHANGED_CHANNEL, event: BOOKINGS_CHANGED_EVENT, payload: {} }],
      }),
    })
  } catch (err) {
    console.error('[notifyBookingsChanged] failed (non-fatal):', err)
  }
}
