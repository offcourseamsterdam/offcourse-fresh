import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiOk, apiError } from '@/lib/api/response'
import { generatePartnerCode, threeMonthsFromNow } from '@/lib/partner-codes/generate'

/**
 * GET /api/admin/partners/[id]/codes — list all codes for a partner,
 * newest first. Status is derived in the UI (active / expired / revoked).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('partner_codes')
      .select('id, code, issued_at, expires_at, is_active, revoked_at, notes')
      .eq('partner_id', id)
      .order('issued_at', { ascending: false })

    if (error) return apiError(error.message)
    return apiOk({ codes: data ?? [] })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

/**
 * POST /api/admin/partners/[id]/codes — generate a new code.
 * Previously-active codes are left alone so physical receipts already in
 * circulation keep working through their 3-month window.
 *
 * Retries up to 5 times on the (extremely unlikely) unique-constraint collision.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    // Guard: make sure the partner exists
    const { data: partner } = await supabase
      .from('partners')
      .select('id, name')
      .eq('id', id)
      .single()
    if (!partner) return apiError('Partner not found', 404)

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generatePartnerCode()
      const { data, error } = await supabase
        .from('partner_codes')
        .insert({
          partner_id: id,
          code,
          expires_at: threeMonthsFromNow(),
        })
        .select('id, code, issued_at, expires_at, is_active, revoked_at, notes')
        .single()

      if (!error && data) return apiOk({ code: data })
      if (error && !error.message.toLowerCase().includes('duplicate')) {
        return apiError(error.message)
      }
      // else: collision, try again
    }

    return apiError('Could not generate a unique code — please try again.', 500)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
