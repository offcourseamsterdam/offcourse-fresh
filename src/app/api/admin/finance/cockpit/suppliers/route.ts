import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { parseBody, supplierCreateSchema } from '@/lib/finance/cockpit/schemas'
import { isValidIban, normalizeIban } from '@/lib/finance/iban'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/finance/cockpit/suppliers — active suppliers, for the
 * manual-upload picker (and future supplier management UI).
 *
 * Returns `has_iban`, never the IBAN itself: the picker only needs to know
 * whether "Goedkeuren & betalen" will be possible, and bank details have no
 * business in a browser payload that's fetched every time the modal opens.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('finance_suppliers')
      .select('id, name, staff_id, iban')
      .eq('is_active', true)
      .order('name', { ascending: true })
    if (error) return apiError(error.message, 500)
    return apiOk((data ?? []).map(s => ({ id: s.id, name: s.name, staff_id: s.staff_id, has_iban: !!s.iban })))
  } catch (err) {
    console.error('[finance/cockpit/suppliers GET]', err)
    return apiError(err instanceof Error ? err.message : 'Could not load suppliers', 500)
  }
}

/**
 * POST /api/admin/finance/cockpit/suppliers {name, iban}
 * A new payee for payment drafting (an obligation or an Expense Record) — the IBAN's checksum is
 * verified here, once, so nothing downstream has to trust an unvalidated string again.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const parsed = await parseBody(request, supplierCreateSchema)
  if (!parsed.ok) return parsed.response

  const iban = normalizeIban(parsed.data.iban)
  if (!isValidIban(iban)) return apiError('IBAN klopt niet (controlegetal faalt)', 400)

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.from('finance_suppliers').insert({ name: parsed.data.name, iban }).select('id, name, staff_id, iban').single()
    if (error || !data) return apiError(error?.message ?? 'Could not create supplier', 500)

    await logFinanceEvent(supabase, {
      event_type: 'supplier_created',
      actor: 'user',
      entity_type: 'supplier',
      entity_id: data.id,
      payload: { name: data.name },
    })

    return apiOk({ id: data.id, name: data.name, staff_id: data.staff_id, has_iban: true })
  } catch (err) {
    console.error('[finance/cockpit/suppliers POST]', err)
    return apiError(err instanceof Error ? err.message : 'Could not create supplier', 500)
  }
}
