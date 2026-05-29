import { createHash } from 'node:crypto'

// Enhanced conversions: hashed first-party identifiers attached to a conversion
// so Google can match the sale to an ad click even when the gclid is missing
// (expired cookie, cross-device, Safari/iOS). Emails/phones are SHA-256 hashed
// BEFORE leaving our server — Google never receives the raw value. These are
// only ever attached when the visitor consented (see report-conversion).

export interface UserIdentifier {
  userIdentifierSource: 'FIRST_PARTY'
  hashedEmail?: string
  hashedPhoneNumber?: string
}

/** SHA-256, lowercase hex — the format Google expects for hashed identifiers. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Normalize an email per Google's rules: trim + lowercase; for gmail/googlemail
 * strip dots and any '+suffix' in the local part. Returns null if not an email.
 */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  const at = email.indexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  let local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+')[0].replace(/\./g, '')
  }
  if (!local) return null
  return `${local}@${domain}`
}

/**
 * Best-effort E.164 normalization. Defaults unknown numbers to NL (+31), since
 * that's most of the customer base; foreign numbers entered in local format
 * simply won't match (harmless — Google ignores non-matches).
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

/** Build the hashed userIdentifiers array from whatever first-party data we have. */
export function buildUserIdentifiers(params: {
  email?: string | null
  phone?: string | null
}): UserIdentifier[] {
  const out: UserIdentifier[] = []

  const email = params.email ? normalizeEmail(params.email) : null
  if (email) out.push({ userIdentifierSource: 'FIRST_PARTY', hashedEmail: sha256Hex(email) })

  const phone = params.phone ? normalizePhoneE164(params.phone) : null
  if (phone) out.push({ userIdentifierSource: 'FIRST_PARTY', hashedPhoneNumber: sha256Hex(phone) })

  return out
}
