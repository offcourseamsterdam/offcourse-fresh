/**
 * Best-effort E.164 normalization. Defaults unknown numbers to NL (+31), since
 * that's most of Off Course's customer base; foreign numbers entered in local
 * format simply won't match (harmless — callers that compare/dial against
 * this ignore non-matches or reject an invalid result).
 *
 * Dependency-free by design — safe to import from both server code (e.g.
 * Google Ads enhanced-conversion hashing) and client components (e.g. the
 * admin softphone's "call a number" input), unlike a module that also pulls
 * in node:crypto or similar server-only APIs.
 */
export function normalizePhoneE164(raw: string, defaultCountry = '31'): string | null {
  const cleaned = raw.replace(/[^\d+]/g, '')
  if (!cleaned || cleaned.replace(/\D/g, '').length < 6) return null
  if (cleaned.startsWith('+')) return cleaned
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`
  if (cleaned.startsWith('0')) return `+${defaultCountry}${cleaned.slice(1)}`
  if (cleaned.startsWith(defaultCountry)) return `+${cleaned}`
  return `+${defaultCountry}${cleaned}`
}
