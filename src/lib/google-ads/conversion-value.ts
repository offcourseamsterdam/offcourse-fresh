// Pure helpers for Google Ads Offline Conversion Import. No I/O — fully unit-tested.

import { extractVat } from '@/lib/extras/calculate'

type Meta = Record<string, string | undefined>

// The same split the booking write paths fall back to when VAT metadata is
// absent (book/route.ts, recover-from-pi.ts). Keeping them identical means the
// conversion value reported to Google can never disagree with the VAT stored
// on the booking row.
const BASE_VAT_RATE_PERCENT = 9
const EXTRAS_VAT_RATE_PERCENT = 21

function num(v: string | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Net revenue (in cents) to report to Google as the conversion value.
 *
 * Beer's choice: report what the business actually keeps — cruise + extras,
 * EXCLUDING 9%/21% VAT and the €2.60/guest city tax (a municipal pass-through,
 * never in base_amount). Amounts in PI metadata are VAT-inclusive, so the ex-VAT
 * value is `amount − vat`.
 *
 *   net = (base − base_vat) + (extras − extras_vat) − discount
 *
 * Reads the PaymentIntent metadata fields written at create-intent time.
 */
export function computeNetRevenueCents(meta: Meta): number {
  const base = num(meta.server_base_amount_cents)
  const extras = num(meta.extras_amount_cents)
  // Fall back to the 9% / 21% split when the VAT metadata is missing (older or
  // partial PaymentIntents). Without this, missing VAT counts as zero and we'd
  // report the GROSS amount to Google — over-stating the conversion value and
  // mis-training Smart Bidding. extractVat(0, …) is 0, so empty input stays 0.
  const baseVat = num(meta.base_vat_amount_cents) || extractVat(base, BASE_VAT_RATE_PERCENT)
  const extrasVat = num(meta.extras_vat_amount_cents) || extractVat(extras, EXTRAS_VAT_RATE_PERCENT)
  const discount = num(meta.discount_amount_cents)
  const net = base - baseVat + (extras - extrasVat) - discount
  return Math.max(0, Math.round(net))
}

/** Cents → major currency units (Google wants e.g. 123.45, not 12345). */
export function centsToMajor(cents: number): number {
  return Math.round(cents) / 100
}

/**
 * Format a Date as Google's required `yyyy-mm-dd hh:mm:ss+hh:mm`, in the given
 * IANA timezone (with the correct DST offset for that instant).
 */
export function formatConversionDateTime(date: Date, timeZone = 'Europe/Amsterdam'): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(date).map((p) => [p.type, p.value]),
  )
  const hour = parts.hour === '24' ? '00' : parts.hour
  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}${tzOffset(date, timeZone)}`
}

function tzOffset(date: Date, timeZone: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const m = name.match(/GMT([+-]\d{2}:\d{2})/)
  return m ? m[1] : '+00:00'
}

export interface UploadDecision {
  /** Whether to actually send the conversion to Google. */
  send: boolean
  /** Machine-readable reason, also used as the row status when not sending. */
  reason: 'ok' | 'skipped_no_gclid' | 'skipped_no_consent'
}

/**
 * Decide whether a conversion may be sent to Google.
 *
 * - No gclid → nothing to match on, skip.
 * - requireConsent on + visitor didn't accept the banner → skip the *send* only
 *   (the gclid still lives on the booking for our own records).
 */
export function decideUpload(params: {
  gclid?: string | null
  consent?: string | null
  requireConsent: boolean
}): UploadDecision {
  const gclid = (params.gclid ?? '').trim()
  if (!gclid) return { send: false, reason: 'skipped_no_gclid' }
  if (params.requireConsent && params.consent !== 'yes') {
    return { send: false, reason: 'skipped_no_consent' }
  }
  return { send: true, reason: 'ok' }
}
