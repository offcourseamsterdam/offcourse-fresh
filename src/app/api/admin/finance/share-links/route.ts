import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateFinanceShareToken } from '@/lib/auth/finance-share'

/**
 * GET/POST /api/admin/finance/share-links
 *
 * Manages temporary accountant links to the Finance tab (see migration 107,
 * src/lib/auth/finance-share.ts). Deliberately requireAdmin() ONLY — the
 * share token itself must never be able to mint or revoke other tokens.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('finance_share_links')
    .select('id, token, label, created_at, revoked_at')
    .order('created_at', { ascending: false })

  if (error) return apiError(error.message)
  return apiOk({ links: data ?? [] })
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null

  const supabase = createAdminClient()
  const token = generateFinanceShareToken()
  const { data, error } = await supabase
    .from('finance_share_links')
    .insert({ token, label })
    .select('id, token, label, created_at, revoked_at')
    .single()

  if (error) return apiError(error.message)
  return apiOk({ link: data })
}
