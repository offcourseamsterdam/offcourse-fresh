import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { isUuid, invoiceRejectSchema, parseBody } from '@/lib/finance/cockpit/schemas'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/finance/cockpit/invoices/[id]/reject {note?}
 * Never creates an obligation, never touches the extracted data — just
 * records the decision so the invoice stops showing up as something to act on.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid invoice id', 400)
  const parsed = await parseBody(request, invoiceRejectSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { data: invoice, error: fetchErr } = await supabase.from('finance_invoices').select('id, decision').eq('id', id).maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!invoice) return apiError('Invoice not found', 404)
    if (invoice.decision) return apiError(`Invoice already ${invoice.decision === 'rejected' ? 'rejected' : 'approved'}`, 400)

    const { data: updated, error } = await supabase
      .from('finance_invoices')
      .update({
        status: 'rejected',
        decision: 'rejected',
        decided_by: 'admin',
        decided_at: new Date().toISOString(),
        decision_note: parsed.data.note ?? null,
      })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !updated) return apiError(error?.message ?? 'Could not reject invoice', 500)

    await logFinanceEvent(supabase, {
      event_type: 'invoice_rejected',
      actor: 'user',
      entity_type: 'invoice',
      entity_id: id,
      payload: { note: parsed.data.note ?? null },
    })

    return apiOk(updated)
  } catch (err) {
    console.error('[finance/cockpit/invoices/[id]/reject]', err)
    return apiError(err instanceof Error ? err.message : 'Could not reject invoice', 500)
  }
}
