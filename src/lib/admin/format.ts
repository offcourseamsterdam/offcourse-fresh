/** Format a date string (YYYY-MM-DD or ISO) for display in the admin. */
export function fmtAdminDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  // Append time component to avoid timezone shift on date-only strings
  const d = dateStr.length === 10
    ? new Date(dateStr + 'T00:00:00')
    : new Date(dateStr)
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Format an ISO datetime string as HH:MM in Amsterdam timezone. */
export function fmtAdminTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Amsterdam',
  })
}

/** Format cents as €X,XX (nl-NL decimal). Returns '—' for null or 0. */
export function fmtAdminAmount(cents: number | null): string {
  if (cents == null || cents === 0) return '—'
  return `€${(cents / 100).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Format cents as €X (no decimals). Returns '—' for null or 0. */
export function fmtAdminAmountRounded(cents: number | null): string {
  if (cents == null || cents === 0) return '—'
  return `€${Math.round(cents / 100)}`
}

/** Format ISO datetime as "28 apr. 14:00" in Amsterdam TZ. */
export function fmtAdminDatetime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Amsterdam',
  })
}
