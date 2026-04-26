import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/admin/partners/[id]/settlements
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('partner_settlements')
    .select('*')
    .eq('partner_id', id)
    .order('quarter', { ascending: false })
  if (error) return apiError(error.message)
  return apiOk(data ?? [])
}

// POST /api/admin/partners/[id]/settlements
// Body: { quarter, settlementType, amountCents, notes? }
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const body = await req.json()

  const quarter = String(body.quarter ?? '').trim()
  const settlementType = String(body.settlementType ?? '').trim()
  const amountCents = Number(body.amountCents ?? 0)
  const notes = body.notes ? String(body.notes) : null

  if (!/^\d{4}-Q[1-4]$/.test(quarter)) return apiError('Invalid quarter', 400)
  if (settlementType !== 'partner_invoice' && settlementType !== 'affiliate') {
    return apiError('settlementType must be partner_invoice or affiliate', 400)
  }
  if (!Number.isFinite(amountCents) || amountCents < 0) {
    return apiError('amountCents must be a non-negative number', 400)
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('partner_settlements')
    .insert({
      partner_id: id,
      quarter,
      settlement_type: settlementType,
      amount_cents: amountCents,
      notes,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      return apiError('This quarter is already marked settled for this type.', 409)
    }
    return apiError(error.message)
  }
  return apiOk(data)
}
