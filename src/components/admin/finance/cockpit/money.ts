/**
 * Money + date formatting for the cash cockpit UI.
 *
 * Every amount on the cockpit screens goes through `eur()` so the whole module
 * speaks one dialect: "€ 52.480" (nl-NL thousands separator, no cents). The
 * existing kasboek helper `fmtAdminAmount` prints cents and returns '—' for
 * zero — both wrong for a planning dashboard where "€ 0" is a real answer.
 */

/** "€ 52.480" — rounded to whole euros, nl-NL grouping, "-€ 1.200" when negative. */
export function eur(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return '—'
  const euros = Math.round(cents / 100)
  const sign = euros < 0 ? '-' : ''
  return `${sign}€ ${Math.abs(euros).toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`
}

/** "€ 1.234,56" — with cents, for loan schedules where interest rarely lands on a whole euro. */
export function eurCents(cents: number | null | undefined): string {
  if (cents == null || Number.isNaN(cents)) return '—'
  const sign = cents < 0 ? '-' : ''
  return `${sign}€ ${(Math.abs(cents) / 100).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "42%" — rounded, clamped to 0..100 unless `clamp` is false. */
export function pct(value: number | null | undefined, clamp = true): string {
  if (value == null || Number.isNaN(value)) return '—'
  const v = clamp ? Math.min(100, Math.max(0, value)) : value
  return `${Math.round(v)}%`
}

/** 'YYYY-MM-DD' (or ISO datetime) → 'dd-mm-yyyy'. */
export function dateNL(iso: string | null | undefined): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${m[3]}-${m[2]}-${m[1]}`
}

/** ISO datetime → 'dd-mm-yyyy HH:MM' in Amsterdam time. */
export function dateTimeNL(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Amsterdam' })
  const time = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
  return `${date} ${time}`
}

/**
 * Form input ("1234,56" / "1234.56" / "1.234,56") → integer cents.
 * Returns null when the input is empty or not a number, so callers can
 * distinguish "left blank" from "typed 0".
 */
export function eurosToCents(input: string | number | null | undefined): number | null {
  if (input == null) return null
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null
  const raw = input.trim().replace(/[€\s]/g, '')
  if (!raw) return null
  // "1.234,56" → "1234.56"; "1234,56" → "1234.56"; "1234.56" stays.
  const normalised = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw
  if (!/^-?\d*(\.\d*)?$/.test(normalised) || normalised === '' || normalised === '-' || normalised === '.') return null
  // Split on the decimal point instead of multiplying a float: 1.005 * 100 is
  // 100.49999…, which would round the wrong way.
  const negative = normalised.startsWith('-')
  const [intPart = '0', decPart = ''] = normalised.replace(/^-/, '').split('.')
  const whole = Number(intPart || '0') * 100
  const fraction = decPart ? Math.round(Number(`0.${decPart}`) * 100) : 0
  const cents = whole + fraction
  if (!Number.isFinite(cents)) return null
  return negative ? -cents : cents
}

/** Integer cents → plain "1234.56" string for a numeric form input (empty for null). */
export function centsToEuros(cents: number | null | undefined): string {
  if (cents == null) return ''
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}
