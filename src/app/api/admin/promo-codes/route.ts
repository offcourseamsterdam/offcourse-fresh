import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeCode } from '@/lib/promo-codes/validate'

/**
 * GET  /api/admin/promo-codes — list all codes (newest first)
 * POST /api/admin/promo-codes — create a new code
 */

export async function GET() {
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

function generateCode(): string {
  const chars = Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}
