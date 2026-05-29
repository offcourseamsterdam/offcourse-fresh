import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeCode } from '@/lib/promo-codes/validate'

/**
 * GET  /api/admin/promo-codes — list all codes (newest first)
 * POST /api/admin/promo-codes — create a new code
 */

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('promo_codes')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) return apiError(error.message)
    return apiOk({ codes: data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = await request.json()
    const {
      code,
      label,
      discount_type,
      discount_value,
      fixed_discount_cents,
      max_uses,
      valid_from,
      valid_until,
      partner_id,
      campaign_id,
      discount_scope,
      notes,
    } = body

    if (!label || !discount_type) {
      return apiError('label and discount_type are required', 400)
    }
    if (!['percentage', 'fixed_amount', 'full'].includes(discount_type)) {
      return apiError('discount_type must be percentage, fixed_amount, or full', 400)
    }
    if (discount_type === 'percentage' && !discount_value) {
      return apiError('discount_value is required for percentage codes', 400)
    }
    if (discount_type === 'fixed_amount' && !fixed_discount_cents) {
      return apiError('fixed_discount_cents is required for fixed_amount codes', 400)
    }
    if (discount_scope && !['cruise', 'all'].includes(discount_scope)) {
      return apiError('discount_scope must be cruise or all', 400)
    }

    // Auto-generate code if not provided
    const finalCode = code
      ? normalizeCode(code)
      : generateCode()

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('promo_codes')
      .insert({
        code: finalCode,
        label,
        discount_type,
        discount_value: discount_value ?? null,
        fixed_discount_cents: fixed_discount_cents ?? null,
        max_uses: max_uses ?? null,
        valid_from: valid_from ?? null,
        valid_until: valid_until ?? null,
        partner_id: partner_id ?? null,
        campaign_id: campaign_id ?? null,
        discount_scope: discount_scope ?? 'cruise',
        notes: notes ?? null,
      })
      .select()
      .single()

    if (error) return apiError(error.message)
    return apiOk({ code: data })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

const ALPHABET = 'ACDEFGHJKLMNPQRTUVWXY3469'

/**
 * Short 4-char promo code, e.g. "FQHY". Compact enough to write on a partner's
 * desk reminder card and dictate over the phone. Uses an alphabet with no
 * lookalike characters.
 *
 * Older 8-char dashed codes like "RUU4-XL3N" still validate via normalizeCode's
 * backward-compat branch — no migration needed for existing codes.
 */
function generateCode(): string {
  return Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')
}
