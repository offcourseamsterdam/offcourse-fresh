import { normalizePartnerCode } from './generate'

export interface PartnerCodeRow {
  id: string
  partner_id: string
  code: string
  is_active: boolean
  expires_at: string
  revoked_at: string | null
}

export type ValidationResult =
  | { ok: true; code: PartnerCodeRow }
  | { ok: false; reason: 'not_found' | 'revoked' | 'expired' | 'wrong_partner' | 'empty' }

/**
 * Pure validation — takes a candidate code row (e.g. looked up from the DB)
 * and checks it against the expected partner, at the given moment in time.
 *
 * Kept separate from DB lookup so it can be unit-tested without Supabase.
 */
export function validatePartnerCode(
  candidateInput: string | null | undefined,
  expectedPartnerId: string,
  row: PartnerCodeRow | null,
  now: Date = new Date(),
): ValidationResult {
  if (!candidateInput || !candidateInput.trim()) return { ok: false, reason: 'empty' }
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.partner_id !== expectedPartnerId) return { ok: false, reason: 'wrong_partner' }
  if (!row.is_active || row.revoked_at) return { ok: false, reason: 'revoked' }
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: 'expired' }
  return { ok: true, code: row }
}

/** Convert a ValidationResult.reason into an end-user-friendly sentence. */
export function reasonMessage(reason: Exclude<ValidationResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'empty': return 'Please enter the partner code from your receipt.'
    case 'not_found': return 'We could not find that code. Please check and try again.'
    case 'revoked': return 'That code has been revoked. Please ask the partner for a new one.'
    case 'expired': return 'That code has expired. Please ask the partner for a new one.'
    case 'wrong_partner': return 'That code is not valid for this booking.'
  }
}

export { normalizePartnerCode }
