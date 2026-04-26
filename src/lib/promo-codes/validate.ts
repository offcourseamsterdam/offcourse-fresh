import { createAdminClient } from '@/lib/supabase/admin'

export interface PromoCodeRow {
  id: string
  code: string
  label: string
  discount_type: 'percentage' | 'fixed_amount' | 'full'
  discount_value: number | null
  fixed_discount_cents: number | null
  max_uses: number | null
  uses_count: number
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
}

export type ValidationResult =
  | { ok: true; code: PromoCodeRow }
  | { ok: false; reason: string; message: string }

export function normalizeCode(input: string): string {
  const stripped = input.toUpperCase().replace(/[\s-]/g, '')
  if (stripped.length !== 8) return stripped
  return `${stripped.slice(0, 4)}-${stripped.slice(4)}`
}

// Injectable lookup for testability — real callers omit it and get the DB lookup.
type LookupFn = (normalised: string) => Promise<PromoCodeRow | null>

export async function validatePromoCode(
  rawCode: string,
  lookup?: LookupFn,
): Promise<ValidationResult> {
  const code = normalizeCode(rawCode.trim())

  if (!code) {
    return { ok: false, reason: 'empty', message: 'Please enter a promo code.' }
  }

  const row = await (lookup ?? dbLookup)(code)

  if (!row) {
    return { ok: false, reason: 'not_found', message: 'This code doesn\'t exist.' }
  }

  if (!row.is_active) {
    return { ok: false, reason: 'inactive', message: 'This code is no longer active.' }
  }

  const now = new Date()

  if (row.valid_from && new Date(row.valid_from) > now) {
    return { ok: false, reason: 'not_yet_valid', message: 'This code isn\'t valid yet.' }
  }

  if (row.valid_until && new Date(row.valid_until) < now) {
    return { ok: false, reason: 'expired', message: 'This code has expired.' }
  }

  if (row.max_uses !== null && row.uses_count >= row.max_uses) {
    return { ok: false, reason: 'max_uses_reached', message: 'This code has reached its usage limit.' }
  }

  return { ok: true, code: row }
}

async function dbLookup(normalised: string): Promise<PromoCodeRow | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('promo_codes')
    .select('id, code, label, discount_type, discount_value, fixed_discount_cents, max_uses, uses_count, valid_from, valid_until, is_active')
    .eq('code', normalised)
    .maybeSingle()
  return (data as PromoCodeRow) ?? null
}
