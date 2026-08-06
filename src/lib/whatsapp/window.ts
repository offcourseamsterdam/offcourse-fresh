/**
 * WhatsApp's 24h customer-service window, formatted for display. Pure/testable
 * on purpose — the UI just calls this on a ticking clock, see ThreadPane.tsx.
 */
export interface WindowStatus {
  label: string
  /** true once the window has closed — free-form replies will fail (Twilio 63016). */
  closed: boolean
}

export function formatWindowRemaining(expiresAt: string | null, now: number): WindowStatus | null {
  if (!expiresAt) return null

  const remainingMs = new Date(expiresAt).getTime() - now
  if (remainingMs <= 0) {
    return { label: 'Window closed — needs a template', closed: true }
  }

  const totalMinutes = Math.ceil(remainingMs / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  const label = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  return { label, closed: false }
}
